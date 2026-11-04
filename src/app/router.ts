import { signal } from "@preact/signals";
import { confirmLeave } from "./leaveGuard";

export type PageId = "inspect" | "query" | "limits" | "users" | "import";

export interface Route {
  page: PageId;
  parts: string[];
  params: URLSearchParams;
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // malformed % escape
  }
};

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path, qs = ""] = raw.split("?");
  const segs = path.split("/").filter(Boolean).map(decode);
  const page = (["inspect", "query", "limits", "users", "import"].includes(segs[0]) ? segs[0] : "inspect") as PageId;
  return { page, parts: segs.slice(1), params: new URLSearchParams(qs) };
}

export const route = signal<Route>(parse(location.hash));
let lastHash = location.hash;
window.addEventListener("hashchange", () => {
  const next = parse(location.hash);
  const cur = route.value;
  // Moving to another page or record may need confirmation (e.g. an import is running).
  const leaving = next.page !== cur.page || next.parts.join("/") !== cur.parts.join("/");
  if (leaving && !confirmLeave()) {
    history.replaceState(null, "", lastHash);
    return;
  }
  lastHash = location.hash;
  route.value = next;
});

export function navigate(hash: string, replace = false) {
  const h = hash.startsWith("#") ? hash : "#" + hash;
  if (replace) {
    history.replaceState(null, "", h);
    lastHash = h;
    route.value = parse(h);
  } else location.hash = h;
}

export const host = new URLSearchParams(location.search).get("host") ?? "";

export const links = {
  objects: () => "#/inspect",
  object: (name: string) => `#/inspect/${encodeURIComponent(name)}`,
  record: (name: string, id: string) => `#/inspect/${encodeURIComponent(name)}/${id}`,
  id: (id: string) => `#/inspect/_/${id}`,
  query: (soql?: string, tooling?: boolean) => "#/query" + (soql ? `?q=${encodeURIComponent(soql)}${tooling ? "&tooling=1" : ""}` : ""),
  limits: () => "#/limits",
  users: (q?: string) => "#/users" + (q ? `?q=${encodeURIComponent(q)}` : ""),
  user: (id: string) => `#/users/${id}`,
  import: (object?: string) => "#/import" + (object ? `?object=${encodeURIComponent(object)}` : ""),
};

/** Absolute URL to an app page for a given org (for opening in a new tab). */
export function appUrl(h: string, hash: string) {
  const base = typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL("app.html") : "app.html";
  return `${base}?host=${encodeURIComponent(h)}${hash.startsWith("#") ? hash : "#" + hash}`;
}
