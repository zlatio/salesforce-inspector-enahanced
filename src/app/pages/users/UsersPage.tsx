import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Search, Snowflake, UserRound, Users } from "lucide-preact";
import { orgState } from "../../../lib/org";
import type { SfRecord } from "../../../lib/types";
import { fmtNumber, fmtRelative } from "../../../lib/format";
import { Badge, Callout, Empty, SearchInput, Seg, Spinner, Switch } from "../../../ui";
import { links, navigate, route } from "../../router";
import { UserDetail } from "./UserDetail";
import "./users.css";

export interface UserRow extends SfRecord {
  Id: string;
  Name: string;
  Username: string;
  Email: string;
  IsActive: boolean;
  LastLoginDate: string | null;
  UserType: string;
  Profile?: { Name: string; UserLicense?: { Name: string } | null } | null;
  UserRole?: { Name: string } | null;
}

export const soqlEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
export const likeEscape = (s: string) => soqlEscape(s).replace(/%/g, "\\%").replace(/_/g, "\\_");

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** Stable, theme-safe avatar tint from the user id. */
export function Avatar({ id, name, size = 32 }: { id: string; name: string; size?: number }) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span class="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), "--hue": String(h) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function UsersPage() {
  const id = route.value.parts[0];
  if (id) return <UserDetail key={id} userId={id} />;
  return <UserList />;
}

type Status = "active" | "inactive" | "all";
type Sort = "name" | "login";

function UserList() {
  const sf = orgState.value!.sf;
  const me = orgState.value!.user;
  const p0 = route.value.params;
  const [q, setQ] = useState(() => p0.get("q") ?? "");
  const [status, setStatus] = useState<Status>(() => (p0.get("status") as Status) || "active");
  const [sort, setSort] = useState<Sort>(() => (p0.get("sort") as Sort) || "name");
  const [allTypes, setAllTypes] = useState(() => p0.get("types") === "all");
  // Keep the list state in the URL so returning from a user restores it.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (status !== "active") p.set("status", status);
    if (sort !== "name") p.set("sort", sort);
    if (allTypes) p.set("types", "all");
    const qs = p.toString();
    navigate("#/users" + (qs ? "?" + qs : ""), true);
  }, [q, status, sort, allTypes]);
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [frozen, setFrozen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const h = setTimeout(async () => {
      const where: string[] = [];
      if (status !== "all") where.push(`IsActive = ${status === "active"}`);
      if (!allTypes) where.push(`UserType = 'Standard'`);
      const s = q.trim();
      if (s) {
        const l = likeEscape(s);
        where.push(`(Name LIKE '%${l}%' OR Username LIKE '%${l}%' OR Email LIKE '%${l}%' OR Profile.Name LIKE '%${l}%' OR UserRole.Name LIKE '%${l}%')`);
      }
      const order = sort === "name" ? "Name ASC" : "LastLoginDate DESC NULLS LAST";
      const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
      try {
        const [res, count] = await Promise.all([
          sf.query<UserRow>(`SELECT Id, Name, Username, Email, IsActive, LastLoginDate, UserType, Profile.Name, Profile.UserLicense.Name, UserRole.Name FROM User${whereSql} ORDER BY ${order} LIMIT 200`),
          sf.query(`SELECT COUNT() FROM User${whereSql}`).catch(() => null),
        ]);
        if (cancelled) return;
        setRows(res.records);
        setTotal(count?.totalSize ?? res.totalSize);
        setError(null);
        const ids = res.records.map((r) => `'${r.Id}'`);
        if (ids.length) {
          const fz = await sf.query<{ UserId: string }>(`SELECT UserId FROM UserLogin WHERE IsFrozen = true AND UserId IN (${ids.join(",")})`).catch(() => null);
          if (!cancelled) setFrozen(new Set(fz?.records.map((r) => r.UserId) ?? []));
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [q, status, sort, allTypes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement).tagName;
      if (e.key === "/" && t !== "INPUT" && t !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const licenseCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const l = r.Profile?.UserLicense?.Name ?? "—";
      m.set(l, (m.get(l) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [rows]);

  return (
    <div class="page">
      <div class="page__head">
        <div class="grow">
          <h1 class="page__title">Users</h1>
          <div class="page__subtitle">
            {rows ? (
              <>
                <span>{total > rows.length ? `Showing ${fmtNumber(rows.length)} of ${fmtNumber(total)} users` : `${fmtNumber(total)} ${total === 1 ? "user" : "users"}`}</span>
                {licenseCounts.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {total > rows.length ? "Shown: " : ""}
                      {licenseCounts.map(([l, n]) => `${n} ${l}`).join(" · ")}
                    </span>
                  </>
                )}
              </>
            ) : (
              "Loading users…"
            )}
          </div>
        </div>
        {me && (
          <div class="page__actions">
            <button class="btn btn--sm" onClick={() => navigate(links.user(me.id))}>
              <UserRound /> My user
            </button>
          </div>
        )}
      </div>
      <div class="toolbar">
        <SearchInput inputRef={searchRef} value={q} onInput={setQ} placeholder="Search name, username, email, profile or role" autoFocus class="toolbar__search users__search" hint={<kbd class="kbd">/</kbd>} />
        <Seg<Status>
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "all", label: "All" },
          ]}
        />
        <Switch checked={allTypes} onChange={setAllTypes} title="Also show portal, guest, integration and automated-process users">
          Non-standard users
        </Switch>
        <div class="row" style={{ marginLeft: "auto", gap: 6 }}>
          <span class="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Sort
          </span>
          <Seg<Sort>
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: "name", label: "Name" },
              { value: "login", label: "Last login" },
            ]}
          />
        </div>
      </div>
      {error ? (
        <div class="lpad">
          <Callout tone="danger" title="Couldn't load users">
            {error}
          </Callout>
        </div>
      ) : !rows ? (
        <div class="empty">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <Empty icon={<Search />} title="No users match">
          Try another search or status filter.
        </Empty>
      ) : (
        <div class="tablewrap userlist">
          <table class="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Profile</th>
                <th>Role</th>
                <th>License</th>
                <th>Last login</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.Id} class={u.IsActive ? "" : "is-inactive"}>
                  <td>
                    <a class="ucell" href={links.user(u.Id)}>
                      <Avatar id={u.Id} name={u.Name} />
                      <span class="ucell__text">
                        <span class="ucell__name">
                          {u.Name}
                          {me?.id?.slice(0, 15) === u.Id.slice(0, 15) && <span class="ucell__you">you</span>}
                        </span>
                        <span class="ucell__user mono truncate">{u.Username}</span>
                      </span>
                    </a>
                  </td>
                  <td class="truncate">{u.Profile?.Name ?? "—"}</td>
                  <td class="truncate subtle">{u.UserRole?.Name ?? "—"}</td>
                  <td class="truncate subtle">{u.Profile?.UserLicense?.Name ?? "—"}</td>
                  <td class="tabular subtle" title={u.LastLoginDate ?? "Never"}>
                    {u.LastLoginDate ? fmtRelative(Date.parse(u.LastLoginDate)) : "Never"}
                  </td>
                  <td>
                    <div class="row" style={{ gap: 4 }}>
                      {u.IsActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
                      {frozen.has(u.Id) && (
                        <Badge tone="info">
                          <Snowflake /> Frozen
                        </Badge>
                      )}
                      {u.UserType !== "Standard" && <Badge>{u.UserType}</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > rows.length && (
            <div class="ftable__hidden">
              <Users class="inline-icon" /> Showing the first {rows.length}. Narrow the search to find others.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
