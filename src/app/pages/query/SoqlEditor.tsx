import { useEffect, useRef } from "preact/hooks";
import { Annotation, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, drawSelection, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers, placeholder, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, startCompletion } from "@codemirror/autocomplete";
import { HighlightStyle, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { SQLDialect, sql } from "@codemirror/lang-sql";
import { tags as t } from "@lezer/highlight";
import type { Sf } from "../../../lib/sf";
import { DATE_LITERALS, SOQL_FUNCTIONS } from "../../../lib/soql";
import { makeCompletionSource } from "./soqlComplete";
import { externalEdit, history as queryHistory } from "./store";
import { objectFrequency } from "../../../lib/queries";
import { loadRecent } from "../../../lib/recent";

const External = Annotation.define<boolean>();

const dialect = SQLDialect.define({
  keywords:
    "select from where and or not in like includes excludes order by asc desc nulls first last limit offset group having rollup cube typeof when then else end using scope with security_enforced user_mode system_mode for view reference update tracking viewstat all rows true false null fields",
  builtin: SOQL_FUNCTIONS.join(" ").toLowerCase() + " " + DATE_LITERALS.map((d) => d.split(":")[0].toLowerCase()).join(" "),
  types: "",
  operatorChars: "=<>!",
  caseInsensitiveIdentifiers: true,
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syn-keyword)", fontWeight: "600" },
  { tag: [t.standard(t.name), t.function(t.variableName)], color: "var(--syn-function)" },
  { tag: t.string, color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null], color: "var(--syn-number)" },
  { tag: [t.operator, t.punctuation, t.paren, t.separator], color: "var(--syn-operator)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.name, t.propertyName, t.special(t.name)], color: "var(--syn-field)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--surface)", color: "var(--text)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-content": { padding: "10px 0", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 14px 0 6px" },
  ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--text-4)", border: "none", paddingLeft: "6px" },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "22px", fontSize: "11.5px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent-soft) 55%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--accent-soft-2) !important" },
  ".cm-matchingBracket": { backgroundColor: "var(--accent-soft-2)", outline: "1px solid var(--accent-border)" },
  ".cm-placeholder": { color: "var(--text-4)" },
  ".cm-tooltip": { border: "1px solid var(--border)", backgroundColor: "var(--surface-raised)", borderRadius: "8px", boxShadow: "var(--shadow-lg)", overflow: "hidden" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-sans)", fontSize: "12.5px", maxHeight: "300px", minWidth: "320px", padding: "4px" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "4px 8px", borderRadius: "5px", display: "flex", alignItems: "center", gap: "8px", lineHeight: "1.5" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-soft-2)", color: "var(--text)", boxShadow: "inset 2px 0 0 var(--accent)" },
  ".cm-completionLabel": { fontFamily: "var(--font-mono)", fontSize: "12px" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--accent-text)", fontWeight: "700" },
  ".cm-completionDetail": { marginLeft: "auto", paddingLeft: "16px", color: "var(--text-3)", fontStyle: "normal", fontSize: "11.5px" },
  ".cm-completionInfo": { padding: "8px 10px", fontSize: "12px", maxWidth: "320px", color: "var(--text-2)" },
  ".cm-completionIcon": { width: "18px", height: "18px", padding: "0", opacity: "1", display: "grid", placeItems: "center", borderRadius: "4px", fontSize: "11px", fontWeight: "700", fontFamily: "var(--font-sans)" },
  ".cm-completionIcon-property": { backgroundColor: "var(--surface-3)", color: "var(--text-2)" },
  ".cm-completionIcon-property:after": { content: "'F'" },
  ".cm-completionIcon-class": { backgroundColor: "var(--accent-soft)", color: "var(--accent-text)" },
  ".cm-completionIcon-class:after": { content: "'O'" },
  ".cm-completionIcon-namespace": { backgroundColor: "var(--accent-soft)", color: "var(--accent-text)" },
  ".cm-completionIcon-namespace:after": { content: "'R'" },
  ".cm-completionIcon-keyword": { backgroundColor: "var(--surface-3)", color: "var(--text-2)" },
  ".cm-completionIcon-keyword:after": { content: "'K'" },
  ".cm-completionIcon-function": { backgroundColor: "var(--success-soft)", color: "var(--success-text)" },
  ".cm-completionIcon-function:after": { content: "'ƒ'" },
  ".cm-completionIcon-enum": { backgroundColor: "var(--warning-soft)", color: "var(--warning-text)" },
  ".cm-completionIcon-enum:after": { content: "'V'" },
  ".cm-completionIcon-constant": { backgroundColor: "var(--warning-soft)", color: "var(--warning-text)" },
  ".cm-completionIcon-constant:after": { content: "'D'" },
  ".cm-soql-error": { textDecoration: "underline wavy var(--danger)", textUnderlineOffset: "3px", backgroundColor: "var(--danger-soft)" },
});

