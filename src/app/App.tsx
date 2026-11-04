import { useSignalEffect } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { Cloud, KeyRound, RefreshCw } from "lucide-preact";
import { connectOrg, loadRecentOrgs, orgError, orgState, type RecentOrg } from "../lib/org";
import { SfError, sessionExpired } from "../lib/sf";
import { Button, Callout, Empty, EnvBadge, Spinner, Toasts, isTyping } from "../ui";
import { Palette, paletteOpen } from "./Palette";
import { appUrl, host, navigate, route } from "./router";
import { Header, Rail } from "./Shell";
import { InspectorPage } from "./pages/inspector/InspectorPage";
import { QueryPage } from "./pages/query/QueryPage";
import { LimitsPage } from "./pages/limits/LimitsPage";

let pendingG = 0;

export function App() {
  useEffect(() => {
    if (!host) return;
    connectOrg(host).then(
      (s) => (orgState.value = s),
      (e) => (orgError.value = e),
    );
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        paletteOpen.value = !paletteOpen.value;
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target) && !document.querySelector("dialog[open]")) {
        // "g" then o / q / l jumps between tools (Alt+number is taken by the browser on Linux/Windows).
        if (pendingG && Date.now() - pendingG < 900) {
          const dest = { o: "#/inspect", q: "#/query", l: "#/limits" }[e.key.toLowerCase()];
          pendingG = 0;
          if (dest) {
            e.preventDefault();
            navigate(dest);
          }
        } else if (e.key === "g") pendingG = Date.now();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useSignalEffect(() => {
    const titles = { inspect: "Objects", query: "Query", limits: "Org Limits" };
    const st = orgState.value;
    const r = route.value;
    // Object and record views set their own, more specific title.
    if (r.page === "inspect" && r.parts.length) return;
    const org = st?.org?.Name;
    document.title = `${st?.env === "production" ? "[PROD] " : ""}${titles[r.page]}${org ? " · " + org : ""} — Inspector`;
  });

  if (!host) return <NoOrg />;
  if (orgError.value) return <ConnectError error={orgError.value} />;
  if (!orgState.value) return <Booting />;

  const page = route.value.page;
  return (
    <div class="shell">
      <Header />
      <Rail />
      <main class="main">
        {sessionExpired.value && (
          <div class="main__banner">
            <Callout
              tone="warning"
              title="Your Salesforce session has expired"
              action={
                <Button size="sm" onClick={() => location.reload()}>
                  <RefreshCw /> Reload
                </Button>
              }
            >
              Log in to the org again in a Salesforce tab, then reload this page.
            </Callout>
          </div>
        )}
        {page === "inspect" && <InspectorPage />}
        {page === "query" && <QueryPage />}
        {page === "limits" && <LimitsPage />}
      </main>
      {paletteOpen.value && <Palette />}
      <Toasts />
    </div>
  );
}

function Booting() {
  return (
    <div class="boot">
      <img src="./icons/icon48.png" width={40} height={40} alt="" />
      <div class="row">
        <Spinner small /> <span class="muted">Connecting to {host}…</span>
      </div>
    </div>
  );
}

function ConnectError({ error }: { error: Error }) {
  const noSession = error instanceof SfError && (error.isSessionError || error.errorCode === "NO_SESSION");
  return (
    <div class="boot">
      <Empty
        error
        icon={<KeyRound />}
        title={noSession ? "Not signed in to this org" : "Couldn't connect to the org"}
        action={
          <div class="row" style={{ justifyContent: "center" }}>
            <Button variant="primary" onClick={() => window.open(`https://${host.replace(/\.my\.salesforce\.com$/, ".lightning.force.com")}/`, "_blank")}>
              Open Salesforce
            </Button>
            <Button onClick={() => location.reload()}>
              <RefreshCw /> Retry
            </Button>
          </div>
        }
      >
        {noSession ? (
          <>
            Inspector uses your existing browser session. Log in to <span class="mono">{host}</span> in a Salesforce tab, then retry.
          </>
        ) : (
          error.message
        )}
      </Empty>
    </div>
  );
}

function NoOrg() {
  const [recent, setRecent] = useState<RecentOrg[] | null>(null);
  useEffect(() => {
    loadRecentOrgs().then(setRecent);
  }, []);
  return (
    <div class="boot">
      <div class="noorg card">
        <div class="noorg__head">
          <img src="./icons/icon48.png" width={36} height={36} alt="" />
          <div>
            <div class="noorg__title">Choose an org</div>
            <div class="muted">Open Inspector from a Salesforce tab, or pick a recently used org.</div>
          </div>
        </div>
        {recent === null ? (
          <div class="row" style={{ padding: 16 }}>
            <Spinner small />
          </div>
        ) : recent.length === 0 ? (
          <Empty icon={<Cloud />} title="No orgs yet">
            Open any Salesforce page and click the Inspector icon in the toolbar.
          </Empty>
        ) : (
          <div class="noorg__list">
            {recent.map((o) => (
              <a class="noorg__item" href={appUrl(o.host, "#/inspect")} key={o.host}>
                <div class="grow">
                  <div class="noorg__name">{o.name}</div>
                  <div class="mono muted truncate">{o.host}</div>
                </div>
                <EnvBadge env={o.env} />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
