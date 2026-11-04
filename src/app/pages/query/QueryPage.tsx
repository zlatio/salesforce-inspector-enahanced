import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  AlertCircle,
  Braces,
  ChevronsDown,
  Clipboard,
  Download,
  FileSpreadsheet,
  History as HistoryIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Search,
  Square,
  Star,
  Table2,
  Trash2,
  Wand2,
  X,
} from "lucide-preact";
import { orgState } from "../../../lib/org";
import type { SfError } from "../../../lib/sf";
import { errorOffset, formatSoql, isCountOnly, mainObject, toDelimited, toJson, flattenRecords } from "../../../lib/soql";
import { fmtDuration, fmtNumber, fmtRelative, plural } from "../../../lib/format";
import { Pencil } from "lucide-preact";
import { Badge, Button, Callout, copyText, Empty, Keys, Menu, Modal, SearchInput, Seg, Spinner, Switch, modKey, toast } from "../../../ui";
import { route, navigate } from "../../router";
import { ResultGrid, gridTz, hasDatetimes, setGridTz, type GridView } from "./ResultGrid";
import { GridEditBar, useGridEdit, type GridEditState } from "./gridEdit";
import { SoqlEditor, markError, type SoqlEditorHandle } from "./SoqlEditor";
import {
  activeTab,
  activeTabId,
  addHistory,
  closeTab,
  history,
  newTab,
  runs,
  saveQuery,
  saved,
  setRun,
  setTabSoql,
  sidePanel,
  tabs,
  updateTab,
  type QueryTab,
  NEW_TAB_SOQL,
  clearGridEdit,
  gridChangeCount,
} from "./store";
import "./query.css";

const controllers = new Map<string, AbortController>();

