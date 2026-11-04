import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { Braces, ExternalLink, GitFork, Layers, ListTree, RefreshCw, Settings2, TerminalSquare, Undo2, Save, AlertCircle, AlertTriangle } from "lucide-preact";
import { orgState } from "../../../lib/org";
import { SfError } from "../../../lib/sf";
import type { DescribeField, DescribeSObjectResult, SfRecord } from "../../../lib/types";
import { fmtNumber, fmtRelative, plural } from "../../../lib/format";
import { Badge, Button, Callout, CopyButton, Empty, Keys, Modal, Spinner, Switch, altKey, isMac, isTyping, modKey, onTablistKey, toast } from "../../../ui";
import { links, navigate, route } from "../../router";
import { FieldsTable, type Filter } from "./FieldsTable";
import { FieldDrawer } from "./FieldDrawer";
import { RelationshipsTab } from "./RelationshipsTab";
import { sameValue } from "./values";
import { pushRecent } from "../../../lib/recent";
import { defaultQuery } from "../../../lib/queries";

type Tab = "fields" | "relationships" | "recordtypes" | "json";

export interface LookupNames {
  [id: string]: { name: string; type: string };
}

export function ObjectView({ objectName, recordId, tooling }: { objectName: string; recordId?: string; tooling: boolean }) {
  const sf = orgState.value!.sf;
  const [describe, setDescribe] = useState<DescribeSObjectResult | null>(null);
  const [record, setRecord] = useState<SfRecord | null>(null);
  const [error, setError] = useState<SfError | Error | null>(null);
  const [loadingRecord, setLoadingRecord] = useState(!!recordId);
  const [lookups, setLookups] = useState<LookupNames>({});
  const draftKey = recordId ? `sie.draft.${sf.host}.${objectName}.${recordId}` : null;
  const [edits, setEdits] = useState<Record<string, unknown>>(() => {
    if (!draftKey) return {};
    try {
      return JSON.parse(sessionStorage.getItem(draftKey) ?? "{}");
    } catch {
      return {};
    }
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [drawerField, setDrawerField] = useState<string | null>(() => route.value.params.get("field"));
  const tab = (route.value.params.get("tab") as Tab) || "fields";
  const env = orgState.value!.env;
  const isProd = env === "production";
  // Production orgs start read-only: editing needs an explicit switch. Sandboxes are click-to-edit.
  const [editMode, setEditMode] = useState(!isProd);
  const [filter, setFilterState] = useState<Filter>(() => {
    if (!recordId) return "all";
    const saved = localStorage.getItem("sie.fields.filter") as Filter | null;
    return saved && ["populated", "all", "editable", "custom"].includes(saved) ? saved : "populated";
  });
  const [filterBeforeChanged, setFilterBeforeChanged] = useState<Filter | null>(null);
  /** persist=false for programmatic switches (e.g. "show all" from a search hint) so they don't become the default. */
  const setFilter = (f: Filter, persist = true) => {
    if (f === "changed" && filter !== "changed") setFilterBeforeChanged(filter);
    setFilterState(f);
    if (persist && recordId && f !== "changed") localStorage.setItem("sie.fields.filter", f);
  };
  // Server state captured when the review dialog opens, to catch edits made by someone else meanwhile.
  const [serverCheck, setServerCheck] = useState<{ record: SfRecord | null; checking: boolean; failed?: boolean } | null>(null);

  const setTab = (t: Tab) => {
    const p = new URLSearchParams(route.value.params);
    if (t === "fields") p.delete("tab");
    else p.set("tab", t);
    const qs = p.toString();
    navigate(`#/inspect/${encodeURIComponent(objectName)}${recordId ? "/" + recordId : ""}${qs ? "?" + qs : ""}`, true);
  };

  const loadRecord = useCallback(async () => {
    if (!recordId) return;
    setLoadingRecord(true);
    try {
      const rec = await sf.getRecord(objectName, recordId, tooling);
      setRecord(rec);
      return rec;
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoadingRecord(false);
    }
  }, [objectName, recordId, tooling]);

  useEffect(() => {
    sf.describe(objectName, tooling).then(setDescribe, (e) => setError(e));
    loadRecord();
  }, [objectName, recordId, tooling]);

  // Resolve lookup ids to record names once both describe and record are in.
  useEffect(() => {
    if (!describe || !record) return;
    resolveLookups(describe, record).then(setLookups, () => {});
  }, [describe, record]);

  const dirty = Object.keys(edits).length;

  useEffect(() => {
    if (!dirty && filter === "changed") setFilterState(filterBeforeChanged ?? "populated");
  }, [dirty]);

  // Keep staged edits in this tab's session so moving around the app (lookups, palette, popup) never loses them.
  useEffect(() => {
    if (!draftKey) return;
    if (dirty) sessionStorage.setItem(draftKey, JSON.stringify(edits));
    else sessionStorage.removeItem(draftKey);
  }, [edits]);
  useEffect(() => {
    if (dirty) toast("info", `Restored ${plural(dirty, "unsaved change")}`, "Staged edits are kept while you move around Inspector. Review & save, or discard them.");
  }, []);

  const nameField = describe?.fields.find((f) => f.nameField);
  const recordName = record && nameField ? (record[nameField.name] as string | null) : null;
  useEffect(() => {
    const what = recordId ? `${recordName || recordId} · ${describe?.label ?? objectName}` : describe?.label ?? objectName;
    document.title = `${isProd ? "[PROD] " : ""}${what} — Inspector`;
    if (describe && (!recordId || record)) pushRecent(sf.host, { objectName: describe.name, recordId, title: recordId ? recordName || recordId : describe.label });
  }, [recordName, describe, recordId]);

  const openReview = async () => {
    if (!dirty || !recordId) return;
    setReviewing(true);
    setServerCheck({ record: null, checking: true });
    try {
      const fresh = await sf.getRecord(objectName, recordId, tooling);
      setServerCheck({ record: fresh, checking: false });
    } catch {
      setServerCheck({ record: null, checking: false, failed: true });
    }
  };

  const save = async () => {
    if (!describe || !recordId || !dirty) return;
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});
    const applied = { ...edits };
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(applied)) before[k] = (serverCheck?.record ?? record)?.[k] ?? null;
    try {
      await sf.updateRecord(objectName, recordId, applied, tooling);
      const changed = new Set(Object.keys(applied));
      setEdits({});
      setReviewing(false);
      await loadRecord();
      flashFields(changed);
      requestAnimationFrame(() => {
        const first = [...changed][0];
        const row = [...document.querySelectorAll<HTMLElement>(".frow")].find((r) => r.querySelector(".fapi")?.textContent?.trim() === first);
        (row?.querySelector<HTMLElement>(".fcell__edit") ?? row?.querySelector<HTMLElement>(".frow__info"))?.focus();
      });
      toast("success", `Saved ${plural(changed.size, "field")}${isProd ? " to production" : ""}`, `${describe.label} · ${recordName || recordId}`, {
        action: {
          label: "Undo",
          run: async () => {
            if (isProd && !confirm(`Revert ${plural(changed.size, "field")} on this production record to the previous values?`)) return;
            try {
              await sf.updateRecord(objectName, recordId, before, tooling);
              await loadRecord();
              flashFields(changed);
              toast("info", "Change undone", `Restored ${plural(changed.size, "field")} to the previous values.`);
            } catch (e) {
              toast("error", "Couldn't undo", (e as Error).message);
            }
          },
        },
      });
    } catch (e) {
      const err = e as SfError;
      setReviewing(false);
      const details = Array.isArray(err.details) ? (err.details as Array<{ message: string; fields?: string[] }>) : [];
      const fe: Record<string, string> = {};
      const general: string[] = [];
      for (const d of details.length ? details : [{ message: err.message, fields: err.fields }]) {
        if (d.fields?.length) for (const f of d.fields) fe[f] = d.message;
        else general.push(d.message);
      }
      setFieldErrors(fe);
      setSaveError(general.join(" ") || (Object.keys(fe).length ? "Some fields have errors — see highlighted rows." : err.message));
      if (Object.keys(fe).length) setFilter("changed", false);
    } finally {
      setSaving(false);
    }
  };

  const flashFields = (names: Set<string>) => {
    setFlash(names);
    setTimeout(() => setFlash(new Set()), 1600);
  };

  const discard = () => {
    setEdits({});
    setFieldErrors({});
    setSaveError(null);
  };

  // Keyboard: Cmd/Ctrl+S saves, Escape in non-input context discards nothing (too destructive).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) openReview();
      } else if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === "KeyE" && recordId && !document.querySelector("dialog[open]") && !(isMac && isTyping(e.target))) {
        e.preventDefault();
        if (isProd && !editMode) {
          toast("info", "Production editing stays locked", "Use the “Edit production data” switch to unlock it deliberately.");
          return;
        }
        setEditMode(!editMode);
        toast("info", editMode ? "Edit mode off" : "Edit mode on", editMode ? "Field values are read-only." : "Click a value, or focus a row and press Enter, to edit it.");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, editMode]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const setEdit = (field: DescribeField, value: unknown | undefined) => {
    setEdits((prev) => {
      const next = { ...prev };
      if (value === undefined || sameValue(value, record?.[field.name])) delete next[field.name];
      else next[field.name] = value;
      return next;
    });
    setFieldErrors((prev) => {
      if (!(field.name in prev)) return prev;
      const next = { ...prev };
      delete next[field.name];
      return next;
    });
  };

  if (error) {
    const notFound = error instanceof SfError && (error.status === 404 || error.errorCode === "NOT_FOUND");
    return (
      <div class="page">
        <Empty
          error
          icon={<AlertCircle />}
          title={notFound ? (recordId ? "Record not found" : `Object “${objectName}” not found`) : "Something went wrong"}
          action={<Button onClick={() => navigate(links.objects())}>Browse objects</Button>}
        >
          {notFound && recordId ? `No ${objectName} with ID ${recordId} is visible to you. It may have been deleted, or you may not have access.` : error.message}
        </Empty>
      </div>
    );
  }

  const lightning = "https://" + sf.lightningHost;
  const recordTypes = describe?.recordTypeInfos.filter((r) => !r.master) ?? [];
  const childRels = describe?.childRelationships.filter((r) => r.relationshipName && !r.deprecatedAndHidden) ?? [];
  const drawer = drawerField && describe ? describe.fields.find((f) => f.name === drawerField) : null;

  return (
    <div class="page objview">
      <div class="page__head">
        <div class="grow" style={{ minWidth: 0 }}>
          <div class="crumbs">
            <a href={links.objects()}>Objects</a>
            <span>/</span>
            {recordId ? <a href={links.object(objectName)}>{describe?.label ?? objectName}</a> : <span>{describe?.label ?? objectName}</span>}
          </div>
          <h1 class="page__title truncate">
            {recordId ? (
              loadingRecord && !record ? <span class="skeleton" style={{ display: "inline-block", width: 260, height: 22 }} /> : recordName || recordId
            ) : (
              describe?.label ?? objectName
            )}
          </h1>
          <div class="page__subtitle">
            <span class="idpill">
              <span class="mono">{describe?.name ?? objectName}</span>
              <CopyButton text={describe?.name ?? objectName} label="Copy API name" />
            </span>
            {recordId && (
              <span class="idpill">
                <span class="mono">{recordId}</span>
                <CopyButton text={recordId} label="Copy record ID" />
              </span>
            )}
            {describe?.keyPrefix && !recordId && (
              <Badge square mono title="Key prefix">
                {describe.keyPrefix}
              </Badge>
            )}
            {describe?.custom && <Badge tone="accent">Custom</Badge>}
            {tooling && <Badge tone="info">Tooling API</Badge>}
            {record && typeof record.LastModifiedDate === "string" && (
              <span class="muted">
                Modified {fmtRelative(Date.parse(record.LastModifiedDate))}
                {record.LastModifiedById && lookups[record.LastModifiedById as string] ? ` by ${lookups[record.LastModifiedById as string].name}` : ""}
              </span>
            )}
          </div>
        </div>
        <div class="page__actions">
          {recordId && (
            <Button size="sm" variant="ghost" aria-label="Reload record" data-tip="Reload" onClick={() => loadRecord()} disabled={loadingRecord}>
              <RefreshCw class={loadingRecord ? "spin" : ""} />
            </Button>
          )}
          {describe?.queryable && (
            <Button
              size="sm"
              onClick={() => navigate(links.query(defaultQuery(describe, recordId ? { where: `Id = '${recordId}'` } : {}), tooling))}
            >
              <TerminalSquare /> Query
            </Button>
          )}
          {!tooling && (
            <Button size="sm" onClick={() => window.open(`${lightning}/lightning/setup/ObjectManager/${describe?.name ?? objectName}/FieldsAndRelationships/view`, "_blank")}>
              <Settings2 /> Object Manager
            </Button>
          )}
          {!tooling && (
            <Button size="sm" variant="primary" onClick={() => window.open(recordId ? `${lightning}/lightning/r/${objectName}/${recordId}/view` : `${lightning}/lightning/o/${objectName}/list`, "_blank")}>
              <ExternalLink /> {recordId ? "Open record" : "Open list"}
            </Button>
          )}
        </div>
      </div>

      <div class="tabs objview__tabs" role="tablist" aria-label="Record sections" onKeyDown={onTablistKey}>
        <button class="tab" role="tab" aria-selected={tab === "fields"} tabIndex={tab === "fields" ? 0 : -1} onClick={() => setTab("fields")}>
          <ListTree /> Fields {describe && <span class="tab__count">{describe.fields.length}</span>}
        </button>
        <button class="tab" role="tab" aria-selected={tab === "relationships"} tabIndex={tab === "relationships" ? 0 : -1} onClick={() => setTab("relationships")}>
          <GitFork /> Child relationships {describe && <span class="tab__count">{childRels.length}</span>}
        </button>
        {recordTypes.length > 0 && (
          <button class="tab" role="tab" aria-selected={tab === "recordtypes"} tabIndex={tab === "recordtypes" ? 0 : -1} onClick={() => setTab("recordtypes")}>
            <Layers /> Record types <span class="tab__count">{recordTypes.length}</span>
          </button>
        )}
        <button class="tab" role="tab" aria-selected={tab === "json"} tabIndex={tab === "json" ? 0 : -1} onClick={() => setTab("json")}>
          <Braces /> JSON
        </button>
      </div>

      {/* Save bar comes before the table in DOM order so keyboard users reach it without tabbing through every row. */}
      {dirty > 0 && (
        <div class={"savebar" + (isProd ? " savebar--prod" : "")} role="region" aria-label="Unsaved changes">
          <div class="savebar__count" aria-live="polite">
            <span class="savebar__dot" />
            {plural(dirty, "unsaved change")}
            {isProd && <span class="env env--production">Production</span>}
          </div>
          {saveError && (
            <div class="savebar__error" role="alert">
              <AlertCircle /> <span>{saveError}</span>
            </div>
          )}
          <div class="row" style={{ marginLeft: "auto" }}>
            <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>
              <Undo2 /> Discard
            </Button>
            <Button size="sm" variant="primary" onClick={openReview} disabled={saving}>
              {saving ? <Spinner small /> : <Save />} Review & save <Keys k={[modKey, "S"]} />
            </Button>
          </div>
        </div>
      )}

      <div class="objview__body">
        {!describe ? (
          <div class="empty">
            <Spinner />
            <span>Loading {objectName}…</span>
          </div>
        ) : tab === "fields" ? (
          <FieldsTable
            describe={describe}
            record={recordId ? record : null}
            recordMode={!!recordId}
            loadingRecord={loadingRecord}
            lookups={lookups}
            edits={edits}
            fieldErrors={fieldErrors}
            flash={flash}
            onEdit={setEdit}
            onOpenField={setDrawerField}
            activeField={drawerField}
            onLookupName={(id, name, type) => setLookups((l) => ({ ...l, [id]: { name, type }, [id.slice(0, 15)]: { name, type } }))}
            filter={filter}
            setFilter={setFilter}
            canEdit={editMode}
            toolbarExtra={
              recordId &&
              describe.updateable && (
                <Switch checked={editMode} onChange={setEditMode} title={isProd ? "Production org: turn on to edit field values" : `Click values to edit them (${altKey}+E)`}>
                  {isProd ? "Edit production data" : "Edit mode"}
                </Switch>
              )
            }
          />
        ) : tab === "relationships" ? (
          <RelationshipsTab describe={describe} recordId={recordId} />
        ) : tab === "recordtypes" ? (
          <RecordTypesTab describe={describe} />
        ) : (
          <JsonTab value={recordId ? record : describe} />
        )}
        {drawer && <FieldDrawer field={drawer} describe={describe!} record={recordId ? record : null} staged={drawer.name in edits ? { value: edits[drawer.name] } : undefined} lookups={lookups} onClose={() => setDrawerField(null)} />}
      </div>

      {reviewing && describe && record && (
        <Modal
          title={
            <>
              Save {plural(dirty, "change")} to {isProd ? <span class="t-prod">production</span> : "Salesforce"}?
            </>
          }
          onClose={() => setReviewing(false)}
          width={680}
          footer={
            <>
              <Button onClick={() => setReviewing(false)} data-autofocus={isProd ? true : undefined}>
                Keep editing
              </Button>
              <Button
                variant={isProd ? "danger" : "primary"}
                onClick={() => !serverCheck?.checking && save()}
                disabled={saving}
                aria-disabled={serverCheck?.checking || undefined}
                class={serverCheck?.checking ? "is-busy" : undefined}
                data-save
                data-autofocus={isProd ? undefined : true}
              >
                {saving || serverCheck?.checking ? <Spinner small /> : <Save />} {serverCheck?.checking ? "Checking record…" : isProd ? "Save to production" : "Save to Salesforce"}
              </Button>
            </>
          }
        >
          <div class="modal__body stack" style={{ gap: 12 }}>
            <div class="review__target">
              <span class="muted">{describe.label}</span>
              <strong class="truncate">{recordName || recordId}</strong>
              <span class="mono muted">{recordId}</span>
              <span class={`env env--${env}`}>{env}</span>
            </div>
            {(() => {
              const fresh = serverCheck?.record;
              if (serverCheck?.checking) {
                return (
                  <div class="row muted">
                    <Spinner small /> Checking the record for changes made since you loaded it…
                  </div>
                );
              }
              if (serverCheck?.failed)
                return (
                  <Callout tone="warning" title="Couldn't re-check the record">
                    The values below are from when you loaded the page; someone may have changed it since.
                  </Callout>
                );
              const moved = fresh && fresh.LastModifiedDate !== record.LastModifiedDate;
              const conflicts = fresh ? Object.keys(edits).filter((k) => !sameValue(fresh[k], record[k])) : [];
              if (!moved) return null;
              return (
                <Callout tone="warning" title="This record changed after you opened it">
                  Modified {fmtRelative(Date.parse(String(fresh!.LastModifiedDate)))}
                  {fresh!.LastModifiedById && lookups[fresh!.LastModifiedById as string] ? ` by ${lookups[fresh!.LastModifiedById as string].name}` : ""}.
                  {conflicts.length ? ` ${plural(conflicts.length, "field")} you're changing now ${conflicts.length === 1 ? "has" : "have"} a different value on the server — check the “Now on server” column.` : " None of the fields you're changing were affected."}
                </Callout>
              );
            })()}
            <table class="table diff">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>{serverCheck?.record ? "Now on server" : "Current"}</th>
                  <th>New value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(edits).map(([name, v]) => {
                  const f = describe.fields.find((x) => x.name === name)!;
                  const server = serverCheck?.record ? serverCheck.record[name] : record[name];
                  const drifted = serverCheck?.record && !sameValue(server, record[name]);
                  return (
                    <tr key={name} class={drifted ? "is-drifted" : ""}>
                      <td>
                        <div>{f.label}</div>
                        <div class="mono muted" style={{ fontSize: "var(--fs-xs)" }}>
                          {name}
                        </div>
                      </td>
                      <td class="diff__old">
                        {fmtDiff(server)}
                        {drifted && (
                          <div class="diff__drift">
                            <AlertTriangle /> was {fmtDiff(record[name])} when you loaded it
                          </div>
                        )}
                      </td>
                      <td class="diff__new">{fmtDiff(v)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}

function fmtDiff(v: unknown) {
  if (v == null || v === "") return <span class="muted">empty</span>;
  return <span class="mono">{String(v)}</span>;
}

async function resolveLookups(describe: DescribeSObjectResult, record: SfRecord): Promise<LookupNames> {
  const sf = orgState.value!.sf;
  const ids = new Set<string>();
  for (const f of describe.fields) {
    const v = record[f.name];
    if (f.type === "reference" && typeof v === "string" && v.length >= 15) ids.add(v);
  }
  if (!ids.size) return {};
  const byObject = new Map<string, string[]>();
  for (const id of ids) {
    const o = await sf.objectForId(id);
    if (!o || !o.queryable) continue;
    byObject.set(o.name, [...(byObject.get(o.name) ?? []), id]);
  }
  const out: LookupNames = {};
  await Promise.all(
    [...byObject].map(async ([obj, list]) => {
      try {
        const d = await sf.describe(obj);
        const nf = d.fields.find((f) => f.nameField)?.name;
        if (!nf || nf === "Id") return;
        const res = await sf.query<SfRecord>(`SELECT Id, ${nf} FROM ${obj} WHERE Id IN (${list.map((i) => `'${i}'`).join(",")})`);
        for (const r of res.records) {
          const id = r.Id as string;
          const name = String(r[nf] ?? "");
          out[id] = { name, type: obj };
          out[id.slice(0, 15)] = out[id];
        }
      } catch {
        /* best effort */
      }
    }),
  );
  return out;
}

function RecordTypesTab({ describe }: { describe: DescribeSObjectResult }) {
  const rts = describe.recordTypeInfos.filter((r) => !r.master);
  return (
    <div class="tablewrap">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Developer name</th>
            <th>ID</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rts.map((r) => (
            <tr key={r.recordTypeId}>
              <td>{r.name}</td>
              <td class="mono">{r.developerName}</td>
              <td>
                <span class="idpill">
                  <span class="mono">{r.recordTypeId}</span>
                  <CopyButton text={r.recordTypeId} />
                </span>
              </td>
              <td>
                <div class="row">
                  {r.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
                  {r.available && <Badge>Available to you</Badge>}
                  {r.defaultRecordTypeMapping && <Badge tone="accent">Your default</Badge>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JsonTab({ value }: { value: unknown }) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value]);
  if (value == null)
    return (
      <div class="empty">
        <Spinner />
      </div>
    );
  return (
    <div class="jsonview">
      <div class="jsonview__bar">
        <span class="muted">{fmtNumber(text.length)} characters</span>
        <CopyButton text={text} label="Copy JSON" />
      </div>
      <pre class="jsonview__pre">{text}</pre>
    </div>
  );
}

