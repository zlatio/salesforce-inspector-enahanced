// In-page launcher: a small tab on the right edge of Salesforce pages that opens the Inspector
// popup as a floating panel. Everything lives in a shadow root so Salesforce styles can't leak in.

const SF_SELECTORS = "body.sfdcBody, body.ApexCSIPage, #auraLoadingBox, #studioBody, #flowContainer, one-appnav, .slds-global-header, force-aloha-page";
const POS_KEY = "sie.launcher.top";

function whenSalesforce(cb: () => void) {
  if (document.querySelector(SF_SELECTORS)) return cb();
  const obs = new MutationObserver(() => {
    if (document.querySelector(SF_SELECTORS)) {
      obs.disconnect();
      cb();
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 20000);
}

const ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="m15.5 15.5 4.5 4.5"/><path d="M10.5 8v5M8 10.5h5" stroke-width="2"/></svg>`;

const LAUNCHER_CSS = `
:host { all: initial; }
.tab {
  position: fixed; right: 0; z-index: 2147483000;
  width: 26px; height: 44px; padding: 0 0 0 3px;
  display: grid; place-items: center;
  border: 0; border-radius: 10px 0 0 10px; cursor: pointer;
  color: #fff; background: linear-gradient(160deg, #8b6cf6, #5a32c8);
  box-shadow: 0 2px 10px rgba(60, 30, 140, .35), inset 0 1px 0 rgba(255,255,255,.18);
  opacity: .72; transform: translateX(4px);
  transition: opacity .15s ease, transform .15s ease, width .15s ease;
}
.tab:hover, .tab.open, .tab:focus-visible { opacity: 1; transform: none; width: 30px; outline: none; }
.tab:focus-visible { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #5a32c8; }
.tab.dragging { cursor: grabbing; transition: none; opacity: 1; }
.panel {
  position: fixed; right: 40px; z-index: 2147483001;
  width: 380px; height: min(580px, calc(100vh - 24px));
  border-radius: 14px; overflow: hidden;
  border: 1px solid rgba(120,120,140,.28);
  box-shadow: 0 24px 60px -12px rgba(15,15,30,.45), 0 8px 20px -8px rgba(15,15,30,.3);
  background: #fff;
  animation: in .16s cubic-bezier(.2,.8,.2,1);
}
.panel iframe { width: 100%; height: 100%; border: 0; display: block; color-scheme: normal; }
@keyframes in { from { opacity: 0; transform: translateX(8px) scale(.985); } }
@media (prefers-reduced-motion: reduce) { .panel { animation: none; } .tab { transition: none; } }
`;

function mount(sfHost: string) {
  const host = document.createElement("div");
  host.id = "sie-launcher";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${LAUNCHER_CSS}</style><button class="tab" type="button" aria-label="Salesforce Inspector" aria-expanded="false" aria-haspopup="dialog" title="Salesforce Inspector — click to open, drag to move (Alt+↑/↓ moves it)">${ICON}</button>`;
  const tab = root.querySelector<HTMLButtonElement>(".tab")!;
  let panel: HTMLDivElement | null = null;
  let top = 0.4;
  let panelHeight = 580;

  const place = () => {
    const y = Math.round(Math.min(window.innerHeight - 56, Math.max(8, top * window.innerHeight)));
    tab.style.top = y + "px";
    if (panel) {
      const h = Math.min(panelHeight, window.innerHeight - 24);
      panel.style.height = h + "px";
      panel.style.top = Math.round(Math.min(window.innerHeight - h - 12, Math.max(12, y - 120))) + "px";
    }
  };

  const close = (refocus = true) => {
    if (!panel) return;
    panel.remove();
    panel = null;
    tab.classList.remove("open");
    tab.setAttribute("aria-expanded", "false");
    if (refocus) tab.focus();
  };
  const open = () => {
    panel = document.createElement("div");
    panel.className = "panel";
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL(`popup.html?embedded=1&host=${encodeURIComponent(sfHost)}&url=${encodeURIComponent(location.href)}&title=${encodeURIComponent(document.title)}`);
    iframe.title = "Salesforce Inspector";
    iframe.allow = "clipboard-write";
    panel.appendChild(iframe);
    root.appendChild(panel);
    tab.classList.add("open");
    tab.setAttribute("aria-expanded", "true");
    place();
    iframe.addEventListener("load", () => iframe.focus());
  };

  // A vertical drag repositions the tab (remembered); a plain click or Enter/Space toggles the panel.
  let justDragged = false;
  tab.addEventListener("pointerdown", (e) => {
    const startY = e.clientY;
    let dragged = false;
    tab.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!dragged && Math.abs(ev.clientY - startY) < 5) return;
      dragged = true;
      tab.classList.add("dragging");
      top = Math.min(0.95, Math.max(0.02, (ev.clientY - 22) / window.innerHeight));
      place();
    };
    const up = () => {
      tab.removeEventListener("pointermove", move);
      tab.removeEventListener("pointerup", up);
      tab.classList.remove("dragging");
      justDragged = dragged;
      if (dragged) chrome.storage.local.set({ [POS_KEY]: top });
    };
    tab.addEventListener("pointermove", move);
    tab.addEventListener("pointerup", up);
  });
  tab.addEventListener("click", () => {
    if (justDragged) return void (justDragged = false);
    if (panel) close();
    else open();
  });
  tab.addEventListener("keydown", (e) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    top = Math.min(0.95, Math.max(0.02, top + (e.key === "ArrowUp" ? -0.04 : 0.04)));
    place();
    chrome.storage.local.set({ [POS_KEY]: top });
  });

  const extOrigin = new URL(chrome.runtime.getURL("")).origin;
  window.addEventListener("message", (e) => {
    if (e.origin !== extOrigin) return;
    if (e.data?.type === "sie:close") close();
    if (e.data?.type === "sie:height" && typeof e.data.h === "number") {
      panelHeight = Math.max(200, Math.min(640, e.data.h + 2));
      place();
    }
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && panel && close());
  document.addEventListener("mousedown", (e) => panel && !e.composedPath().includes(host) && close(false));
  window.addEventListener("resize", place);

  chrome.storage.local.get([POS_KEY, "sie.launcher"], (v) => {
    if (typeof v[POS_KEY] === "number") top = v[POS_KEY];
    // Opt-in: the toolbar popup is the primary entry point; the in-page tab is enabled from its footer.
    host.style.display = v["sie.launcher"] === true ? "" : "none";
    place();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && "sie.launcher" in ch) {
      const on = ch["sie.launcher"].newValue === true;
      host.style.display = on ? "" : "none";
      if (!on) close(false);
    }
  });

  document.documentElement.appendChild(host);
}

if (window.top === window && !document.getElementById("sie-launcher")) {
  whenSalesforce(() => {
    chrome.runtime.sendMessage({ type: "sie:resolveHost", url: location.href }, (h: string | null) => {
      if (chrome.runtime.lastError || !h) return;
      mount(h);
    });
  });
}

export {};
