import { signal } from "@preact/signals";

export type ThemePref = "system" | "light" | "dark";
const KEY = "sie.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

export const themePref = signal<ThemePref>(readPref());
export const resolvedTheme = signal<"light" | "dark">("light");

function apply() {
  const dark = themePref.value === "dark" || (themePref.value === "system" && media.matches);
  resolvedTheme.value = dark ? "dark" : "light";
  document.documentElement.dataset.theme = resolvedTheme.value;
}

export function setTheme(pref: ThemePref) {
  themePref.value = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
  // Mirror to chrome.storage so the in-page launcher (a content script) can follow along.
  if (typeof chrome !== "undefined" && chrome.storage?.local) chrome.storage.local.set({ [KEY]: pref });
  apply();
}

export function cycleTheme() {
  const order: ThemePref[] = ["system", "light", "dark"];
  setTheme(order[(order.indexOf(themePref.value) + 1) % order.length]);
}

export function initTheme() {
  apply();
  media.addEventListener("change", apply);
  // Keep every open extension page in sync.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      themePref.value = readPref();
      apply();
    }
  });
}
