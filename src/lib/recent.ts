// Recently visited objects and records, per org, for the command palette.
export interface RecentItem {
  objectName: string;
  recordId?: string;
  title: string;
  at: number;
}

const key = (host: string) => `sie.recent.${host}`;

export function loadRecent(host: string): RecentItem[] {
  try {
    return JSON.parse(localStorage.getItem(key(host)) ?? "[]");
  } catch {
    return [];
  }
}

export function pushRecent(host: string, item: Omit<RecentItem, "at">) {
  const list = loadRecent(host).filter((r) => !(r.objectName === item.objectName && r.recordId === item.recordId));
  try {
    localStorage.setItem(key(host), JSON.stringify([{ ...item, at: Date.now() }, ...list].slice(0, 15)));
  } catch {
    /* storage full or blocked */
  }
}
