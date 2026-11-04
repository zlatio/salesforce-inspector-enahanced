import { useEffect, useMemo, useState } from "preact/hooks";
import { AlertOctagon, AlertTriangle, BadgeCheck, CalendarClock, ChevronRight, Database, ExternalLink, FileStack, Gauge, IdCard, RefreshCw, Rows3, Search, Users, Zap } from "lucide-preact";
import { orgState } from "../../../lib/org";
import { load, save } from "../../../lib/storage";
import type { LimitValue, LimitsResult } from "../../../lib/types";
import { fmtCompact, fmtDate, fmtNumber, fmtPercent, fmtRelative, humanizeKey } from "../../../lib/format";
import { Badge, Button, Callout, Empty, Meter, SearchInput, Seg, Spinner, Switch, onTablistKey } from "../../../ui";
import { apiSamplesKey, apiUsage, type ApiSample } from "../../../lib/sf";
import { Sparkline, TrendChart, type Point } from "../../../ui/charts";
import { links, route, navigate } from "../../router";
import { NOISE_OBJECT } from "../../../lib/queries";
import "./limits.css";

interface Row {
  key: string;
  label: string;
  max: number;
  used: number;
  remaining: number;
  pct: number;
  category: string;
  subs: Row[];
}

interface Snapshot {
  at: number;
  u: Record<string, number>;
}

const CATEGORIES: Array<[string, RegExp]> = [
  ["API & integration", /Api|Bulk|OData|Callout|IdMapping|ManagedContentPublicRequests|Functions|Request/i],
  ["Storage", /StorageMB|DataSizeMB|Storage/i],
  ["Async & automation", /Async|Apex|Workflow|Flow|Batch|TimeBased|Dataflow/i],
  ["Events & streaming", /Event|Streaming|CometD/i],
  ["Email", /Email/i],
  ["Reports & dashboards", /Report|Dashboard/i],
  ["Analytics & AI", /Analytics|Einstein|Cdp|Ai\b|Prediction/i],
  ["Development", /Scratch|Package|PermissionSets|Sandbox/i],
  ["Content", /Content/i],
];
const categoryOf = (k: string) => CATEGORIES.find(([, re]) => re.test(k))?.[0] ?? "Other";

const LABEL_OVERRIDES: Record<string, string> = {
  DataStorageMB: "Data storage",
  FileStorageMB: "File storage",
  DailyApiRequests: "Daily API requests",
  DailyAsyncApexExecutions: "Daily async Apex executions",
  DailyBulkApiBatches: "Daily Bulk API batches",
  DailyBulkV2QueryJobs: "Daily Bulk API 2.0 query jobs",
  DailyBulkV2QueryFileStorageMB: "Daily Bulk API 2.0 query storage (MB)",
  SingleEmail: "Single emails",
  MassEmail: "Mass emails",
  HourlyODataCallout: "Hourly OData callouts",
};
const labelOf = (k: string) => LABEL_OVERRIDES[k] ?? sentence(humanizeKey(k));
function sentence(s: string) {
  return s
    .split(" ")
    .map((w, i) => (i === 0 || /^[A-Z0-9]{2,}$/.test(w) || /\(/.test(w) ? w : w.toLowerCase()))
    .join(" ")
    .replace(/\bapi\b/gi, "API")
    .replace(/\bapex\b/g, "Apex")
    .replace(/\bo data\b/gi, "OData")
    .replace(/\bbulk v2\b/gi, "Bulk API 2.0")
    .replace(/\bcdp\b/gi, "CDP")
    .replace(/\bai\b/gi, "AI")
    .replace(/\beinstein\b/gi, "Einstein")
    .replace(/\bmb\b/gi, "MB")
    .replace(/\bid\b/gi, "ID");
}

function toRows(res: LimitsResult): Row[] {
  const mk = (key: string, v: LimitValue, parent?: string): Row => {
    const max = v.Max ?? 0;
    const remaining = v.Remaining ?? 0;
    const used = Math.max(0, max - remaining);
    const subs = Object.entries(v)
      .filter(([k, x]) => k !== "Max" && k !== "Remaining" && x && typeof x === "object")
      .map(([k, x]) => mk(k, x as LimitValue, key))
      .filter((r) => r.max > 0 || r.used > 0)
      .sort((a, b) => b.used - a.used);
    return { key, label: parent ? key : labelOf(key), max, used, remaining, pct: max > 0 ? (used / max) * 100 : 0, category: categoryOf(parent ?? key), subs };
  };
  return Object.entries(res)
    .map(([k, v]) => mk(k, v))
    .filter((r) => r.max > 0);
}

const REFRESH_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "30", label: "30s" },
  { value: "60", label: "1m" },
  { value: "300", label: "5m" },
];

