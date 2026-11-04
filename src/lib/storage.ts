import { signal, type Signal } from "@preact/signals";

// chrome.storage.local with a localStorage fallback so pages also work outside the extension.
const hasChromeStorage = typeof chrome !== "undefined" && !!chrome.storage?.local;

export async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    if (hasChromeStorage) {
      const got = await chrome.storage.local.get(key);
      return (got[key] as T) ?? fallback;
    }
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export async function save<T>(key: string, value: T): Promise<void> {
  try {
    if (hasChromeStorage) await chrome.storage.local.set({ [key]: value });
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("storage save failed", key, e);
  }
}

/**
 * A signal backed by storage. Writes are debounced; changes made in other extension pages
 * (e.g. the popup) flow back in through storage.onChanged.
 */
export function persisted<T>(key: string, initial: T, debounceMs = 250): Signal<T> & { ready: Promise<void> } {
  const s = signal(initial) as Signal<T> & { ready: Promise<void> };
  let loaded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ownWrites: string[] = [];
  s.ready = load(key, initial).then((v) => {
    s.value = v;
    loaded = true;
  });
  s.subscribe((v) => {
    if (!loaded) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const json = JSON.stringify(v);
      ownWrites.push(json);
      if (ownWrites.length > 20) ownWrites.shift();
      save(key, v);
    }, debounceMs);
  });
  if (hasChromeStorage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !(key in changes)) return;
      const next = changes[key].newValue as T;
      const json = JSON.stringify(next);
      const mine = ownWrites.indexOf(json);
      if (mine >= 0) {
        ownWrites.splice(0, mine + 1);
        return;
      }
      if (json === JSON.stringify(s.peek())) return;
      s.value = next ?? initial;
    });
  }
  return s;
}
