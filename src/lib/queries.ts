import type { Sf } from "./sf";
import type { DescribeSObjectResult } from "./types";

/** Id, the object's name field and LastModifiedDate when available — the columns people want first. */
export function defaultFields(d: DescribeSObjectResult, extra: string[] = []): string[] {
  const has = (n: string) => d.fields.some((f) => f.name === n);
  const name = d.fields.find((f) => f.nameField)?.name;
  const out = ["Id", ...(name && name !== "Id" ? [name] : []), ...extra.filter((x) => x !== "Id" && x !== name), ...(has("LastModifiedDate") ? ["LastModifiedDate"] : [])];
  return [...new Set(out)];
}

export function defaultQuery(d: DescribeSObjectResult, opts: { where?: string; extra?: string[]; limit?: number } = {}): string {
  const order = d.fields.some((f) => f.name === "LastModifiedDate") ? " ORDER BY LastModifiedDate DESC" : "";
  return `SELECT ${defaultFields(d, opts.extra).join(", ")} FROM ${d.name}${opts.where ? ` WHERE ${opts.where}` : ""}${order} LIMIT ${opts.limit ?? 200}`;
}

/** Same as defaultQuery, describing the object first (falls back to SELECT Id if the describe fails). */
export async function buildDefaultQuery(sf: Sf, objectName: string, opts: { where?: string; extra?: string[]; tooling?: boolean } = {}): Promise<string> {
  try {
    return defaultQuery(await sf.describe(objectName, opts.tooling), opts);
  } catch {
    return `SELECT Id FROM ${objectName}${opts.where ? ` WHERE ${opts.where}` : ""} LIMIT 200`;
  }
}

/** Objects ranked by how often they appear in this org's query history and recent visits. */
export function objectFrequency(history: Array<{ object: string | null; at: number }>, recent: Array<{ objectName: string; at: number }>): Map<string, number> {
  const now = Date.now();
  const score = new Map<string, number>();
  const add = (name: string | null, at: number, w: number) => {
    if (!name) return;
    const decay = 1 / (1 + (now - at) / (7 * 86400_000));
    score.set(name.toLowerCase(), (score.get(name.toLowerCase()) ?? 0) + w * decay);
  };
  for (const h of history) add(h.object, h.at, 1);
  for (const r of recent) add(r.objectName, r.at, 1.5);
  return score;
}

/** Tables that are rarely what you mean (sharing, history, feeds, change events). */
export const NOISE_OBJECT = /(Share|History|Feed|ChangeEvent|__hd|__ChangeEvent)$/;