export function QueryPage() {
  const sf = orgState.value!.sf;
  const tab = activeTab.value;
  const run = runs.value[tab.id];
  const editor = useRef<SoqlEditorHandle>({ view: null });
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [editorH, setEditorH] = useState(() => Number(localStorage.getItem("sie.query.editorH")) || 190);
  const gridView = useRef<GridView | null>(null);
  const [pending, setPending] = useState<null | { kind: "run"; tab: QueryTab } | { kind: "close"; id: string } | { kind: "stopEdit" }>(null);
  const requestClose = (id: string) => {
    if (gridChangeCount(id) > 0) return setPending({ kind: "close", id });
    clearGridEdit(id);
    closeTab(id);
  };
  const [showCancel, setShowCancel] = useState(false);

  // Accept ?q=… from other pages (e.g. “Query this object”): open it in a fresh tab and run.
  useEffect(() => {
    const q = route.value.params.get("q");
    if (!q) return;
    const tooling = route.value.params.get("tooling") === "1";
    // Links always mean a plain query (never "Include deleted"). If the same query is already
    // open that way, switch to it rather than piling up duplicate tabs.
    const same = tabs.value.find((t) => t.soql.trim() === q.trim() && !!t.tooling === tooling && !t.all);
    if (same) {
      activeTabId.value = same.id;
      navigate("#/query", true);
      // Unsaved cell edits stay put; re-running would ask to discard them.
      if (!gridChangeCount(same.id)) setTimeout(() => execute(same), 0);
      return;
    }
    const empty = tabs.value.find((t) => !t.soql.trim() || t.soql === NEW_TAB_SOQL);
    const t = empty ? (setTabSoql(empty.id, q, { tooling, all: false }), (activeTabId.value = empty.id), empty) : newTab(q, tooling);
    navigate("#/query", true);
    setTimeout(() => execute({ ...t, soql: q, tooling, all: false }), 0);
  }, [route.value.params.get("q")]);

  useEffect(() => setFilter(""), [tab.id]);

  const execute = async (t: QueryTab = activeTab.value, force = false) => {
    const soql = t.soql.trim();
    if (!soql) return;
    // Re-running replaces the results, so unsaved cell edits must be discarded deliberately.
    if (!force && gridChangeCount(t.id) > 0) return setPending({ kind: "run", tab: t });
    if (force) clearGridEdit(t.id);
    controllers.get(t.id)?.abort();
    const ctrl = new AbortController();
    controllers.set(t.id, ctrl);
    // A newer run (or load-more) on this tab owns its state now; a superseded run must not touch it.
    const current = () => controllers.get(t.id) === ctrl;
    markError(editor.current.view, null);
    const startedAt = performance.now();
    setRun(t.id, { status: "running", soql, tooling: t.tooling, records: [], totalSize: 0, ms: 0, startedAt: Date.now() });
    try {
      const res = await sf.query(soql, { tooling: t.tooling, all: t.all, signal: ctrl.signal });
      if (!current()) return;
      const ms = performance.now() - startedAt;
      setRun(t.id, { status: "done", soql, tooling: t.tooling, records: res.records, totalSize: res.totalSize, nextRecordsUrl: res.done ? undefined : res.nextRecordsUrl, ms, startedAt: Date.now() });
      addHistory({ soql, tooling: t.tooling, object: mainObject(soql), rows: res.totalSize, at: Date.now() });
    } catch (e) {
      if (!current()) return;
      if ((e as Error).name === "AbortError") {
        setRun(t.id, (p) => ({ ...p!, status: "cancelled", ms: performance.now() - startedAt }));
        return;
      }
      const msg = (e as SfError).message;
      const off = errorOffset(soql, msg);
      setRun(t.id, { status: "error", soql, tooling: t.tooling, records: [], totalSize: 0, ms: performance.now() - startedAt, error: msg, errorOffset: off, startedAt: Date.now() });
      if (t.id === activeTab.value.id && soql === editor.current.view?.state.doc.toString().trim()) markError(editor.current.view, off);
    } finally {
      if (current()) controllers.delete(t.id);
    }
  };

  const loadMore = async (all: boolean) => {
    const id = tab.id;
    let r = runs.value[id];
    if (!r?.nextRecordsUrl) return;
    controllers.get(id)?.abort();
    const ctrl = new AbortController();
    controllers.set(id, ctrl);
    const current = () => controllers.get(id) === ctrl;
    setRun(id, { ...r, loadingMore: true });
    try {
      do {
        const res = await sf.queryMore(r.nextRecordsUrl!, ctrl.signal);
        if (!current()) return;
        r = { ...runs.value[id], records: [...runs.value[id].records, ...res.records], nextRecordsUrl: res.done ? undefined : res.nextRecordsUrl, loadingMore: true };
        setRun(id, r);
      } while (all && r.nextRecordsUrl && !ctrl.signal.aborted);
    } catch (e) {
      if (current() && (e as Error).name !== "AbortError") toast("error", "Couldn't load more rows", (e as Error).message);
    } finally {
      if (current()) {
        setRun(id, { ...runs.value[id], loadingMore: false });
        controllers.delete(id);
      }
    }
  };

  const cancel = () => controllers.get(tab.id)?.abort();

  const startDrag = (e: MouseEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = editorH;
    const onMove = (ev: MouseEvent) => setEditorH(Math.max(90, Math.min(window.innerHeight - 260, h0 + ev.clientY - y0)));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("is-resizing-v");
      setEditorH((h) => (localStorage.setItem("sie.query.editorH", String(h)), h));
    };
    document.body.classList.add("is-resizing-v");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const running = run?.status === "running" || !!run?.loadingMore;
  const obj = mainObject(tab.soql);
  const ge = useGridEdit(tab.id, run, run ? mainObject(run.soql) : null);

  // Only offer Cancel once a query has been running for a moment, so fast queries don't flash it.
  useEffect(() => {
    if (!running) return setShowCancel(false);
    const h = setTimeout(() => setShowCancel(true), 400);
    return () => clearTimeout(h);
  }, [running]);

  const copyVisible = () => {
    const v = gridView.current;
    if (!v || !run) return;
    copyText(toDelimited(v.columns, v.rows, "\t"));
    const more = run.totalSize - run.records.length;
    const what = v.filtered ? `${fmtNumber(v.rows.length)} filtered rows` : `${fmtNumber(v.rows.length)} rows`;
    toast("success", `Copied ${what}`, `Tab-separated, ready to paste into Excel or Sheets.${more > 0 ? ` ${fmtNumber(more)} more rows on the server aren't loaded yet.` : ""}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "s" && ge.on) {
        e.preventDefault();
        if (ge.changes) ge.setReviewing(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copyVisible();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const list = tabs.value;
    const go = (j: number) => {
      const t = list[(j + list.length) % list.length];
      activeTabId.value = t.id;
      requestAnimationFrame(() => document.getElementById("qtab-" + t.id)?.focus());
    };
    if (e.key === "ArrowRight") (e.preventDefault(), go(i + 1));
    else if (e.key === "ArrowLeft") (e.preventDefault(), go(i - 1));
    else if (e.key === "Home") (e.preventDefault(), go(0));
    else if (e.key === "End") (e.preventDefault(), go(list.length - 1));
    else if (e.key === "Delete") (e.preventDefault(), requestClose(list[i].id));
  };

  return (
    <div class="qpage">
      {sidePanel.value && (
        <SidePanel
          onLoad={(soql, tooling, savedId, inNewTab) => {
            // Ctrl/Cmd-click opens it in a new tab instead of replacing the current query.
            if (inNewTab) {
              const t = newTab(soql, tooling);
              if (savedId) updateTab(t.id, { savedId });
            } else setTabSoql(tab.id, soql, { tooling, savedId });
          }}
        />
      )}
      <div class="qmain">
        <div class="qtabs">
          <Button variant="ghost" size="sm" icon aria-label={sidePanel.value ? "Hide history" : "Show history"} aria-expanded={!!sidePanel.value} data-tip={sidePanel.value ? "Hide panel" : "History & saved"} onClick={() => (sidePanel.value = sidePanel.value ? null : "history")}>
            {sidePanel.value ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <div class="qtabs__list" role="tablist" aria-label="Query tabs">
            {tabs.value.map((t, i) => {
              const o = mainObject(t.soql);
              const r = runs.value[t.id];
              const active = t.id === tab.id;
              return (
                <div class={"qtab" + (active ? " is-active" : "")} key={t.id}>
                  <button
                    id={"qtab-" + t.id}
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    class="qtab__main"
                    onClick={() => (activeTabId.value = t.id)}
                    onAuxClick={(e) => e.button === 1 && requestClose(t.id)}
                    onKeyDown={(e) => onTabKey(e, i)}
                    title={t.soql.trim() || "Empty query"}
                  >
                    {r?.status === "running" ? <Spinner small /> : r?.status === "error" ? <AlertCircle class="qtab__err" aria-label="Failed" /> : <Table2 class="qtab__icon" aria-hidden="true" />}
                    <span class="truncate">{o ?? "Untitled"}</span>
                    {t.tooling && (
                      <span class="qtab__tag" title="Tooling API">
                        Tooling
                      </span>
                    )}
                  </button>
                  <button class="qtab__close" aria-label={`Close ${o ?? "untitled"} tab`} tabIndex={-1} onClick={() => requestClose(t.id)}>
                    <X />
                  </button>
                </div>
              );
            })}
          </div>
          <Button variant="ghost" size="sm" icon aria-label="New query tab" data-tip="New tab" onClick={() => newTab()}>
            <Plus />
          </Button>
        </div>

        <div class="qeditor" style={{ height: editorH }}>
          <SoqlEditor key={tab.id} tabId={tab.id} value={tab.soql} onChange={(v) => updateTab(tab.id, { soql: v })} onRun={() => execute()} sf={sf} tooling={tab.tooling} handle={editor} />
        </div>

        <div class="qbar">
          <Button variant="primary" onClick={() => execute()} disabled={!tab.soql.trim() || running}>
            {running ? <Spinner small /> : <Play />} {running ? "Running…" : "Run"} <Keys k={[modKey, "↵"]} />
          </Button>
          {showCancel && (
            <Button variant="ghost" onClick={cancel}>
              <Square /> Cancel
            </Button>
          )}
          <Switch checked={tab.tooling} onChange={(v) => updateTab(tab.id, { tooling: v })} title="Query metadata objects such as ApexClass, Flow or CustomField via the Tooling API">
            Tooling API
          </Switch>
          <Switch checked={tab.all && !tab.tooling} disabled={tab.tooling} onChange={(v) => updateTab(tab.id, { all: v })} title={tab.tooling ? "Not available with the Tooling API" : "Include deleted and archived records (queryAll)"}>
            Include deleted
          </Switch>
          <div class="qbar__spacer" />
          <Button size="sm" variant="ghost" onClick={() => setTabSoql(tab.id, formatSoql(tab.soql))} disabled={!tab.soql.trim()} data-tip="Format query">
            <Wand2 /> Format
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSaving(true)} disabled={!tab.soql.trim()}>
            <Star /> Save
          </Button>
        </div>

        <div
          class="qresize"
          onMouseDown={startDrag}
          role="separator"
          tabIndex={0}
          aria-orientation="horizontal"
          aria-label="Resize editor (arrow keys)"
          aria-valuenow={editorH}
          aria-valuemin={90}
          aria-valuemax={window.innerHeight - 260}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            setEditorH((h) => {
              const n = Math.max(90, Math.min(window.innerHeight - 260, h + (e.key === "ArrowUp" ? -16 : 16)));
              localStorage.setItem("sie.query.editorH", String(n));
              return n;
            });
          }}
        />

        <Results run={run} filter={filter} setFilter={setFilter} obj={obj} onMore={loadMore} onCancel={cancel} gridView={gridView} onCopy={copyVisible} ge={ge} onStopEdit={() => setPending({ kind: "stopEdit" })} />
      </div>

      {saving && <SaveDialog tab={tab} onClose={() => setSaving(false)} />}
      {pending && (
        <Modal
          title={pending.kind === "run" ? "Discard unsaved edits and re-run?" : pending.kind === "close" ? "Close tab with unsaved edits?" : "Stop editing?"}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button onClick={() => setPending(null)} data-autofocus>
                Keep editing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const p = pending;
                  setPending(null);
                  if (p.kind === "run") execute(p.tab, true);
                  else if (p.kind === "close") (clearGridEdit(p.id), closeTab(p.id));
                  else (ge.discard(), ge.setOn(false));
                }}
              >
                {pending.kind === "run" ? "Discard & run" : pending.kind === "close" ? "Discard & close" : "Discard edits"}
              </Button>
            </>
          }
        >
          <div class="modal__body">
            <p>
              {plural(gridChangeCount(pending.kind === "close" ? pending.id : pending.kind === "run" ? pending.tab.id : tab.id), "unsaved cell change")} will be lost. Use “Review & save” first to keep{" "}
              {gridChangeCount(pending.kind === "close" ? pending.id : pending.kind === "run" ? pending.tab.id : tab.id) === 1 ? "it" : "them"}.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Results({
  run,
  filter,
  setFilter,
  obj,
  onMore,
  onCancel,
  gridView,
  onCopy,
  ge,
  onStopEdit,
}: {
  ge: GridEditState;
  onStopEdit: () => void;
  run: ReturnType<() => (typeof runs.value)[string]> | undefined;
  filter: string;
  setFilter: (s: string) => void;
  obj: string | null;
  onMore: (all: boolean) => void;
  onCancel: () => void;
  gridView: { current: GridView | null };
  onCopy: () => void;
}) {
  if (!run)
    return (
      <div class="qresults">
        <Empty icon={<Play />} title="Run a query to see results">
          Press <Keys k={[modKey, "↵"]} /> to run. Suggestions appear as you type; press <Keys k={["Ctrl", "Space"]} /> to open them anywhere.
        </Empty>
      </div>
    );
  if (run.status === "error")
    return (
      <div class="qresults qresults--pad">
        <Callout tone="danger" title="Query failed">
          <div class="mono qerror">{run.error}</div>
        </Callout>
      </div>
    );
  if (run.status === "running" && !run.records.length)
    return (
      <div class="qresults">
        <div class="empty">
          <Spinner />
          <span>Running query…</span>
        </div>
      </div>
    );
  if (run.status === "cancelled")
    return (
      <div class="qresults">
        <Empty icon={<Square />} title="Query cancelled" />
      </div>
    );

  const countOnly = isCountOnly(run.soql);
  const loaded = run.records.length;
  const isProd = orgState.value!.env === "production";
  return (
    <div class="qresults">
      <div class="qres__bar">
        <div class="qres__stats">
          <span class="qres__count tabular">
            {countOnly ? (
              <>Count</>
            ) : loaded < run.totalSize ? (
              <>
                {fmtNumber(loaded)} <span class="muted">of {fmtNumber(run.totalSize)} rows</span>
              </>
            ) : (
              <>{fmtNumber(run.totalSize)} {run.totalSize === 1 ? "row" : "rows"}</>
            )}
          </span>
          <span class="muted">·</span>
          <span class="muted tabular">{fmtDuration(run.ms)}</span>
          {obj && (
            <>
              <span class="muted">·</span>
              <Badge mono square>
                {obj}
              </Badge>
            </>
          )}
          {run.tooling && <Badge tone="info">Tooling</Badge>}
          {hasDatetimes(run.records) && (
            <div class="tzseg" title="Show datetimes in your local time zone or UTC (copy and export keep the raw value)">
              <Seg label="Datetime display" value={gridTz.value} onChange={setGridTz} options={[{ value: "local", label: "Local" }, { value: "utc", label: "UTC" }]} />
            </div>
          )}
        </div>
        {run.nextRecordsUrl && (
          <div class="row">
            {run.loadingMore ? (
              <>
                <Spinner small />
                <span class="muted">Loading…</span>
                <Button size="sm" variant="ghost" onClick={onCancel}>
                  Stop
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => onMore(false)}>
                  <ChevronsDown /> Load more
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onMore(true)}>
                  Load all {fmtNumber(run.totalSize - loaded)}
                </Button>
              </>
            )}
          </div>
        )}
        <div class="qbar__spacer" />
        {!countOnly && loaded > 0 && (
          <>
            <SearchInput value={filter} onInput={setFilter} placeholder="Filter results" size="sm" class="qres__filter" />
            <Button size="sm" onClick={onCopy} data-tip={`Copy visible rows for Excel (${modKey}+Shift+C)`}>
              <FileSpreadsheet /> Copy
            </Button>
            {ge.eligible && (
              <Button
                size="sm"
                variant={ge.on ? "soft" : "default"}
                aria-pressed={ge.on}
                onClick={() => {
                  if (ge.on && ge.changes) return onStopEdit();
                  ge.setOn(!ge.on);
                }}
                data-tip={ge.on ? "Stop editing" : "Edit cells, then save in bulk"}
              >
                <Pencil /> {ge.on ? "Editing" : isProd ? "Edit production data" : "Edit"}
              </Button>
            )}
            <ExportMenu run={run} gridView={gridView} />
          </>
        )}
      </div>
      {countOnly ? (
        <div class="qcount">
          <div class="qcount__n tabular">{fmtNumber(run.totalSize)}</div>
          <div class="muted">matching {obj ?? "records"}</div>
        </div>
      ) : loaded === 0 ? (
        <Empty icon={<Search />} title="No rows returned">
          The query ran successfully but matched no records.
        </Empty>
      ) : (
        <>
          {ge.on && (
            <div class="gedit-hint">
              {ge.describe ? (
                <>
                  <Pencil aria-hidden="true" /> Double-click a cell, or select it and press Enter, to edit. {plural(ge.fields.size, "column")} can be edited
                  {ge.fields.size === 0 ? " — add updateable fields of this object to the SELECT" : ""}.
                </>
              ) : (
                <>
                  <Spinner small /> Loading field info…
                </>
              )}
            </div>
          )}
          <ResultGrid records={run.records} filter={filter} viewRef={gridView} edit={ge.edit} />
          {mainObject(run.soql) && <GridEditBar ge={ge} run={run} obj={mainObject(run.soql)!} gridView={gridView} />}
        </>
      )}
    </div>
  );
}

