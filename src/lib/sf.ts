import { signal } from "@preact/signals";
import { getSession, type Session } from "./auth";
import { load, save } from "./storage";
import type { DescribeGlobalResult, DescribeSObjectResult, GlobalSObject, LimitsResult, QueryResult, SfRecord } from "./types";

export const DEFAULT_API_VERSION = "62.0";

export class SfError extends Error {
  status: number;
  errorCode?: string;
  fields?: string[];
  details: unknown;
  constructor(message: string, status: number, errorCode?: string, fields?: string[], details?: unknown) {
    super(message);
    this.name = "SfError";
    this.status = status;
    this.errorCode = errorCode;
    this.fields = fields;
    this.details = details;
  }
  get isSessionError() {
    return this.status === 401 || this.errorCode === "INVALID_SESSION_ID";
  }
}

export interface ApiUsage {
  used: number;
  max: number;
  at: number;
}

/** Latest `Sforce-Limit-Info` reading, updated by every API response. */
export const apiUsage = signal<ApiUsage | null>(null);
/** Set when a call fails because the browser session has expired. */
export const sessionExpired = signal(false);

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Return null instead of throwing on 404. */
  allow404?: boolean;
}

export interface ApiSample {
  at: number;
  v: number;
}
export const apiSamplesKey = (host: string) => `sie.apiSamples.${host}`;

async function recordApiSample(host: string, at: number, v: number) {
  const key = apiSamplesKey(host);
  const prev = await load<ApiSample[]>(key, []);
  const next = [...prev, { at, v }].filter((x) => at - x.at < 7 * 86400_000).slice(-600);
  save(key, next);
}

export class Sf {
  readonly host: string;
  readonly orgId: string;
  private token: string;
  version = DEFAULT_API_VERSION;
  private describeCache = new Map<string, Promise<DescribeSObjectResult>>();
  private globalCache = new Map<string, Promise<DescribeGlobalResult>>();

  constructor(session: Session) {
    this.host = session.host;
    this.token = session.token;
    this.orgId = session.orgId;
  }

  static async connect(host: string): Promise<Sf> {
    const session = await getSession(host);
    if (!session) throw new SfError(`No active Salesforce session found for ${host}. Log in to the org in this browser, then try again.`, 401, "NO_SESSION");
    const sf = new Sf(session);
    await sf.detectVersion();
    return sf;
  }

  get instanceUrl() {
    return "https://" + this.host;
  }

  /** The Lightning Experience host for opening records in the UI. */
  get lightningHost() {
    return this.host.replace(/\.my\.salesforce\.com$/, ".lightning.force.com");
  }

  private async detectVersion() {
    try {
      const versions = await this.request<Array<{ version: string }>>("/services/data/");
      if (Array.isArray(versions) && versions.length) this.version = versions[versions.length - 1].version;
    } catch (e) {
      if (e instanceof SfError && e.isSessionError) throw e;
    }
  }

  path(p: string, tooling = false) {
    return `/services/data/v${this.version}${tooling ? "/tooling" : ""}${p}`;
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = path.startsWith("http") ? path : this.instanceUrl + path;
    const headers: Record<string, string> = {
      Authorization: "Bearer " + this.token,
      Accept: "application/json",
      "Sforce-Call-Options": "client=SalesforceInspectorEnhanced",
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    let res: Response;
    try {
      res = await fetch(url, { method: opts.method ?? "GET", headers, body, signal: opts.signal, cache: "no-store" });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new SfError(`Network error contacting ${this.host}: ${(e as Error).message}`, 0, "NETWORK");
    }
    this.readLimitHeader(res);
    if (res.status === 204) return null as T;
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      if (res.status === 404 && opts.allow404) return null as T;
      const first = Array.isArray(data) ? (data[0] as { message?: string; errorCode?: string; fields?: string[] }) : (data as { message?: string; errorCode?: string } | null);
      const err = new SfError(first?.message || `HTTP ${res.status} ${res.statusText}`, res.status, first?.errorCode, (first as { fields?: string[] })?.fields, data);
      if (err.isSessionError) sessionExpired.value = true;
      throw err;
    }
    return data as T;
  }

  private lastSample = 0;
  private readLimitHeader(res: Response) {
    const info = res.headers.get("Sforce-Limit-Info");
    const m = info && /api-usage=(\d+)\/(\d+)/.exec(info);
    if (!m) return;
    const now = Date.now();
    apiUsage.value = { used: +m[1], max: +m[2], at: now };
    // Every API call doubles as a free usage sample for the limits trend (at most one a minute).
    if (now - this.lastSample > 60_000) {
      this.lastSample = now;
      recordApiSample(this.host, now, +m[1]);
    }
  }

  // ---- Query -------------------------------------------------------------

  query<T = SfRecord>(soql: string, opts: { tooling?: boolean; all?: boolean; signal?: AbortSignal } = {}) {
    const endpoint = opts.all && !opts.tooling ? "/queryAll/" : "/query/";
    return this.request<QueryResult<T>>(this.path(endpoint, opts.tooling) + "?q=" + encodeURIComponent(soql), { signal: opts.signal });
  }

