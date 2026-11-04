import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { Sf } from "../../../lib/sf";
import type { DescribeField, DescribeSObjectResult } from "../../../lib/types";
import { DATE_LITERALS, SOQL_FUNCTIONS, SOQL_KEYWORDS, stripStrings } from "../../../lib/soql";
import { fieldTypeLabel } from "../../../lib/format";
import { NOISE_OBJECT } from "../../../lib/queries";

const COMMON_OBJECTS = new Set(["Account", "Contact", "Opportunity", "Lead", "Case", "User", "Task", "Event", "Campaign", "Product2", "Order", "Profile", "PermissionSet", "Contract", "Quote"]);

// ---- Autocomplete ----

interface Scope {
  start: number;
  end: number;
  sub: boolean;
}

/** Find the (sub)query that contains `pos`: either the whole doc or the innermost "(SELECT …)". */
function scopeAt(doc: string, pos: number): Scope {
  const s = stripStrings(doc);
  const stack: number[] = [];
  let found: number | null = null;
  for (let i = 0; i < pos; i++) {
    if (s[i] === "(") stack.push(i);
    else if (s[i] === ")") stack.pop();
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    if (/^\(\s*SELECT\b/i.test(s.slice(stack[k], stack[k] + 12))) {
      found = stack[k];
      break;
    }
  }
  if (found == null) return { start: 0, end: doc.length, sub: false };
  let depth = 0;
  for (let i = found; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return { start: found + 1, end: i, sub: true };
  }
  return { start: found + 1, end: doc.length, sub: true };
}

/** Text of a scope with nested parentheses blanked out, so FROM detection hits the right level. */
function topLevel(s: string) {
  let depth = 0;
  let out = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    out += depth > 0 ? " " : ch;
    if (ch === ")") depth = Math.max(0, depth - 1);
  }
  return out;
}

function fromOf(text: string) {
  return /\bFROM\s+([A-Za-z_]\w*)/i.exec(topLevel(stripStrings(text)))?.[1] ?? null;
}

async function resolvePath(sf: Sf, tooling: boolean, base: string, path: string[]): Promise<DescribeSObjectResult | null> {
  let d = await sf.describe(base, tooling).catch(() => null);
  for (const part of path) {
    if (!d) return null;
    const rel = d.fields.find((f) => f.relationshipName?.toLowerCase() === part.toLowerCase());
    if (!rel?.referenceTo?.length) return null;
    d = await sf.describe(rel.referenceTo[0], tooling).catch(() => null);
  }
  return d;
}

interface FieldOption extends Completion {
  search: string[];
}

function fieldOptions(d: DescribeSObjectResult): FieldOption[] {
  const out: FieldOption[] = [];
  for (const f of d.fields) {
    out.push({ label: f.name, type: "property", detail: `${f.label} · ${fieldTypeLabel(f, { formulaWrap: false })}`, info: f.inlineHelpText ?? undefined, search: [f.name.toLowerCase(), f.label.toLowerCase()] });
    if (f.relationshipName && f.referenceTo?.length)
      out.push({ label: f.relationshipName + ".", type: "namespace", detail: `${f.label} → ${f.referenceTo.join(", ")}`, search: [f.relationshipName.toLowerCase(), f.label.toLowerCase()] });
  }
  return out;
}

/**
 * Rank fields by API name *and* label (admins think in labels): exact > prefix > word start > contains.
 * CodeMirror's own filter only looks at the label, so we filter ourselves and turn its filter off.
 */
