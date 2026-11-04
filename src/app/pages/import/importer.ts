import type { Sf } from "../../../lib/sf";
import type { DescribeField, DescribeSObjectResult } from "../../../lib/types";

export type Operation = "insert" | "update" | "upsert" | "delete";
export type BlankMode = "ignore" | "null";
/** "us" = 1,234.56 · "eu" = 1.234,56 */
export type NumberFormat = "us" | "eu";

/** Parse a number in the chosen format; anything ambiguous is an error rather than a silent guess. */
function parseNumber(raw: string, fmt: NumberFormat): number {
  let s = raw.replace(/\s/g, "").replace(/%$/, "").replace(/^[$£€]/, "");
  if (fmt === "us") {
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else if (s.includes(",")) throw new Error(`“${raw}” isn’t in 1,234.56 format. If this file uses comma decimals, switch Numbers to 1.234,56`);
  } else {
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^-?\d+(,\d+)?$/.test(s)) s = s.replace(",", ".");
    else if (s.includes(".") || s.includes(",")) throw new Error(`“${raw}” isn’t in 1.234,56 format. If this file uses dot decimals, switch Numbers to 1,234.56`);
  }
  const n = Number(s);
  if (!isFinite(n) || s === "") throw new Error(`“${raw}” isn't a number`);
  return n;
}

/** Normalise a header or label for fuzzy matching: "Account Name" ≈ "account_name" ≈ "AccountName". */
const norm = (s: string) => s.toLowerCase().replace(/__c$/, "").replace(/[^a-z0-9]/g, "");

/** Map spreadsheet headers to fields: exact API name, then label, then a normalised match. */
export function autoMap(headers: string[], d: DescribeSObjectResult): Array<string | null> {
  const used = new Set<string>();
  return headers.map((h) => {
    const t = h.trim();
    const pick = (f?: DescribeField) => {
      if (!f || used.has(f.name)) return null;
      used.add(f.name);
      return f.name;
    };
    return (
      pick(d.fields.find((f) => f.name.toLowerCase() === t.toLowerCase())) ??
      pick(d.fields.find((f) => f.label.toLowerCase() === t.toLowerCase())) ??
      pick(d.fields.find((f) => norm(f.name) === norm(t) || norm(f.label) === norm(t))) ??
      null
    );
  });
}

/** Fields that can be written for an operation (Id is the record key for update/delete). */
export function writableFields(d: DescribeSObjectResult, op: Operation): DescribeField[] {
  return d.fields
    .filter((f) => {
      if (f.name === "Id") return op !== "insert";
      if (op === "delete") return false;
      if (f.calculated || f.autoNumber || f.type === "address" || f.type === "location") return false;
      if (op === "insert") return f.createable;
      if (op === "update") return f.updateable;
      return f.createable || f.updateable || f.externalId || f.idLookup;
    })
    .sort((a, b) => (a.name === "Id" ? -1 : b.name === "Id" ? 1 : a.label.localeCompare(b.label)));
}

export function externalIdFields(d: DescribeSObjectResult): DescribeField[] {
  return d.fields.filter((f) => f.name === "Id" || f.externalId || (f.idLookup && f.type !== "id" && f.createable));
}

const ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

/** Convert a cell to the API value for a field. Returns undefined to omit the field. Throws with a readable message. */
export function convert(f: DescribeField, raw: string, blank: BlankMode, numbers: NumberFormat = "us"): unknown {
  const s = raw.trim();
  if (s === "") return blank === "null" && f.name !== "Id" ? null : undefined;
  switch (f.type) {
    case "id":
    case "reference":
      if (!ID_RE.test(s)) throw new Error(`“${s}” isn't a record ID`);
      return s;
    case "boolean":
      if (/^(true|yes|y|1|x|✓|checked)$/i.test(s)) return true;
      if (/^(false|no|n|0|unchecked)$/i.test(s)) return false;
      throw new Error(`“${s}” isn't true/false`);
    case "int":
    case "long": {
      const n = parseNumber(s, numbers);
      if (!Number.isInteger(n)) throw new Error(`“${s}” isn't a whole number`);
      return n;
    }
    case "double":
    case "currency":
    case "percent":
      return parseNumber(s, numbers);
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw new Error(`“${s}” isn't an email address`);
      return s;
    case "date": {
      const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
      if (!m) throw new Error(`Use YYYY-MM-DD for dates (got “${s}”)`);
      return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    }
    case "datetime": {
      const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(" ", "T") : s);
      if (isNaN(+d)) throw new Error(`“${s}” isn't a date/time (use ISO, e.g. 2026-11-04T14:30:00Z)`);
      return d.toISOString();
    }
    case "picklist":
      if (f.restrictedPicklist && !f.picklistValues.some((p) => p.active && p.value === s)) throw new Error(`“${s}” isn't an allowed value`);
      return s;
    case "multipicklist":
      return s
        .split(/\s*;\s*/)
        .filter(Boolean)
        .join(";");
    default:
      if (f.length && s.length > f.length) throw new Error(`Too long: ${s.length} of max ${f.length} characters`);
      return raw;
  }
}