  queryMore<T = SfRecord>(nextRecordsUrl: string, signal?: AbortSignal) {
    return this.request<QueryResult<T>>(nextRecordsUrl, { signal });
  }

  /** Fetch every page of a query (use only for small, bounded queries). */
  async queryAllRecords<T = SfRecord>(soql: string, opts: { tooling?: boolean } = {}): Promise<T[]> {
    let res = await this.query<T>(soql, opts);
    const out = [...res.records];
    while (!res.done && res.nextRecordsUrl) {
      res = await this.queryMore<T>(res.nextRecordsUrl);
      out.push(...res.records);
    }
    return out;
  }

  // ---- Metadata ----------------------------------------------------------

  describeGlobal(tooling = false): Promise<DescribeGlobalResult> {
    const key = tooling ? "tooling" : "data";
    let p = this.globalCache.get(key);
    if (!p) {
      p = this.request<DescribeGlobalResult>(this.path("/sobjects/", tooling)).then((r) => {
        // Some orgs return placeholder labels like "__MISSING LABEL__ PropertyFile - val X not found".
        for (const o of r.sobjects) if (!o.label || o.label.startsWith("__MISSING LABEL__")) o.label = o.name;
        return r;
      });
      p.catch(() => this.globalCache.delete(key));
      this.globalCache.set(key, p);
    }
    return p;
  }

  describe(name: string, tooling = false): Promise<DescribeSObjectResult> {
    const key = (tooling ? "t:" : "d:") + name.toLowerCase();
    let p = this.describeCache.get(key);
    if (!p) {
      p = this.request<DescribeSObjectResult>(this.path(`/sobjects/${encodeURIComponent(name)}/describe/`, tooling)).then((d) => {
        if (!d.label || d.label.startsWith("__MISSING LABEL__")) d.label = d.name;
        for (const f of d.fields) if (!f.label || f.label.startsWith("__MISSING LABEL__")) f.label = f.name;
        return d;
      });
      p.catch(() => this.describeCache.delete(key));
      this.describeCache.set(key, p);
    }
    return p;
  }

  invalidateDescribe(name: string) {
    this.describeCache.delete("d:" + name.toLowerCase());
    this.describeCache.delete("t:" + name.toLowerCase());
  }

  /** Resolve the sObject type for a record id from its 3-character key prefix. */
  async objectForId(id: string): Promise<GlobalSObject | null> {
    const prefix = id.slice(0, 3);
    const data = await this.describeGlobal();
    const hit = data.sobjects.find((s) => s.keyPrefix === prefix);
    if (hit) return hit;
    const tooling = await this.describeGlobal(true).catch(() => null);
    return tooling?.sobjects.find((s) => s.keyPrefix === prefix) ?? null;
  }

  // ---- Records -----------------------------------------------------------

  getRecord(type: string, id: string, tooling = false) {
    return this.request<SfRecord>(this.path(`/sobjects/${type}/${id}`, tooling));
  }

  updateRecord(type: string, id: string, fields: Record<string, unknown>, tooling = false) {
    return this.request<null>(this.path(`/sobjects/${type}/${id}`, tooling), { method: "PATCH", body: fields });
  }

  /**
   * Run many GETs (e.g. COUNT() queries) through the Composite Batch API: 25 per call. Plain Composite
   * would cap query sub-requests at 5 per call.
   */
  async batch<T = unknown>(paths: string[]): Promise<Array<{ status: number; body: T }>> {
    const out: Array<{ status: number; body: T }> = [];
    const prefix = `/services/data/`;
    for (let i = 0; i < paths.length; i += 25) {
      const chunk = paths.slice(i, i + 25);
      const res = await this.request<{ results: Array<{ statusCode: number; result: T }> }>(this.path("/composite/batch"), {
        method: "POST",
        body: { haltOnError: false, batchRequests: chunk.map((p) => ({ method: "GET", url: p.startsWith(prefix) ? p.slice(prefix.length) : p })) },
      });
      out.push(...res.results.map((r) => ({ status: r.statusCode, body: r.result })));
    }
    return out;
  }

  // ---- Limits ------------------------------------------------------------

  limits() {
    return this.request<LimitsResult>(this.path("/limits/"));
  }

  recordCounts() {
    return this.request<{ sObjects: Array<{ name: string; count: number }> }>(this.path("/limits/recordCount"));
  }

  userInfo() {
    return this.request<{ user_id: string; name: string; email: string; preferred_username: string; organization_id: string }>("/services/oauth2/userinfo");
  }
}

/** Salesforce record ids are 15 or 18 alphanumerics; this checks shape only. */
export function looksLikeId(s: string) {
  return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(s.trim()) && /\d/.test(s);
}

/** Convert a 15-character id to its case-insensitive 18-character form. */
export function to18(id: string) {
  if (id.length !== 15) return id;
  let suffix = "";
  for (let block = 0; block < 3; block++) {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const c = id[block * 5 + i];
      if (c >= "A" && c <= "Z") n |= 1 << i;
    }
    suffix += "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"[n];
  }
  return id + suffix;
}
