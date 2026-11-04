import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ArrowDown, ArrowUp, Check, ExternalLink, Info, Lock, Pencil, Search, Sigma, Undo2, X } from "lucide-preact";
import type { DescribeField, DescribeSObjectResult, SfRecord } from "../../../lib/types";
import { fieldTypeLabel, fmtDate, fmtDateTime, fmtNumber } from "../../../lib/format";
import { looksLikeId } from "../../../lib/sf";
import { Badge, CopyButton, Empty, SearchInput, Seg, Spinner, announce, toast, copyText } from "../../../ui";
import { orgState } from "../../../lib/org";
import { links } from "../../router";
import type { LookupNames } from "./ObjectView";
import { formatAddress, fromInput, isEditable, toInput } from "./values";

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

interface EditorProps {
  f: DescribeField;
  value: unknown;
  original: unknown;
  onCommit: (v: unknown) => void;
  onCancel: () => void;
  onTab?: (dir: 1 | -1) => void;
  onLookupName?: (id: string, name: string, type: string) => void;
  lookups?: LookupNames;
}

export function Editor({ f, value, original, onCommit, onCancel, onTab, onLookupName, lookups }: EditorProps) {
  const [text, setText] = useState(toInput(f, value));
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);
  useEffect(() => {
    ref.current?.focus();
    if (ref.current && "select" in ref.current && f.type !== "picklist") ref.current.select?.();
  }, []);

  // Guard so a blur that fires while unmounting can't overwrite the committed value.
  const done = useRef(false);
  const commit = (raw = text, then?: () => void) => {
    if (done.current) return;
    try {
      const v = fromInput(f, raw);
      done.current = true;
      onCommit(v);
      then?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const cancel = () => {
    done.current = true;
    onCancel();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === "Enter" && (f.type !== "textarea" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === "Tab" && onTab) {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      commit(text, () => onTab(dir));
    }
  };
  const hintId = `ed-hint-${f.name}`;
  const common = {
    ref,
    onKeyDown: onKey,
    onBlur: () => commit(),
    onClick: (e: Event) => e.stopPropagation(),
    class: "input input--sm" + (error ? " is-invalid" : ""),
    "aria-label": f.label,
    "aria-invalid": !!error,
    "aria-describedby": hintId,
  };

  let control;
  if (f.type === "reference") {
    control = (
      <LookupInput
        f={f}
        text={text}
        setText={(t) => (setText(t), setError(null))}
        common={common}
        onPick={(id, name, type, tabDir) => (onLookupName?.(id, name, type), commit(id, tabDir && onTab ? () => onTab(tabDir) : undefined))}
        onUnresolved={() => setError("Pick a match from the list, or paste a record ID")}
        current={lookups?.[text]}
      />
    );
  } else if (f.type === "picklist" || (f.type === "combobox" && f.picklistValues.length)) {
    // Arrow keys on a closed <select> change the value in Chrome on Windows/Linux, so only Enter/blur commits.
    const values = f.picklistValues.filter((p) => p.active || p.value === original);
    control = (
      <select {...common} class={"select select--sm" + (error ? " is-invalid" : "")} value={text} onChange={(e) => setText((e.target as HTMLSelectElement).value)}>
        <option value="">— None —</option>
        {values.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
            {p.label !== p.value ? ` (${p.value})` : ""}
          </option>
        ))}
        {text && !values.some((p) => p.value === text) && <option value={text}>{text}</option>}
      </select>
    );
  } else if (f.type === "multipicklist") {
    const selected = new Set(text ? text.split(";") : []);
    control = (
      <div class="mpick" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), e.stopPropagation(), cancel())}>
        {f.picklistValues
          .filter((p) => p.active)
          .map((p, i) => (
            <button
              key={p.value}
              ref={i === 0 ? (ref as never) : undefined}
              type="button"
              class={"mpick__opt" + (selected.has(p.value) ? " is-on" : "")}
              aria-pressed={selected.has(p.value)}
              onClick={() => {
                const next = new Set(selected);
                if (next.has(p.value)) next.delete(p.value);
                else next.add(p.value);
                setText([...next].join(";"));
              }}
            >
              {selected.has(p.value) && <Check />}
              {p.label}
            </button>
          ))}
        <div class="row" style={{ marginLeft: "auto" }}>
          <button class="btn btn--sm" type="button" onClick={cancel}>
            Cancel
          </button>
          <button class="btn btn--sm btn--primary" type="button" onClick={() => commit()}>
            Done
          </button>
        </div>
      </div>
    );
  } else if (f.type === "textarea") {
    control = <textarea {...common} class={"textarea" + (error ? " is-invalid" : "")} rows={Math.min(8, Math.max(3, text.split("\n").length))} value={text} onInput={(e) => (setText((e.target as HTMLTextAreaElement).value), setError(null))} />;
  } else {
    const type =
      f.type === "date"
        ? "date"
        : f.type === "datetime"
          ? "datetime-local"
          : f.type === "time"
            ? "time"
            : ["int", "long", "double", "currency", "percent"].includes(f.type)
              ? "number"
              : f.type === "email"
                ? "email"
                : "text";
    control = (
      <input
        {...common}
        class={common.class + (f.type === "id" ? " input--mono" : "")}
        type={type as "text"}
        step={type === "number" ? "any" : type === "datetime-local" || type === "time" ? 1 : undefined}
        maxLength={f.length || undefined}
        value={text}
        onInput={(e) => (setText((e.target as HTMLInputElement).value), setError(null))}
      />
    );
  }

  const hint =
    f.type === "textarea"
      ? "Ctrl+Enter to apply · Esc to cancel"
      : f.type === "multipicklist"
        ? "Toggle values, then Done · Esc to cancel"
        : f.type === "reference"
          ? "Type a name or paste an ID · Enter to apply · Esc to cancel"
          : "Enter to apply · Esc to cancel";

  return (
    <div class="feditor" onClick={(e) => e.stopPropagation()}>
      {control}
      <span class="feditor__hint" id={hintId}>
        {hint}
        {onTab && f.type !== "multipicklist" ? " · Tab for next field" : ""}
      </span>
      {error && (
        <div class="fcell__error" role="alert">
          {error}
        </div>
      )}
      {f.length > 0 && ["string", "textarea", "email", "url", "phone"].includes(f.type) && (
        <span class={"feditor__count" + (text.length > f.length ? " is-over" : "")}>
          {text.length}/{f.length}
        </span>
      )}
    </div>
  );
}