type Tab = "limits" | "licenses" | "records";



interface License {
  Id: string;
  Name?: string;
  MasterLabel: string;
  Status: string;
  TotalLicenses: number;
  UsedLicenses: number;
  ExpirationDate?: string | null;
}
interface LicenseData {
  user: License[] | string;
  psl: License[] | string;
}

interface Attention {
  key: string;
  source: "Limit" | "User license" | "Permission set license";
  label: string;
  detail: string;
  pct: number;
  level: "critical" | "warning";
  note?: string;
  /** What to do about it: a query to run or a Setup page to open. */
  action?: { label: string; query?: string; url?: string };
}

const SETUP_FOR_LIMIT: Record<string, [string, string]> = {
  DataStorageMB: ["Storage usage", "CompanyResourceDisk/home"],
  FileStorageMB: ["Storage usage", "CompanyResourceDisk/home"],
  DailyAsyncApexExecutions: ["Apex jobs", "AsyncApexJobs/home"],
  DailyApiRequests: ["API usage report", "CompanyProfileInfo/home"],
  DailyWorkflowEmails: ["Email deliverability", "OrgEmailSettings/home"],
  SingleEmail: ["Email deliverability", "OrgEmailSettings/home"],
};

const sev = (pct: number) => (pct >= 90 ? "critical" : pct >= 75 ? "warning" : null);

export function SeverityIcon({ pct }: { pct: number }) {
  const s = sev(pct);
  if (!s) return null;
  return s === "critical" ? <AlertOctagon class="sev sev--critical" aria-label="Critical" /> : <AlertTriangle class="sev sev--warning" aria-label="Warning" />;
}