export interface PreparedRow {
  index: number;
  values: Record<string, unknown>;
  errors: string[];
  /** Problems that may still succeed (e.g. a required field blank on upsert, which only matters for new records). */
  warnings: string[];
  /** Raw text of cells that failed to convert, shown in the preview next to the error. */
  invalid?: Record<string, string>;
}

const requiredOnCreate = (f: DescribeField) => f.createable && !f.nillable && !f.defaultedOnCreate && f.type !== "boolean";

/** Turn mapped rows into API payloads, collecting per-row validation errors. */
export function prepareRows(rows: string[][], mapping: Array<string | null>, d: DescribeSObjectResult, op: Operation, blank: BlankMode, keyField: string | null, numbers: NumberFormat = "us"): PreparedRow[] {
  const fieldBy = new Map(d.fields.map((f) => [f.name, f]));
  const mapped = mapping.filter((m): m is string => !!m).map((m) => fieldBy.get(m)!);
  return rows.map((cells, index) => {
    const values: Record<string, unknown> = {};
    const errors: string[] = [];
    const warnings: string[] = [];
    const invalid: Record<string, string> = {};
    mapping.forEach((fieldName, col) => {
      if (!fieldName) return;
      if (op === "delete" && fieldName !== "Id") return;
      const f = fieldBy.get(fieldName)!;
      try {
        const v = convert(f, cells[col] ?? "", op === "insert" ? "ignore" : blank, numbers);
        if (v !== undefined) values[fieldName] = v;
      } catch (e) {
        errors.push(`${f.label}: ${(e as Error).message}`);
        invalid[fieldName] = cells[col] ?? "";
      }
    });
    // Required fields that are mapped but blank in this row.
    for (const f of mapped) {
      if (f.name === "Id" || values[f.name] != null) continue;
      if (op === "insert" && requiredOnCreate(f)) errors.push(`${f.label} is required`);
      else if (op === "upsert" && requiredOnCreate(f) && !(f.name in values)) warnings.push(`${f.label} is blank — required if this creates a new record`);
      if ((op === "update" || op === "upsert") && values[f.name] === null && !f.nillable && f.type !== "boolean") errors.push(`${f.label} can't be cleared`);
    }
    if ((op === "update" || op === "delete") && !values.Id) errors.push("Missing record Id");
    if (op === "upsert" && keyField && (values[keyField] == null || values[keyField] === "")) errors.push(`Missing ${keyField}`);
    if (op === "insert") delete values.Id;
    return { index, values, errors, warnings, invalid };
  });
}

/** Required-on-insert fields that aren't mapped. */
export function missingRequired(d: DescribeSObjectResult, mapping: Array<string | null>, op: Operation): DescribeField[] {
  if (op !== "insert" && op !== "upsert") return [];
  const mapped = new Set(mapping.filter(Boolean));
  return d.fields.filter((f) => f.createable && !f.nillable && !f.defaultedOnCreate && f.type !== "boolean" && !mapped.has(f.name));
}

export interface RowResult {
  index: number;
  success: boolean;
  /** Skipped because the run was stopped before reaching it. */
  notRun?: boolean;
  id?: string;
  created?: boolean;
  error?: string;
}

/**
 * Run the operation through the sObject Collections API (200 records per request, allOrNone=false so
 * one bad row doesn't sink the batch). Calls onProgress after every batch; stop() aborts between batches.
 */
export async function runImport(
  sf: Sf,
  objectName: string,
  op: Operation,
  rows: PreparedRow[],
  keyField: string | null,
  onProgress: (done: RowResult[]) => void,
  shouldStop: () => boolean,
  batchSize = 200,
): Promise<RowResult[]> {
  const results: RowResult[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    if (shouldStop()) break;
    const batch = rows.slice(i, i + batchSize);
    let res: Array<{ id?: string; success: boolean; created?: boolean; errors?: Array<{ message: string; statusCode: string; fields?: string[] }> }>;
    try {
      if (op === "delete") {
        const ids = batch.map((r) => r.values.Id as string).join(",");
        res = await sf.request(sf.path(`/composite/sobjects?ids=${ids}&allOrNone=false`), { method: "DELETE" });
      } else {
        const records = batch.map((r) => ({ attributes: { type: objectName }, ...r.values }));
        const path = op === "upsert" ? `/composite/sobjects/${objectName}/${keyField}` : "/composite/sobjects";
        res = await sf.request(sf.path(path), { method: op === "insert" ? "POST" : "PATCH", body: { allOrNone: false, records } });
      }
    } catch (e) {
      // A request-level failure (e.g. session expired) fails the whole batch.
      res = batch.map(() => ({ success: false, errors: [{ message: (e as Error).message, statusCode: "REQUEST_FAILED" }] }));
    }
    batch.forEach((r, k) => {
      const x = res[k];
      results.push({
        index: r.index,
        success: !!x?.success,
        id: x?.id ?? (r.values.Id as string | undefined),
        created: x?.created,
        error: x?.success ? undefined : (x?.errors ?? []).map((e) => `${e.statusCode}: ${e.message}${e.fields?.length ? ` (${e.fields.join(", ")})` : ""}`).join("; ") || "Unknown error",
      });
    });
    onProgress([...results]);
  }
  return results;
}
