import { useEffect, useMemo, useState } from "preact/hooks";
import { AlertTriangle, Save, Undo2, XCircle } from "lucide-preact";
import { orgState } from "../../../lib/org";
import { isAggregate } from "../../../lib/soql";
import type { DescribeSObjectResult, SfRecord } from "../../../lib/types";
import { plural } from "../../../lib/format";
import { Button, Callout, Keys, Modal, Spinner, modKey, toast } from "../../../ui";
import { isEditable, sameValue } from "../../../lib/values";
import type { GridEdit, GridView } from "./ResultGrid";
import { EMPTY_GRID_EDIT, clearGridEdit, gridEdits, setRun, updateGridEdit, type QueryRun } from "./store";

/** State for editing cells in a single-object result set and saving them back in batches of 200. */
export function useGridEdit(tabId: string, run: QueryRun | undefined, obj: string | null) {
  const st = orgState.value!;
  const sf = st.sf;
  const tabEdit = gridEdits.value[tabId] ?? EMPTY_GRID_EDIT;
  const { staged, errors } = tabEdit;
  const changes = Object.values(staged).reduce((n, x) => n + Object.keys(x).length, 0);
  const [on, setOn] = useState(changes > 0);
  const [describe, setDescribe] = useState<DescribeSObjectResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const eligible = !!run && run.status === "done" && !run.tooling && !!obj && run.records.length > 0 && typeof run.records[0].Id === "string" && !isAggregate(run.soql);

  // Returning to a tab with staged edits puts it straight back into edit mode.
  useEffect(() => setOn(changes > 0), [tabId]);
  useEffect(() => {
    if (!eligible && !changes) setOn(false);
  }, [eligible]);
  useEffect(() => {
    if (on && obj) sf.describe(obj).then(setDescribe, (e) => (toast("error", `Couldn't describe ${obj}`, e.message), setOn(false)));
  }, [on, obj]);
  // Unsaved cell edits survive in-app navigation (session storage), but warn before closing the browser tab.
  useEffect(() => {
    if (!changes) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [changes > 0]);

  const fields = useMemo(() => {
    if (!describe || !run) return new Map();
    const cols = new Set(Object.keys(run.records[0] ?? {}));
    return new Map(describe.fields.filter((f) => cols.has(f.name) && f.name !== "Id" && isEditable(f)).map((f) => [f.name, f]));
  }, [describe, run?.records]);

  const rowsChanged = Object.keys(staged).length;

  const onStage = (id: string, field: string, value: unknown | undefined) =>
    updateGridEdit(tabId, (e) => {
      const row = { ...(e.staged[id] ?? {}) };
      if (value === undefined) delete row[field];
      else row[field] = value;
      const nextStaged = { ...e.staged };
      if (Object.keys(row).length) nextStaged[id] = row;
      else delete nextStaged[id];
      const nextErrors = { ...e.errors };
      delete nextErrors[id];
      return { staged: nextStaged, errors: nextErrors };
    });

  const save = async () => {
    if (!run || !obj) return;
    setSaving(true);
    const ids = Object.keys(staged);
    const failed: Record<string, string> = {};
    const saved = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      try {
        const res = await sf.request<Array<{ id: string; success: boolean; errors: Array<{ message: string; statusCode: string; fields?: string[] }> }>>(sf.path("/composite/sobjects"), {
          method: "PATCH",
          body: { allOrNone: false, records: batch.map((id) => ({ attributes: { type: obj }, Id: id, ...staged[id] })) },
        });
        batch.forEach((id, k) => {
          if (res[k]?.success) saved.add(id);
          else failed[id] = (res[k]?.errors ?? []).map((e) => `${e.message}${e.fields?.length ? ` (${e.fields.join(", ")})` : ""}`).join("; ") || "Save failed";
        });
      } catch (e) {
        for (const id of batch) failed[id] = (e as Error).message;
      }
    }
    // Apply what saved to the visible results; keep failures staged so they can be fixed and retried.
    const records = run.records.map((r) => (saved.has(r.Id as string) ? ({ ...r, ...staged[r.Id as string] } as SfRecord) : r));
    setRun(tabId, { ...run, records });
    updateGridEdit(tabId, (e) => ({ staged: Object.fromEntries(Object.entries(e.staged).filter(([id]) => !saved.has(id))), errors: failed }));
    setSaving(false);
    setReviewing(false);
    const nFailed = Object.keys(failed).length;
    if (nFailed) toast("error", `${plural(nFailed, "record")} couldn't be saved`, `${plural(saved.size, "record")} saved. Use “${plural(nFailed, "failed")}” in the save bar to see why.`);
    else toast("success", `Saved ${plural(saved.size, "record")}`, `${obj} · ${Math.ceil(ids.length / 200)} API ${Math.ceil(ids.length / 200) === 1 ? "call" : "calls"}`);
  };

  const edit: GridEdit | undefined = on && describe ? { fields, staged, errors, onStage } : undefined;
  return { eligible, on, setOn, edit, describe, staged, errors, changes, rowsChanged, save, saving, reviewing, setReviewing, discard: () => clearGridEdit(tabId), fields };
}

