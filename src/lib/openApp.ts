/**
 * Open an Inspector page, reusing the org's existing Inspector tab unless a new one is requested.
 * Works from the popup and the background worker. runtime.getContexts lists our own extension tabs
 * without needing the broad "tabs" permission. Staged edits survive the reuse (they're kept per tab
 * in sessionStorage), so switching the tab's page is safe.
 */
export async function openAppTab(url: string, opts: { forceNew?: boolean; index?: number } = {}): Promise<void> {
  if (!opts.forceNew) {
    const want = new URL(url);
    const contexts = (await chrome.runtime.getContexts?.({ contextTypes: [chrome.runtime.ContextType.TAB] }).catch(() => [])) ?? [];
    const existing = contexts.find((c) => c.documentUrl?.startsWith(chrome.runtime.getURL("app.html")) && new URL(c.documentUrl).searchParams.get("host") === want.searchParams.get("host"));
    if (existing && existing.tabId >= 0) {
      await chrome.tabs.update(existing.tabId, { url, active: true });
      if (existing.windowId >= 0) await chrome.windows?.update(existing.windowId, { focused: true });
      return;
    }
  }
  await chrome.tabs.create({ url, index: opts.index });
}
