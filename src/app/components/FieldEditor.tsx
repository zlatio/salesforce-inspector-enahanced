import { useEffect, useRef, useState } from "preact/hooks";
import { Check } from "lucide-preact";
import type { DescribeField, LookupNames, SfRecord } from "../../lib/types";
import { looksLikeId } from "../../lib/sf";
import { orgState } from "../../lib/org";
import { fromInput, toInput } from "../../lib/values";
import { likeEscape } from "../../lib/soql";
import { Spinner } from "../../ui";
import "./field-editor.css";

// Type-aware field editor shared by the record view and the query results grid.

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
  // Text the editor opened with: committing it unchanged keeps the exact original value, so a
  // round trip through the input (e.g. a datetime losing its milliseconds) never stages an edit.
  const initial = useRef(text);
  const commit = (raw = text, then?: () => void) => {
    if (done.current) return;
    try {
      const v = raw === initial.current ? value : fromInput(f, raw);
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
  } else if (f.type === "boolean") {
    control = (
      <select {...common} class={"select select--sm" + (error ? " is-invalid" : "")} value={text} onChange={(e) => setText((e.target as HTMLSelectElement).value)}>
        <option value="true">True</option>
        <option value="false">False</option>
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
      const like = likeEscape(term);
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