interface LookupHit {
  id: string;
  name: string;
  type: string;
}

/** Lookup editor: type to search the target object(s) by name, or paste an id. */
function LookupInput({
  f,
  text,
  setText,
  common,
  onPick,
  current,
  onUnresolved,
}: {
  f: DescribeField;
  text: string;
  setText: (t: string) => void;
  common: Record<string, unknown> & { onKeyDown: (e: KeyboardEvent) => void; onBlur: () => void };
  onPick: (id: string, name: string, type: string, tabDir?: 1 | -1) => void;
  current?: { name: string; type: string };
  onUnresolved: () => void;
}) {
  const [q, setQ] = useState(current ? current.name : text);
  const [hits, setHits] = useState<LookupHit[] | null>(null);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const listId = `lk-${f.name}`;

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || looksLikeId(term) || (current && term === current.name)) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const h = setTimeout(async () => {
      setBusy(true);
      const sf = orgState.value!.sf;
      const like = term.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const out: LookupHit[] = [];
      for (const obj of f.referenceTo.slice(0, 3)) {
        try {
          const d = await sf.describe(obj);
          const nf = d.fields.find((x) => x.nameField)?.name ?? "Name";
          const active = d.fields.some((x) => x.name === "IsActive") && obj === "User" ? " AND IsActive = true" : "";
          const order = d.fields.some((x) => x.name === "LastModifiedDate") ? " ORDER BY LastModifiedDate DESC" : "";
          const res = await sf.query<SfRecord>(`SELECT Id, ${nf} FROM ${obj} WHERE ${nf} LIKE '%${like}%'${active}${order} LIMIT 8`);
          out.push(...res.records.map((r) => ({ id: r.Id as string, name: String(r[nf] ?? r.Id), type: obj })));
        } catch {
          /* object not searchable by name — skip */
        }
      }
      if (!cancelled) {
        setHits(out);
        setSel(0);
        setBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [q]);

  const pick = (hit: LookupHit, tabDir?: 1 | -1) => {
    setQ(hit.name);
    setText(hit.id);
    setHits(null);
    onPick(hit.id, hit.name, hit.type, tabDir);
  };
  // Typed something that is neither an id, empty, nor the current record's name.
  const unresolved = () => {
    const t = q.trim();
    return !!t && !looksLikeId(t) && !(current && t === current.name);
  };

  return (
    <div class="lookup">
      <input
        {...(common as object)}
        class={(common.class as string) + " lookup__input"}
        value={q}
        role="combobox"
        aria-expanded={!!hits?.length}
        aria-controls={listId}
        aria-activedescendant={hits?.length ? `${listId}-${sel}` : undefined}
        placeholder={`Search ${f.referenceTo.join(" / ")} or paste an ID`}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setQ(v);
          setText(looksLikeId(v.trim()) || v.trim() === "" ? v.trim() : text);
        }}
        onKeyDown={(e) => {
          if (hits?.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setSel((i) => (e.key === "ArrowDown" ? Math.min(hits.length - 1, i + 1) : Math.max(0, i - 1)));
            return;
          }
          if (hits?.length && (e.key === "Enter" || e.key === "Tab")) {
            e.preventDefault();
            pick(hits[sel], e.key === "Tab" ? (e.shiftKey ? -1 : 1) : undefined);
            return;
          }
          if ((e.key === "Enter" || e.key === "Tab") && unresolved()) {
            e.preventDefault();
            onUnresolved();
            return;
          }
          common.onKeyDown(e);
        }}
        onBlur={() => {
          // Leave time for a click on a suggestion; don't silently drop a name that wasn't picked.
          setTimeout(() => {
            if (document.activeElement?.closest(".lookup")) return;
            if (unresolved()) onUnresolved();
            else common.onBlur();
          }, 150);
        }}
      />
      {busy && <Spinner small />}
      {hits && (
        <div class="lookup__list" role="listbox" id={listId}>
          {hits.length === 0 ? (
            <div class="lookup__empty">No {f.referenceTo.join(" / ")} named “{q}”</div>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.id}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === sel}
                class={"lookup__opt" + (i === sel ? " is-active" : "")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
              >
                <span class="truncate">{h.name}</span>
                <span class="mono muted lookup__id">{h.id}</span>
                {f.referenceTo.length > 1 && <span class="muted lookup__type">{h.type}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
