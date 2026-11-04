import { useEffect } from "preact/hooks";

// Pages with unsaved, unrecoverable work (e.g. a running import) register a guard. Navigating
// inside the app asks first; closing the tab triggers the browser's own prompt; and the popup /
// side panel won't reuse this tab for something else while it's busy.
const guards = new Set<() => string>();

/** Ask the user before leaving; true means it's fine to go. */
export function confirmLeave(): boolean {
  for (const g of guards) if (!window.confirm(g())) return false;
  return true;
}

let tabIdPromise: Promise<number | undefined> | null = null;
const currentTabId = () => (tabIdPromise ??= chrome.tabs?.getCurrent?.().then((t) => t?.id).catch(() => undefined) ?? Promise.resolve(undefined));
export const busyKey = (tabId: number) => `sie.busy.${tabId}`;

export function useLeaveGuard(active: boolean, message: string) {
  useEffect(() => {
    if (!active) return;
    const g = () => message;
    guards.add(g);
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    currentTabId().then((id) => {
      if (id != null) chrome.storage?.session?.set({ [busyKey(id)]: message });
    });
    return () => {
      guards.delete(g);
      window.removeEventListener("beforeunload", onUnload);
      if (!guards.size)
        currentTabId().then((id) => {
          if (id != null) chrome.storage?.session?.remove(busyKey(id));
        });
    };
  }, [active, message]);
}
