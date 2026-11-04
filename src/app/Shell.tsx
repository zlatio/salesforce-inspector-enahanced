import { Activity, Check, ChevronDown, Copy, Database, ExternalLink, Gauge, Monitor, Moon, Search, Settings2, Sun, TerminalSquare, Upload, Users } from "lucide-preact";
import { orgState, shortOrgName } from "../lib/org";
import { apiUsage } from "../lib/sf";
import { setTheme, themePref, resolvedTheme, type ThemePref } from "../lib/theme";
import { fmtNumber, fmtPercent } from "../lib/format";
import { Button, copyText, EnvBadge, Keys, Menu, modKey, toast } from "../ui";
import { paletteOpen } from "./Palette";
import { links, route, type PageId } from "./router";

export function Header() {
  const st = orgState.value!;
  const name = st.org?.Name ?? shortOrgName(st.sf.host);
  const sandboxName = st.env === "sandbox" ? shortOrgName(st.sf.host) : null;
  const lightning = "https://" + st.sf.lightningHost;
  return (
    <header class={"header" + (st.env === "production" ? " header--prod" : "")}>
      <a class="brand" href={links.objects()} aria-label="Inspector home">
        <img src="./icons/icon32.png" width={22} height={22} alt="" />
        <span class="brand__name">Inspector</span>
      </a>
      <div class="header__divider" />
      <Menu
        align="left"
        trigger={(open, toggle) => (
          <button class={"orgchip" + (open ? " is-open" : "")} onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
            <span class="orgchip__name">{name}</span>
            {sandboxName && <span class="orgchip__sandbox">/ {sandboxName}</span>}
            <EnvBadge env={st.env} />
            <ChevronDown class="orgchip__chev" />
          </button>
        )}
      >
        {(close) => (
          <>
            <div class="orgmenu__info" role="none">
              <div class="orgmenu__row">
                <span class="muted">Host</span>
                <span class="mono truncate">{st.sf.host}</span>
              </div>
              {st.org && (
                <>
                  <div class="orgmenu__row">
                    <span class="muted">Org ID</span>
                    <span class="mono">{st.org.Id}</span>
                  </div>
                  <div class="orgmenu__row">
                    <span class="muted">Edition</span>
                    <span>{st.org.OrganizationType}</span>
                  </div>
                  <div class="orgmenu__row">
                    <span class="muted">Instance</span>
                    <span>{st.org.InstanceName}</span>
                  </div>
                </>
              )}
              {st.user && (
                <div class="orgmenu__row">
                  <span class="muted">User</span>
                  <span class="truncate">{st.user.username}</span>
                </div>
              )}
              <div class="orgmenu__row">
                <span class="muted">API</span>
                <span>v{st.sf.version}</span>
              </div>
            </div>
            <div class="menu__sep" />
            <button role="menuitem" class="menu__item" onClick={() => (window.open(lightning + "/lightning/page/home", "_blank"), close())}>
              <ExternalLink /> Open org home
            </button>
            <button role="menuitem" class="menu__item" onClick={() => (window.open(lightning + "/lightning/setup/SetupOneHome/home", "_blank"), close())}>
              <Settings2 /> Open Setup
            </button>
            {st.org && (
              <button role="menuitem" class="menu__item" onClick={() => (copyText(st.org!.Id), toast("success", "Org ID copied"), close())}>
                <Copy /> Copy org ID
              </button>
            )}
            {st.user && (
              <button role="menuitem" class="menu__item" onClick={() => (copyText(st.user!.id), toast("success", "User ID copied"), close())}>
                <Copy /> Copy my user ID
              </button>
            )}
          </>
        )}
      </Menu>

      <button class="cmdk" onClick={() => (paletteOpen.value = true)}>
        <Search />
        <span class="grow">Search objects, paste a record ID, or run a command…</span>
        <Keys k={[modKey, "K"]} />
      </button>

      <div class="header__right">
        <ApiUsageChip />
        <ThemeMenu />
      </div>
    </header>
  );
}

function ApiUsageChip() {
  const u = apiUsage.value;
  if (!u) return null;
  const pct = (u.used / u.max) * 100;
  const tone = pct >= 90 ? "danger" : pct >= 75 ? "warning" : "ok";
  return (
    <a class={`apichip apichip--${tone}`} href={links.limits()} data-tip={`${fmtNumber(u.used)} of ${fmtNumber(u.max)} daily API requests used`}>
      <Activity />
      <span class="apichip__label">API</span>
      <span class="apichip__bar">
        <span style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </span>
      <span class="tabular">{fmtPercent(pct)}</span>
    </a>
  );
}

export function ThemeMenu({ align = "right" }: { align?: "left" | "right" }) {
  const opts: Array<{ v: ThemePref; label: string; Icon: typeof Sun }> = [
    { v: "system", label: "System", Icon: Monitor },
    { v: "light", label: "Light", Icon: Sun },
    { v: "dark", label: "Dark", Icon: Moon },
  ];
  const CurrentIcon = themePref.value === "system" ? Monitor : resolvedTheme.value === "dark" ? Moon : Sun;
  return (
    <Menu
      align={align}
      trigger={(open, toggle) => (
        <Button variant="ghost" icon aria-label={`Theme: ${themePref.value}`} aria-haspopup="menu" aria-expanded={open} data-tip="Theme" onClick={toggle}>
          <CurrentIcon />
        </Button>
      )}
    >
      {(close) => (
        <>
          <div class="menu__label" role="none">Appearance</div>
          {opts.map(({ v, label, Icon }) => (
            <button role="menuitemradio" aria-checked={themePref.value === v} class="menu__item" key={v} onClick={() => (setTheme(v), close())}>
              <Icon /> {label}
              {themePref.value === v && <Check style={{ marginLeft: "auto", color: "var(--accent)" }} />}
            </button>
          ))}
        </>
      )}
    </Menu>
  );
}

const NAV: Array<{ id: PageId; label: string; Icon: typeof Database; href: string }> = [
  { id: "inspect", label: "Objects", Icon: Database, href: links.objects() },
  { id: "query", label: "Query", Icon: TerminalSquare, href: links.query() },
  { id: "limits", label: "Limits", Icon: Gauge, href: links.limits() },
  { id: "users", label: "Users", Icon: Users, href: links.users() },
  { id: "import", label: "Import", Icon: Upload, href: links.import() },
];

export function Rail() {
  const current = route.value.page;
  return (
    <nav class="rail" aria-label="Tools">
      {NAV.map(({ id, label, Icon, href }) => (
        <a key={id} href={href} class={"rail__item" + (current === id ? " is-active" : "")} aria-current={current === id ? "page" : undefined} title={`${label} (g then ${({ inspect: "o", query: "q", limits: "l", users: "u", import: "i" } as const)[id]})`}>
          <span class="rail__icon">
            <Icon />
          </span>
          <span class="rail__label">{label}</span>
        </a>
      ))}
    </nav>
  );
}
