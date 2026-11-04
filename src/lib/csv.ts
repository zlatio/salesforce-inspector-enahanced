// CSV / TSV parsing for pasted spreadsheet data and uploaded files.

export type Delimiter = "\t" | "," | ";";

/**
 * Guess the delimiter from the header row: header names rarely contain separators, while data
 * cells (addresses, notes) often contain commas. Excel and Sheets pastes are tab-separated, so
 * any tab in the header wins. Quoted sections are ignored.
 */
export function detectDelimiter(text: string): Delimiter {
  const header = (text.replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => l.trim() !== "") ?? "").replace(/"(?:[^"]|"")*"/g, "");
  const count = (d: string) => header.split(d).length - 1;
  if (count("\t") > 0) return "\t";
  return count(";") > count(",") ? ";" : ",";
}

/** RFC 4180-style parser: quoted fields, "" escapes, delimiters and newlines inside quotes. */
export function parseDelimited(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop blank lines anywhere (spreadsheet pastes often have empty or all-tab rows); they'd
  // otherwise import as empty records.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const esc = (s: string, sep: string) => (/["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s);
export function toCsv(rows: string[][], sep = ","): string {
  return rows.map((r) => r.map((c) => esc(c, sep)).join(sep)).join("\r\n");
}

export const DELIMITER_LABEL: Record<Delimiter, string> = { "\t": "Tab-separated", ",": "Comma-separated", ";": "Semicolon-separated" };
