import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ClipboardPaste, Download, FileUp, Play, RotateCcw, Square, TerminalSquare, Trash2, Upload, XCircle } from "lucide-preact";
import { orgState } from "../../../lib/org";
import type { DescribeSObjectResult, GlobalSObject } from "../../../lib/types";
import { DELIMITER_LABEL, detectDelimiter, parseDelimited, toCsv, type Delimiter } from "../../../lib/csv";
import { fmtNumber, plural } from "../../../lib/format";
import { Badge, Button, Callout, Empty, Meter, Modal, Seg, Spinner, Switch, toast } from "../../../ui";
import { rankObjects } from "../../Palette";
import { links, navigate, route } from "../../router";
import { autoMap, externalIdFields, missingRequired, prepareRows, runImport, writableFields, type BlankMode, type Operation, type RowResult } from "./importer";
import "./import.css";

const OPS: Array<{ value: Operation; label: string; hint: string }> = [
  { value: "insert", label: "Insert", hint: "Create new records" },
  { value: "update", label: "Update", hint: "Change existing records by Id" },
  { value: "upsert", label: "Upsert", hint: "Update matches, insert the rest" },
  { value: "delete", label: "Delete", hint: "Delete records by Id" },
];

export function ImportPage() {
  const st = orgState.value!;
  const sf = st.sf;
  const isProd = st.env === "production";
  const [text, setText] = useState("");
  const [delim, setDelim] = useState<Delimiter | "auto">("auto");
  const [objects, setObjects] = useState<GlobalSObject[]>([]);
  const [objectName, setObjectName] = useState<string>(() => route.value.params.get("object") ?? "");
  const [describe, setDescribe] = useState<DescribeSObjectResult | null>(null);
  const [op, setOp] = useState<Operation>("insert");
  const [keyField, setKeyField] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Array<string | null>>([]);
  const [blank, setBlank] = useState<BlankMode>("ignore");
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [onlyRows, setOnlyRows] = useState<number[] | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    sf.describeGlobal().then((g) => setObjects(g.sobjects.filter((o) => !o.deprecatedAndHidden && (o.createable || o.updateable || o.deletable))));
  }, []);
  useEffect(() => {
    setDescribe(null);
    if (!objectName) return;
    sf.describe(objectName).then(setDescribe, (e) => toast("error", `Couldn't describe ${objectName}`, e.message));
  }, [objectName]);

  const delimiter: Delimiter = delim === "auto" ? detectDelimiter(text) : delim;
  const table = useMemo(() => (text.trim() ? parseDelimited(text, delimiter) : []), [text, delimiter]);
  const headers = table[0] ?? [];
  const dataRows = useMemo(() => table.slice(1), [table]);
  const width = Math.max(headers.length, ...dataRows.slice(0, 50).map((r) => r.length));

  // Re-map automatically when the columns or object change.
  useEffect(() => {
    if (describe && headers.length) setMapping(autoMap(headers, describe));
  }, [describe, headers.join("\u0001")]);
  useEffect(() => {
    if (!describe) return;
    const ext = externalIdFields(describe);
    if (op === "upsert" && (!keyField || !ext.some((f) => f.name === keyField))) setKeyField(ext.find((f) => f.name !== "Id")?.name ?? "Id");
  }, [describe, op]);
  useEffect(() => {
    setResults(null);
    setOnlyRows(null);
  }, [text, objectName, op]);

  const writable = useMemo(() => (describe ? writableFields(describe, op) : []), [describe, op]);
  const writableNames = useMemo(() => new Set(writable.map((f) => f.name)), [writable]);
  const effectiveMapping = mapping.map((m) => (m && writableNames.has(m) ? m : null));
  const prepared = useMemo(() => (describe ? prepareRows(dataRows, effectiveMapping, describe, op, blank, op === "upsert" ? keyField : null) : []), [describe, dataRows, effectiveMapping.join("|"), op, blank, keyField]);
  const toRun = onlyRows ? prepared.filter((r) => onlyRows.includes(r.index)) : prepared;
  const invalid = toRun.filter((r) => r.errors.length);
  const valid = toRun.filter((r) => !r.errors.length);
  const missing = describe ? missingRequired(describe, effectiveMapping, op) : [];
  const mappedCount = effectiveMapping.filter(Boolean).length;
  const needsId = (op === "update" || op === "delete") && !effectiveMapping.includes("Id");
  const needsKey = op === "upsert" && keyField && !effectiveMapping.includes(keyField);
  const canRun = !!describe && valid.length > 0 && !needsId && !needsKey && (op === "delete" || mappedCount > 0) && !running;

  const run = async () => {
    setConfirming(false);
    setRunning(true);
    stopRef.current = false;
    const prior = onlyRows && results ? results.filter((r) => !onlyRows.includes(r.index)) : [];
    const res = await runImport(sf, describe!.name, op, valid, op === "upsert" ? keyField : null, (done) => setResults([...prior, ...done]), () => stopRef.current);
    const all = [...prior, ...res, ...invalid.map((r) => ({ index: r.index, success: false, error: r.errors.join("; ") }))].sort((a, b) => a.index - b.index);
    setResults(all);
    setOnlyRows(null);
    setRunning(false);
    const ok = res.filter((r) => r.success).length;
    const failed = all.filter((r) => !r.success).length;
    toast(failed ? "info" : "success", `${OPS.find((o) => o.value === op)!.label} finished`, `${plural(ok, "record")} succeeded${failed ? `, ${failed} failed` : ""}${stopRef.current ? " (stopped early)" : ""}.`);
  };

  const downloadResults = () => {
    if (!results) return;
    const byIndex = new Map(results.map((r) => [r.index, r]));
    const rows = [[...headers, "Result", "Record Id", "Error"], ...dataRows.map((r, i) => {
      const x = byIndex.get(i);
      return [...r, x ? (x.success ? (x.created === false ? "Updated" : op === "delete" ? "Deleted" : "Success") : "Failed") : "Not run", x?.id ?? "", x?.error ?? ""];
    })];
    const url = URL.createObjectURL(new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${describe?.name ?? "import"}-${op}-results.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onFile = async (file: File) => {
    setText(await file.text());
    toast("info", `Loaded ${file.name}`, `${fmtNumber(file.size / 1024)} KB`);
  };

  return (
    <div class="page">
      <div class="page__body">
        <div class="page__head">
          <div class="grow">
            <h1 class="page__title">Data import</h1>
            <div class="page__subtitle">Insert, update, upsert or delete records from a spreadsheet. Paste straight from Excel or Google Sheets, or load a CSV.</div>
          </div>
          {(text || results) && (
            <div class="page__actions">
              <Button size="sm" variant="ghost" onClick={() => (setText(""), setResults(null))} disabled={running}>
                <RotateCcw /> Start over
              </Button>
            </div>
          )}
        </div>

        <div class="imp lpad">
          {/* 1. Data */}
          <section class="card imp__step">
            <StepHead n={1} title="Data" done={dataRows.length > 0}>
              {dataRows.length > 0 && (
                <span class="muted">
                  {DELIMITER_LABEL[delimiter]} · {plural(dataRows.length, "row")} · {plural(width, "column")}
                </span>
              )}
            </StepHead>
            <div class="card__body stack" style={{ gap: 10 }}>
              {!text ? (
                <DropZone onText={setText} onFile={onFile} />
              ) : (
                <>
                  <textarea class="textarea imp__paste mono" value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} spellcheck={false} aria-label="Import data" rows={6} />
                  <div class="row">
                    <span class="muted" style={{ fontSize: "var(--fs-sm)" }}>
                      Separator
                    </span>
                    <Seg
                      label="Separator"
                      value={delim}
                      onChange={setDelim}
                      options={[
                        { value: "auto", label: "Auto" },
                        { value: "\t", label: "Tab" },
                        { value: ",", label: "Comma" },
                        { value: ";", label: "Semicolon" },
                      ]}
                    />
                    <span class="muted" style={{ marginLeft: "auto", fontSize: "var(--fs-sm)" }}>
                      The first row must contain column headers.
                    </span>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* 2. Target */}
          <section class={"card imp__step" + (dataRows.length ? "" : " is-dim")}>
            <StepHead n={2} title="Object & operation" done={!!describe} />
            <div class="card__body imp__target">
              <label class="stack imp__field">
                <span class="imp__label">Object</span>
                <ObjectPicker objects={objects} value={objectName} onChange={setObjectName} />
              </label>
              <div class="stack imp__field">
                <span class="imp__label">Operation</span>
                <Seg label="Operation" value={op} onChange={setOp} options={OPS.map((o) => ({ value: o.value, label: o.label, title: o.hint }))} />
              </div>
              {op === "upsert" && describe && (
                <label class="stack imp__field">
                  <span class="imp__label">Match records on</span>
                  <select class="select" value={keyField ?? ""} onChange={(e) => setKeyField((e.target as HTMLSelectElement).value)}>
                    {externalIdFields(describe).map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.label} ({f.name})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </section>

          {/* 3. Mapping */}
          <section class={"card imp__step" + (describe && headers.length ? "" : " is-dim")}>
            <StepHead n={3} title="Map columns" done={!!describe && mappedCount > 0 && !missing.length && !needsId && !needsKey}>
              {describe && headers.length > 0 && (
                <span class="muted">
                  {mappedCount} of {headers.length} columns mapped
                </span>
              )}
            </StepHead>
            {describe && headers.length > 0 ? (
              <div class="imp__map">
                <div class="imp__maprow imp__maprow--head">
                  <span>Column</span>
                  <span>Sample</span>
                  <span />
                  <span>Field</span>
                </div>
                {headers.map((h, col) => {
                  const m = mapping[col] ?? null;
                  const ignored = m && !writableNames.has(m);
                  return (
                    <div class={"imp__maprow" + (effectiveMapping[col] ? " is-mapped" : "")} key={col}>
                      <span class="truncate imp__col" title={h}>
                        {h || <span class="muted">(column {col + 1})</span>}
                      </span>
                      <span class="truncate muted mono imp__sample" title={dataRows.slice(0, 3).map((r) => r[col]).join(" · ")}>
                        {dataRows.slice(0, 3).map((r) => r[col] ?? "").filter(Boolean).join(" · ") || "—"}
                      </span>
                      <ArrowRight class="imp__arrow" aria-hidden="true" />
                      <span class="row" style={{ gap: 6 }}>
                        <select
                          class="select select--sm"
                          aria-label={`Field for column ${h}`}
                          value={m ?? ""}
                          onChange={(e) => {
                            const v = (e.target as HTMLSelectElement).value || null;
                            setMapping((prev) => prev.map((x, i) => (i === col ? v : x === v && v ? null : x)));
                          }}
                        >
                          <option value="">— Skip this column —</option>
                          {writable.map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.label} ({f.name})
                            </option>
                          ))}
                        </select>
                        {ignored && (
                          <span class="imp__warn" title={`${m} can't be written by ${op}`}>
                            <AlertTriangle />
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
                <div class="imp__checks">
                  {needsId && <Callout tone="danger">Map a column to the record Id — {op} needs it to find each record.</Callout>}
                  {needsKey && <Callout tone="danger">Map a column to {keyField} — upsert matches records on it.</Callout>}
                  {missing.length > 0 && (
                    <Callout tone="warning" title="Required fields aren't mapped">
                      {missing.map((f) => f.label).join(", ")}. New records will fail unless a default or automation fills them.
                    </Callout>
                  )}
                </div>
              </div>
            ) : (
              <div class="card__body muted">Add data and pick an object to map columns.</div>
            )}
          </section>

          {/* 4. Review & run, then results */}
          {describe && dataRows.length > 0 && (
            <section class="card imp__step">
              <StepHead n={4} title={results ? "Results" : "Review & run"} done={!!results && !running} />
              <div class="card__body stack" style={{ gap: 12 }}>
                {!results || running ? (
                  <>
                    <div class="imp__summary">
                      <span class="imp__stat">
                        <CheckCircle2 class="t-success" /> {plural(valid.length, "row")} ready
                      </span>
                      {invalid.length > 0 && (
                        <span class="imp__stat">
                          <XCircle class="t-danger" /> {plural(invalid.length, "row")} with problems (skipped)
                        </span>
                      )}
                      {op !== "delete" && (
                        <span class="row" style={{ marginLeft: "auto", gap: 6 }}>
                          <span class="muted" style={{ fontSize: "var(--fs-sm)" }}>
                            Blank cells
                          </span>
                          <Seg
                            label="Blank cells"
                            value={blank}
                            onChange={setBlank}
                            options={[
                              { value: "ignore", label: "Leave unchanged", title: "Blank cells are not sent" },
                              { value: "null", label: "Clear the field", title: "Blank cells set the field to empty" },
                            ]}
                          />
                        </span>
                      )}
                    </div>
                    <Preview rows={toRun.slice(0, 100)} describe={describe} mapping={effectiveMapping} op={op} />
                    {running && results && (
                      <div class="imp__progress">
                        <Meter pct={(results.length / Math.max(1, toRun.length)) * 100} large label="Import progress" />
                        <span class="tabular muted">
                          {fmtNumber(results.length)} / {fmtNumber(valid.length)}
                        </span>
                      </div>
                    )}
                    <div class="row">
                      {running ? (
                        <>
                          <Spinner small />
                          <span class="muted">Running… {fmtNumber(results?.length ?? 0)} done</span>
                          <Button variant="ghost" onClick={() => (stopRef.current = true)}>
                            <Square /> Stop after this batch
                          </Button>
                        </>
                      ) : (
                        <Button variant={op === "delete" || isProd ? "danger" : "primary"} onClick={() => setConfirming(true)} disabled={!canRun}>
                          {op === "delete" ? <Trash2 /> : <Play />} {OPS.find((o) => o.value === op)!.label} {plural(valid.length, "record")}
                        </Button>
                      )}
                      <span class="muted" style={{ fontSize: "var(--fs-sm)" }}>
                        Sent in batches of 200 · {Math.ceil(valid.length / 200)} API {Math.ceil(valid.length / 200) === 1 ? "call" : "calls"}
                      </span>
                    </div>
                  </>
                ) : (
                  <Results
                    results={results}
                    op={op}
                    objectName={describe.name}
                    rows={dataRows}
                    headers={headers}
                    onDownload={downloadResults}
                    onRetry={(failed) => {
                      setOnlyRows(failed);
                      setResults(results);
                      setConfirming(true);
                    }}
                  />
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {confirming && describe && (
        <ConfirmRun
          op={op}
          count={(onlyRows ? prepared.filter((r) => onlyRows.includes(r.index) && !r.errors.length) : valid).length}
          object={describe.label}
          isProd={isProd}
          orgName={st.org?.Name ?? ""}
          onCancel={() => (setConfirming(false), setOnlyRows(null))}
          onRun={run}
        />
      )}
    </div>
  );
}

function StepHead({ n, title, done, children }: { n: number; title: string; done?: boolean; children?: preact.ComponentChildren }) {
  return (
    <div class="card__head imp__head">
      <span class={"imp__num" + (done ? " is-done" : "")} aria-hidden="true">
        {done ? <Check /> : n}
      </span>
      <span class="card__title">{title}</span>
      <span style={{ marginLeft: "auto" }}>{children}</span>
    </div>
  );
}

function DropZone({ onText, onFile }: { onText: (t: string) => void; onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div
      class={"imp__drop" + (over ? " is-over" : "")}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer?.files?.[0];
        if (f) onFile(f);
      }}
    >
      <textarea
        class="imp__drop-input mono"
        placeholder={"Paste rows here (Ctrl+V) — the first row must be column headers.\n\nName\tPhone\tIndustry\nAcme\t555-0100\tManufacturing"}
        aria-label="Paste spreadsheet data"
        onInput={(e) => onText((e.target as HTMLTextAreaElement).value)}
        rows={5}
      />
      <div class="imp__drop-actions">
        <ClipboardPaste aria-hidden="true" />
        <span class="muted">Paste from Excel or Sheets, drop a CSV here, or</span>
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          <FileUp /> Choose file
        </Button>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" hidden onChange={(e) => (e.target as HTMLInputElement).files?.[0] && onFile((e.target as HTMLInputElement).files![0])} />
      </div>
    </div>
  );
}

function ObjectPicker({ objects, value, onChange }: { objects: GlobalSObject[]; value: string; onChange: (v: string) => void }) {
  const current = objects.find((o) => o.name === value);
  const [q, setQ] = useState(current ? `${current.label} (${current.name})` : value);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    if (current) setQ(`${current.label} (${current.name})`);
  }, [current?.name]);
  const hits = useMemo(() => rankObjects(objects, q.replace(/\s*\(.*\)$/, ""), 12), [objects, q]);
  const choose = (o: GlobalSObject) => {
    onChange(o.name);
    setQ(`${o.label} (${o.name})`);
    setOpen(false);
  };
  return (
    <div class="lookup imp__picker">
      <input
        class="input"
        value={q}
        placeholder="Search objects, e.g. Account"
        role="combobox"
        aria-expanded={open}
        aria-controls="imp-objects"
        aria-activedescendant={open && hits[sel] ? `imp-obj-${sel}` : undefined}
        onFocus={(e) => ((e.target as HTMLInputElement).select(), setOpen(true))}
        onInput={(e) => (setQ((e.target as HTMLInputElement).value), setOpen(true), setSel(0))}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setSel((i) => Math.min(hits.length - 1, i + 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setSel((i) => Math.max(0, i - 1)));
          else if (e.key === "Enter" && hits[sel]) (e.preventDefault(), choose(hits[sel]));
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && hits.length > 0 && (
        <div class="lookup__list" role="listbox" id="imp-objects">
          {hits.map((o, i) => (
            <button key={o.name} id={`imp-obj-${i}`} type="button" role="option" tabIndex={-1} aria-selected={i === sel} class={"lookup__opt" + (i === sel ? " is-active" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
              <span class="truncate">{o.label}</span>
              <span class="mono muted lookup__id">{o.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Preview({ rows, describe, mapping, op }: { rows: ReturnType<typeof prepareRows>; describe: DescribeSObjectResult; mapping: Array<string | null>; op: Operation }) {
  const fields = [...new Set(mapping.filter((m): m is string => !!m && (op !== "delete" || m === "Id")))];
  const label = (n: string) => describe.fields.find((f) => f.name === n)?.label ?? n;
  if (!fields.length) return <Empty title="No mapped columns">Map at least one column to a field.</Empty>;
  return (
    <div class="imp__preview">
      <table class="table">
        <thead>
          <tr>
            <th class="imp__rownum">#</th>
            {fields.map((f) => (
              <th key={f} title={f}>
                {label(f)}
              </th>
            ))}
            <th>Check</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.index} class={r.errors.length ? "is-bad" : ""}>
              <td class="imp__rownum">{r.index + 1}</td>
              {fields.map((f) => (
                <td key={f} class="truncate">
                  {r.values[f] === undefined ? <span class="muted">—</span> : r.values[f] === null ? <span class="muted">(clear)</span> : String(r.values[f])}
                </td>
              ))}
              <td class="imp__check">{r.errors.length ? <span class="t-danger">{r.errors.join("; ")}</span> : <Check class="t-success" aria-label="OK" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Results({
  results,
  op,
  objectName,
  rows,
  headers,
  onDownload,
  onRetry,
}: {
  results: RowResult[];
  op: Operation;
  objectName: string;
  rows: string[][];
  headers: string[];
  onDownload: () => void;
  onRetry: (failed: number[]) => void;
}) {
  const [onlyFailed, setOnlyFailed] = useState(false);
  const ok = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const shown = onlyFailed ? failed : results;
  const ids = ok.map((r) => r.id).filter(Boolean) as string[];
  return (
    <>
      <div class="imp__summary">
        <span class="imp__stat">
          <CheckCircle2 class="t-success" /> {plural(ok.length, "record")} {op === "delete" ? "deleted" : op === "insert" ? "created" : op === "update" ? "updated" : "saved"}
          {op === "upsert" && ok.length > 0 && <span class="muted"> ({ok.filter((r) => r.created).length} new, {ok.filter((r) => r.created === false).length} updated)</span>}
        </span>
        {failed.length > 0 && (
          <span class="imp__stat">
            <XCircle class="t-danger" /> {plural(failed.length, "row")} failed
          </span>
        )}
        <span class="row" style={{ marginLeft: "auto", gap: 8 }}>
          {failed.length > 0 && (
            <Switch checked={onlyFailed} onChange={setOnlyFailed}>
              Failed only
            </Switch>
          )}
          {failed.length > 0 && (
            <Button size="sm" onClick={() => onRetry(failed.map((r) => r.index))}>
              <RotateCcw /> Retry failed
            </Button>
          )}
          {op !== "delete" && ids.length > 0 && (
            <Button size="sm" onClick={() => navigate(links.query(`SELECT Id, Name, LastModifiedDate FROM ${objectName} WHERE Id IN ('${ids.slice(0, 500).join("','")}')`))}>
              <TerminalSquare /> Query {ids.length > 500 ? "first 500" : "these"}
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={onDownload}>
            <Download /> Download results
          </Button>
        </span>
      </div>
      <div class="imp__preview">
        <table class="table">
          <thead>
            <tr>
              <th class="imp__rownum">#</th>
              <th>Result</th>
              <th>Record Id</th>
              <th>{headers[0] ?? "Data"}</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 500).map((r) => (
              <tr key={r.index} class={r.success ? "" : "is-bad"}>
                <td class="imp__rownum">{r.index + 1}</td>
                <td>{r.success ? <Badge tone="success">{op === "delete" ? "Deleted" : r.created === false ? "Updated" : op === "update" ? "Updated" : "Created"}</Badge> : <Badge tone="danger">Failed</Badge>}</td>
                <td class="mono">{r.id && op !== "delete" ? <a href={links.id(r.id)}>{r.id}</a> : (r.id ?? "—")}</td>
                <td class="truncate">{rows[r.index]?.[0] ?? ""}</td>
                <td class="imp__err">{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ConfirmRun({ op, count, object, isProd, orgName, onCancel, onRun }: { op: Operation; count: number; object: string; isProd: boolean; orgName: string; onCancel: () => void; onRun: () => void }) {
  // Typed confirmation for anything destructive or in production.
  const word = op === "delete" ? "delete" : isProd ? "production" : null;
  const [typed, setTyped] = useState("");
  const label = OPS.find((o) => o.value === op)!.label;
  return (
    <Modal
      title={`${label} ${plural(count, "record")}?`}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} data-autofocus={word ? undefined : true}>
            Cancel
          </Button>
          <Button variant={word ? "danger" : "primary"} onClick={onRun} disabled={!!word && typed.trim().toLowerCase() !== word}>
            {op === "delete" ? <Trash2 /> : <Upload />} {label} {plural(count, "record")}
          </Button>
        </>
      }
    >
      <form class="modal__body stack" style={{ gap: 12 }} onSubmit={(e) => (e.preventDefault(), (!word || typed.trim().toLowerCase() === word) && onRun())}>
        <p>
          {label} {plural(count, `${object} record`)} in <strong>{orgName || "this org"}</strong>
          {isProd ? <span class="t-prod"> (production)</span> : null}. Rows succeed or fail individually; you'll get a result for every row.
        </p>
        {op === "delete" && <Callout tone="warning">Deleted records go to the Recycle Bin, where they can be restored for 15 days.</Callout>}
        {word && (
          <label class="stack" style={{ gap: 6 }}>
            <span class="subtle">
              Type <strong class="mono">{word}</strong> to confirm
            </span>
            <input class="input" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} autoComplete="off" data-autofocus />
          </label>
        )}
      </form>
    </Modal>
  );
}
