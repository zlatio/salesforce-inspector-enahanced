import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ArrowDown, ArrowUp, Check, ExternalLink, Info, Lock, Pencil, Search, Sigma, Undo2, X } from "lucide-preact";
import type { DescribeField, DescribeSObjectResult, LookupNames, SfRecord } from "../../../lib/types";
import { fieldTypeLabel, fmtDate, fmtDateTime, fmtNumber } from "../../../lib/format";
import { looksLikeId } from "../../../lib/sf";
import { Badge, CopyButton, Empty, SearchInput, Seg, announce, toast, copyText } from "../../../ui";
import { links } from "../../router";
import { formatAddress, isEditable } from "../../../lib/values";
import { Editor } from "../../components/FieldEditor";

export type Filter = "all" | "populated" | "editable" | "changed" | "custom" | "required" | "formula";
type SortKey = "label" | "name" | "type";

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  populated: "With value",
  editable: "Editable",
  changed: "Changed",
  custom: "Custom",
  required: "Required",
  formula: "Formula",
};

interface Props {
  describe: DescribeSObjectResult;
  record: SfRecord | null;
  recordMode: boolean;
  loadingRecord: boolean;
  lookups: LookupNames;
  edits: Record<string, unknown>;
  fieldErrors: Record<string, string>;
  flash: Set<string>;
  onEdit: (f: DescribeField, v: unknown | undefined) => void;
  onOpenField: (name: string) => void;
  activeField: string | null;
  filter: Filter;
  setFilter: (f: Filter, persist?: boolean) => void;
  /** Cache the display name of a record picked in the lookup editor. */
  onLookupName?: (id: string, name: string, type: string) => void;
  /** False while editing is locked (production orgs until the user turns edit mode on). */
  canEdit: boolean;
  toolbarExtra?: preact.ComponentChildren;
}

const isRequired = (f: DescribeField) => !f.nillable && f.createable && f.type !== "boolean" && !f.defaultedOnCreate;
const hasValue = (r: SfRecord | null, f: DescribeField) => !!r && r[f.name] != null && r[f.name] !== "";

function matchesFilter(f: DescribeField, filter: Filter, record: SfRecord | null, edits: Record<string, unknown>) {
  switch (filter) {
    case "populated":
      return hasValue(record, f) || f.name in edits;
    case "editable":
      return isEditable(f);
    case "changed":
      return f.name in edits;
    case "custom":
      return f.custom;
    case "required":
      return isRequired(f);
    case "formula":
      return f.calculated;
    default:
      return true;
  }
}

/** Fields people look for first stay pinned to the top in record mode. */
const pinnedFor = (d: DescribeSObjectResult) => ["Id", d.fields.find((f) => f.nameField)?.name ?? "Name", "RecordTypeId", "OwnerId"];

