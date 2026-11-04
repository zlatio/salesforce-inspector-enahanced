import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ArrowRight, Box, Check, Cloud, Database, ExternalLink, Fingerprint, Gauge, KeyRound, PanelRight, Settings2, SlidersHorizontal, TerminalSquare, Upload, Users, X } from "lucide-preact";
import { RecordPeek } from "./RecordPeek";
import { resolveApiHost, toApiHost } from "../lib/auth";
import { parsePageContext, parsePastedTarget, type PageContext } from "../lib/context";
import { connectOrg, loadRecentOrgs, shortOrgName, type OrgState, type RecentOrg } from "../lib/org";
import { apiUsage, SfError } from "../lib/sf";
import type { GlobalSObject } from "../lib/types";
import { fmtPercent } from "../lib/format";
import { load, save } from "../lib/storage";
import { Button, CopyButton, EnvBadge, Kbd, Menu, Spinner, Toasts, toast } from "../ui";
import { ThemeMenu } from "../app/Shell";
import { rankObjects } from "../app/Palette";
import { appUrl, links } from "../app/router";
import { openAppTab } from "../lib/openApp";
import { loadRecent, type RecentItem } from "../lib/recent";
import { buildDefaultQuery } from "../lib/queries";

const params = new URLSearchParams(location.search);
const embedded = params.get("embedded") === "1";
/** The same UI runs as the toolbar popup, inside the in-page panel, or as Chrome's side panel. */
const isPanel = location.pathname.endsWith("sidepanel.html");

function closePopup() {
  if (isPanel) return; // the side panel stays open
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

/** Open Chrome's side panel for this window (must run from a user gesture, e.g. a click in the popup). */
async function openSidePanel() {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id! });
    window.close();
  } catch (e) {
    toast("error", "Couldn't open the side panel", (e as Error).message);
  }
}

