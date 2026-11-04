import { signal } from "@preact/signals";
import type { ButtonHTMLAttributes, ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { AlertTriangle, Check, CheckCircle2, Copy, Info, Search as SearchIcon, X, XCircle } from "lucide-preact";
import type { OrgEnv } from "../lib/types";

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl";
export const altKey = isMac ? "⌥" : "Alt";

/** True when a key event comes from somewhere the user is typing text. */
export function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || !!el.closest?.(".cm-editor"));
}

type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "type"> & {
  variant?: "primary" | "ghost" | "danger" | "soft" | "default";
  size?: "sm" | "md";
  icon?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
};

export function Button({ variant = "default", size = "md", icon, class: cls, className, type = "button", ...rest }: BtnProps) {
  const c = ["btn", variant !== "default" && `btn--${variant}`, size === "sm" && "btn--sm", icon && "btn--icon", cls, className].filter(Boolean).join(" ");
  return <button type={type} class={c} {...rest} />;
}

export function Kbd({ children }: { children: ComponentChildren }) {
  return <kbd class="kbd">{children}</kbd>;
}

/** A key combination rendered as separate chips, e.g. <Keys k={[modKey, "S"]} />. */
export function Keys({ k }: { k: string[] }) {
  return (
    <span class="keys" aria-label={k.join("+")}>
      {k.map((x) => (
        <kbd class="kbd" key={x} aria-hidden="true">
          {x}
        </kbd>
      ))}
    </span>
  );
}

export function Badge({ tone, square, mono, children, title }: { tone?: "accent" | "success" | "warning" | "danger" | "info"; square?: boolean; mono?: boolean; children: ComponentChildren; title?: string }) {
  const c = ["badge", tone && `badge--${tone}`, square && "badge--square", mono && "badge--mono"].filter(Boolean).join(" ");
  return (
    <span class={c} title={title}>
      {children}
    </span>
  );
}

const ENV_LABEL: Record<OrgEnv, string> = { production: "Production", sandbox: "Sandbox", scratch: "Scratch", developer: "Developer", trial: "Trial" };
export function EnvBadge({ env }: { env: OrgEnv }) {
  return <span class={`env env--${env}`}>{ENV_LABEL[env]}</span>;
}

export function Spinner({ small }: { small?: boolean }) {
  return <span class={small ? "spinner spinner--sm" : "spinner"} role="status" aria-label="Loading" />;
}

export function SearchInput({
  value,
  onInput,
  placeholder,
  autoFocus,
  size,
  inputRef,
  onKeyDown,
  hint,
  label,
  class: cls,
}: {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
  autoFocus?: boolean;
  size?: "sm";
  inputRef?: { current: HTMLInputElement | null };
  onKeyDown?: (e: KeyboardEvent) => void;
  hint?: ComponentChildren;
  class?: string;
}) {
  const local = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? local;
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, []);
  return (
    <div class={"search " + (cls ?? "")}>
      <SearchIcon />
      <input
        ref={ref}
        class={"input" + (size === "sm" ? " input--sm" : "")}
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        spellcheck={false}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onInput("");
          }
          onKeyDown?.(e);
        }}
      />
      {value ? (
        <button class="search__clear" aria-label="Clear search" onClick={() => (onInput(""), ref.current?.focus())}>
          <X />
        </button>
      ) : (
        hint && <span class="search__hint">{hint}</span>
      )}
    </div>
  );
}