export function FieldsTable(p: Props) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "label", dir: 1 });
  const [editing, setEditing] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { describe, record, recordMode, edits, filter, setFilter } = p;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = document.activeElement?.tagName;
      if (e.key === "/" && t !== "INPUT" && t !== "TEXTAREA" && t !== "SELECT" && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    for (const k of Object.keys(FILTER_LABEL) as Filter[]) c[k] = describe.fields.filter((f) => matchesFilter(f, k, record, edits)).length;
    return c;
  }, [describe, record, edits]);

  const matchesSearch = (f: DescribeField, s: string) => {
    if (!s) return true;
    if (f.name.toLowerCase().includes(s) || f.label.toLowerCase().includes(s)) return true;
    if (fieldTypeLabel(f).toLowerCase().includes(s)) return true;
    const v = record?.[f.name];
    if (v != null && String(typeof v === "object" ? JSON.stringify(v) : v).toLowerCase().includes(s)) return true;
    const lk = typeof v === "string" ? p.lookups[v] : undefined;
    return !!lk && lk.name.toLowerCase().includes(s);
  };

  const pinned = useMemo(() => pinnedFor(describe), [describe]);
  const { rows, hidden } = useMemo(() => {
    const s = q.trim().toLowerCase();
    const searched = describe.fields.filter((f) => matchesSearch(f, s));
    const fs = searched.filter((f) => matchesFilter(f, filter, record, edits));
    const key = (f: DescribeField) => (sort.key === "label" ? f.label : sort.key === "name" ? f.name : fieldTypeLabel(f)).toLowerCase();
    const pin = (f: DescribeField) => {
      const i = recordMode && sort.key !== "type" ? pinned.indexOf(f.name) : f.type === "id" ? 0 : -1;
      return i < 0 ? 99 : i;
    };
    const sorted = [...fs].sort((a, b) => pin(a) - pin(b) || key(a).localeCompare(key(b)) * sort.dir);
    return { rows: sorted, hidden: s ? searched.length - fs.length : 0 };
  }, [describe, record, q, filter, sort, edits, p.lookups]);

  const filterOptions: Filter[] = recordMode ? ["populated", "all", "editable", "custom", ...(counts.changed ? (["changed"] as Filter[]) : [])] : ["all", "custom", "required", "formula"];

  const header = (key: SortKey, label: string) => (
    <div role="columnheader" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button class={"fh" + (sort.key === key ? " is-sorted" : "")} onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}>
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowDown /> : <ArrowUp />)}
      </button>
    </div>
  );

  // Locking edit mode closes any open editor.
  useEffect(() => {
    if (!p.canEdit) setEditing(null);
  }, [p.canEdit]);

  const fieldsRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tb = toolbarRef.current;
    if (!tb) return;
    const ro = new ResizeObserver(() => fieldsRef.current?.style.setProperty("--fields-toolbar-h", tb.offsetHeight + "px"));
    ro.observe(tb);
    return () => ro.disconnect();
  }, []);

  // Tab / Shift+Tab inside an editor commits it and opens the next / previous editable field.
  const editNext = (from: string, dir: 1 | -1) => {
    const editable = rows.filter((f) => recordMode && isEditable(f) && !!record && p.canEdit && f.type !== "boolean");
    const i = editable.findIndex((f) => f.name === from);
    const next = editable[i + dir];
    setEditing(next ? next.name : null);
    if (next) requestAnimationFrame(() => document.getElementById("frow-" + next.name)?.scrollIntoView({ block: "nearest" }));
  };

  return (
    <div class="fields" ref={fieldsRef}>
      <div class="toolbar fields__toolbar" ref={toolbarRef}>
        <SearchInput
          inputRef={searchRef}
          value={q}
          onInput={setQ}
          placeholder={recordMode ? "Search fields and values" : "Search fields"}
          label={recordMode ? "Search fields and values" : "Search fields"}
          autoFocus
          class="toolbar__search"
          hint={<kbd class="kbd">/</kbd>}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              focusRow(fieldsRef.current?.querySelector(".frow"));
            }
          }}
        />
        <Seg<Filter> label="Filter fields" value={filter} onChange={setFilter} options={filterOptions.map((f) => ({ value: f, label: FILTER_LABEL[f], count: counts[f] }))} />
        <div class="fields__right">
          {p.toolbarExtra}
          <span class="muted tabular">{rows.length === describe.fields.length ? `${fmtNumber(rows.length)} fields` : `${fmtNumber(rows.length)} of ${fmtNumber(describe.fields.length)}`}</span>
        </div>
      </div>
      <div class={"ftable" + (recordMode ? " ftable--record" : " ftable--object")} role="table" aria-label={`${describe.label} fields`} aria-rowcount={rows.length}>
        <div class="ftable__head" role="row">
          {header("label", "Label")}
          {header("name", "API name")}
          {header("type", "Type")}
          <div role="columnheader" class="fh fh--static">
            {recordMode ? "Value" : "Properties"}
          </div>
          {!recordMode && (
            <div role="columnheader" class="fh fh--static">
              Help text
            </div>
          )}
          <div role="columnheader" class="sr-only">
            Details
          </div>
        </div>
        {rows.length === 0 ? (
          <Empty icon={<Search />} title={q ? `No field matching “${q}”` : "No fields in this view"}>
            {hidden > 0 ? (
              <>
                {hidden === 1 ? "1 field matches" : `${hidden} fields match`} but {hidden === 1 ? "is" : "are"} hidden by the “{FILTER_LABEL[filter]}” filter
                {filter === "populated" ? " (the value is empty)" : ""}.{" "}
                <button class="link-btn" onClick={() => setFilter("all", false)}>
                  Show all fields
                </button>
              </>
            ) : q ? (
              `${describe.label} has no field whose label, API name, type or value contains “${q}”.`
            ) : (
              "Try another filter."
            )}
          </Empty>
        ) : (
          rows.map((f) => <FieldRow key={f.name} f={f} {...p} editing={editing === f.name} setEditing={(on) => setEditing(on ? f.name : null)} required={isRequired(f)} onTabNav={(dir) => editNext(f.name, dir)} />)
        )}
        {rows.length > 0 && hidden > 0 && (
          <div class="ftable__hidden">
            {hidden === 1 ? "1 more match" : `${hidden} more matches`} hidden by “{FILTER_LABEL[filter]}”.{" "}
            <button class="link-btn" onClick={() => setFilter("all", false)}>
              Show all
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Focus a row's primary control (edit if editable, otherwise details). */
function focusRow(row: Element | null | undefined) {
  (row?.querySelector<HTMLElement>("[data-primary]") ?? null)?.focus();
}

function FieldRow(props: Props & { f: DescribeField; editing: boolean; setEditing: (on: boolean) => void; required: boolean; onTabNav: (dir: 1 | -1) => void }) {
  const { f, record, recordMode, edits, fieldErrors, flash, onEdit, onOpenField, editing, setEditing, lookups, activeField, loadingRecord, canEdit } = props;
  const changed = f.name in edits;
  const original = record?.[f.name];
  const value = changed ? edits[f.name] : original;
  const editable = recordMode && isEditable(f) && !!record && canEdit;
  const err = fieldErrors[f.name];
  const editBtn = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    // Return focus to the row's edit button after the inline editor closes — unless focus already moved on
    // (e.g. Tab opened the next field's editor).
    const lost = !document.activeElement || document.activeElement === document.body;
    if (wasEditing.current && !editing && lost) editBtn.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  // Row shortcuts while focus is inside the row: ↑/↓ move between rows, C copies the API name,
  // V copies the value, I opens details.
  const onRowKey = (e: KeyboardEvent) => {
    if (editing || e.metaKey || e.ctrlKey || e.altKey) return;
    const row = e.currentTarget as HTMLElement;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      let next = (e.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling) as HTMLElement | null;
      while (next && !next.classList.contains("frow")) next = (e.key === "ArrowDown" ? next.nextElementSibling : next.previousElementSibling) as HTMLElement | null;
      if (next) focusRow(next);
      else if (e.key === "ArrowUp") document.querySelector<HTMLInputElement>(".fields__toolbar input")?.focus();
    } else if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      copyText(f.name);
      toast("success", "Copied API name", f.name);
    } else if ((e.key === "v" || e.key === "V") && raw) {
      e.preventDefault();
      copyText(raw);
      toast("success", `Copied ${f.label}`, raw.length > 80 ? raw.slice(0, 80) + "…" : raw);
    } else if (e.key === "i" || e.key === "I") {
      e.preventDefault();
      onOpenField(f.name);
    } else if ((e.key === "r" || e.key === "R") && changed) {
      e.preventDefault();
      onEdit(f, undefined);
      announce(`Reverted ${f.label}`);
    }
  };

  const cls = ["frow", changed && "is-changed", err && "is-error", flash.has(f.name) && "is-flash", activeField === f.name && "is-active", editing && "is-editing"].filter(Boolean).join(" ");
  const raw = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const primaryIsEdit = editable && f.type !== "boolean";

  return (
    <div class={cls} role="row" id={"frow-" + f.name} onKeyDown={onRowKey}>
      <div class="fcell fcell--label" role="cell" onClick={() => onOpenField(f.name)}>
        <span class="truncate" title={f.label}>
          {f.label}
        </span>
        {props.required && (
          <span class="req" title="Required" aria-hidden="true">
            *
          </span>
        )}
        {props.required && <span class="sr-only">(required)</span>}
        {changed && <span class="sr-only">(changed)</span>}
      </div>
      <div class="fcell fcell--api" role="cell">
        <button
          class="fapi mono truncate"
          tabIndex={-1}
          title={`${f.name} — click to copy (C)`}
          onClick={() => {
            copyText(f.name);
            toast("success", "Copied API name", f.name);
          }}
        >
          {f.name}
        </button>
      </div>
      <div class="fcell fcell--type" role="cell" onClick={() => onOpenField(f.name)}>
        <TypeBadge f={f} />
      </div>
      {recordMode ? (
        <div
          class={"fcell fcell--value" + (editable ? " is-editable" : "")}
          role="cell"
          onClick={() => {
            if (editable && !editing && f.type !== "boolean") setEditing(true);
          }}
        >
          {loadingRecord && !record ? (
            <span class="skeleton" style={{ width: "40%", height: 10 }} />
          ) : editing ? (
            <Editor f={f} value={value} original={original} onCommit={(v) => (onEdit(f, v), setEditing(false))} onCancel={() => setEditing(false)} onTab={props.onTabNav} onLookupName={props.onLookupName} lookups={lookups} />
          ) : f.type === "boolean" && editable ? (
            <label class="check" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={!!value} aria-label={f.label} onChange={(e) => onEdit(f, (e.target as HTMLInputElement).checked)} />
              <span class="mono">{String(!!value)}</span>
            </label>
          ) : (
            <>
              {changed && (
                <span class="fold" title="Current value in Salesforce">
                  <span class="sr-only">was </span>
                  <Value f={f} v={original} lookups={lookups} />
                  <span class="fold__arrow" aria-hidden="true">
                    →
                  </span>
                </span>
              )}
              {changed && <span class="sr-only">now </span>}
              <Value f={f} v={value} lookups={lookups} />
            </>
          )}
          {!editing && (
            <span class="fcell__tools">
              {raw && f.type !== "boolean" && <CopyButton text={raw} label={`Copy ${f.label} value (V)`} tabIndex={-1} />}
              {primaryIsEdit && (
                <button
                  ref={editBtn}
                  class="copy fcell__edit"
                  data-primary
                  aria-label={`Edit ${f.label}. Arrow keys move between fields; C copies the API name, V the value, I opens details${changed ? ", R reverts" : ""}.`}
                  data-tip="Edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(true);
                  }}
                >
                  <Pencil />
                </button>
              )}
              {changed && (
                <button
                  class="copy"
                  tabIndex={-1}
                  aria-label={`Revert ${f.label}`}
                  data-tip="Revert (R)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(f, undefined);
                  }}
                >
                  <Undo2 />
                </button>
              )}
              {!editable && recordMode && isEditable(f) && !canEdit && <Lock class="fcell__lock" aria-label="Turn on edit mode to change this field" />}
            </span>
          )}
          {err && (
            <div class="fcell__error" role="alert">
              {err}
            </div>
          )}
        </div>
      ) : (
        <>
          <div class="fcell fcell--props" role="cell" onClick={() => onOpenField(f.name)}>
            <FieldFlags f={f} />
          </div>
          <div class="fcell fcell--help" role="cell" onClick={() => onOpenField(f.name)}>
            <span class="truncate subtle" title={f.inlineHelpText ?? undefined}>
              {f.inlineHelpText ?? ""}
            </span>
          </div>
        </>
      )}
      <div role="cell" class="fcell fcell--info">
        <button
          class="frow__info"
          tabIndex={primaryIsEdit ? -1 : 0}
          data-primary={primaryIsEdit ? undefined : true}
          aria-label={`Details for ${f.label}${primaryIsEdit ? "" : ". Arrow keys move between fields; C copies the API name, V the value."}`}
          data-tip="Details (I)"
          data-tip-pos="left"
          onClick={() => onOpenField(f.name)}
        >
          <Info />
        </button>
      </div>
    </div>
  );
}

