import type { DescribeField } from "../../../lib/types";

const pad = (n: number) => String(n).padStart(2, "0");

/** Whether this field can be edited inline on an existing record. */
export function isEditable(f: DescribeField) {
  return f.updateable && !f.calculated && !f.autoNumber && f.type !== "address" && f.type !== "location" && f.type !== "base64";
}

/** Convert an API value into the string an <input> expects. */
export function toInput(f: DescribeField, v: unknown): string {
  if (v == null) return "";
  switch (f.type) {
    case "datetime": {
      const d = new Date(String(v));
      if (isNaN(+d)) return String(v);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    case "time":
      return String(v).replace(/(\.\d+)?Z$/, "");
    default:
      return String(v);
  }
}

/** Convert input text back into the value the REST API wants (or throw a readable error). */
export function fromInput(f: DescribeField, s: string): unknown {
  if (f.type === "boolean") return s === "true";
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
      const d = new Date(s);
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

export function sameValue(a: unknown, b: unknown) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function formatAddress(v: Record<string, unknown>) {
  const parts = [v.street, [v.city, v.state ?? v.stateCode, v.postalCode].filter(Boolean).join(" "), v.country ?? v.countryCode].filter((x) => x && String(x).trim());
  if (parts.length) return parts.join(", ");
  if (v.latitude != null) return `${v.latitude}, ${v.longitude}`;
  return "";
}
