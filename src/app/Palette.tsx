import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Box, Clock, CornerDownLeft, Database, ExternalLink, Fingerprint, Gauge, ListTree, Monitor, Moon, Search, Settings2, Star, Sun, TerminalSquare, Upload, Users } from "lucide-preact";
import { orgState } from "../lib/org";
import { parsePastedTarget } from "../lib/context";
import { setTheme } from "../lib/theme";
import { loadRecent } from "../lib/recent";
import { load } from "../lib/storage";
import type { DescribeSObjectResult, GlobalSObject } from "../lib/types";
import { fmtRelative } from "../lib/format";
import { Keys, Kbd, modKey } from "../ui";
import { buildDefaultQuery } from "../lib/queries";
import { links, navigate } from "./router";

export const paletteOpen = signal(false);

type Mods = { mod: boolean; shift: boolean };

interface Item {
  id: string;
  group: string;
  icon: ComponentChildren;
  title: ComponentChildren;
  /** Plain text used for matching commands. */
  text?: string;
  hint?: ComponentChildren;
  run: (m: Mods) => void;
}

export function rankObjects(list: GlobalSObject[], q: string, limit = 40): GlobalSObject[] {
  const s = q.trim().toLowerCase();
  if (!s) return list.slice(0, limit);
  const scored: Array<[number, GlobalSObject]> = [];
  for (const o of list) {
    const name = o.name.toLowerCase();
    const label = o.label.toLowerCase();
    let score = -1;
    if (name === s || label === s) score = 100;
    else if (name.startsWith(s)) score = 80 - name.length / 100;
    else if (label.startsWith(s)) score = 70 - label.length / 100;
    else if (name.includes(s)) score = 50 - name.length / 100;
    else if (label.includes(s)) score = 40 - label.length / 100;
    if (score >= 0) scored.push([score + (o.custom ? 0 : 1) + (o.queryable ? 0.5 : 0), o]);
  }
  return scored
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map((x) => x[1]);
}

const SETUP: Array<[string, string]> = [
  ["Object Manager", "ObjectManager/home"],
  ["Users", "ManageUsers/home"],
  ["Profiles", "EnhancedProfiles/home"],
  ["Permission Sets", "PermSets/home"],
  ["Flows", "Flows/home"],
  ["Apex Classes", "ApexClasses/home"],
  ["Apex Jobs", "AsyncApexJobs/home"],
  ["Scheduled Jobs", "ScheduledJobs/home"],
  ["Debug Logs", "ApexDebugLogs/home"],
  ["Custom Metadata Types", "CustomMetadata/home"],
  ["Deployment Status", "DeployStatus/home"],
  ["Company Information", "CompanyProfileInfo/home"],
];

interface SavedQuery {
  id: string;
  name: string;
  soql: string;
  tooling: boolean;
}