export function TypeBadge({ f }: { f: DescribeField }) {
  const label = fieldTypeLabel(f, { formulaWrap: false });
  return (
    <span class={"ftype" + (f.calculated ? " ftype--formula" : f.type === "reference" ? " ftype--ref" : f.type === "id" ? " ftype--id" : "")} title={fieldTypeLabel(f)}>
      {f.calculated && <Sigma aria-label="Formula" />}
      <span class="truncate">{label}</span>
    </span>
  );
}

export function FieldFlags({ f }: { f: DescribeField }) {
  return (
    <span class="row" style={{ gap: 4, flexWrap: "nowrap", overflow: "hidden" }}>
      {f.custom && <Badge tone="accent">Custom</Badge>}
      {isRequired(f) && <Badge tone="danger">Required</Badge>}
      {f.unique && <Badge>Unique</Badge>}
      {f.externalId && <Badge tone="info">External ID</Badge>}
      {f.encrypted && <Badge tone="warning">Encrypted</Badge>}
      {!f.updateable && !f.calculated && f.type !== "id" && <Badge>Read only</Badge>}
    </span>
  );
}

export function Value({ f, v, lookups, full }: { f: DescribeField; v: unknown; lookups: LookupNames; full?: boolean }) {
  if (v == null || v === "") return <span class="fnull">{full ? "No value" : <span aria-label="No value">—</span>}</span>;
  switch (f.type) {
    case "boolean":
      return v ? (
        <span class="fbool fbool--on">
          <Check /> true
        </span>
      ) : (
        <span class="fbool">
          <X /> false
        </span>
      );
    case "id":
      return <span class="mono">{String(v)}</span>;
    case "reference": {
      const id = String(v);
      const lk = lookups[id];
      return (
        <span class="fref">
          <a href={links.id(id)} onClick={(e) => e.stopPropagation()} class="mono">
            {id}
          </a>
          {lk && (
            <span class="fref__name truncate" title={`${lk.type}: ${lk.name}`}>
              {lk.name}
            </span>
          )}
        </span>
      );
    }
    case "datetime":
      return (
        <span title={String(v)}>
          {fmtDateTime(String(v))} <span class="muted mono fsmall">{String(v).slice(0, 19).replace("T", " ")}</span>
        </span>
      );
    case "date":
      return (
        <span title={String(v)}>
          {fmtDate(String(v))} <span class="muted mono fsmall">{String(v)}</span>
        </span>
      );
    case "url":
      return (
        <a href={/^https?:/i.test(String(v)) ? String(v) : "https://" + v} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} class="truncate">
          {String(v)} <ExternalLink class="inline-icon" />
        </a>
      );
    case "email":
      return (
        <a href={`mailto:${v}`} onClick={(e) => e.stopPropagation()}>
          {String(v)}
        </a>
      );
    case "currency":
    case "double":
    case "int":
    case "long":
    case "percent":
      return (
        <span class="tabular">
          {typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: f.scale || 0 }) : String(v)}
          {f.type === "percent" ? "%" : ""}
        </span>
      );
    case "multipicklist":
      return (
        <span class="row" style={{ gap: 4, flexWrap: full ? "wrap" : "nowrap", overflow: "hidden" }}>
          {String(v)
            .split(";")
            .map((x) => (
              <Badge key={x}>{x}</Badge>
            ))}
        </span>
      );
    case "picklist": {
      const pv = f.picklistValues.find((p) => p.value === v);
      return (
        <span class="truncate">
          {String(v)}
          {pv && pv.label !== pv.value && <span class="muted"> · {pv.label}</span>}
          {pv && !pv.active && <Badge tone="warning">Inactive</Badge>}
        </span>
      );
    }
    case "address":
    case "location":
      return <span class={full ? "" : "truncate"}>{typeof v === "object" ? formatAddress(v as Record<string, unknown>) : String(v)}</span>;
    case "textarea":
      return <span class={full ? "fpre" : "truncate"}>{String(v)}</span>;
    default:
      if (typeof v === "object") return <span class="mono truncate">{JSON.stringify(v)}</span>;
      // Id-shaped text (e.g. formula "18 digit ID" fields) reads better in mono.
      return <span class={(full ? "fpre" : "truncate") + (typeof v === "string" && looksLikeId(v) ? " mono" : "")}>{String(v)}</span>;
  }
}
