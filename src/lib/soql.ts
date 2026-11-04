import type { QueryResult, SfRecord } from "./types";
import { rawString } from "./format";

export const SOQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE", "INCLUDES", "EXCLUDES", "ORDER BY", "GROUP BY", "HAVING",
  "ASC", "DESC", "NULLS FIRST", "NULLS LAST", "LIMIT", "OFFSET", "TYPEOF", "WHEN", "THEN", "ELSE", "END", "USING SCOPE",
  "WITH SECURITY_ENFORCED", "WITH USER_MODE", "WITH SYSTEM_MODE", "FOR VIEW", "FOR REFERENCE", "FOR UPDATE", "ALL ROWS", "ROLLUP", "CUBE",
  "TRUE", "FALSE", "NULL", "FIELDS(ALL)", "FIELDS(STANDARD)", "FIELDS(CUSTOM)",
];

export const SOQL_FUNCTIONS = [
  "COUNT", "COUNT_DISTINCT", "SUM", "AVG", "MIN", "MAX", "FORMAT", "toLabel", "convertCurrency", "GROUPING",
  "CALENDAR_MONTH", "CALENDAR_QUARTER", "CALENDAR_YEAR", "DAY_IN_MONTH", "DAY_IN_WEEK", "DAY_IN_YEAR", "DAY_ONLY",
  "FISCAL_MONTH", "FISCAL_QUARTER", "FISCAL_YEAR", "HOUR_IN_DAY", "WEEK_IN_MONTH", "WEEK_IN_YEAR", "DISTANCE", "GEOLOCATION",
];

export const DATE_LITERALS = [
  "TODAY", "YESTERDAY", "TOMORROW", "LAST_WEEK", "THIS_WEEK", "NEXT_WEEK", "LAST_MONTH", "THIS_MONTH", "NEXT_MONTH",
  "LAST_90_DAYS", "NEXT_90_DAYS", "LAST_N_DAYS:7", "NEXT_N_DAYS:7", "LAST_N_WEEKS:4", "LAST_N_MONTHS:3", "THIS_QUARTER",
  "LAST_QUARTER", "NEXT_QUARTER", "THIS_YEAR", "LAST_YEAR", "NEXT_YEAR", "LAST_N_YEARS:2", "THIS_FISCAL_QUARTER", "THIS_FISCAL_YEAR",
];

/** Main FROM object of a query, ignoring sub-queries in parentheses. */
export function mainObject(soql: string): string | null {
  const flat = stripStrings(soql);
  let depth = 0;
  let top = "";
  for (const ch of flat) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) top += ch;
    if (depth > 0) top += " ";
  }
  const m = /\bFROM\s+([A-Za-z_][\w]*)/i.exec(top);
  return m ? m[1] : null;
}

/** Replace string literal contents with spaces so parsing ignores them but offsets stay stable. */
export function stripStrings(s: string) {
  return s.replace(/'(?:[^'\\]|\\.)*'/g, (m) => "'" + " ".repeat(Math.max(0, m.length - 2)) + "'");
}

export function isAggregate(soql: string) {
  return /\bGROUP\s+BY\b/i.test(soql) || /^\s*SELECT\s+(COUNT|COUNT_DISTINCT|SUM|AVG|MIN|MAX)\s*\(/i.test(soql);
}

export function isCountOnly(soql: string) {
  return /^\s*SELECT\s+COUNT\(\s*\)\s+FROM\b/i.test(soql);
}

export interface SubResult {
  __sub: true;
  totalSize: number;
  records: SfRecord[];
}

export type Cell = string | number | boolean | null | SubResult | object;
export type FlatRow = Record<string, Cell>;

/** Flatten nested relationship objects (Owner.Name) into dotted columns; keep sub-queries intact. */
export function flattenRecords(records: SfRecord[]): { columns: string[]; rows: FlatRow[] } {
  const columns: string[] = [];
  const seen = new Set<string>();
  const add = (c: string) => {
    if (!seen.has(c)) {
      seen.add(c);
      columns.push(c);
    }
  };
  const rows = records.map((rec) => {
    const out: FlatRow = {};
    const walk = (obj: SfRecord, prefix: string) => {
      for (const key of Object.keys(obj)) {
        if (key === "attributes") continue;
        const v = obj[key];
        const col = prefix + key;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const o = v as QueryResult & SfRecord;
          if (Array.isArray(o.records) && "totalSize" in o) {
            add(col);
            out[col] = { __sub: true, totalSize: o.totalSize, records: o.records } as SubResult;
          } else if (o.attributes) {
            walk(o, col + ".");
          } else {
            add(col);
            out[col] = v as object;
          }
        } else {
          add(col);
          out[col] = v as Cell;
        }
      }
    };
    walk(rec, "");
    return out;
  });
  // A null relationship ("Owner": null) shouldn't produce its own column if other rows expand it.
  const finalCols = columns.filter((c) => !columns.some((o) => o.startsWith(c + ".")));
  return { columns: finalCols, rows };
}

