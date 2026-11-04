import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ArrowRight, Box, Fingerprint, TerminalSquare } from "lucide-preact";
import { orgState } from "../../../lib/org";
import { parsePastedTarget } from "../../../lib/context";
import type { GlobalSObject } from "../../../lib/types";
import { fmtNumber } from "../../../lib/format";
import { Badge, Button, Callout, Empty, SearchInput, Seg, Spinner, useVirtual } from "../../../ui";
import { rankObjects } from "../../Palette";
import { buildDefaultQuery } from "../../../lib/queries";
import { links, navigate, route } from "../../router";
import { ObjectView } from "./ObjectView";
import "./inspector.css";

export function InspectorPage() {
  const { parts, params } = route.value;
  if (parts.length === 0) return <ObjectList />;
  const tooling = params.get("tooling") === "1";
  if (parts[0] === "_" && parts[1]) return <ResolveId id={parts[1]} tooling={tooling} />;
  return <ObjectView key={parts.join("/")} objectName={parts[0]} recordId={parts[1]} tooling={tooling} />;
}

/** /inspect/_/<id>: look up the object type from the key prefix, then redirect. */
function ResolveId({ id, tooling }: { id: string; tooling: boolean }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const sf = orgState.value!.sf;
    sf.objectForId(id).then(
      (o) => {
        if (!o) return setError(`No object in this org uses the key prefix “${id.slice(0, 3)}”.`);
        navigate(links.record(o.name, id) + (tooling ? "?tooling=1" : ""), true);
      },
      (e) => setError(e.message),
    );
  }, [id]);
  if (error)
    return (
      <div class="page">
        <Empty error icon={<Fingerprint />} title="Couldn't resolve that record ID" action={<Button onClick={() => navigate(links.objects())}>Browse objects</Button>}>
          {error}
        </Empty>
      </div>
    );
  return (
    <div class="page">
      <div class="empty">
        <Spinner />
        <span>Resolving {id}…</span>
      </div>
    </div>
  );
}

type Kind = "all" | "standard" | "custom" | "metadata" | "events" | "settings";

function kindOf(o: GlobalSObject): Kind[] {
  const k: Kind[] = [];
  if (o.name.endsWith("__mdt")) k.push("metadata");
  else if (o.name.endsWith("__e") || o.name.endsWith("ChangeEvent")) k.push("events");
  else if (o.customSetting) k.push("settings");
  else if (o.custom) k.push("custom");
  else k.push("standard");
  return k;
}

const ROW_H = 36;

function ObjectList() {
  const [objects, setObjects] = useState<GlobalSObject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [idInput, setIdInput] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const sf = orgState.value!.sf;

  useEffect(() => {
    sf.describeGlobal().then(
      (r) => setObjects(r.sobjects.filter((o) => !o.deprecatedAndHidden)),
      (e) => setError(e.message),
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { all: 0, standard: 0, custom: 0, metadata: 0, events: 0, settings: 0 };
    for (const o of objects ?? []) {
      c.all++;
      for (const k of kindOf(o)) c[k]++;
    }
    return c;
  }, [objects]);

  const filtered = useMemo(() => {
    if (!objects) return [];
    const base = kind === "all" ? objects : objects.filter((o) => kindOf(o).includes(kind));
    return q.trim() ? rankObjects(base, q, 5000) : [...base].sort((a, b) => a.label.localeCompare(b.label));
  }, [objects, q, kind]);

  const v = useVirtual(filtered.length, ROW_H);
  const pasted = parsePastedTarget(idInput);
  const idValid = !!pasted?.recordId;

  return (
    <div class="page">
      <div class="page__head">
        <div class="grow">
          <h1 class="page__title">Objects</h1>
          <div class="page__subtitle">{objects ? `${fmtNumber(objects.length)} objects available to you in this org` : "Loading objects…"}</div>
        </div>
      </div>
      <div class="toolbar">
        <SearchInput inputRef={searchRef} value={q} onInput={setQ} placeholder="Filter by label or API name" autoFocus class="toolbar__search" hint={<kbd class="kbd">/</kbd>} />
        <Seg<Kind>
          label="Object type"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "standard", label: "Standard", count: counts.standard },
            { value: "custom", label: "Custom", count: counts.custom },
            { value: "metadata", label: "Custom metadata", count: counts.metadata },
            { value: "settings", label: "Settings", count: counts.settings },
            { value: "events", label: "Events", count: counts.events },
          ]}
        />
        <form
          class="idjump"
          onSubmit={(e) => {
            e.preventDefault();
            if (pasted?.recordId) navigate(pasted.objectName ? links.record(pasted.objectName, pasted.recordId) : links.id(pasted.recordId));
          }}
        >
          <Fingerprint aria-hidden="true" />
          <input class="input input--mono" placeholder="Record ID or URL…" value={idInput} onInput={(e) => setIdInput((e.target as HTMLInputElement).value)} spellcheck={false} aria-label="Open a record by ID" />
          {idValid && (
            <button type="submit" class="idjump__go" aria-label="Open record">
              <ArrowRight />
            </button>
          )}
        </form>
      </div>
      {error ? (
        <div style={{ padding: "0 24px" }}>
          <Callout tone="danger" title="Couldn't load objects">
            {error}
          </Callout>
        </div>
      ) : !objects ? (
        <div class="objlist">
          {Array.from({ length: 12 }, (_, i) => (
            <div class="objrow" key={i}>
              <div class="skeleton" style={{ width: 180, height: 12 }} />
              <div class="skeleton" style={{ width: 140, height: 12 }} />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Empty icon={<Box />} title="No objects match">
          Try a different search or filter.
        </Empty>
      ) : (
        <div class="objlist-wrap">
          <div class="objlist-head">
            <span>Label</span>
            <span>API name</span>
            <span>Prefix</span>
            <span>Capabilities</span>
            <span />
          </div>
          <div class="objlist" ref={v.ref}>
            <div style={{ height: v.total, position: "relative" }}>
              <div style={{ transform: `translateY(${v.offset}px)` }}>
                {filtered.slice(v.start, v.end).map((o) => (
                  <div class="objrow" key={o.name} style={{ height: ROW_H }}>
                    <a class="objrow__label truncate objrow__link" href={links.object(o.name)}>
                      {o.label}
                    </a>
                    <span class="mono truncate objrow__api">{o.name}</span>
                    <span class="mono muted">{o.keyPrefix ?? "—"}</span>
                    <span class="objrow__flags">
                      {o.custom && !o.customSetting && !o.name.endsWith("__mdt") && <Badge tone="accent">Custom</Badge>}
                      {o.customSetting && <Badge tone="info">Setting</Badge>}
                      {o.name.endsWith("__mdt") && <Badge tone="info">Metadata</Badge>}
                      {!o.queryable && <Badge>Not queryable</Badge>}
                      {o.queryable && !o.updateable && !o.createable && <Badge>Read only</Badge>}
                    </span>
                    <span class="objrow__actions">
                      {o.queryable && (
                        <Button size="sm" variant="ghost" icon data-tip="Query this object" data-tip-pos="left" aria-label={`Query ${o.name}`} onClick={async () => navigate(links.query(await buildDefaultQuery(sf, o.name)))}>
                          <TerminalSquare />
                        </Button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