function ExportMenu({ run, gridView }: { run: NonNullable<(typeof runs.value)[string]>; gridView: { current: GridView | null } }) {
  // Copies follow what the grid shows (filter + sort); downloads export every loaded row.
  const visible = () => gridView.current ?? flattenRecords(run.records);
  const data = () => flattenRecords(run.records);
  const download = (text: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const base = `${mainObject(run.soql) ?? "query"}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
  return (
    <Menu
      trigger={(open, toggle) => (
        <Button size="sm" onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
          <Download /> Export
        </Button>
      )}
    >
      {(close) => (
        <>
          <div class="menu__label" role="none">Copy to clipboard</div>
          <button
            role="menuitem"
            class="menu__item"
            onClick={() => {
              const d = visible();
              copyText(toDelimited(d.columns, d.rows, "\t"));
              toast("success", `Copied ${fmtNumber(d.rows.length)} rows`, "Tab-separated — paste straight into Excel or Sheets.");
              close();
            }}
          >
            <FileSpreadsheet /> Copy for Excel
          </button>
          <button
            role="menuitem"
            class="menu__item"
            onClick={() => {
              const d = visible();
              copyText(toDelimited(d.columns, d.rows));
              toast("success", `Copied ${fmtNumber(d.rows.length)} rows as CSV`);
              close();
            }}
          >
            <Clipboard /> Copy as CSV
          </button>
          <button
            role="menuitem"
            class="menu__item"
            onClick={() => {
              copyText(toJson(run.records));
              toast("success", `Copied ${fmtNumber(run.records.length)} records as JSON`);
              close();
            }}
          >
            <Braces /> Copy as JSON
          </button>
          <div class="menu__sep" />
          <div class="menu__label" role="none">Download</div>
          <button
            role="menuitem"
            class="menu__item"
            onClick={() => {
              const d = data();
              download("﻿" + toDelimited(d.columns, d.rows), base + ".csv", "text/csv;charset=utf-8");
              close();
            }}
          >
            <Download /> CSV file
          </button>
          <button
            role="menuitem"
            class="menu__item"
            onClick={() => {
              download(toJson(run.records), base + ".json", "application/json");
              close();
            }}
          >
            <Download /> JSON file
          </button>
        </>
      )}
    </Menu>
  );
}

function SidePanel({ onLoad }: { onLoad: (soql: string, tooling: boolean, savedId?: string, inNewTab?: boolean) => void }) {
  const [q, setQ] = useState("");
  const panel = sidePanel.value ?? "history";
  const s = q.trim().toLowerCase();
  const hist = useMemo(() => history.value.filter((h) => !s || h.soql.toLowerCase().includes(s)), [history.value, s]);
  const sav = useMemo(() => saved.value.filter((h) => !s || h.soql.toLowerCase().includes(s) || h.name.toLowerCase().includes(s)), [saved.value, s]);

  return (
    <aside class="qside" aria-label="Query history and saved queries">
      <div class="qside__tabs">
        <button class={"qside__tab" + (panel === "history" ? " is-active" : "")} aria-pressed={panel === "history"} onClick={() => (sidePanel.value = "history")}>
          <HistoryIcon /> History <span class="tab__count">{history.value.length}</span>
        </button>
        <button class={"qside__tab" + (panel === "saved" ? " is-active" : "")} aria-pressed={panel === "saved"} onClick={() => (sidePanel.value = "saved")}>
          <Star /> Saved <span class="tab__count">{saved.value.length}</span>
        </button>
      </div>
      <div class="qside__search">
        <SearchInput value={q} onInput={setQ} placeholder={panel === "history" ? "Search history" : "Search saved queries"} size="sm" />
      </div>
      <div class="qside__list">
        {panel === "history" ? (
          hist.length === 0 ? (
            <div class="qside__empty">{s ? "No matches." : "Queries you run appear here."}</div>
          ) : (
            <>
              {hist.map((h) => (
                <div class="qitem" key={h.at}>
                  <button class="qitem__load" onClick={(e) => onLoad(h.soql, h.tooling, undefined, e.ctrlKey || e.metaKey)} onAuxClick={(e) => e.button === 1 && onLoad(h.soql, h.tooling, undefined, true)} title="Load into the editor (Ctrl+click: new tab)">
                    <span class="qitem__soql">{h.soql}</span>
                    <span class="qitem__meta">
                      {h.object && <span class="mono">{h.object}</span>}
                      <span>{plural(h.rows, "row")}</span>
                      <span>{fmtRelative(h.at)}</span>
                      {h.tooling && <span class="qtab__tag">Tooling</span>}
                    </span>
                  </button>
                  <div class="qitem__actions">
                    <button class="copy" aria-label="Remove from history" data-tip="Remove" onClick={(e) => (e.stopPropagation(), (history.value = history.value.filter((x) => x !== h)))}>
                      <Trash2 />
                    </button>
                  </div>
                </div>
              ))}
              <button class="link-btn qside__clear" onClick={() => confirm("Clear query history for this org?") && (history.value = [])}>
                Clear history
              </button>
            </>
          )
        ) : sav.length === 0 ? (
          <div class="qside__empty">{s ? "No matches." : "Save a query with the ☆ Save button to keep it here. Saved queries are shared across orgs."}</div>
        ) : (
          sav.map((h) => (
            <div class="qitem" key={h.id}>
              <button class="qitem__load" onClick={(e) => onLoad(h.soql, h.tooling, h.id, e.ctrlKey || e.metaKey)} onAuxClick={(e) => e.button === 1 && onLoad(h.soql, h.tooling, h.id, true)} title="Load into the editor (Ctrl+click: new tab)">
                <span class="qitem__name">
                  <Star class="qitem__star" aria-hidden="true" /> {h.name}
                  {h.tooling && <span class="qtab__tag">Tooling</span>}
                </span>
                <span class="qitem__soql">{h.soql}</span>
              </button>
              <div class="qitem__actions">
                <button class="copy" aria-label="Delete saved query" data-tip="Delete" onClick={(e) => (e.stopPropagation(), confirm(`Delete “${h.name}”?`) && (saved.value = saved.value.filter((x) => x.id !== h.id)))}>
                  <Trash2 />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function SaveDialog({ tab, onClose }: { tab: QueryTab; onClose: () => void }) {
  const existing = tab.savedId ? saved.value.find((x) => x.id === tab.savedId) : undefined;
  const [mode, setMode] = useState<"update" | "new">(existing ? "update" : "new");
  const [name, setName] = useState(() => {
    if (existing) return existing.name;
    const o = mainObject(tab.soql);
    return o ? `${o} query` : "My query";
  });
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.select();
  }, []);
  const soql = tab.soql.trim();
  const submit = (e?: Event) => {
    e?.preventDefault();
    if (!name.trim()) return;
    if (existing && mode === "update") {
      saved.value = saved.value.map((x) => (x.id === existing.id ? { ...x, name: name.trim(), soql, tooling: tab.tooling } : x));
      toast("success", "Saved query updated", name.trim());
    } else {
      const q = saveQuery(name.trim(), soql, tab.tooling);
      updateTab(tab.id, { savedId: q.id });
      toast("success", "Query saved", name.trim());
    }
    sidePanel.value = "saved";
    onClose();
  };
  return (
    <Modal
      title={existing ? "Save query" : "Save new query"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => submit()} disabled={!name.trim()}>
            <Star /> {existing && mode === "update" ? "Update" : "Save"}
          </Button>
        </>
      }
    >
      <form class="modal__body stack" style={{ gap: 12 }} onSubmit={submit}>
        {existing && (
          <Seg
            label="Save mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "update", label: `Update “${existing.name}”` },
              { value: "new", label: "Save as new" },
            ]}
          />
        )}
        <label class="stack" style={{ gap: 6 }}>
          <span class="subtle" style={{ fontWeight: 500 }}>
            Name
          </span>
          <input ref={ref} class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <pre class="dcode">{soql}</pre>
      </form>
    </Modal>
  );
}