export function cellText(v: Cell | undefined): string {
  if (v == null) return "";
  if (typeof v === "object" && (v as SubResult).__sub) return `${(v as SubResult).totalSize} records`;
  return rawString(v);
}

function csvEscape(s: string, sep: string) {
  return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toDelimited(columns: string[], rows: FlatRow[], sep = ",") {
  const lines = [columns.map((c) => csvEscape(c, sep)).join(sep)];
  for (const r of rows) lines.push(columns.map((c) => csvEscape(cellText(r[c]), sep)).join(sep));
  return lines.join("\r\n");
}

export function toJson(records: SfRecord[]) {
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) if (k !== "attributes") o[k] = clean(x);
      return o;
    }
    return v;
  };
  return JSON.stringify(clean(records), null, 2);
}

const BREAK_BEFORE = ["FROM", "WHERE", "GROUP BY", "HAVING", "ORDER BY", "LIMIT", "OFFSET", "WITH", "USING SCOPE", "FOR"];
const UPPER = new Set(
  "select from where and or not in like includes excludes order by group having asc desc nulls first last limit offset typeof when then else end using scope with for view reference update true false null rows all".split(" "),
);

/** Lightweight formatter: upper-case keywords and put each clause on its own line. Leaves string literals untouched. */
export function formatSoql(soql: string): string {
  const parts = soql.split(/('(?:[^'\\]|\\.)*')/g);
  let out = parts
    .map((p, i) => (i % 2 ? p : p.replace(/\s+/g, " ").replace(/\b([A-Za-z_]+)\b/g, (w) => (UPPER.has(w.toLowerCase()) ? w.toUpperCase() : w))))
    .join("")
    .trim();
  // Only break top-level clauses (depth 0).
  let depth = 0;
  let res = "";
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && out[i - 1] === " ") {
      const hit = BREAK_BEFORE.find((k) => out.startsWith(k, i) && !/\w/.test(out[i + k.length] ?? ""));
      if (hit) {
        res = res.trimEnd() + "\n";
      }
    }
    res += ch;
  }
  // Split long select lists one field per line.
  out = res.replace(/^SELECT (.+)$/m, (_, list: string) => {
    const fields = splitTopLevel(list);
    return fields.length > 4 ? "SELECT\n  " + fields.join(",\n  ") : "SELECT " + fields.join(", ");
  });
  return out;
}

function splitTopLevel(list: string) {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** "ERROR at Row:1:Column:25" → zero-based character offset in the query. */
export function errorOffset(soql: string, message: string): number | null {
  const m = /Row:(\d+):Column:(\d+)/.exec(message);
  if (!m) return null;
  const lines = soql.split("\n");
  const row = +m[1] - 1;
  const col = +m[2] - 1;
  if (row >= lines.length) return null;
  let off = 0;
  for (let i = 0; i < row; i++) off += lines[i].length + 1;
  return Math.min(soql.length, off + col);
}

/** Escape text for use inside a quoted SOQL string literal. */
export const soqlEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
/** Escape text for a LIKE pattern: also neutralises the % and _ wildcards. */
export const likeEscape = (s: string) => soqlEscape(s).replace(/%/g, "\\%").replace(/_/g, "\\_");

/** A SOQL literal for a field value, or null when the type can't be compared in a WHERE clause. */
export function soqlLiteral(type: string, v: unknown): string | null {
  if (v == null || v === "") return "null";
  switch (type) {
    case "boolean":
      return v ? "TRUE" : "FALSE";
    case "int":
    case "long":
    case "double":
    case "currency":
    case "percent":
      return String(v);
    case "date":
      return String(v);
    case "datetime":
      return String(v).replace(/(\.\d+)?(\+0000|Z)$/, "Z");
    case "address":
    case "location":
    case "base64":
    case "time":
      return null;
    default:
      return "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  }
}
