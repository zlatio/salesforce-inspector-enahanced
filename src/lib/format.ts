import type { DescribeField } from "./types";

const nf = new Intl.NumberFormat();
const compactNf = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const fmtNumber = (n: number) => nf.format(n);
export const fmtCompact = (n: number) => compactNf.format(n);
export function fmtPercent(n: number) {
  if (!isFinite(n)) return "–";
  if (n > 0 && n < 0.1) return "<0.1%";
  return (n >= 10 || n === 0 ? Math.round(n) : n.toFixed(1)) + "%";
}

export function fmtDate(iso: string) {
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return isNaN(+d) ? iso : dateFmt.format(d);
}
export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return isNaN(+d) ? iso : dateTimeFmt.format(d);
}

export function fmtRelative(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(new Date(ts).toISOString());
}

export function fmtDuration(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

/** Human readable type, e.g. "Text(255)", "Lookup(User, Group)", "Number(16, 2)". */
export function fieldTypeLabel(f: DescribeField, opts: { formulaWrap?: boolean } = {}): string {
  const t = f.type;
  if (f.calculated && f.calculatedFormula) return opts.formulaWrap === false ? baseType(f) : `Formula(${baseType(f)})`;
  if (f.autoNumber) return "Auto Number";
  switch (t) {
    case "id":
      return "Id";
    case "reference":
      return `${f.cascadeDelete && f.custom ? "Master-Detail" : "Lookup"}(${f.referenceTo.join(", ")})`;
    default:
      return baseType(f);
  }
}

function baseType(f: DescribeField): string {
  switch (f.type) {
    case "string":
      return `Text(${f.length})`;
    case "textarea":
      return f.htmlFormatted ? `Rich Text(${f.length})` : f.length > 255 ? `Long Text(${f.length})` : `Text Area(${f.length})`;
    case "encryptedstring":
      return `Encrypted(${f.length})`;
    case "boolean":
      return "Checkbox";
    case "int":
      return `Number(${f.digits || f.precision}, 0)`;
    case "long":
      return "Long";
    case "double":
      return `Number(${f.precision - f.scale}, ${f.scale})`;
    case "currency":
      return `Currency(${f.precision - f.scale}, ${f.scale})`;
    case "percent":
      return `Percent(${f.precision - f.scale}, ${f.scale})`;
    case "date":
      return "Date";
    case "datetime":
      return "Date/Time";
    case "time":
      return "Time";
    case "email":
      return "Email";
    case "phone":
      return "Phone";
    case "url":
      return "URL";
    case "picklist":
      return "Picklist";
    case "multipicklist":
      return "Multi-Picklist";
    case "combobox":
      return "Combobox";
    case "reference":
      return "Reference";
    case "address":
      return "Address";
    case "location":
      return "Geolocation";
    case "base64":
      return "Blob";
    case "anyType":
      return "Any";
    default:
      return f.type;
  }
}

/** Turn a camel-case limit key like "DailyAsyncApexExecutions" into "Daily Async Apex Executions". */
export function humanizeKey(key: string) {
  return key
    .replace(/MB$/, " (MB)")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\bApi\b/g, "API")
    .replace(/\bApex\b/g, "Apex")
    .replace(/\s+/g, " ")
    .trim();
}

export function plural(n: number, one: string, many = one + "s") {
  return `${fmtNumber(n)} ${n === 1 ? one : many}`;
}

/** Stringify any record value for copying or CSV export. */
export function rawString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
