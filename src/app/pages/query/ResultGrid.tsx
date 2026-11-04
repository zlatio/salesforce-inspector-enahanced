import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ArrowDown, ArrowUp, Layers } from "lucide-preact";
import { looksLikeId } from "../../../lib/sf";
import { cellText, flattenRecords, type Cell, type FlatRow, type SubResult } from "../../../lib/soql";
import type { SfRecord } from "../../../lib/types";
import { copyText, CopyButton, Modal, toast } from "../../../ui";
import { links, navigate } from "../../router";
import type { DescribeField } from "../../../lib/types";
import { Editor } from "../../components/FieldEditor";
import { sameValue } from "../../../lib/values";
import { Pencil } from "lucide-preact";
import { signal } from "@preact/signals";

/** Datetime display: local time (default) or UTC. Copy/export always keep the raw ISO value. */
export const gridTz = signal<"local" | "utc">(localStorage.getItem("sie.grid.tz") === "utc" ? "utc" : "local");
export function setGridTz(tz: "local" | "utc") {
  gridTz.value = tz;
  localStorage.setItem("sie.grid.tz", tz);
}
const ISO_DT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?(\+0000|Z)$/;
const pad = (n: number) => String(n).padStart(2, "0");
export function hasDatetimes(records: SfRecord[]) {
  return records.slice(0, 50).some((r) => Object.values(r).some((v) => typeof v === "string" && ISO_DT.test(v)));
}
export function fmtDt(s: string) {
  const m = ISO_DT.exec(s);
  if (!m) return null;
  if (gridTz.value === "utc") return `${m[1]} ${m[2]}`;
  const d = new Date(s.replace("+0000", "Z"));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const ROW_H = 30;
const NUM_W = 52;

function estimateWidth(col: string, rows: FlatRow[]) {
  let max = col.length * 7.4 + 34;
  const n = Math.min(rows.length, 200);
  for (let i = 0; i < n; i++) {
    const t = cellText(rows[i][col]);
    const w = Math.min(t.length, 60) * 7 + 26;
    if (w > max) max = w;
  }
  return Math.round(Math.min(Math.max(max, 72), 420));
}

export interface GridView {
  columns: string[];
  rows: FlatRow[];
  filtered: boolean;
  /** Select and scroll to the row with this record Id (used by the failed-rows list). */
  scrollToId?: (id: string) => void;
}

let gridSeq = 0;

/** Inline editing for single-object results: which columns are editable, what's staged, and per-row errors. */
export interface GridEdit {
  fields: Map<string, DescribeField>;
  staged: Record<string, Record<string, unknown>>;
  errors: Record<string, string>;
  onStage: (id: string, field: string, value: unknown | undefined) => void;
}

export function ResultGrid({ records, filter, viewRef, edit }: { records: SfRecord[]; filter: string; viewRef?: { current: GridView | null }; edit?: GridEdit }) {
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [gid] = useState(() => "g" + ++gridSeq);
  const { columns, rows } = useMemo(() => flattenRecords(records), [records]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const [sub, setSub] = useState<{ title: string; data: SubResult } | null>(null);
  const [viewer, setViewer] = useState<{ col: string; value: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ top: 0, height: 400, left: 0, width: 800 });

  useEffect(() => {
    const w: Record<string, number> = {};
    for (const c of columns) w[c] = estimateWidth(c, rows);
    setWidths(w);
    setSel(null);
  }, [columns.join("|")]);

  const view = useMemo(() => {
    const s = filter.trim().toLowerCase();
    let list = rows.map((r, i) => ({ r, i }));
    if (s)
      list = list.filter(({ r }) =>
        columns.some((c) => {
          const t = cellText(r[c]);
          return t.toLowerCase().includes(s) || (ISO_DT.test(t) && (fmtDt(t) ?? "").includes(s));
        }),
      );
    if (sort) {
      const { col, dir } = sort;
      list.sort((a, b) => {
        const x = a.r[col];
        const y = b.r[col];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
        return cellText(x).localeCompare(cellText(y), undefined, { numeric: true }) * dir;
      });
    }
    return list;
  }, [rows, columns, filter, sort]);

  if (viewRef)
    viewRef.current = {
      columns,
      rows: view.map((x) => x.r),
      filtered: view.length !== rows.length,
      scrollToId: (id) => {
        const r = view.findIndex((x) => x.r.Id === id);
        if (r < 0) return;
        setSel({ r, c: 0 });
        const el = scrollRef.current;
        if (el) {
          el.scrollTop = Math.max(0, r * ROW_H - el.clientHeight / 3);
          el.focus();
        }
      },
    };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setVp({ top: el.scrollTop, height: el.clientHeight, left: el.scrollLeft, width: el.clientWidth });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  // Keyboard: arrows move the selection, Cmd/Ctrl+C copies the cell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      // Header buttons and resize handles handle their own keys (Enter sorts, arrows resize).
      if (!sel || !scrollRef.current?.contains(t) || t.closest(".grid__head") || t.closest(".gedit")) return;
      const move = (dr: number, dc: number) => {
        e.preventDefault();
        const r = Math.max(0, Math.min(view.length - 1, sel.r + dr));
        const c = Math.max(0, Math.min(columns.length - 1, sel.c + dc));
        setSel({ r, c });
        const el = scrollRef.current!;
        const rowTop = r * ROW_H;
        if (rowTop < el.scrollTop) el.scrollTop = rowTop;
        else if (rowTop + ROW_H * 2 > el.scrollTop + el.clientHeight) el.scrollTop = rowTop + ROW_H * 2 - el.clientHeight;
        // Horizontal: keep the cell clear of the sticky row-number column.
        let left = NUM_W;
        for (let i = 0; i < c; i++) left += widths[columns[i]] ?? 120;
        const right = left + (widths[columns[c]] ?? 120);
        if (left - NUM_W < el.scrollLeft) el.scrollLeft = left - NUM_W;
        else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
      };
      if (e.key === "ArrowDown") move(1, 0);
      else if (e.key === "ArrowUp") move(-1, 0);
      else if (e.key === "PageDown") move(Math.floor((scrollRef.current?.clientHeight ?? 300) / ROW_H) - 1, 0);
      else if (e.key === "PageUp") move(-(Math.floor((scrollRef.current?.clientHeight ?? 300) / ROW_H) - 1), 0);
      else if (e.key === "Home") move(0, -sel.c);
      else if (e.key === "End") move(0, columns.length);
      else if (e.key === "ArrowRight") move(0, 1);
      else if (e.key === "ArrowLeft") move(0, -1);
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
        e.preventDefault();
        const v = cellText(view[sel.r]?.r[columns[sel.c]]);
        copyText(v);
        toast("success", "Copied cell value", v.length > 80 ? v.slice(0, 80) + "…" : v || "(empty)");
      } else if (e.key === "Enter") {
        e.preventDefault();
        const col = columns[sel.c];
        const v = view[sel.r]?.r[col];
        // Ctrl/Cmd+Enter on an Id follows it to the record view; Enter shows the full value.
        if ((e.metaKey || e.ctrlKey) && typeof v === "string" && looksLikeId(v)) navigate(links.id(v));
        else if (edit?.fields.has(col) && view[sel.r]?.r.Id) setEditing({ r: sel.r, c: sel.c });
        else openCell(col, v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, view, columns, widths]);

  const openCell = (col: string, v: Cell | undefined) => {
    if (v && typeof v === "object" && (v as SubResult).__sub) setSub({ title: col, data: v as SubResult });
    else setViewer({ col, value: typeof v === "object" && v ? JSON.stringify(v, null, 2) : cellText(v) });
  };

  const startResize = (col: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[col] ?? 120;
    const onMove = (ev: MouseEvent) => setWidths((w) => ({ ...w, [col]: Math.max(56, startW + ev.clientX - startX) }));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("is-resizing");
    };
    document.body.classList.add("is-resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const template = `${NUM_W}px ${columns.map((c) => (widths[c] ?? 120) + "px").join(" ")}`;
  const totalW = NUM_W + columns.reduce((s, c) => s + (widths[c] ?? 120), 0);
  const start = Math.max(0, Math.floor(vp.top / ROW_H) - 10);
  const end = Math.min(view.length, Math.ceil((vp.top + vp.height) / ROW_H) + 10);

  return (
    <>
      <div
        class="grid"
        ref={scrollRef}
        tabIndex={0}
        role="grid"
        aria-label={edit ? "Query results in edit mode — arrow keys move, Enter edits a cell, Ctrl+S reviews changes" : "Query results — arrow keys move, Enter shows a cell, Ctrl+Enter opens an Id, Ctrl+C copies"}
        aria-rowcount={view.length + 1}
        aria-colcount={columns.length + 1}
        aria-activedescendant={sel ? `${gid}-${sel.r}-${sel.c}` : undefined}
        onFocus={(e) => {
          if (e.target === e.currentTarget && !sel && view.length) setSel({ r: 0, c: 0 });
        }}
      >
        <div class="grid__inner" style={{ width: totalW, height: ROW_H * (view.length + 1) + (edit && (Object.keys(edit.staged).length || Object.keys(edit.errors).length) ? 76 : 0) }}>
          <div class="grid__head" style={{ gridTemplateColumns: template, width: totalW }} role="row">
            <div class="gh gh--num" role="columnheader">
              #
            </div>
            {columns.map((c) => (
              <div key={c} class={"gh" + (sort?.col === c ? " is-sorted" : "")} role="columnheader" aria-sort={sort?.col === c ? (sort.dir === 1 ? "ascending" : "descending") : "none"} title={c}>
                <button class="gh__btn" onClick={() => setSort((s) => (s?.col !== c ? { col: c, dir: 1 } : s.dir === 1 ? { col: c, dir: -1 } : null))} aria-label={`Sort by ${c}${edit?.fields.has(c) ? ", editable" : ""}`}>
                  <span class="truncate">{c}</span>
                  {edit?.fields.has(c) && <Pencil class="gh__editable" aria-hidden="true" />}
                  {sort?.col === c && (sort.dir === 1 ? <ArrowDown /> : <ArrowUp />)}
                </button>
                <span
                  class="gh__resize"
                  role="separator"
                  tabIndex={0}
                  aria-orientation="vertical"
                  aria-label={`Resize ${c} column (arrow keys)`}
                  aria-valuenow={widths[c] ?? 120}
                  onMouseDown={(e) => startResize(c, e)}
                  onClick={(e) => e.stopPropagation()}
                  onDblClick={() => setWidths((w) => ({ ...w, [c]: estimateWidth(c, rows) }))}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                    e.preventDefault();
                    e.stopPropagation();
                    setWidths((w) => ({ ...w, [c]: Math.max(56, (w[c] ?? 120) + (e.key === "ArrowRight" ? 16 : -16)) }));
                  }}
                />
              </div>
            ))}
          </div>
          <div style={{ transform: `translateY(${start * ROW_H}px)` }}>
            {view.slice(start, end).map(({ r, i }, k) => {
              const ri = start + k;
              return (
                <div
                  class={"grow-row" + (sel?.r === ri ? " is-selrow" : "") + (edit && r.Id && edit.errors[r.Id as string] ? " is-error" : "")}
                  style={{ gridTemplateColumns: template, width: totalW }}
                  key={i}
                  role="row"
                  aria-rowindex={ri + 2}
                >
                  <div class="gc gc--num" role="rowheader" title={edit && r.Id ? edit.errors[r.Id as string] : undefined}>
                    {i + 1}
                  </div>
                  {columns.map((c, ci) => {
                    const id = r.Id as string | undefined;
                    const f = edit && id ? edit.fields.get(c) : undefined;
                    const isStaged = !!f && !!id && c in (edit!.staged[id] ?? {});
                    const v = isStaged ? (edit!.staged[id!][c] as Cell) : r[c];
                    const selected = sel?.r === ri && sel.c === ci;
                    const isEditing = editing?.r === ri && editing.c === ci && !!f;
                    return (
                      <div
                        key={c}
                        id={`${gid}-${ri}-${ci}`}
                        class={"gc" + (selected ? " is-sel" : "") + (typeof v === "number" ? " gc--num-val" : "") + (f ? " is-editable" : "") + (isStaged ? " is-staged" : "")}
                        role="gridcell"
                        aria-colindex={ci + 2}
                        aria-selected={selected}
                        onMouseDown={() => setSel({ r: ri, c: ci })}
                        onDblClick={() => (f ? setEditing({ r: ri, c: ci }) : openCell(c, v))}
                      >
                        <CellView col={c} v={v} onOpenSub={() => openCell(c, v)} />
                        {isStaged && <span class="sr-only"> (changed, was {r[c] == null ? "empty" : String(r[c])})</span>}
                        {isEditing && (
                          <div class="gedit" onMouseDown={(e) => e.stopPropagation()}>
                            <Editor
                              f={f!}
                              value={v}
                              original={r[c]}
                              onCommit={(nv) => {
                                edit!.onStage(id!, c, sameValue(nv, r[c]) ? undefined : nv);
                                setEditing(null);
                                scrollRef.current?.focus();
                              }}
                              onCancel={() => (setEditing(null), scrollRef.current?.focus())}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {sub && (
        <Modal title={<>{sub.title} <span class="muted">· {sub.data.totalSize} records</span></>} onClose={() => setSub(null)} width={960}>
          <div class="subgrid">
            <ResultGrid records={sub.data.records} filter="" />
          </div>
        </Modal>
      )}
      {viewer && (
        <Modal
          title={<span class="mono">{viewer.col}</span>}
          onClose={() => setViewer(null)}
          width={720}
          footer={<CopyButton text={viewer.value} label="Copy value" />}
        >
          <div class="modal__body">
            <pre class="dcode" style={{ maxHeight: "50vh" }}>{viewer.value || "(empty)"}</pre>
          </div>
        </Modal>
      )}
    </>
  );
}

function CellView({ col, v, onOpenSub }: { col: string; v: Cell | undefined; onOpenSub: () => void }) {
  if (v == null) return <span class="gnull">—</span>;
  if (typeof v === "boolean") return <span class={"gbool" + (v ? " is-on" : "")}>{String(v)}</span>;
  if (typeof v === "object") {
    if ((v as SubResult).__sub) {
      const s = v as SubResult;
      return (
        <button class="gsub" tabIndex={-1} onClick={(e) => (e.stopPropagation(), onOpenSub())} disabled={!s.totalSize}>
          <Layers /> {s.totalSize} {s.totalSize === 1 ? "record" : "records"}
        </button>
      );
    }
    return <span class="mono truncate">{JSON.stringify(v)}</span>;
  }
  const s = String(v);
  if (typeof v === "string") {
    const dt = fmtDt(v);
    if (dt) return <span class="tabular" title={v}>{dt}</span>;
  }
  if (typeof v === "string" && (col === "Id" || col.endsWith("Id") || col.endsWith(".Id")) && looksLikeId(s)) {
    return (
      <a class="mono gid" tabIndex={-1} href={links.id(s)} onMouseDown={(e) => e.stopPropagation()}>
        {s}
      </a>
    );
  }
  return <span class="truncate">{s}</span>;
}