export function Empty({ icon, title, children, error, action }: { icon?: ComponentChildren; title: string; children?: ComponentChildren; error?: boolean; action?: ComponentChildren }) {
  return (
    <div class={"empty" + (error ? " empty--error" : "")}>
      {icon && <div class="empty__icon">{icon}</div>}
      <div class="empty__title">{title}</div>
      {children && <div class="empty__text">{children}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function Callout({ tone = "info", title, children, action }: { tone?: "info" | "danger" | "warning"; title?: string; children?: ComponentChildren; action?: ComponentChildren }) {
  const Icon = tone === "danger" ? XCircle : tone === "warning" ? AlertTriangle : Info;
  return (
    <div class={`callout callout--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon />
      <div class="callout__body">
        {title && <div class="callout__title">{title}</div>}
        {children}
      </div>
      {action}
    </div>
  );
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/** Polite announcement for screen readers (e.g. "Copied"). */
export const announcement = signal("");
export function announce(msg: string) {
  announcement.value = "";
  setTimeout(() => (announcement.value = msg), 30);
}

export function CopyButton({ text, label = "Copy", class: cls, tabIndex }: { text: string; label?: string; class?: string; tabIndex?: number }) {
  const [done, setDone] = useState(false);
  return (
    <button
      class={"copy" + (done ? " is-done" : "") + (cls ? " " + cls : "")}
      aria-label={label}
      tabIndex={tabIndex}
      data-tip={done ? "Copied" : label}
      onClick={(e) => {
        e.stopPropagation();
        copyText(text);
        announce("Copied");
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check /> : <Copy />}
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: Array<{ value: T; label: ComponentChildren; count?: number; title?: string }>; onChange: (v: T) => void; label?: string; disabled?: boolean }) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} title={o.title} disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null && <span class="seg__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, children, title, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ComponentChildren; title?: string; disabled?: boolean }) {
  return (
    <label class={"switch" + (disabled ? " is-disabled" : "")} title={title}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      {children}
    </label>
  );
}

export function Meter({ pct, large, label, neutral }: { pct: number; large?: boolean; label?: string; neutral?: boolean }) {
  const tone = neutral ? " meter--neutral" : pct >= 90 ? " meter--danger" : pct >= 75 ? " meter--warning" : "";
  const state = neutral ? "" : pct >= 90 ? ", critical" : pct >= 75 ? ", warning" : "";
  return (
    <div
      class={"meter" + tone + (large ? " meter--lg" : "")}
      role={label ? "meter" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${pct < 0.1 && pct > 0 ? "<0.1" : Math.round(pct * 10) / 10}% used${state}`}
    >
      <div class="meter__fill" style={{ width: `${Math.max(pct > 0 ? 1.5 : 0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/** Dropdown menu: closes on outside click / Escape / Tab, arrow keys move between items, focus returns to the trigger. */
export function Menu({ trigger, children, align = "right" }: { trigger: (open: boolean, toggle: () => void) => ComponentChildren; children: (close: () => void) => ComponentChildren; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>(".menu__item:not(:disabled)") ?? [])];
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) ref.current?.querySelector<HTMLElement>("button")?.focus();
  };
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), close());
      else if (e.key === "Tab") setOpen(false);
      else if (e.key === "ArrowDown") (e.preventDefault(), list[(i + 1) % list.length]?.focus());
      else if (e.key === "ArrowUp") (e.preventDefault(), list[(i - 1 + list.length) % list.length]?.focus());
      else if (e.key === "Home") (e.preventDefault(), list[0]?.focus());
      else if (e.key === "End") (e.preventDefault(), list[list.length - 1]?.focus());
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div class="menu-wrap" ref={ref}>
      {trigger(open, () => setOpen(!open))}
      {open && (
        <div class={"menu" + (align === "left" ? " menu--left" : "")} ref={menuRef} role="menu">
          {children(() => close())}
        </div>
      )}
    </div>
  );
}

let modalSeq = 0;
/** Modal built on the native <dialog> element, so focus is trapped and restored by the browser. */
export function Modal({ title, onClose, children, footer, width }: { title?: ComponentChildren; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren; width?: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [titleId] = useState(() => `modal-title-${++modalSeq}`);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useEffect(() => {
    const d = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    d.showModal();
    const auto = d.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ?? d.querySelector<HTMLElement>(".modal__body input, .modal__body textarea, .modal__body select");
    auto?.focus();
    return () => {
      if (d.open) d.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      class="modal"
      aria-labelledby={title ? titleId : undefined}
      style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined}
      onCancel={(e) => {
        e.preventDefault();
        latestClose.current();
      }}
      onMouseDown={(e) => e.target === e.currentTarget && latestClose.current()}
    >
      <div class="modal__inner">
        {title && (
          <div class="modal__head">
            <div class="modal__title grow" id={titleId}>
              {title}
            </div>
            <Button variant="ghost" size="sm" icon aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          </div>
        )}
        {children}
        {footer && <div class="modal__foot">{footer}</div>}
      </div>
    </dialog>
  );
}

// ---------- Toasts ----------
interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  text?: string;
  action?: { label: string; run: () => void };
  ms: number;
}
const toasts = signal<Toast[]>([]);
let toastId = 0;
const dismiss = (id: number) => (toasts.value = toasts.value.filter((t) => t.id !== id));
/** Errors stay until dismissed; others auto-hide (paused while hovered or focused). */
export function toast(tone: Toast["tone"], title: string, text?: string, opts: { action?: Toast["action"]; ms?: number } = {}) {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, tone, title, text, action: opts.action, ms: opts.ms ?? (tone === "error" ? 0 : opts.action ? 10000 : 3500) }];
  return id;
}
function ToastItem({ t }: { t: Toast }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!t.ms || paused) return;
    const h = setTimeout(() => dismiss(t.id), t.ms);
    return () => clearTimeout(h);
  }, [paused]);
  const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? XCircle : Info;
  return (
    <div
      class={`toast toast--${t.tone}`}
      role={t.tone === "error" ? "alert" : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusIn={() => setPaused(true)}
      onFocusOut={() => setPaused(false)}
    >
      <Icon />
      <div class="toast__body">
        <div class="toast__title">{t.title}</div>
        {t.text && <div class="toast__text">{t.text}</div>}
        {t.action && (
          <Button
            size="sm"
            class="toast__action"
            onClick={() => {
              t.action!.run();
              dismiss(t.id);
            }}
          >
            {t.action.label}
          </Button>
        )}
      </div>
      <button class="copy" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
        <X />
      </button>
    </div>
  );
}
export function Toasts() {
  return (
    <>
      <div class="toasts" aria-live="polite" aria-relevant="additions">
        {toasts.value.map((t) => (
          <ToastItem key={t.id} t={t} />
        ))}
      </div>
      <div class="sr-only" aria-live="polite">
        {announcement.value}
      </div>
    </>
  );
}

/** Simple fixed-row-height virtualisation for long lists inside a scroll container. */
export function useVirtual(count: number, rowHeight: number, overscan = 8) {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [state, setState] = useState({ top: 0, height: 600 });
  useEffect(() => {
    if (!el) return;
    const update = () => setState({ top: el.scrollTop, height: el.clientHeight });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [el]);
  const start = Math.max(0, Math.floor(state.top / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((state.top + state.height) / rowHeight) + overscan);
  return { ref, start, end, total: count * rowHeight, offset: start * rowHeight };
}

/** Arrow-key / Home / End navigation for a role="tablist" (selection follows focus). */
export function onTablistKey(e: KeyboardEvent) {
  const tabs = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')];
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const to = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
  if (to < 0) return;
  e.preventDefault();
  tabs[to].focus();
  tabs[to].click();
}