export function LimitsPage() {
  const st = orgState.value!;
  const sf = st.sf;
  const snapKey = `sie.limits.snap.${sf.host}`;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [licenses, setLicenses] = useState<LicenseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [apiSamples, setApiSamples] = useState<ApiSample[]>([]);
  // Every API response updates the usage reading; fold it into the trend live instead of waiting for a refresh.
  useEffect(
    () =>
      apiUsage.subscribe((u) => {
        if (!u) return;
        setApiSamples((prev) => {
          const last = prev[prev.length - 1];
          if (last && (last.v === u.used || u.at - last.at < 15_000)) return prev;
          return [...prev, { at: u.at, v: u.used }];
        });
      }),
    [],
  );
  const [refresh, setRefresh] = useState(() => localStorage.getItem("sie.limits.refresh") ?? "0");
  const [, tick] = useState(0);
  const tab = (route.value.params.get("tab") as Tab) || "limits";

  const fetchLicenses = async () => {
    const [u, p] = await Promise.allSettled([
      sf.queryAllRecords<License>("SELECT Id, Name, MasterLabel, Status, TotalLicenses, UsedLicenses FROM UserLicense ORDER BY MasterLabel"),
      sf.queryAllRecords<License>("SELECT Id, MasterLabel, Status, TotalLicenses, UsedLicenses, ExpirationDate FROM PermissionSetLicense ORDER BY MasterLabel"),
    ]);
    setLicenses({ user: u.status === "fulfilled" ? u.value : (u.reason as Error).message, psl: p.status === "fulfilled" ? p.value : (p.reason as Error).message });
  };

  const fetchLimits = async () => {
    setLoading(true);
    try {
      const [res] = await Promise.all([sf.limits(), fetchLicenses()]);
      const r = toRows(res);
      setRows(r);
      setError(null);
      const now = Date.now();
      setUpdatedAt(now);
      const prev = await load<Snapshot[]>(snapKey, []);
      const last = prev[prev.length - 1];
      const snap: Snapshot = { at: now, u: Object.fromEntries(r.map((x) => [x.key, x.used])) };
      const next = (last && now - last.at < 50_000 ? [...prev.slice(0, -1), snap] : [...prev, snap]).filter((s) => now - s.at < 7 * 86400_000).slice(-400);
      setSnaps(next);
      save(snapKey, next);
      setApiSamples(await load<ApiSample[]>(apiSamplesKey(sf.host), []));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLimits();
  }, []);

  useEffect(() => {
    localStorage.setItem("sie.limits.refresh", refresh);
    const s = Number(refresh);
    if (!s) return;
    const id = setInterval(fetchLimits, s * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const series = (key: string): Point[] => {
    const pts = snaps.filter((s) => key in s.u).map((s) => ({ at: s.at, v: s.u[key] }));
    // Daily API requests also gets a sample from every API call any Inspector page makes.
    if (key === "DailyApiRequests") pts.push(...apiSamples.map((s) => ({ at: s.at, v: s.v })));
    return pts.sort((a, b) => a.at - b.at);
  };
  const byKey = useMemo(() => new Map((rows ?? []).map((r) => [r.key, r])), [rows]);

  const attention = useMemo<Attention[]>(() => {
    const out: Attention[] = [];
    for (const r of rows ?? []) {
      const s = sev(r.pct);
      const setup = SETUP_FOR_LIMIT[r.key];
      if (s)
        out.push({
          key: "l:" + r.key,
          source: "Limit",
          label: r.label,
          detail: `${fmtNumber(r.used)} / ${fmtNumber(r.max)}`,
          pct: r.pct,
          level: s,
          action: setup ? { label: setup[0], url: `https://${sf.lightningHost}/lightning/setup/${setup[1]}` } : undefined,
        });
    }
    const lic = (list: License[] | string | undefined, source: Attention["source"]) => {
      if (!Array.isArray(list)) return;
      for (const l of list) {
        if (l.Status !== "Active" || l.TotalLicenses <= 0) continue;
        const pct = (l.UsedLicenses / l.TotalLicenses) * 100;
        const s = sev(pct);
        // Tiny allocations (e.g. 1 of 1 integration user) are normally full on purpose.
        const full = s && l.TotalLicenses > 2 ? s : null;
        const days = l.ExpirationDate ? Math.round((Date.parse(l.ExpirationDate) - Date.now()) / 86400_000) : null;
        const expiring = days != null && days >= 0 && days <= 60 && l.UsedLicenses > 0 ? (days <= 14 ? "critical" : "warning") : null;
        if (!full && !expiring) continue;
        // Reclaiming licenses starts with who holds them, least recently active first.
        const query =
          source === "User license"
            ? `SELECT Id, Name, Username, Profile.Name, LastLoginDate FROM User WHERE IsActive = true AND Profile.UserLicenseId = '${l.Id}' ORDER BY LastLoginDate ASC NULLS FIRST`
            : `SELECT Id, Assignee.Name, Assignee.Username, Assignee.IsActive, Assignee.LastLoginDate FROM PermissionSetLicenseAssign WHERE PermissionSetLicenseId = '${l.Id}' ORDER BY Assignee.LastLoginDate ASC NULLS FIRST`;
        out.push({
          key: source + l.Id,
          source,
          label: l.MasterLabel,
          detail: `${fmtNumber(l.UsedLicenses)} / ${fmtNumber(l.TotalLicenses)} assigned`,
          pct,
          level: full === "critical" || expiring === "critical" ? "critical" : "warning",
          note: expiring ? `Expires ${fmtDate(l.ExpirationDate!)} (${days === 0 ? "today" : `in ${days} days`})` : undefined,
          action: { label: "Who has it", query },
        });
      }
    };
    lic(licenses?.user, "User license");
    lic(licenses?.psl, "Permission set license");
    return out.sort((a, b) => (a.level === b.level ? b.pct - a.pct : a.level === "critical" ? -1 : 1));
  }, [rows, licenses]);

  const licenseAlerts = attention.filter((a) => a.source !== "Limit").length;
  const setTab = (t: Tab) => navigate(t === "limits" ? "#/limits" : `#/limits?tab=${t}`, true);

  return (
    <div class="page">
      <div class="page__body">
        <div class="page__head">
          <div class="grow">
            <h1 class="page__title">Org limits & usage</h1>
            <div class="page__subtitle">
              {st.org && (
                <>
                  <span>{st.org.OrganizationType}</span>
                  <span aria-hidden="true">·</span>
                  <span>Instance {st.org.InstanceName}</span>
                  <span aria-hidden="true">·</span>
                  <span>Created {fmtDate(st.org.CreatedDate)}</span>
                  {st.org.TrialExpirationDate && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Expires {fmtDate(st.org.TrialExpirationDate)}</span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <div class="page__actions">
            <div class="row" style={{ gap: 6 }}>
              <span class="muted" style={{ fontSize: "var(--fs-sm)" }} id="autorefresh-label">
                Auto-refresh
              </span>
              <Seg label="Auto-refresh interval" value={refresh} onChange={setRefresh} options={REFRESH_OPTIONS} />
            </div>
            <span class="actions__sep" aria-hidden="true" />
            <span class="muted refresh-label" aria-live="polite">
              {updatedAt ? `Updated ${fmtRelative(updatedAt)}` : ""}
            </span>
            <Button size="sm" onClick={fetchLimits} disabled={loading}>
              <RefreshCw class={loading ? "spin" : ""} /> Refresh
            </Button>
          </div>
        </div>

        {error && (
          <div class="lpad lgap">
            <Callout tone="danger" title="Couldn't load limits">
              {error}
            </Callout>
          </div>
        )}

        <div class="kpis lpad">
          <Kpi icon={<Zap />} title="Daily API requests" sub="Rolling 24 hours" row={byKey.get("DailyApiRequests")} points={series("DailyApiRequests")} loading={!rows} />
          <Kpi icon={<Database />} title="Data storage" row={byKey.get("DataStorageMB")} points={series("DataStorageMB")} unit="MB" loading={!rows} />
          <Kpi icon={<FileStack />} title="File storage" row={byKey.get("FileStorageMB")} points={series("FileStorageMB")} unit="MB" loading={!rows} />
          <Kpi icon={<Gauge />} title="Async Apex executions" sub="Rolling 24 hours" row={byKey.get("DailyAsyncApexExecutions")} points={series("DailyAsyncApexExecutions")} loading={!rows} />
        </div>

        {rows && attention.length > 0 && (
          <div class="lpad lgap">
            <section class="attention card" aria-labelledby="attention-title">
              <div class="attention__head">
                <AlertTriangle aria-hidden="true" />
                <span class="card__title" id="attention-title">
                  {attention.length === 1 ? "1 item needs attention" : `${attention.length} items need attention`}
                </span>
                <span class="muted">Limits and licenses at 75% or more, and licenses expiring soon</span>
              </div>
              <div class="attention__list" role="list">
                {attention.map((a) => (
                  <div class={"attention__item" + (a.action ? " has-action" : "")} key={a.key} role="listitem">
                    {a.level === "critical" ? <AlertOctagon class="sev sev--critical" aria-hidden="true" /> : <AlertTriangle class="sev sev--warning" aria-hidden="true" />}
                    <span class="attention__src">{a.source}</span>
                    <span class="grow truncate">
                      <span class="attention__label">{a.label}</span>
                      {a.note && (
                        <span class="attention__note">
                          <CalendarClock aria-hidden="true" /> {a.note}
                        </span>
                      )}
                    </span>
                    <span class="tabular subtle">{a.detail}</span>
                    <Badge tone={a.level === "critical" ? "danger" : "warning"}>
                      {a.level === "critical" ? "Critical" : "Warning"} · {fmtPercent(a.pct)}
                    </Badge>
                    <span class="attention__action">
                      {a.action &&
                        (a.action.query ? (
                          <Button size="sm" variant="ghost" onClick={() => navigate(links.query(a.action!.query))} aria-label={`${a.action.label}: ${a.label}`}>
                            <Users /> {a.action.label}
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => window.open(a.action!.url, "_blank")} aria-label={`${a.action.label} in Setup`}>
                            <ExternalLink /> {a.action.label}
                          </Button>
                        ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        <div class="ltabs lpad-tabs">
          <div class="tabs" role="tablist" aria-label="Limits sections" onKeyDown={onTablistKey}>
            <button class="tab" role="tab" aria-selected={tab === "limits"} tabIndex={tab === "limits" ? 0 : -1} onClick={() => setTab("limits")}>
              <Gauge /> All limits {rows && <span class="tab__count">{rows.length}</span>}
            </button>
            <button class="tab" role="tab" aria-selected={tab === "licenses"} tabIndex={tab === "licenses" ? 0 : -1} onClick={() => setTab("licenses")}>
              <IdCard /> Licenses {licenseAlerts > 0 && <span class="tab__count tab__count--alert">{licenseAlerts}</span>}
            </button>
            <button class="tab" role="tab" aria-selected={tab === "records"} tabIndex={tab === "records" ? 0 : -1} onClick={() => setTab("records")}>
              <Rows3 /> Records by object
            </button>
          </div>
          {rows && attention.length === 0 && (
            <span class="allgood">
              <BadgeCheck aria-hidden="true" /> All limits and licenses are below 75%
            </span>
          )}
        </div>

        {tab === "limits" &&
          (rows ? (
            <LimitsList rows={rows} series={series} />
          ) : (
            <div class="empty">
              <Spinner />
            </div>
          ))}
        {tab === "licenses" &&
          (licenses ? (
            <div class="lpad lbody">
              <LicenseTable title="User licenses" list={licenses.user} />
              <LicenseTable title="Permission set licenses" list={licenses.psl} showExpiry />
            </div>
          ) : (
            <div class="empty">
              <Spinner />
            </div>
          ))}
        {tab === "records" && <RecordCounts />}
      </div>
    </div>
  );
}

/** True when a series has enough samples and actually moves; flat or sparse trends are noise. */
function meaningful(points: Point[]) {
  if (points.length < 3) return false;
  const vs = points.map((p) => p.v);
  return Math.max(...vs) !== Math.min(...vs);
}

function deltaText(points: Point[]) {
  if (points.length < 2) return null;
  const d = points[points.length - 1].v - points[0].v;
  const mins = Math.round((points[points.length - 1].at - points[0].at) / 60000);
  const span = mins < 90 ? `${mins} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`;
  return { d, label: `${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmtNumber(Math.abs(d))} in ${span}` };
}

function Kpi({ icon, title, sub, row, points, unit, loading }: { icon: preact.ComponentChildren; title: string; sub?: string; row?: Row; points: Point[]; unit?: string; loading: boolean }) {
  if (loading)
    return (
      <div class="kpi card">
        <div class="kpi__label">
          {icon} {title}
        </div>
        <div class="skeleton" style={{ width: 120, height: 26, marginTop: 6 }} />
        <div class="skeleton" style={{ width: "100%", height: 8, marginTop: 14 }} />
      </div>
    );
  if (!row)
    return (
      <div class="kpi card is-na">
        <div class="kpi__label">
          {icon} {title}
        </div>
        <div class="kpi__value muted">—</div>
        <div class="muted kpi__foot">Not reported for this org</div>
      </div>
    );
  const fmt = (n: number) => (unit === "MB" ? fmtStorage(n) : n >= 100000 ? fmtCompact(n) : fmtNumber(n));
  const delta = meaningful(points) ? deltaText(points) : null;
  return (
    <div class="kpi card">
      <div class="kpi__label">
        {icon} {title}
        {sub && <span class="kpi__sub">{sub}</span>}
      </div>
      <div class="kpi__value">
        {fmt(row.used)}
        <span class="kpi__of"> of {fmt(row.max)}</span>
      </div>
      <Meter pct={row.pct} large label={title} />
      <div class="kpi__foot">
        <span class={row.pct >= 90 ? "t-danger" : row.pct >= 75 ? "t-warning" : "muted"}>
          <SeverityIcon pct={row.pct} /> {fmtPercent(row.pct)} used · {fmt(row.remaining)} left
        </span>
        {delta && (
          <span class="kpi__trend" title={delta.label}>
            <Sparkline points={points} />
          </span>
        )}
      </div>
    </div>
  );
}

function fmtStorage(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  return `${fmtNumber(mb)} MB`;
}

type LFilter = "all" | "used" | "high";
type LSort = "usage" | "name";

function LimitsList({ rows, series }: { rows: Row[]; series: (k: string) => Point[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<LFilter>("all");
  const [sort, setSort] = useState<LSort>("usage");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter((r) => (filter === "used" ? r.used > 0 : filter === "high" ? r.pct >= 50 : true))
      .filter((r) => !s || r.label.toLowerCase().includes(s) || r.key.toLowerCase().includes(s))
      .sort((a, b) => (sort === "usage" ? b.pct - a.pct || a.label.localeCompare(b.label) : a.label.localeCompare(b.label)));
  }, [rows, q, filter, sort]);

  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of filtered) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    const order = [...CATEGORIES.map((c) => c[0]), "Other"];
    return [...m].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [filtered]);

  const apiPoints = series("DailyApiRequests");
  const api = rows.find((r) => r.key === "DailyApiRequests");
  const toggle = (key: string) => {
    const n = new Set(open);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    setOpen(n);
  };

  return (
    <div class="lpad lbody">
      {api && (
        <div class="card trendcard">
          <div class="card__head">
            <span class="card__title">Daily API requests</span>
            <span class="muted trendcard__meta">
              {meaningful(apiPoints)
                ? `${deltaText(apiPoints)!.label} · ${fmtNumber(apiPoints.length)} samples from this browser · limit ${fmtNumber(api.max)} (${fmtPercent(api.pct)} used)`
                : "Collecting samples — Inspector records usage from every API call it makes, so the trend fills in as you work."}
            </span>
          </div>
          {meaningful(apiPoints) && (
            <div class="card__body">
              <TrendChart points={apiPoints} height={140} label="Daily API requests used" />
            </div>
          )}
        </div>
      )}

      <div class="toolbar ltoolbar">
        <SearchInput value={q} onInput={setQ} placeholder="Filter limits" class="toolbar__search" />
        <Seg<LFilter>
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: rows.length },
            { value: "used", label: "In use", count: rows.filter((r) => r.used > 0).length },
            { value: "high", label: "≥ 50%", count: rows.filter((r) => r.pct >= 50).length },
          ]}
        />
        <div class="row" style={{ marginLeft: "auto", gap: 6 }}>
          <span class="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Sort
          </span>
          <Seg<LSort>
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: "usage", label: "Usage" },
              { value: "name", label: "Name" },
            ]}
          />
        </div>
      </div>

      {groups.length === 0 ? (
        <Empty icon={<Search />} title="No limits match" />
      ) : (
        groups.map(([cat, list]) => {
          const expandable = list.some((r) => r.subs.length);
          return (
            <section class={"lgroup card" + (expandable ? " has-expand" : "")} key={cat} aria-label={cat}>
              <div class="lgroup__head">
                <span class="card__title">{cat}</span>
                <span class="muted tabular">{list.length}</span>
              </div>
              <div role="table" aria-label={`${cat} limits`}>
                <div class="lrow lrow--head" role="row">
                  <span role="columnheader">Limit</span>
                  <span role="columnheader">Usage</span>
                  <span role="columnheader" class="r">
                    Used
                  </span>
                  <span role="columnheader" class="r">
                    Max
                  </span>
                  <span role="columnheader" class="r">
                    Used %
                  </span>
                  <span role="columnheader" class="r">
                    Change
                  </span>
                </div>
                {list.map((r) => {
                  const isOpen = open.has(r.key);
                  const pts = series(r.key);
                  const delta = meaningful(pts) ? deltaText(pts) : null;
                  return (
                    <>
                      <div class={"lrow" + (isOpen ? " is-open" : "")} key={r.key} role="row">
                        <span class="lrow__name" role="cell">
                          {expandable &&
                            (r.subs.length ? (
                              <button class="lrow__toggle" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} per-app usage for ${r.label}`} onClick={() => toggle(r.key)}>
                                <ChevronRight class="lrow__chev" />
                              </button>
                            ) : (
                              <span class="lrow__toggle" aria-hidden="true" />
                            ))}
                          <span class="truncate" title={`${r.label} (${r.key})`}>
                            <span class="lrow__label">{r.label}</span>
                            <span class="lrow__key mono">{r.key}</span>
                          </span>
                        </span>
                        <span role="cell">
                          <Meter pct={r.pct} />
                        </span>
                        <span class="r tabular" role="cell">
                          {fmtNumber(r.used)}
                        </span>
                        <span class="r tabular muted" role="cell">
                          {fmtNumber(r.max)}
                        </span>
                        <span class={"r tabular lrow__pct" + (r.pct >= 90 ? " t-danger" : r.pct >= 75 ? " t-warning" : "")} role="cell">
                          <SeverityIcon pct={r.pct} />
                          {fmtPercent(r.pct)}
                        </span>
                        <span class="r lrow__delta" role="cell">
                          {delta ? (
                            <>
                              <Sparkline points={pts} width={56} />
                              <span class="tabular">{delta.label.split(" in ")[0]}</span>
                            </>
                          ) : (
                            <span class="muted" aria-label="No change recorded">
                              —
                            </span>
                          )}
                        </span>
                      </div>
                      {isOpen &&
                        r.subs.map((s) => (
                          <div class="lrow lrow--sub" key={r.key + s.key} role="row">
                            <span class="lrow__name" role="cell">
                              <span class="lrow__toggle" aria-hidden="true" />
                              <span class="truncate" title={s.key}>
                                {s.key}
                              </span>
                            </span>
                            <span role="cell">
                              <Meter pct={s.pct} />
                            </span>
                            <span class="r tabular" role="cell">
                              {fmtNumber(s.used)}
                            </span>
                            <span class="r tabular muted" role="cell">
                              {fmtNumber(s.max)}
                            </span>
                            <span class="r tabular" role="cell">
                              {fmtPercent(s.pct)}
                            </span>
                            <span role="cell" />
                          </div>
                        ))}
                    </>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function LicenseTable({ title, list, showExpiry }: { title: string; list: License[] | string; showExpiry?: boolean }) {
  const [showUnused, setShowUnused] = useState(false);
  if (typeof list === "string")
    return (
      <section class="lgroup card">
        <div class="lgroup__head">
          <span class="card__title">{title}</span>
        </div>
        <div class="card__body">
          <Callout tone="warning">{list}</Callout>
        </div>
      </section>
    );
  const sorted = [...list].filter((l) => l.TotalLicenses > 0).sort((a, b) => b.UsedLicenses / b.TotalLicenses - a.UsedLicenses / a.TotalLicenses);
  const visible = showUnused ? sorted : sorted.filter((l) => l.UsedLicenses > 0);
  return (
    <section class="lgroup card" aria-label={title}>
      <div class="lgroup__head">
        <span class="card__title">{title}</span>
        <span class="muted tabular">
          {visible.length} of {sorted.length}
        </span>
        <button class="link-btn" style={{ marginLeft: "auto", fontSize: "var(--fs-sm)" }} onClick={() => setShowUnused(!showUnused)}>
          {showUnused ? "Hide unused" : `Show ${sorted.length - sorted.filter((l) => l.UsedLicenses > 0).length} unused`}
        </button>
      </div>
      <div role="table" aria-label={title}>
        <div class="lrow lrow--head lrow--lic" role="row">
          <span role="columnheader">License</span>
          <span role="columnheader">Usage</span>
          <span role="columnheader" class="r">
            Used
          </span>
          <span role="columnheader" class="r">
            Total
          </span>
          <span role="columnheader" class="r">
            Used %
          </span>
          <span role="columnheader" class="r">
            {showExpiry ? "Expires" : "Status"}
          </span>
        </div>
        {visible.length === 0 && <div class="qside__empty">No licenses in use.</div>}
        {visible.map((l) => {
          const pct = (l.UsedLicenses / l.TotalLicenses) * 100;
          const tiny = l.TotalLicenses <= 2;
          return (
            <div class="lrow lrow--lic" key={l.Id} role="row">
              <span class="lrow__name" role="cell">
                <span class="truncate" title={l.MasterLabel}>
                  <span class="lrow__label">{l.MasterLabel}</span>
                  {l.Status !== "Active" && <Badge>{l.Status}</Badge>}
                </span>
              </span>
              <span role="cell">
                <Meter pct={pct} neutral={tiny} />
              </span>
              <span class="r tabular" role="cell">
                {fmtNumber(l.UsedLicenses)}
              </span>
              <span class="r tabular muted" role="cell">
                {fmtNumber(l.TotalLicenses)}
              </span>
              <span class={"r tabular lrow__pct" + (!tiny && pct >= 90 ? " t-danger" : !tiny && pct >= 75 ? " t-warning" : "")} role="cell">
                {tiny && pct >= 100 ? (
                  <span class="muted" title="Small allocations are usually fully assigned on purpose">
                    Fully allocated
                  </span>
                ) : (
                  <>
                    {!tiny && <SeverityIcon pct={pct} />}
                    {fmtPercent(pct)}
                  </>
                )}
              </span>
              <span class="r muted" role="cell">
                {showExpiry ? (l.ExpirationDate ? fmtDate(l.ExpirationDate) : "—") : l.Status}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RecordCounts() {
  const sf = orgState.value!.sf;
  const [data, setData] = useState<Array<{ name: string; count: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [dataOnly, setDataOnly] = useState(true);
  const [business, setBusiness] = useState<Set<string> | null>(null);
  useEffect(() => {
    // "Business data" = custom objects plus standard objects that have page layouts, minus sharing/history/feed tables.
    sf.describeGlobal().then((g) => setBusiness(new Set(g.sobjects.filter((o) => (o.custom || o.layoutable) && !o.customSetting && !NOISE_OBJECT.test(o.name)).map((o) => o.name))));
    sf.recordCounts().then(
      (r) => setData(r.sObjects.filter((o) => o.count > 0).sort((a, b) => b.count - a.count)),
      (e) => setError(e.message),
    );
  }, []);
  if (error)
    return (
      <div class="lpad lbody">
        <Callout tone="danger" title="Couldn't load record counts">
          {error}
        </Callout>
      </div>
    );
  if (!data)
    return (
      <div class="empty">
        <Spinner />
      </div>
    );
  const s = q.trim().toLowerCase();
  const base = dataOnly && business ? data.filter((d) => business.has(d.name)) : data;
  const filtered = base.filter((d) => !s || d.name.toLowerCase().includes(s));
  const shown = all || s ? filtered : filtered.slice(0, 25);
  const max = base[0]?.count || 1;
  const total = base.reduce((a, b) => a + b.count, 0);
  return (
    <div class="lpad lbody">
      <div class="toolbar ltoolbar">
        <SearchInput value={q} onInput={setQ} placeholder="Filter objects" class="toolbar__search" />
        <Switch checked={dataOnly} onChange={setDataOnly} title="Hide setup, sharing, history and feed objects">
          Business data only
        </Switch>
        <span class="muted" style={{ marginLeft: "auto", fontSize: "var(--fs-sm)" }}>
          {fmtNumber(total)} records across {fmtNumber(base.length)} objects · approximate counts from Salesforce
        </span>
      </div>
      <section class="lgroup card" aria-label="Records by object">
        <div class="lgroup__head">
          <span class="card__title">Records by object</span>
          <span class="muted">{s ? `${filtered.length} matching` : all ? "All objects" : "Top 25"}</span>
        </div>
        <div class="bars">
          {shown.map((d) => (
            <a class="bar" href={links.object(d.name)} key={d.name} title={`${d.name}: ${fmtNumber(d.count)} records`}>
              <span class="bar__name mono truncate">{d.name}</span>
              <span class="bar__track">
                <span class="bar__fill" style={{ width: `max(3px, calc((100% - 84px) * ${(d.count / max).toFixed(4)}))` }} />
                <span class="bar__val tabular">{fmtNumber(d.count)}</span>
              </span>
            </a>
          ))}
        </div>
        {!s && filtered.length > 25 && (
          <div class="bars__more">
            <button class="link-btn" onClick={() => setAll(!all)}>
              {all ? "Show top 25" : `Show all ${fmtNumber(filtered.length)} objects`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
