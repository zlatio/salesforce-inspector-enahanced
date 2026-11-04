import { useEffect, useMemo, useState } from "preact/hooks";
import { Save, Undo2 } from "lucide-preact";
import { orgState } from "../../../lib/org";
import { isAggregate } from "../../../lib/soql";
import type { DescribeSObjectResult, SfRecord } from "../../../lib/types";
import { plural } from "../../../lib/format";
import { Button, Modal, Spinner, toast } from "../../../ui";
import { isEditable } from "../inspector/values";
import type { GridEdit } from "./ResultGrid";
import { setRun, type QueryRun } from "./store";

/** State for editing cells in a single-object result set and saving them back in batches of 200. */
export function useGridEdit(tabId: string, run: QueryRun | undefined, obj: string | null) {
  const st = orgState.value!;
  const sf = st.sf;
  const [on, setOn] = useState(false);
  const [describe, setDescribe] = useState<DescribeSObjectResult | null>(null);
  const [staged, setStaged] = useState<Record<string, Record<string, unknown>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const eligible = !!run && run.status === "done" && !run.tooling && !!obj && run.records.length > 0 && typeof run.records[0].Id === "string" && !isAggregate(run.soql);

  // A new run (or tab) starts clean; edit mode stays on if it still applies.
  useEffect(() => {
    setStaged({});
    setErrors({});
  }, [run?.startedAt, tabId]);
  useEffect(() => {
    if (!eligible) setOn(false);
  }, [eligible]);
  useEffect(() => {
    if (on && obj) sf.describe(obj).then(setDescribe, (e) => (toast("error", `Couldn't describe ${obj}`, e.message), setOn(false)));
  }, [on, obj]);

  const fields = useMemo(() => {
    if (!describe || !run) return new Map();
    const cols = new Set(Object.keys(run.records[0] ?? {}));
    return new Map(describe.fields.filter((f) => cols.has(f.name) && f.name !== "Id" && isEditable(f)).map((f) => [f.name, f]));
  }, [describe, run?.records]);

  const changes = Object.values(staged).reduce((n, x) => n + Object.keys(x).length, 0);
  const rowsChanged = Object.keys(staged).length;

  const onStage = (id: string, field: string, value: unknown | undefined) => {
    setStaged((prev) => {
      const row = { ...(prev[id] ?? {}) };
      if (value === undefined) delete row[field];
      else row[field] = value;
      const next = { ...prev };
      if (Object.keys(row).length) next[id] = row;
      else delete next[id];
      return next;
    });
    setErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

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
    setStaged((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !saved.has(id))));
    setErrors(failed);
    setSaving(false);
    setReviewing(false);
    const nFailed = Object.keys(failed).length;
    if (nFailed) toast("error", `${plural(nFailed, "record")} couldn't be saved`, `${plural(saved.size, "record")} saved. Failed rows are marked in red — hover the row number for the reason.`);
    else toast("success", `Saved ${plural(saved.size, "record")}`, `${obj} · ${Math.ceil(ids.length / 200)} API ${Math.ceil(ids.length / 200) === 1 ? "call" : "calls"}`);
  };

  const edit: GridEdit | undefined = on && describe ? { fields, staged, errors, onStage } : undefined;
  return { eligible, on, setOn, edit, describe, staged, errors, changes, rowsChanged, save, saving, reviewing, setReviewing, discard: () => (setStaged({}), setErrors({})), fields };
}

export type GridEditState = ReturnType<typeof useGridEdit>;

/** Floating bar with the pending-changes count, plus the review dialog. */
export function GridEditBar({ ge, run, obj }: { ge: GridEditState; run: QueryRun; obj: string }) {
  const isProd = orgState.value!.env === "production";
  if (!ge.on) return null;
  const nameField = ge.describe?.fields.find((f) => f.nameField)?.name;
  const byId = new Map(run.records.map((r) => [r.Id as string, r]));
  const lines = Object.entries(ge.staged).flatMap(([id, fields]) => Object.entries(fields).map(([f, v]) => ({ id, f, v, old: byId.get(id)?.[f], name: nameField ? (byId.get(id)?.[nameField] as string) : undefined })));
  const show = (v: unknown) => (v == null || v === "" ? <span class="muted">empty</span> : <span class="mono">{String(v)}</span>);
  return (
    <>
      {ge.changes > 0 && (
        <div class={"gsavebar" + (isProd ? " savebar--prod" : "")} role="region" aria-label="Unsaved cell changes">
          <span class="savebar__dot" aria-hidden="true" />
          <span class="gsavebar__count" aria-live="polite">
            {plural(ge.changes, "change")} in {plural(ge.rowsChanged, "record")}
          </span>
          {Object.keys(ge.errors).length > 0 && <span class="t-danger gsavebar__err">{plural(Object.keys(ge.errors).length, "record")} failed</span>}
          <span class="row" style={{ marginLeft: "auto" }}>
            <Button size="sm" variant="ghost" onClick={ge.discard} disabled={ge.saving}>
              <Undo2 /> Discard
            </Button>
            <Button size="sm" variant="primary" onClick={() => ge.setReviewing(true)} disabled={ge.saving}>
              {ge.saving ? <Spinner small /> : <Save />} Review & save
            </Button>
          </span>
        </div>
      )}
      {ge.reviewing && (
        <Modal
          title={
            <>
              Save {plural(ge.changes, "change")} to {plural(ge.rowsChanged, `${obj} record`)}
              {isProd && <span class="t-prod"> in production</span>}?
            </>
          }
          onClose={() => ge.setReviewing(false)}
          width={720}
          footer={
            <>
              <Button onClick={() => ge.setReviewing(false)} data-autofocus={isProd ? true : undefined}>
                Keep editing
              </Button>
              <Button variant={isProd ? "danger" : "primary"} onClick={ge.save} disabled={ge.saving} data-autofocus={isProd ? undefined : true}>
                {ge.saving ? <Spinner small /> : <Save />} {isProd ? "Save to production" : "Save to Salesforce"}
              </Button>
            </>
          }
        >
          <div class="modal__body">
            <table class="table diff">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Field</th>
                  <th>Current</th>
                  <th>New value</th>
                </tr>
              </thead>
              <tbody>
                {lines.slice(0, 200).map((l) => (
                  <tr key={l.id + l.f}>
                    <td>
                      <div class="truncate" style={{ maxWidth: 180 }}>
                        {l.name ?? l.id}
                      </div>
                      {l.name && (
                        <div class="mono muted" style={{ fontSize: "var(--fs-xs)" }}>
                          {l.id}
                        </div>
                      )}
                    </td>
                    <td class="mono">{l.f}</td>
                    <td class="diff__old">{show(l.old)}</td>
                    <td class="diff__new">{show(l.v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lines.length > 200 && <p class="muted">…and {lines.length - 200} more changes.</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