// ---- Error underline ----
export const setErrorMark = StateEffect.define<{ from: number; to: number } | null>();
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorMark)) deco = e.value && e.value.to > e.value.from ? Decoration.set([Decoration.mark({ class: "cm-soql-error" }).range(e.value.from, e.value.to)]) : Decoration.none;
    }
    if (tr.docChanged) deco = Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface SoqlEditorHandle {
  view: EditorView | null;
}

export function SoqlEditor({
  tabId,
  value,
  onChange,
  onRun,
  sf,
  tooling,
  handle,
}: {
  tabId: string;
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  sf: Sf;
  tooling: boolean;
  handle?: { current: SoqlEditorHandle };
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, onRun, sf, tooling });
  latest.current = { onChange, onRun, sf, tooling };

  useEffect(() => {
    const extensions: Extension[] = [
      lineNumbers(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      bracketMatching(),
      closeBrackets(),
      sql({ dialect, upperCaseKeywords: true }),
      syntaxHighlighting(highlight),
      autocompletion({
        override: [makeCompletionSource(() => latest.current.sf, () => latest.current.tooling, () => objectFrequency(queryHistory.peek(), loadRecent(latest.current.sf.host)))],
        icons: true,
        activateOnTyping: true,
        maxRenderedOptions: 200,
      }),
      errorField,
      placeholder("SELECT Id, Name FROM Account WHERE …"),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": "SOQL query editor. Ctrl+Enter runs. Press Escape then Tab to leave the editor." }),
      keymap.of([
        { key: "Mod-Enter", run: () => (latest.current.onRun(), true) },
        { key: "Shift-Enter", run: () => (latest.current.onRun(), true) },
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...historyKeymap,
        indentWithTab,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) latest.current.onChange(u.state.doc.toString());
      }),
      theme,
    ];
    view.current = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions }) });
    if (handle) handle.current = { view: view.current };
    view.current.focus();
    view.current.dispatch({ selection: { anchor: view.current.state.doc.length } });
    // A fresh "SELECT Id FROM " tab opens straight onto object suggestions.
    if (/\bFROM\s+$/i.test(value)) setTimeout(() => view.current && startCompletion(view.current), 50);
    return () => view.current?.destroy();
  }, []);

  // Apply edits made outside the editor (history, format, deep links). Only events newer than mount count.
  useEffect(() => {
    const since = externalEdit.peek()?.n ?? 0;
    return externalEdit.subscribe((e) => {
      const v = view.current;
      if (!e || e.n <= since || e.tabId !== tabId || !v || v.state.doc.toString() === e.soql) return;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: e.soql }, annotations: External.of(true), selection: { anchor: e.soql.length } });
      v.focus();
    });
  }, [tabId]);

  return <div class="soql-editor" ref={host} />;
}

export function markError(view: EditorView | null, offset: number | null | undefined) {
  if (!view) return;
  if (offset == null) {
    view.dispatch({ effects: setErrorMark.of(null) });
    return;
  }
  const doc = view.state.doc.toString();
  const end = Math.min(doc.length, offset + Math.max(1, /^[\w.]+/.exec(doc.slice(offset))?.[0].length ?? 1));
  view.dispatch({ effects: setErrorMark.of({ from: offset, to: end }), selection: { anchor: offset }, scrollIntoView: true });
}
