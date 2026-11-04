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

// Keyboard shortcuts (configurable at chrome://extensions/shortcuts).
chrome.commands?.onCommand.addListener(async (command, tab) => {
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
