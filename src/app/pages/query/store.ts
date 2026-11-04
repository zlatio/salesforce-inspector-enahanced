import { computed, signal } from "@preact/signals";
import { persisted } from "../../../lib/storage";
import type { SfRecord } from "../../../lib/types";
import { host } from "../../router";

export interface QueryTab {
  id: string;
  soql: string;
  tooling: boolean;
  all: boolean;
  /** Set when the tab was loaded from (or saved as) a saved query, so Save can update it in place. */
  savedId?: string;
}

export interface QueryRun {
  status: "running" | "done" | "error" | "cancelled";
  soql: string;
  tooling: boolean;
  records: SfRecord[];
  totalSize: number;
  nextRecordsUrl?: string;
  ms: number;
  error?: string;
  errorOffset?: number | null;
  loadingMore?: boolean;
  startedAt: number;
}

export interface HistoryEntry {
  soql: string;
  tooling: boolean;
  object: string | null;
  rows: number;
  at: number;
}

export interface SavedQuery {
  id: string;
  name: string;
  soql: string;
  tooling: boolean;
  createdAt: number;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export const DEFAULT_SOQL = "SELECT Id, Name, CreatedDate\nFROM Account\nORDER BY CreatedDate DESC\nLIMIT 50";

// Tabs are remembered per org; results live in memory for the session.
export const tabs = persisted<QueryTab[]>(`sie.query.tabs.${host}`, [{ id: uid(), soql: DEFAULT_SOQL, tooling: false, all: false }], 400);
export const activeTabId = persisted<string>(`sie.query.active.${host}`, "");
export const runs = signal<Record<string, QueryRun>>({});
export const history = persisted<HistoryEntry[]>(`sie.query.history.${host}`, []);
export const saved = persisted<SavedQuery[]>("sie.query.saved", []);
export const sidePanel = persisted<"history" | "saved" | null>("sie.query.panel", "history");

export const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? tabs.value[0]);

export function updateTab(id: string, patch: Partial<QueryTab>) {
  tabs.value = tabs.value.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

/**
 * Text changes that come from outside the editor (history, format, links). The editor applies these
 * imperatively; it never syncs back from props, which raced with fast typing and could loop.
 */
export const externalEdit = signal<{ tabId: string; soql: string; n: number } | null>(null);
let editSeq = 0;
export function setTabSoql(id: string, soql: string, extra: Partial<QueryTab> = {}) {
  updateTab(id, { ...extra, soql });
  externalEdit.value = { tabId: id, soql, n: ++editSeq };
}

export const NEW_TAB_SOQL = "SELECT Id\nFROM ";

export function newTab(soql = NEW_TAB_SOQL, tooling = false) {
  const t: QueryTab = { id: uid(), soql, tooling, all: false };
  tabs.value = [...tabs.value, t];
  activeTabId.value = t.id;
  return t;
}

export function closeTab(id: string) {
  const list = tabs.value;
  if (list.length === 1) {
    setTabSoql(id, "");
    return;
  }
  const idx = list.findIndex((t) => t.id === id);
  const next = list.filter((t) => t.id !== id);
  tabs.value = next;
  if (activeTabId.value === id || !next.some((t) => t.id === activeTabId.value)) activeTabId.value = next[Math.max(0, idx - 1)].id;
  const r = { ...runs.value };
  delete r[id];
  runs.value = r;
}

export function setRun(id: string, run: QueryRun | ((prev: QueryRun | undefined) => QueryRun)) {
  runs.value = { ...runs.value, [id]: typeof run === "function" ? run(runs.value[id]) : run };
}

export function addHistory(e: HistoryEntry) {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  history.value = [e, ...history.value.filter((h) => norm(h.soql) !== norm(e.soql) || h.tooling !== e.tooling)].slice(0, 150);
}

export function saveQuery(name: string, soql: string, tooling: boolean) {
  const q: SavedQuery = { id: uid(), name, soql, tooling, createdAt: Date.now() };
  saved.value = [q, ...saved.value];
  return q;
}