function rankFields(options: FieldOption[], typed: string): Completion[] {
  const q = typed.toLowerCase();
  if (!q) return options;
  const scored: Array<[number, FieldOption]> = [];
  for (const o of options) {
    const [name, label] = o.search;
    let score = 0;
    if (name === q || name === q + ".") score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (label.startsWith(q)) score = 70;
    else if (new RegExp("(^|[_\\s(/-])" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(label) || name.includes("_" + q)) score = 55;
    else if (name.includes(q)) score = 40;
    else if (label.includes(q)) score = 30;
    if (score) scored.push([score - name.length / 1000, o]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(([score, o]) => ({ ...o, boost: Math.round(score) - 50 }));
}

const keywordOptions: Completion[] = [
  ...SOQL_KEYWORDS.map((k) => ({ label: k, type: "keyword", boost: -5 })),
  ...SOQL_FUNCTIONS.map((k) => ({ label: k, type: "function", apply: k + "(", boost: -6 })),
];

export function makeCompletionSource(getSf: () => Sf, isTooling: () => boolean, getFrequency: () => Map<string, number> = () => new Map()) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const word = ctx.matchBefore(/[\w.]*/);
    if (!word) return null;
    const doc = ctx.state.doc.toString();
    const before = stripStrings(doc.slice(0, word.from));
    if ((before.match(/'/g) ?? []).length % 2 === 1) return null; // inside a string literal
    if (word.from === word.to && !ctx.explicit && !/(\bFROM|\bSELECT|,|\(|=|\bWHERE|\bAND|\bOR|\bBY)\s+$/i.test(before) && !/,\s*$/.test(before)) return null;

    const sf = getSf();
    const tooling = isTooling();
    const scope = scopeAt(doc, word.from);
    const scopeBefore = before.slice(scope.start);
    const prev = /(\w+)\s*$/.exec(scopeBefore)?.[1]?.toUpperCase();
    const scopeText = doc.slice(scope.start, scope.end);

    // Object names after FROM (or child relationship names inside a sub-query).
    if (prev === "FROM") {
      if (scope.sub) {
        const parent = fromOf(doc.slice(0, scope.start - 1) + " " + doc.slice(scope.end + 1));
        const pd = parent ? await sf.describe(parent, tooling).catch(() => null) : null;
        if (!pd) return null;
        return {
          from: word.from,
          options: pd.childRelationships.filter((r) => r.relationshipName).map((r) => ({ label: r.relationshipName!, type: "namespace", detail: r.childSObject, boost: 5 })),
          validFor: /^\w*$/,
        };
      }
      const g = await sf.describeGlobal(tooling).catch(() => null);
      if (!g) return null;
      // Rank by name/label match, boosted by how often this org's objects show up in your history.
      const q = word.text.toLowerCase();
      const freq = getFrequency();
      const scored: Array<[number, Completion]> = [];
      for (const o of g.sobjects) {
        if (!o.queryable) continue;
        const name = o.name.toLowerCase();
        const label = o.label.toLowerCase();
        let sc = !q ? 10 : name === q ? 100 : name.startsWith(q) ? 80 : label.startsWith(q) ? 70 : name.includes(q) ? 40 : label.includes(q) ? 30 : 0;
        if (!sc) continue;
        sc += Math.min(45, (freq.get(name) ?? 0) * 15);
        if (NOISE_OBJECT.test(o.name) && !(q.length > 3 && name.startsWith(q))) sc -= 30;
        if (!o.custom) sc += 1;
        if (!q && COMMON_OBJECTS.has(o.name)) sc += 20;
        const recent = (freq.get(name) ?? 0) > 0.5;
        const detail = [o.label !== o.name ? o.label : null, recent ? "recent" : null].filter(Boolean).join(" · ") || undefined;
        scored.push([sc, { label: o.name, type: "class", detail }]);
      }
      scored.sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label));
      return { from: word.from, options: scored.slice(0, 150).map((x) => x[1]), filter: false };
    }

    // Work out the object whose fields apply here.
    let base = fromOf(scopeText);
    if (scope.sub && base) {
      const parent = fromOf(doc.slice(0, scope.start - 1) + " " + doc.slice(scope.end + 1));
      const pd = parent ? await sf.describe(parent, tooling).catch(() => null) : null;
      base = pd?.childRelationships.find((r) => r.relationshipName?.toLowerCase() === base!.toLowerCase())?.childSObject ?? null;
    }

    // Values after an operator: picklist values, booleans, date literals.
    const valueCtx = /([\w.]+)\s*(?:=|!=|<>|<=|>=|<|>)\s*$/.exec(scopeBefore) ?? /([\w.]+)\s+(?:NOT\s+)?(?:IN|INCLUDES|EXCLUDES)\s*\(([^)]*)$/i.exec(scopeBefore);
    if (valueCtx && base) {
      const path = valueCtx[1].split(".");
      const fieldName = path.pop()!;
      const d = await resolvePath(sf, tooling, base, path);
      const f: DescribeField | undefined = d?.fields.find((x) => x.name.toLowerCase() === fieldName.toLowerCase());
      if (f) {
        let options: Completion[] = [];
        if (f.picklistValues?.length) options = f.picklistValues.filter((p) => p.active).map((p) => ({ label: `'${p.value}'`, type: "enum", detail: p.label !== p.value ? p.label : undefined, boost: 5 }));
        else if (f.type === "boolean") options = [{ label: "TRUE", type: "keyword" }, { label: "FALSE", type: "keyword" }];
        else if (f.type === "date" || f.type === "datetime") options = DATE_LITERALS.map((l) => ({ label: l, type: "constant" }));
        if (f.nillable) options.push({ label: "NULL", type: "keyword", boost: -1 });
        if (options.length) return { from: word.from, options, validFor: /^[\w']*$/ };
      }
    }

    if (!base) return { from: word.from, options: keywordOptions, validFor: /^\w*$/ };

    const dot = word.text.lastIndexOf(".");
    if (dot >= 0) {
      const path = word.text.slice(0, dot).split(".");
      const d = await resolvePath(sf, tooling, base, path);
      if (!d) return null;
      return { from: word.from + dot + 1, options: rankFields(fieldOptions(d), word.text.slice(dot + 1)), filter: false };
    }
    const d = await sf.describe(base, tooling).catch(() => null);
    const typed = word.text.toLowerCase();
    const kw = keywordOptions.filter((k) => !typed || k.label.toLowerCase().startsWith(typed));
    return { from: word.from, options: [...(d ? rankFields(fieldOptions(d), word.text) : []), ...kw], filter: false };
  };
}

