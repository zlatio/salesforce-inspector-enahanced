// Session discovery. The extension reuses the browser's existing Salesforce login: the `sid`
// cookie on the org's API host is a valid OAuth bearer token for the REST API. Only extension
// contexts (background, popup, app pages) can read cookies; content scripts ask the background.

const SF_HOST_SUFFIXES = [
  "salesforce.com",
  "salesforce-setup.com",
  "force.com",
  "cloudforce.com",
  "visualforce.com",
  "sfcrmapps.cn",
  "sfcrmproducts.cn",
  "salesforce.mil",
  "force.mil",
  "cloudforce.mil",
  "visualforce.mil",
  "crmforce.mil",
];

// The session lookup in resolveApiHost (these domains and their order, matching on the org id, skipping
// help.salesforce.com, the .mcas.ms fallback) and the host mapping in toApiHost are adapted from
// Salesforce Inspector Reloaded (MIT). See THIRD_PARTY_NOTICES.md.

// Cookie domains that can hold an API-capable session, in the order they should be tried.
const SESSION_COOKIE_DOMAINS = ["salesforce.com", "cloudforce.com", "salesforce.mil", "cloudforce.mil", "sfcrmproducts.cn", "force.com"];

const NON_ORG_HOSTS = /^(help|trailhead|developer|appexchange|status|www|login|test)\.salesforce\.com$/;

export function isSalesforceHost(hostname: string): boolean {
  const host = hostname.replace(/\.mcas\.ms$/, "");
  return SF_HOST_SUFFIXES.some((s) => host === s || host.endsWith("." + s));
}

/** Map Lightning / Visualforce hosts onto the My Domain host that serves the API without redirects. */
export function toApiHost(hostname: string): string {
  return hostname
    .replace(/\.mcas\.ms$/, "")
    .replace(/\.lightning\.force\./, ".my.salesforce.")
    .replace(/\.lightning\.([^.]+)\.force\.com$/, ".my.$1.salesforce.com")
    .replace(/\.my\.salesforce-setup\.com$/, ".my.salesforce.com");
}

function cookiesGet(details: chrome.cookies.CookieDetails): Promise<chrome.cookies.Cookie | null> {
  return new Promise((resolve) => chrome.cookies.get(details, (c) => resolve(c ?? null)));
}
function cookiesGetAll(details: chrome.cookies.GetAllDetails): Promise<chrome.cookies.Cookie[]> {
  return new Promise((resolve) => chrome.cookies.getAll(details, (c) => resolve(c ?? [])));
}

/**
 * Given any Salesforce page URL, work out which host to call the API on. A Lightning page's own
 * cookie may not have API access, so we find the sid cookie for the same org (the cookie value
 * starts with the org id) on a salesforce.com-style domain.
 */
export async function resolveApiHost(pageUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !isSalesforceHost(url.hostname) || NON_ORG_HOSTS.test(url.hostname)) return null;

  const pageCookie = await cookiesGet({ url: pageUrl, name: "sid" });
  if (!pageCookie || url.hostname.endsWith(".mcas.ms")) return toApiHost(url.hostname);

  const orgId = pageCookie.value.split("!")[0];
  const candidates: chrome.cookies.Cookie[] = [];
  for (const domain of SESSION_COOKIE_DOMAINS) {
    const cookies = await cookiesGetAll({ name: "sid", domain, secure: true });
    candidates.push(...cookies.filter((c) => c.value.startsWith(orgId + "!") && !c.domain.includes("help.salesforce.com")));
  }
  // Prefer the My Domain API host when several cookies belong to the org.
  candidates.sort((a, b) => score(b.domain) - score(a.domain));
  const best = candidates[0];
  return best ? best.domain.replace(/^\./, "") : toApiHost(url.hostname);
}

function score(domain: string): number {
  if (domain.includes(".my.salesforce.com")) return 3;
  if (domain.endsWith("salesforce.com")) return 2;
  if (domain.includes("lightning")) return 0;
  return 1;
}

export interface Session {
  host: string;
  token: string;
  orgId: string;
}

export async function getSession(host: string): Promise<Session | null> {
  const cookie = await cookiesGet({ url: "https://" + host, name: "sid" });
  if (!cookie) return null;
  return { host, token: cookie.value, orgId: cookie.value.split("!")[0] };
}
