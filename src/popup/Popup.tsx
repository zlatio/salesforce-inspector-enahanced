import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ArrowRight, Box, Cloud, Database, ExternalLink, Fingerprint, Gauge, KeyRound, Settings2, TerminalSquare, X } from "lucide-preact";
import { resolveApiHost } from "../lib/auth";
import { parsePageContext, parsePastedTarget, type PageContext } from "../lib/context";
import { connectOrg, loadRecentOrgs, shortOrgName, type OrgState, type RecentOrg } from "../lib/org";
import { apiUsage, SfError } from "../lib/sf";
import type { GlobalSObject } from "../lib/types";
import { fmtPercent } from "../lib/format";
import { load, save } from "../lib/storage";
import { CopyButton, EnvBadge, Kbd, Spinner, Switch } from "../ui";
import { ThemeMenu } from "../app/Shell";
import { rankObjects } from "../app/Palette";
import { appUrl, links } from "../app/router";
import { openAppTab } from "../lib/openApp";
import { loadRecent, type RecentItem } from "../lib/recent";
import { buildDefaultQuery } from "../lib/queries";

const params = new URLSearchParams(location.search);
const embedded = params.get("embedded") === "1";

function closePopup() {
  if (embedded) window.parent.postMessage({ type: "sie:close" }, "*");
  else window.close();
}

async function openTab(url: string, forceNew = false) {
  if (!chrome.tabs?.create) {
    window.open(url, "_blank");
    return closePopup();
  }
  await openAppTab(url, { forceNew });
  closePopup();
}

// When embedded in the in-page panel, tell the page how tall the content is so the panel fits it.
if (embedded) {
  const report = () => {
    const el = document.querySelector(".popup");
    if (el) window.parent.postMessage({ type: "sie:height", h: Math.ceil(el.getBoundingClientRect().height) }, "*");
  };
  new ResizeObserver(report).observe(document.body);
  new MutationObserver(report).observe(document.body, { childList: true, subtree: true });
}

type Phase = { kind: "loading" } | { kind: "nosf"; recent: RecentOrg[] } | { kind: "error"; host: string; error: Error } | { kind: "ready"; st: OrgState; ctx: PageContext; title: { name: string; object: string } | null };

/** "Acme Corp | Account | Salesforce" → { name: "Acme Corp", object: "Account" } (Lightning record tab titles). */
function recordNameFromTitle(title: string | null | undefined): { name: string; object: string } | null {
  const parts = title?.split(" | ").map((x) => x.trim()) ?? [];
  if (parts.length < 3 || !parts[0] || parts[0].length > 120) return null;
  return { name: parts[0], object: parts[1] };
}

export function Popup() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    (async () => {
      let pageUrl = params.get("url") ?? "";
      let pageTitle = params.get("title");
      if (!pageUrl && chrome.tabs?.query) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        pageUrl = tab?.url ?? "";
        pageTitle = tab?.title ?? null;
      }
      const host = pageUrl ? await resolveApiHost(pageUrl) : null;
      if (!host) return setPhase({ kind: "nosf", recent: await loadRecentOrgs() });
      try {
        const st = await connectOrg(host);
        setPhase({ kind: "ready", st, ctx: parsePageContext(pageUrl), title: recordNameFromTitle(pageTitle) });
      } catch (e) {
        setPhase({ kind: "error", host, error: e as Error });
      }
    })();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePopup();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class={"popup" + (embedded ? " popup--embedded" : "")}>
      {phase.kind === "loading" && (
        <>
          <PopupHeader />
          <div class="popup__center">
            <Spinner />
          </div>
        </>
      )}
      {phase.kind === "nosf" && <NoSalesforce recent={phase.recent} />}
      {phase.kind === "error" && <ErrorState host={phase.host} error={phase.error} />}
      {phase.kind === "ready" && <Ready st={phase.st} ctx={phase.ctx} pageTitle={phase.title} />}
    </div>
  );
}