// Connecting costs a few API calls, so reuse the connection while the side panel follows tabs around.
// A connection holds the session token it was made with; sessionGen counts session changes so the
// view built on an old connection is replaced, not just re-rendered.
const orgCache = new Map<string, Promise<OrgState>>();
let sessionGen = 0;
function connectCached(host: string) {
  let p = orgCache.get(host);
  if (!p) {
    p = connectOrg(host);
    p.catch(() => orgCache.delete(host));
    orgCache.set(host, p);
  }
  return p;
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

type Phase = { kind: "loading" } | { kind: "nosf"; recent: RecentOrg[] } | { kind: "error"; host: string; error: Error } | { kind: "ready"; st: OrgState; ctx: PageContext; title: { name: string; object: string } | null; gen: number };

/** "Acme Corp | Account | Salesforce" → { name: "Acme Corp", object: "Account" } (Lightning record tab titles). */
function recordNameFromTitle(title: string | null | undefined): { name: string; object: string } | null {
  const parts = title?.split(" | ").map((x) => x.trim()) ?? [];
  if (parts.length < 3 || !parts[0] || parts[0].length > 120) return null;
  return { name: parts[0], object: parts[1] };
}

export function Popup() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const lastUrl = useRef<string | null>(null);
  // calls: newest detect() started (its tab lookup wins). seq: newest connect in flight (its result wins).
  const calls = useRef(0);
  const seq = useRef(0);
  // The side panel belongs to one browser window and follows only that window's active tab.
  const myWindow = useRef<number | undefined>(undefined);

  const detect = useCallback(async () => {
    const call = ++calls.current;
    let pageUrl = params.get("url") ?? "";
    let pageTitle = params.get("title");
    if (!pageUrl && chrome.tabs?.query) {
      if (isPanel && myWindow.current == null) myWindow.current = (await chrome.windows.getCurrent()).id;
      const [tab] = await chrome.tabs.query(isPanel && myWindow.current != null ? { active: true, windowId: myWindow.current } : { active: true, currentWindow: true });
      pageUrl = tab?.url ?? "";
      pageTitle = tab?.title ?? null;
      if (call !== calls.current) return;
    }
    // Lightning updates the tab title after the URL, so a title change alone is worth a refresh too.
    const key = pageUrl + "|" + (pageTitle ?? "");
    // A repeat event for the same page (status/title updates) must not cancel the lookup in flight.
    if (key === lastUrl.current && isPanel) return;
    lastUrl.current = key;
    const mine = ++seq.current;
    const host = pageUrl ? await resolveApiHost(pageUrl) : null;
    // A slower, older detection must never overwrite a newer one.
    const current = () => mine === seq.current;
    if (!host) {
      const recent = await loadRecentOrgs();
      if (current()) setPhase({ kind: "nosf", recent });
      return;
    }
    try {
      const gen = sessionGen;
      const st = await connectCached(host);
      if (current()) setPhase({ kind: "ready", st, ctx: parsePageContext(pageUrl), title: recordNameFromTitle(pageTitle), gen });
    } catch (e) {
      if (current()) setPhase({ kind: "error", host, error: e as Error });
    }
  }, []);

  useEffect(() => {
    detect();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePopup();
    window.addEventListener("keydown", onKey);
    if (!isPanel) return () => window.removeEventListener("keydown", onKey);
    // Side panel: follow the active tab — switching tabs, navigating within Salesforce, changing windows.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(detect, 250);
    };
    const onActivated = (info: { tabId: number; windowId: number }) => info.windowId === myWindow.current && soon();
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => tab.active && tab.windowId === myWindow.current && (info.url || info.status === "complete" || info.title) && soon();
    // Logging in again, "Log in as" or a new session replaces the sid cookie: drop that org's cached
    // connection (it holds the old token) and reconnect.
    const onCookie = ({ cookie }: chrome.cookies.CookieChangeInfo) => {
      if (cookie.name !== "sid") return;
      const host = toApiHost(cookie.domain.replace(/^\./, ""));
      if (!orgCache.has(host)) return;
      orgCache.delete(host);
      sessionGen++;
      lastUrl.current = null;
      soon();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.cookies.onChanged.addListener(onCookie);
    return () => {
      window.removeEventListener("keydown", onKey);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.cookies.onChanged.removeListener(onCookie);
    };
  }, []);

  return (
    <div class={"popup" + (embedded ? " popup--embedded" : "") + (isPanel ? " popup--panel" : "")}>
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
      {phase.kind === "ready" && <Ready key={`${phase.st.sf.host}#${phase.gen}`} st={phase.st} ctx={phase.ctx} pageTitle={phase.title} />}
      <Toasts />
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
      {!embedded && !isPanel && chrome.sidePanel && (
        <Button variant="ghost" icon size="sm" aria-label="Open in side panel" data-tip="Open in side panel" data-tip-pos="left" onClick={openSidePanel}>
          <PanelRight />
        </Button>
      )}
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
  const ctxObject = useMemo<GlobalSObject | null>(() => {
    if (ctx.objectName) return objects.find((o) => o.name.toLowerCase() === ctx.objectName!.toLowerCase()) ?? null;
    if (ctx.recordId) return objects.find((o) => o.keyPrefix === ctx.recordId!.slice(0, 3)) ?? null;
    return null;
  }, [objects, ctx.objectName, ctx.recordId]);
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
    if (!isPanel) inputRef.current?.focus();
    sf.describeGlobal().then((g) => setObjects(g.sobjects.filter((o) => !o.deprecatedAndHidden)));
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
                  <Database /> Inspect record {!isPanel && <Kbd>↵</Kbd>}
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

        {isPanel && ctx.recordId && objects.length > 0 && (
          <RecordPeek
            key={ctx.recordId}
            sf={sf}
            objectName={ctxObject?.name}
            recordId={ctx.recordId}
            onOpenField={(obj, field, tooling) => open(`${links.record(obj, ctx.recordId!)}?field=${encodeURIComponent(field)}${tooling ? "&tooling=1" : ""}`)}
          />
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
          <button class="ptool" onClick={() => open(links.users())}>
            <span class="ptool__icon">
              <Users />
            </span>
            <span class="ptool__title">Users</span>
            <span class="ptool__desc">Access, logins, debug logs</span>
          </button>
          <button class="ptool" onClick={() => open(links.import(ctxObject?.name))}>
            <span class="ptool__icon">
              <Upload />
            </span>
            <span class="ptool__title">Data import</span>
            <span class="ptool__desc">Insert, update, delete</span>
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
        <SettingsMenu />
      </footer>
    </>
  );
}

/** Small settings menu: what the toolbar icon opens, and whether the in-page button is shown. */
function SettingsMenu() {
  const [launcher, setLauncher] = useState(false);
  const [actionMode, setActionMode] = useState<"popup" | "panel">("popup");
  useEffect(() => {
    load("sie.launcher", false).then(setLauncher);
    load<"popup" | "panel">("sie.actionMode", "popup").then(setActionMode);
  }, []);
  const item = (checked: boolean, label: string, onClick: () => void, close: () => void, role: "menuitemradio" | "menuitemcheckbox" = "menuitemradio") => (
    <button
      role={role}
      aria-checked={checked}
      class="menu__item"
      onClick={() => {
        onClick();
        close();
      }}
    >
      <span class="menu__check">{checked && <Check />}</span>
      {label}
    </button>
  );
  return (
    <Menu
      trigger={(open, toggle) => (
        <Button variant="ghost" size="sm" onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
          <SlidersHorizontal /> Settings
        </Button>
      )}
    >
      {(close) => (
        <>
          <div role="group" aria-labelledby="sie-toolbar-opens">
            <div class="menu__label" id="sie-toolbar-opens">
              Toolbar icon opens
            </div>
            {item(actionMode === "popup", "Popup", () => (setActionMode("popup"), save("sie.actionMode", "popup")), close)}
            {chrome.sidePanel && item(actionMode === "panel", "Side panel", () => (setActionMode("panel"), save("sie.actionMode", "panel")), close)}
          </div>
          <div class="menu__sep" role="separator" />
          <div class="menu__label" role="none">
            On Salesforce pages
          </div>
          {item(launcher, "Show the in-page Inspector button", () => (setLauncher(!launcher), save("sie.launcher", !launcher)), close, "menuitemcheckbox")}
        </>
      )}
    </Menu>
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