export type GridEditState = ReturnType<typeof useGridEdit>;

/** Floating bar with the pending-changes count, the failed-rows list, and the review dialog. */
export function GridEditBar({ ge, run, obj, gridView }: { ge: GridEditState; run: QueryRun; obj: string; gridView: { current: GridView | null } }) {
  const st = orgState.value!;
  const isProd = st.env === "production";
  const [showFailed, setShowFailed] = useState(false);
  const failedIds = Object.keys(ge.errors);
  if (!ge.on && !ge.changes) return null;
  const nameField = ge.describe?.fields.find((f) => f.nameField)?.name;
  const byId = new Map(run.records.map((r) => [r.Id as string, r]));
  const nameOf = (id: string) => (nameField ? (byId.get(id)?.[nameField] as string | undefined) : undefined) ?? id;
  return (
    <>
      {(ge.changes > 0 || failedIds.length > 0) && (
        <div class={"gsavebar" + (isProd ? " savebar--prod" : "")} role="region" aria-label="Unsaved cell changes">
          <span class="savebar__dot" aria-hidden="true" />
          <span class="gsavebar__count" aria-live="polite">
            {plural(ge.changes, "change")} in {plural(ge.rowsChanged, "record")}
          </span>
          {failedIds.length > 0 && (
            <span class="menu-wrap">
              <button class="link-btn t-danger gsavebar__err" aria-expanded={showFailed} onClick={() => setShowFailed(!showFailed)}>
                <XCircle class="inline-icon" /> {plural(failedIds.length, "record")} failed
              </button>
              {showFailed && (
                <div class="menu menu--left gfailed">
                  {failedIds.map((id) => (
                    <button
                      class="menu__item gfailed__item"
                      key={id}
                      onClick={() => {
                        gridView.current?.scrollToId?.(id);
                        setShowFailed(false);
                      }}
                    >
                      <span class="gfailed__name truncate">{nameOf(id)}</span>
                      <span class="gfailed__why">{ge.errors[id]}</span>
                    </button>
                  ))}
                </div>
              )}
            </span>
          )}
          <span class="row" style={{ marginLeft: "auto" }}>
            <Button size="sm" variant="ghost" onClick={ge.discard} disabled={ge.saving}>
              <Undo2 /> Discard
            </Button>
            <Button size="sm" variant="primary" onClick={() => ge.setReviewing(true)} disabled={ge.saving || !ge.changes}>
              {ge.saving ? <Spinner small /> : <Save />} Review & save <Keys k={[modKey, "S"]} />
            </Button>
          </span>
        </div>
      )}
      {ge.reviewing && <ReviewDialog ge={ge} run={run} obj={obj} isProd={isProd} nameOf={nameOf} />}
    </>
  );
}

