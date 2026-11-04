import { getSession, resolveApiHost } from "../lib/auth";
import { parsePageContext } from "../lib/context";
import { openAppTab } from "../lib/openApp";

// Content scripts cannot read cookies, so the background answers their session questions.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "sie:resolveHost") {
    resolveApiHost(msg.url ?? sender.tab?.url ?? "").then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg?.type === "sie:hasSession") {
    getSession(msg.host).then((s) => sendResponse(!!s), () => sendResponse(false));
    return true;
  }
  if (msg?.type === "sie:openApp") {
    chrome.tabs.create({ url: chrome.runtime.getURL(msg.path), index: sender.tab ? sender.tab.index + 1 : undefined });
    return false;
  }
  return false;
});

// "Toolbar icon opens": the popup (default) or Chrome's side panel.
async function applyActionMode() {
  const { "sie.actionMode": mode } = await chrome.storage.local.get("sie.actionMode");
  const panel = mode === "panel";
  await chrome.action.setPopup({ popup: panel ? "" : "popup.html" });
  await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: panel }).catch(() => {});
}
applyActionMode();
chrome.runtime.onInstalled.addListener(applyActionMode);
chrome.runtime.onStartup?.addListener(applyActionMode);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "sie.actionMode" in changes) applyActionMode();
});

// Keyboard shortcuts (configurable at chrome://extensions/shortcuts).
chrome.commands?.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-side-panel") {
    // Must be called synchronously from the user gesture, before any await.
    if (tab?.windowId != null) chrome.sidePanel?.open({ windowId: tab.windowId }).catch(() => {});
    return;
  }
  if (!tab?.url) return;
  const host = await resolveApiHost(tab.url);
  if (!host) return;
  let hash = "#/inspect";
  if (command === "inspect-page") {
    const ctx = parsePageContext(tab.url);
    if (ctx.recordId) hash = ctx.objectName ? `#/inspect/${ctx.objectName}/${ctx.recordId}` : `#/inspect/_/${ctx.recordId}`;
    else if (ctx.objectName) hash = `#/inspect/${ctx.objectName}`;
  } else if (command === "open-query") hash = "#/query";
  else if (command === "open-limits") hash = "#/limits";
  await openAppTab(chrome.runtime.getURL(`app.html?host=${encodeURIComponent(host)}${hash}`), { index: tab.index + 1 });
});