function PopupHeader({ st }: { st?: OrgState }) {
  return (
    <header class="pheader">
      <img src="./icons/icon32.png" width={22} height={22} alt="" class="pheader__logo" />
      {st ? (
        <div class="pheader__org">
          <div class="pheader__name truncate">
            {st.org?.Name ?? shortOrgName(st.sf.host)}
            {st.env === "sandbox" && <span class="muted"> / {shortOrgName(st.sf.host)}</span>}
          </div>
          <div class="pheader__host mono truncate" title={st.sf.host}>
            {st.sf.host}
          </div>
        </div>
      ) : (
        <div class="pheader__org">
          <div class="pheader__name">Inspector</div>
        </div>
      )}
      {st && <EnvBadge env={st.env} />}
      <ThemeMenu />
      {embedded && (
        <button class="copy" aria-label="Close" onClick={closePopup} style={{ width: 28, height: 28 }}>
          <X />
        </button>
      )}
    </header>
  );
}

function Ready({ st, ctx, pageTitle: titleInfo }: { st: OrgState; ctx: PageContext; pageTitle: { name: string; object: string } | null }) {
  const sf = st.sf;
  const [objects, setObjects] = useState<GlobalSObject[]>([]);
  const [ctxObject, setCtxObject] = useState<GlobalSObject | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ctrl/Cmd-click (or middle-click) opens a separate tab; otherwise the org's Inspector tab is reused.
  const newTabMod = useRef(false);
  const open = (hash: string) => openTab(appUrl(sf.host, hash), newTabMod.current);
  useEffect(() => {
    const track = (e: MouseEvent | KeyboardEvent) => (newTabMod.current = e.metaKey || e.ctrlKey);
    window.addEventListener("mousedown", track, true);
    window.addEventListener("keydown", track, true);
    return () => {
      window.removeEventListener("mousedown", track, true);
      window.removeEventListener("keydown", track, true);
    };
  }, []);
  const queryObject = async (objName: string, recordId?: string) => open(links.query(await buildDefaultQuery(sf, objName, recordId ? { where: `Id = '${recordId}'` } : {})));

  useEffect(() => {
    inputRef.current?.focus();
    sf.describeGlobal().then((g) => {
      const list = g.sobjects.filter((o) => !o.deprecatedAndHidden);
      setObjects(list);
      if (ctx.objectName) setCtxObject(list.find((o) => o.name.toLowerCase() === ctx.objectName!.toLowerCase()) ?? null);
      else if (ctx.recordId) setCtxObject(list.find((o) => o.keyPrefix === ctx.recordId!.slice(0, 3)) ?? null);
    });
  }, []);

  const s = q.trim();
  const results = useMemo(() => (s && !/^https?:/i.test(s) ? rankObjects(objects, s, 6) : []), [objects, s]);
  const pasted = parsePastedTarget(s);
  const idHit = !!pasted?.recordId;
  const total = (idHit ? 1 : 0) + results.length;
  useEffect(() => setSel(0), [s]);

  const choose = (i: number) => {
    if (idHit && i === 0) return open(pasted!.objectName ? links.record(pasted!.objectName, pasted!.recordId!) : links.id(pasted!.recordId!));
    const o = results[i - (idHit ? 1 : 0)];
    if (o) open(links.object(o.name));
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") (e.preventDefault(), setSel((x) => Math.min(total - 1, x + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setSel((x) => Math.max(0, x - 1)));
    else if (e.key === "Enter" && total) (e.preventDefault(), choose(sel));
  };

  const u = apiUsage.value;
  const objName = ctxObject?.name ?? ctx.objectName;
  // Only trust the tab title when its object part matches what we detected (titles can be stale or from Setup).
  const pageTitle = titleInfo && ctxObject && [ctxObject.label.toLowerCase(), ctxObject.name.toLowerCase()].includes(titleInfo.object.toLowerCase()) ? titleInfo.name : null;

  return (
    <>
      <PopupHeader st={st} />
      <div class="pbody">
        {(ctx.recordId || objName) && (
          <section class="pctx">
            <div class="pctx__eyebrow">On this page</div>
            <div class="pctx__card">
              <div class="pctx__icon">{ctx.recordId ? <Fingerprint /> : <Box />}</div>
              <div class="grow" style={{ minWidth: 0 }}>
                <div class="pctx__title truncate" title={ctx.recordId && pageTitle ? pageTitle : undefined}>
                  {ctx.recordId && pageTitle ? pageTitle : (ctxObject?.label ?? objName ?? "Record")}
                </div>
                <div class="pctx__sub">
                  {ctx.recordId ? (
                    <>
                      {pageTitle && <span class="pctx__obj">{ctxObject?.label ?? objName}</span>}
                      <span class="mono truncate">{ctx.recordId}</span>
                      <CopyButton text={ctx.recordId} label="Copy record ID" />
                    </>
                  ) : (
                    <span class="mono truncate">{objName}</span>
                  )}
                </div>
              </div>
            </div>
            <div class="pctx__actions">
              {ctx.recordId ? (
                <button class="btn btn--primary pctx__main" onClick={() => open(objName ? links.record(objName, ctx.recordId!) : links.id(ctx.recordId!))}>
                  <Database /> Inspect record <Kbd>↵</Kbd>
                </button>
              ) : (
                <button class="btn btn--primary pctx__main" onClick={() => open(links.object(objName!))}>
                  <Database /> Inspect object
                </button>
              )}
              {objName && ctxObject?.queryable !== false && (
                <button class="btn" onClick={() => queryObject(objName, ctx.recordId)}>
                  <TerminalSquare /> Query
                </button>
              )}
            </div>
          </section>
        )}

        <section class="psearch">
          <div class="psearch__box">
            <input
              ref={inputRef}
              class="input"
              aria-label="Search objects or paste a record ID"
              role="combobox"
              aria-expanded={!!s}
              aria-controls="popup-results"
              aria-activedescendant={s && total ? `presult-${sel}` : undefined}
              placeholder="Search objects or paste a record ID"
              value={q}
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !s && ctx.recordId) {
                  e.preventDefault();
                  open(objName ? links.record(objName, ctx.recordId) : links.id(ctx.recordId));
                  return;
                }
                onKey(e);
              }}
              spellcheck={false}
            />
          </div>
          {s && (
            <div class="presults" role="listbox" id="popup-results">
              {idHit && (
                <button id="presult-0" tabIndex={-1} class={"presult" + (sel === 0 ? " is-active" : "")} onMouseMove={() => setSel(0)} onClick={() => choose(0)} role="option" aria-selected={sel === 0}>
                  <Fingerprint />
                  <span class="grow truncate">
                    Inspect {pasted?.objectName ?? "record"} <span class="mono">{pasted?.recordId}</span>
                  </span>
                  <ArrowRight class="presult__go" />
                </button>
              )}
              {results.map((o, i) => {
                const idx = i + (idHit ? 1 : 0);
                return (
                  <button key={o.name} id={`presult-${idx}`} tabIndex={-1} class={"presult" + (sel === idx ? " is-active" : "")} onMouseMove={() => setSel(idx)} onClick={() => choose(idx)} role="option" aria-selected={sel === idx}>
                    <Box />
                    <span class="grow truncate">
                      {o.label} <span class="mono muted">{o.name}</span>
                    </span>
                    <ArrowRight class="presult__go" />
                  </button>
                );
              })}
              {!idHit && results.length === 0 && <div class="presult presult--empty">No objects match “{s}”</div>}
            </div>
          )}
        </section>

        {!s && <RecentList host={sf.host} exclude={ctx.recordId} onOpen={(r) => open(r.recordId ? links.record(r.objectName, r.recordId) : links.object(r.objectName))} />}

        <section class="ptools">
          <button class="ptool" onClick={() => open(links.objects())}>
            <span class="ptool__icon">
              <Database />
            </span>
            <span class="ptool__title">Objects</span>
            <span class="ptool__desc">Browse objects, edit records</span>
          </button>
          <button class="ptool" onClick={() => open(links.query())}>
            <span class="ptool__icon">
              <TerminalSquare />
            </span>
            <span class="ptool__title">SOQL query</span>
            <span class="ptool__desc">Run, save & export</span>
          </button>
          <button class="ptool" onClick={() => open(links.limits())}>
            <span class="ptool__icon">
              <Gauge />
            </span>
            <span class="ptool__title">Org limits</span>
            <span class="ptool__desc">Usage & licenses</span>
          </button>
        </section>
      </div>
      <footer class="pfoot">
        {u && (
          <span class="pfoot__api" title={`${u.used.toLocaleString()} of ${u.max.toLocaleString()} daily API requests used`}>
            <span class={"pfoot__dot" + (u.used / u.max >= 0.9 ? " is-danger" : u.used / u.max >= 0.75 ? " is-warning" : "")} aria-hidden="true" />
            API {fmtPercent((u.used / u.max) * 100)} used
          </span>
        )}
        <span class="pfoot__sep" />
        <a class="pfoot__link" href={`https://${sf.lightningHost}/lightning/setup/SetupOneHome/home`} target="_blank" rel="noreferrer">
          <Settings2 /> Setup
        </a>
        <LauncherToggle />
      </footer>
    </>
  );
}

function LauncherToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    load("sie.launcher", false).then(setOn);
  }, []);
  return (
    <Switch
      checked={on}
      onChange={(v) => {
        setOn(v);
        save("sie.launcher", v);
      }}
      title="Also show a small Inspector tab on the right edge of Salesforce pages"
    >
      In-page button
    </Switch>
  );
}

function NoSalesforce({ recent }: { recent: RecentOrg[] }) {
  return (
    <>
      <PopupHeader />
      <div class="pbody">
        <div class="pempty">
          <div class="empty__icon">
            <Cloud />
          </div>
          <div class="empty__title">Not a Salesforce page</div>
          <div class="muted">Open a Salesforce org in this tab to inspect records, or jump to a recent org below.</div>
        </div>
        {recent.length > 0 && (
          <section>
            <div class="pctx__eyebrow">Recent orgs</div>
            <div class="porgs">
              {recent.map((o) => (
                <button class="porg" key={o.host} onClick={() => openTab(appUrl(o.host, "#/inspect"))}>
                  <div class="grow" style={{ minWidth: 0 }}>
                    <div class="porg__name truncate">{o.name}</div>
                    <div class="mono muted truncate porg__host">{o.host}</div>
                  </div>
                  <EnvBadge env={o.env} />
                  <ExternalLink class="presult__go" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function ErrorState({ host, error }: { host: string; error: Error }) {
  const noSession = error instanceof SfError && (error.isSessionError || error.errorCode === "NO_SESSION");
  return (
    <>
      <PopupHeader />
      <div class="pbody">
        <div class="pempty">
          <div class="empty__icon" style={{ background: "var(--danger-soft)", color: "var(--danger-text)" }}>
            <KeyRound />
          </div>
          <div class="empty__title">{noSession ? "Not signed in" : "Couldn't connect"}</div>
          <div class="muted">{noSession ? <>Log in to <span class="mono">{host}</span> in this browser, then reopen Inspector.</> : error.message}</div>
        </div>
      </div>
    </>
  );
}

function RecentList({ host, exclude, onOpen }: { host: string; exclude?: string; onOpen: (r: RecentItem) => void }) {
  const items = loadRecent(host)
    .filter((r) => !exclude || r.recordId?.slice(0, 15) !== exclude.slice(0, 15))
    .slice(0, 4);
  if (!items.length) return null;
  return (
    <section>
      <div class="pctx__eyebrow">Recent in Inspector</div>
      <div class="porgs">
        {items.map((r) => (
          <button class="porg prec" key={r.objectName + (r.recordId ?? "")} onClick={() => onOpen(r)}>
            {r.recordId ? <Fingerprint class="prec__icon" /> : <Box class="prec__icon" />}
            <div class="grow" style={{ minWidth: 0 }}>
              <div class="porg__name truncate">{r.title}</div>
              <div class="muted truncate porg__host">{r.recordId ? `${r.objectName} · ${r.recordId}` : "Object"}</div>
            </div>
            <ArrowRight class="presult__go" />
          </button>
        ))}
      </div>
    </section>
  );
}
