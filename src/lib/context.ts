// Work out what the user is looking at in a Salesforce tab, from its URL alone.

export interface PageContext {
  objectName?: string;
  recordId?: string;
}

const ID = "[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?";

export function parsePageContext(href: string): PageContext {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return {};
  }
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* malformed % escape: match against the raw path */
  }
  let m: RegExpExecArray | null;

  // Lightning record page: /lightning/r/Account/001.../view
  if ((m = new RegExp(`^/lightning/r/([\\w]+)/(${ID})(?:/|$)`).exec(path))) return { objectName: m[1], recordId: m[2] };
  // Lightning record page without object: /lightning/r/001.../view
  if ((m = new RegExp(`^/lightning/r/(${ID})(?:/|$)`).exec(path))) return { recordId: m[1] };
  // Lightning list / home: /lightning/o/Account/list
  if ((m = /^\/lightning\/o\/(\w+)\//.exec(path))) return { objectName: m[1] };
  // Object Manager: /lightning/setup/ObjectManager/Account/... (may be an id for custom objects)
  if ((m = /^\/lightning\/setup\/ObjectManager\/([\w]+)\//.exec(path))) {
    return /^01I/.test(m[1]) ? {} : { objectName: m[1] };
  }
  // Setup pages often carry the record id in a query param
  for (const key of ["id", "recordId", "Id"]) {
    const v = url.searchParams.get(key);
    if (v && new RegExp(`^${ID}$`).test(v) && /\d/.test(v)) return { recordId: v };
  }
  // Lightning setup with an address param: /lightning/setup/.../page?address=/005...
  const address = url.searchParams.get("address");
  if (address && (m = new RegExp(`^/(${ID})(?:[/?]|$)`).exec(address))) return { recordId: m[1] };
  // Classic: /001xxxxxxxxxxxx
  if ((m = new RegExp(`^/(${ID})(?:/|$)`).exec(path)) && /\d/.test(m[1])) return { recordId: m[1] };
  return {};
}

/**
 * Interpret pasted text: a Salesforce URL (Lightning, Classic or Setup) or any text containing a record id.
 * Returns null when nothing record- or object-like is found.
 */
export function parsePastedTarget(input: string): PageContext | null {
  const s = input.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    const ctx = parsePageContext(s);
    return ctx.recordId || ctx.objectName ? ctx : null;
  }
  const m = /(?:^|[^a-zA-Z0-9])([a-zA-Z0-9]{18}|[a-zA-Z0-9]{15})(?![a-zA-Z0-9])/.exec(s);
  return m && /\d/.test(m[1]) && /[a-zA-Z]/.test(m[1]) ? { recordId: m[1] } : null;
}
