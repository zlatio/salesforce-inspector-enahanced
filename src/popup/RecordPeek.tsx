import { useEffect, useMemo, useState } from "preact/hooks";
import { ArrowUpRight, RefreshCw } from "lucide-preact";
import type { Sf } from "../lib/sf";
import type { DescribeField, DescribeSObjectResult, SfRecord } from "../lib/types";
import { fmtDate, fmtDateTime, fmtNumber } from "../lib/format";
import { announce, copyText, SearchInput, Spinner, Switch } from "../ui";

/** Plain-text rendering of a field value for the compact side-panel list. */
function show(f: DescribeField, v: unknown): { text: string; kind?: "null" | "bool-on" | "bool-off" | "mono" } {
  if (v == null || v === "") return { text: "—", kind: "null" };
  if (typeof v === "boolean") return { text: String(v), kind: v ? "bool-on" : "bool-off" };
  if (f.type === "datetime") return { text: fmtDateTime(String(v)) };
  if (f.type === "date") return { text: fmtDate(String(v)) };
  if (f.type === "id" || f.type === "reference") return { text: String(v), kind: "mono" };
  if (typeof v === "number") return { text: v.toLocaleString(undefined, { maximumFractionDigits: f.scale || 0 }) + (f.type === "percent" ? "%" : "") };
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const parts = [o.street, [o.city, o.state ?? o.stateCode, o.postalCode].filter(Boolean).join(" "), o.country ?? o.countryCode].filter((x) => x && String(x).trim());
    return { text: parts.length ? parts.join(", ") : JSON.stringify(v) };
  }
  return { text: String(v) };
}

/**
 * "Fields on this record": a live, searchable list for the record open in the current tab. Clicking an
 * API name copies it; the arrow opens that field in the full inspector.
 */
export function RecordPeek({ sf, objectName, recordId, onOpenField }: { sf: Sf; objectName?: string; recordId: string; onOpenField: (obj: string, field?: string) => void }) {
  const [data, setData] = useState<{ d: DescribeSObjectResult; rec: SfRecord } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const obj = objectName ?? (await sf.objectForId(recordId))?.name;
        if (!obj) throw new Error("Unknown object for this record id.");
        const [d, rec] = await Promise.all([sf.describe(obj), sf.getRecord(obj, recordId)]);
        if (!cancelled) setData({ d, rec });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [objectName, recordId, nonce]);

  const rows = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    const nameField = data.d.fields.find((f) => f.nameField)?.name;
    const pinned = ["Id", nameField, "RecordTypeId", "OwnerId"];
    return data.d.fields
      .filter((f) => showEmpty || s || (data.rec[f.name] != null && data.rec[f.name] !== ""))
      .filter((f) => {
        if (!s) return true;
        const v = data.rec[f.name];
        return f.label.toLowerCase().includes(s) || f.name.toLowerCase().includes(s) || (v != null && String(typeof v === "object" ? JSON.stringify(v) : v).toLowerCase().includes(s));
      })
      .sort((a, b) => {
        const pa = pinned.indexOf(a.name);
        const pb = pinned.indexOf(b.name);
        return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || a.label.localeCompare(b.label);
      });
  }, [data, q, showEmpty]);

  const populated = data ? data.d.fields.filter((f) => data.rec[f.name] != null && data.rec[f.name] !== "").length : 0;

  return (
    <section class="peek" aria-label="Fields on this record">
      <div class="peek__head">
        <div class="pctx__eyebrow">Fields on this record</div>
        {data && (
          <span class="muted peek__count">
            {fmtNumber(populated)} with values · {fmtNumber(data.d.fields.length)} total
          </span>
        )}
        <button class="copy" aria-label="Reload record" data-tip="Reload" data-tip-pos="left" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw />
        </button>
      </div>
      <div class="peek__tools">
        <SearchInput value={q} onInput={setQ} placeholder="Search fields and values" size="sm" class="peek__search" />
        <Switch checked={showEmpty} onChange={setShowEmpty}>
          Empty
        </Switch>
      </div>
      {error ? (
        <div class="peek__msg">{error}</div>
      ) : !data ? (
        <div class="peek__msg">
          <Spinner small /> Loading fields…
        </div>
      ) : rows.length === 0 ? (
        <div class="peek__msg">No fields match “{q}”.</div>
      ) : (
        <div class="peek__list" role="list">
          {rows.map((f) => {
            const v = show(f, data.rec[f.name]);
            return (
              <div class="peek__row" role="listitem" key={f.name}>
                <div class="peek__meta">
                  <span class="peek__label truncate" title={f.label}>
                    {f.label}
                  </span>
                  <button
                    class={"peek__api mono truncate" + (copied === f.name ? " is-copied" : "")}
                    title="Copy API name"
                    onClick={() => {
                      copyText(f.name);
                      announce(`Copied ${f.name}`);
                      setCopied(f.name);
                      setTimeout(() => setCopied((c) => (c === f.name ? null : c)), 1200);
                    }}
                  >
                    {copied === f.name ? "Copied" : f.name}
                  </button>
                </div>
                <div class={"peek__value" + (v.kind ? ` peek__value--${v.kind}` : "")} title={v.text}>
                  {v.text}
                </div>
                <button class="copy peek__open" aria-label={`Open ${f.label} in the inspector`} data-tip="Open in inspector" data-tip-pos="left" onClick={() => onOpenField(data.d.name, f.name)}>
                  <ArrowUpRight />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
