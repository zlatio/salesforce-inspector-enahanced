import type { DescribeField } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

/** Whether this field can be edited inline on an existing record. */
export function isEditable(f: DescribeField) {
  return f.updateable && !f.calculated && !f.autoNumber && f.type !== "address" && f.type !== "location" && f.type !== "base64";
}

/** Options for datetime fields: edit in UTC instead of the browser's local time. */
export interface ZoneOpts {
  utc?: boolean;
}

/** Convert an API value into the string an <input> expects. */
export function toInput(f: DescribeField, v: unknown, { utc }: ZoneOpts = {}): string {
  if (f.type === "boolean") return v === true || v === "true" ? "true" : "false";
  if (v == null) return "";
  switch (f.type) {
    case "datetime": {
      const d = new Date(String(v));
      if (isNaN(+d)) return String(v);
      if (utc) return d.toISOString().slice(0, 19);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    case "time":
      return String(v).replace(/(\.\d+)?Z$/, "");
    default:
      return String(v);
  }
}

/** Convert input text back into the value the REST API wants (or throw a readable error). */
export function fromInput(f: DescribeField, s: string, { utc }: ZoneOpts = {}): unknown {
  if (f.type === "boolean") {
    const t = s.trim().toLowerCase();
    if (["true", "yes", "1"].includes(t)) return true;
    if (["false", "no", "0", ""].includes(t)) return false;
    throw new Error("Enter true or false");
  }
  if (s === "") return null;
  switch (f.type) {
    case "int":
    case "long": {
      const n = Number(s);
      if (!Number.isInteger(n)) throw new Error("Enter a whole number");
      return n;
    }
    case "double":
    case "currency":
    case "percent": {
      const n = Number(s);
      if (!isFinite(n)) throw new Error("Enter a number");
      return n;
    }
    case "datetime": {
      // datetime-local text has no zone: it's local time unless the caller edits in UTC.
      const d = new Date(utc && !/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s + "Z" : s);
      if (isNaN(+d)) throw new Error("Enter a valid date and time");
      return d.toISOString();
    }
    case "time":
      return /^\d\d:\d\d$/.test(s) ? s + ":00.000Z" : s + ".000Z";
    case "reference":
      if (!/^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(s.trim())) throw new Error("Enter a 15 or 18 character record ID");
      return s.trim();
    default:
      if (f.length && s.length > f.length && f.type !== "multipicklist") throw new Error(`Max ${f.length} characters (${s.length} entered)`);
      return s;
  }
}

// The API returns datetimes as "…000+0000"; the editor produces "…000Z". Same instant, different text.
const ISO_DATETIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)$/;

export function sameValue(a: unknown, b: unknown) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "string" && typeof b === "string" && ISO_DATETIME.test(a) && ISO_DATETIME.test(b)) return Date.parse(a) === Date.parse(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

export function formatAddress(v: Record<string, unknown>) {
  const parts = [v.street, [v.city, v.state ?? v.stateCode, v.postalCode].filter(Boolean).join(" "), v.country ?? v.countryCode].filter((x) => x && String(x).trim());
  if (parts.length) return parts.join(", ");
  if (v.latitude != null) return `${v.latitude}, ${v.longitude}`;
  return "";
}
