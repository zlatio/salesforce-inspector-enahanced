// CSV / TSV parsing for pasted spreadsheet data and uploaded files.

export type Delimiter = "\t" | "," | ";";

/** Guess the delimiter from the first few lines: Excel/Sheets pastes are tab-separated. */
export function detectDelimiter(text: string): Delimiter {
  const sample = text.split(/\r?\n/).slice(0, 5).join("\n");
  const count = (d: string) => sample.split(d).length - 1;
  const scores: Array<[Delimiter, number]> = [
    ["\t", count("\t") * 1.2],
    [",", count(",")],
    [";", count(";")],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] > 0 ? scores[0][0] : ",";
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
  // Drop trailing blank lines (common when pasting from a spreadsheet).
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows;
}

const esc = (s: string, sep: string) => (/["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s);
export function toCsv(rows: string[][], sep = ","): string {
  return rows.map((r) => r.map((c) => esc(c, sep)).join(sep)).join("\r\n");
}

export const DELIMITER_LABEL: Record<Delimiter, string> = { "\t": "Tab-separated", ",": "Comma-separated", ";": "Semicolon-separated" };