export function Palette() {
  const [q, setQ] = useState("");
  const [objects, setObjects] = useState<GlobalSObject[]>([]);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [fieldsOf, setFieldsOf] = useState<DescribeSObjectResult | null>(null);
  const [sel, setSel] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const st = orgState.value!;
  const sf = st.sf;
  const lightning = "https://" + sf.lightningHost;
  const recent = useMemo(() => loadRecent(sf.host), []);

  useEffect(() => {
    const d = dialogRef.current!;
    const opener = document.activeElement as HTMLElement | null;
    d.showModal();
    inputRef.current?.focus();
    sf.describeGlobal().then((r) => setObjects(r.sobjects.filter((o) => !o.deprecatedAndHidden)));
    load<SavedQuery[]>("sie.query.saved", []).then(setSaved);
    return () => {
      if (d.open) d.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // "Account.Ind" searches the fields of Account.
  const fieldQuery = /^([A-Za-z_][\w]*)\.(\w*)$/.exec(q.trim());
  useEffect(() => {
    if (!fieldQuery) return setFieldsOf(null);
    const obj = objects.find((o) => o.name.toLowerCase() === fieldQuery[1].toLowerCase());
    if (!obj) return setFieldsOf(null);
    if (fieldsOf?.name === obj.name) return;
    sf.describe(obj.name).then(setFieldsOf, () => setFieldsOf(null));
  }, [fieldQuery?.[1], objects]);

  const close = () => (paletteOpen.value = false);
  const go = (hash: string) => {
    navigate(hash);
    close();
  };
  const openExternal = (url: string) => {
    window.open(url, "_blank");
    close();
  };

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const s = q.trim();
    const lower = s.toLowerCase();
    const objectItem = (o: GlobalSObject, group = "Objects"): Item => ({
      id: group + o.name,
      group,
      icon: <Box />,
      title: (
        <>
          {o.label} <span class="mono muted">{o.name}</span>
        </>
      ),
      hint: o.keyPrefix ? <span class="mono muted palette__prefix">{o.keyPrefix}</span> : undefined,
      run: ({ mod, shift }) =>
        shift
          ? openExternal(`${lightning}/lightning/setup/ObjectManager/${o.name}/FieldsAndRelationships/view`)
          : mod && o.queryable
            ? buildDefaultQuery(sf, o.name).then((q) => go(links.query(q)))
            : go(links.object(o.name)),
    });

    if (fieldQuery && fieldsOf) {
      const fq = fieldQuery[2].toLowerCase();
      const fields = fieldsOf.fields.filter((f) => !fq || f.name.toLowerCase().includes(fq) || f.label.toLowerCase().includes(fq)).slice(0, 40);
      for (const f of fields)
        out.push({
          id: "f" + f.name,
          group: `Fields on ${fieldsOf.label}`,
          icon: <ListTree />,
          title: (
            <>
              {f.label} <span class="mono muted">{f.name}</span>
            </>
          ),
          run: () => go(`${links.object(fieldsOf.name)}?field=${encodeURIComponent(f.name)}`),
        });
      return out;
    }

    const pasted = parsePastedTarget(s);
    if (pasted?.recordId) {
      const id = pasted.recordId;
      out.push({
        id: "id",
        group: "Record",
        icon: <Fingerprint />,
        title: (
          <>
            Inspect {pasted.objectName ?? "record"} <span class="mono">{id}</span>
          </>
        ),
        run: () => go(pasted.objectName ? links.record(pasted.objectName, id) : links.id(id)),
      });
    } else if (pasted?.objectName && /^https?:/i.test(s)) {
      out.push({ id: "url-obj", group: "Object", icon: <Box />, title: <>Inspect {pasted.objectName}</>, run: () => go(links.object(pasted.objectName!)) });
    }

    // Recent visits: everything when the box is empty, matches first while typing.
    const recentHits = s ? recent.filter((r) => r.title.toLowerCase().includes(lower) || r.objectName.toLowerCase().includes(lower)).slice(0, 4) : recent.slice(0, 5);
    if (!pasted)
      for (const r of recentHits)
        out.push({
          id: "r" + r.objectName + (r.recordId ?? ""),
          group: "Recent",
          icon: r.recordId ? <Fingerprint /> : <Clock />,
          title: (
            <>
              {r.title} <span class="muted">{r.recordId ? r.objectName : "object"}</span>
            </>
          ),
          hint: <span class="muted palette__prefix">{fmtRelative(r.at)}</span>,
          run: () => go(r.recordId ? links.record(r.objectName, r.recordId) : links.object(r.objectName)),
        });

    for (const o of rankObjects(objects, s, s ? 25 : 6)) out.push(objectItem(o));

    const savedHits = saved.filter((x) => !s || x.name.toLowerCase().includes(lower) || x.soql.toLowerCase().includes(lower)).slice(0, s ? 5 : 3);
    for (const x of savedHits)
      out.push({
        id: "s" + x.id,
        group: "Saved queries",
        icon: <Star />,
        title: (
          <>
            {x.name} <span class="mono muted">{x.soql.replace(/\s+/g, " ").slice(0, 60)}</span>
          </>
        ),
        run: () => go(links.query(x.soql, x.tooling)),
      });

    const commands: Item[] = [
      { id: "c-objects", group: "Go to", icon: <Database />, text: "all objects browse", title: "All objects", hint: <Keys k={["g", "o"]} />, run: () => go(links.objects()) },
      { id: "c-query", group: "Go to", icon: <TerminalSquare />, text: "soql query editor", title: "SOQL query", hint: <Keys k={["g", "q"]} />, run: () => go(links.query()) },
      { id: "c-limits", group: "Go to", icon: <Gauge />, text: "org limits usage licenses", title: "Org limits & usage", hint: <Keys k={["g", "l"]} />, run: () => go(links.limits()) },
      { id: "c-users", group: "Go to", icon: <Users />, text: "users login as debug logs freeze permission sets", title: "Users", hint: <Keys k={["g", "u"]} />, run: () => go(links.users()) },
      { id: "c-import", group: "Go to", icon: <Upload />, text: "data import insert update upsert delete csv excel", title: "Data import", hint: <Keys k={["g", "i"]} />, run: () => go(links.import()) },
      ...SETUP.map(([label, path]) => ({
        id: "setup-" + path,
        group: "Salesforce Setup",
        icon: <Settings2 />,
        text: "setup " + label.toLowerCase(),
        title: label,
        hint: <ExternalLink class="palette__ext" />,
        run: () => openExternal(`${lightning}/lightning/setup/${path}`),
      })),
      { id: "t-light", group: "Theme", icon: <Sun />, text: "theme light", title: "Light theme", run: () => (setTheme("light"), close()) },
      { id: "t-dark", group: "Theme", icon: <Moon />, text: "theme dark", title: "Dark theme", run: () => (setTheme("dark"), close()) },
      { id: "t-system", group: "Theme", icon: <Monitor />, text: "theme system auto", title: "Match system theme", run: () => (setTheme("system"), close()) },
    ];
    // "user jane" / "users jane" searches users by name.
    const userQ = /^users?\s+(.+)/i.exec(s);
    if (userQ) out.unshift({ id: "u-search", group: "Users", icon: <Users />, title: <>Find users matching “{userQ[1]}”</>, run: () => go(links.users(userQ[1])) });
    out.push(...(s ? commands.filter((c) => c.text!.includes(lower)) : commands.filter((c) => c.group === "Go to")));
    return out;
  }, [q, objects, saved, fieldsOf, recent]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[sel]?.run({ mod: e.metaKey || e.ctrlKey, shift: e.shiftKey });
    } else if (e.key === "Tab") {
      // Tab completes "Object." to browse its fields.
      const it = items[sel];
      if (it?.group === "Objects" && !fieldQuery) {
        e.preventDefault();
        setQ(String(it.id).slice("Objects".length) + ".");
      }
    }
  };

  let lastGroup = "";
  return (
    <dialog
      ref={dialogRef}
      class="palette"
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div class="palette__input">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onKeyDown={onKey}
          placeholder="Search objects, paste a record ID, type Account.Industry, or a command…"
          spellcheck={false}
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="palette-list"
          aria-activedescendant={items[sel] ? `pal-${sel}` : undefined}
          aria-label="Search"
        />
        <Kbd>Esc</Kbd>
      </div>
      <div class="palette__list" ref={listRef} id="palette-list" role="listbox" aria-label="Results">
        {items.length === 0 && <div class="palette__empty">No matches for “{q}”</div>}
        {items.map((it, i) => {
          const header = it.group !== lastGroup ? (
            <div class="palette__group" role="presentation">
              {it.group}
            </div>
          ) : null;
          lastGroup = it.group;
          return (
            <>
              {header}
              <div
                key={it.id}
                id={`pal-${i}`}
                data-idx={i}
                role="option"
                aria-selected={i === sel}
                class={"palette__item" + (i === sel ? " is-active" : "")}
                onMouseMove={() => i !== sel && setSel(i)}
                onClick={(e) => it.run({ mod: e.metaKey || e.ctrlKey, shift: e.shiftKey })}
              >
                <span class="palette__icon">{it.icon}</span>
                <span class="grow truncate">{it.title}</span>
                {it.hint}
                {i === sel && <CornerDownLeft class="palette__enter" aria-hidden="true" />}
              </div>
            </>
          );
        })}
      </div>
      <div class="palette__foot">
        <span>
          <Keys k={["↑", "↓"]} /> move
        </span>
        <span>
          <Kbd>↵</Kbd> open
        </span>
        {items[sel]?.group === "Objects" && (
          <>
            <span>
              <Keys k={[modKey, "↵"]} /> query
            </span>
            <span>
              <Keys k={["Shift", "↵"]} /> Object Manager
            </span>
            <span>
              <Kbd>Tab</Kbd> fields
            </span>
          </>
        )}
        {!q && (
          <span class="palette__tip">
            Tip: paste a Salesforce URL or ID, or type <span class="mono">Account.</span> to browse fields
          </span>
        )}
      </div>
    </dialog>
  );
}
