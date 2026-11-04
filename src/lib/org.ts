import { signal } from "@preact/signals";
import { Sf, SfError } from "./sf";
import { load, save } from "./storage";
import type { OrgEnv, OrgInfo } from "./types";

export interface OrgState {
  sf: Sf;
  org: OrgInfo | null;
  env: OrgEnv;
  user: { id: string; name: string; username: string } | null;
}

export const orgState = signal<OrgState | null>(null);
export const orgError = signal<SfError | Error | null>(null);

export function classifyOrg(org: OrgInfo | null, host: string): OrgEnv {
  if (org) {
    if (org.IsSandbox) return org.TrialExpirationDate ? "scratch" : "sandbox";
    if (org.TrialExpirationDate) return org.OrganizationType === "Developer Edition" ? "scratch" : "trial";
    if (org.OrganizationType === "Developer Edition") return "developer";
    return "production";
  }
  if (/\.sandbox\.my\.salesforce\.com$|--/.test(host)) return "sandbox";
  if (/\.scratch\.my\.salesforce\.com$/.test(host)) return "scratch";
  if (/\.develop\.my\.salesforce\.com$/.test(host)) return "developer";
  return "production";
}

/** "acme--uat.sandbox.my.salesforce.com" → "uat"; production orgs return the My Domain name. */
export function shortOrgName(host: string) {
  const sub = host.split(".")[0];
  const parts = sub.split("--");
  return parts.length > 1 ? parts[parts.length - 1] : sub;
}

export interface RecentOrg {
  host: string;
  name: string;
  env: OrgEnv;
  lastUsed: number;
}

export async function rememberOrg(o: RecentOrg) {
  const list = await load<RecentOrg[]>("sie.recentOrgs", []);
  const next = [o, ...list.filter((x) => x.host !== o.host)].slice(0, 8);
  await save("sie.recentOrgs", next);
}

export const loadRecentOrgs = () => load<RecentOrg[]>("sie.recentOrgs", []);

export async function connectOrg(host: string): Promise<OrgState> {
  const sf = await Sf.connect(host);
  const [orgRes, userRes] = await Promise.allSettled([
    sf.query<OrgInfo>(
      "SELECT Id, Name, IsSandbox, InstanceName, OrganizationType, TrialExpirationDate, CreatedDate, NamespacePrefix, LanguageLocaleKey, TimeZoneSidKey FROM Organization LIMIT 1",
    ),
    sf.userInfo(),
  ]);
  const org = orgRes.status === "fulfilled" ? (orgRes.value.records[0] ?? null) : null;
  const u = userRes.status === "fulfilled" ? userRes.value : null;
  const state: OrgState = {
    sf,
    org,
    env: classifyOrg(org, host),
    user: u ? { id: u.user_id, name: u.name, username: u.preferred_username } : null,
  };
  rememberOrg({ host, name: org?.Name ?? shortOrgName(host), env: state.env, lastUsed: Date.now() });
  return state;
}