/** Review: re-reads the records so "Now on server" reflects edits made by others since the query ran. */
function ReviewDialog({ ge, run, obj, isProd, nameOf }: { ge: GridEditState; run: QueryRun; obj: string; isProd: boolean; nameOf: (id: string) => string }) {
  const sf = orgState.value!.sf;
  const [server, setServer] = useState<Map<string, SfRecord> | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [typed, setTyped] = useState("");
  const ids = Object.keys(ge.staged);
  const fields = [...new Set(Object.values(ge.staged).flatMap((x) => Object.keys(x)))];
  useEffect(() => {
    (async () => {
      try {
        const out = new Map<string, SfRecord>();
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          const recs = await sf.queryAllRecords<SfRecord>(`SELECT Id, ${fields.join(", ")} FROM ${obj} WHERE Id IN ('${chunk.join("','")}')`);
          for (const r of recs) out.set(r.Id as string, r);
        }
        setServer(out);
      } catch {
        setCheckFailed(true);
        setServer(new Map());
      }
    })();
  }, []);
  const byId = new Map(run.records.map((r) => [r.Id as string, r]));
  const lines = Object.entries(ge.staged).flatMap(([id, f]) => Object.entries(f).map(([field, v]) => ({ id, field, v, loaded: byId.get(id)?.[field], now: server?.get(id)?.[field] })));
  const drifted = server ? lines.filter((l) => server.has(l.id) && !sameValue(l.now, l.loaded)).length : 0;
  const show = (v: unknown) => (v == null || v === "" ? <span class="muted">empty</span> : <span class="mono">{String(v)}</span>);
  const needWord = isProd;
  const ready = !!server && (!needWord || typed.trim().toLowerCase() === "production");
  return (
    <Modal
      title={
        <>
          Save {plural(ge.changes, "change")} to {plural(ge.rowsChanged, `${obj} record`)}
          {isProd && <span class="t-prod"> in production</span>}?
        </>
      }
      onClose={() => ge.setReviewing(false)}
      width={760}
      footer={
        <>
          <Button onClick={() => ge.setReviewing(false)} data-autofocus={isProd ? undefined : true}>
            Keep editing
          </Button>
          <Button variant={isProd ? "danger" : "primary"} onClick={() => ready && ge.save()} disabled={ge.saving || !ready} data-save>
            {ge.saving || !server ? <Spinner small /> : <Save />} {!server ? "Checking records…" : isProd ? "Save to production" : "Save to Salesforce"}
          </Button>
        </>
      }
    >
      <div class="modal__body stack" style={{ gap: 12 }}>
        <div class="review__target">
          <span class="muted">{obj}</span>
          <strong>{plural(ge.rowsChanged, "record")}</strong>
          <span class={`env env--${orgState.value!.env}`}>{orgState.value!.env}</span>
        </div>
        {checkFailed && <Callout tone="warning" title="Couldn't re-check the records">Values below are from when the query ran; someone may have changed them since.</Callout>}
        {drifted > 0 && (
          <Callout tone="warning" title={`${plural(drifted, "value")} changed on the server since the query ran`}>
            Check the highlighted rows — saving will overwrite those newer values.
          </Callout>
        )}
        <table class="table diff">
          <thead>
            <tr>
              <th>Record</th>
              <th>Field</th>
              <th>{server && !checkFailed ? "Now on server" : "Current"}</th>
              <th>New value</th>
            </tr>
          </thead>
          <tbody>
            {lines.slice(0, 200).map((l) => {
              const drift = server?.has(l.id) && !sameValue(l.now, l.loaded);
              return (
                <tr key={l.id + l.field} class={drift ? "is-drifted" : ""}>
                  <td>
                    <div class="truncate" style={{ maxWidth: 180 }}>
                      {nameOf(l.id)}
                    </div>
                    <div class="mono muted" style={{ fontSize: "var(--fs-xs)" }}>
                      {l.id}
                    </div>
                  </td>
                  <td class="mono">{l.field}</td>
                  <td class="diff__old">
                    {show(server?.has(l.id) ? l.now : l.loaded)}
                    {drift && (
                      <div class="diff__drift">
                        <AlertTriangle /> was {show(l.loaded)} when the query ran
                      </div>
                    )}
                  </td>
                  <td class="diff__new">{show(l.v)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {lines.length > 200 && <p class="muted">…and {lines.length - 200} more changes.</p>}
        {needWord && (
          <label class="stack" style={{ gap: 6 }}>
            <span class="subtle">
              Type <strong class="mono">production</strong> to confirm
            </span>
            <input class="input" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} autoComplete="off" data-autofocus />
          </label>
        )}
      </div>
    </Modal>
  );
}
