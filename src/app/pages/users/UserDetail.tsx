import { useEffect, useMemo, useState } from "preact/hooks";
import { Bug, ChevronLeft, Database, Download, FileText, KeyRound, LogIn, RefreshCw, Settings2, Snowflake, Sun } from "lucide-preact";
import { orgState } from "../../../lib/org";
import { SfError } from "../../../lib/sf";
import type { SfRecord } from "../../../lib/types";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative } from "../../../lib/format";
import { Badge, Button, Callout, CopyButton, Empty, Modal, SearchInput, Spinner, Switch, toast } from "../../../ui";
import { links, navigate } from "../../router";
import { Avatar } from "./UsersPage";

interface UserFull extends SfRecord {
  Id: string;
  Name: string;
  Username: string;
  Email: string;
  Alias: string;
  IsActive: boolean;
  UserType: string;
  Title: string | null;
  Department: string | null;
  LastLoginDate: string | null;
  CreatedDate: string;
  TimeZoneSidKey: string;
  LocaleSidKey: string;
  LanguageLocaleKey: string;
  FederationIdentifier: string | null;
  Manager?: { Id: string; Name: string } | null;
  Profile?: { Id: string; Name: string; UserLicense?: { Name: string } | null } | null;
  UserRole?: { Id: string; Name: string } | null;
}

interface Assignment {
  Id: string;
  PermissionSetId: string;
  PermissionSetGroupId: string | null;
  PermissionSet: { Label: string; Name: string };
  PermissionSetGroup?: { MasterLabel: string; DeveloperName: string } | null;
  SystemModstamp: string;
}
interface Login {
  LoginTime: string;
  Status: string;
  SourceIp: string;
  Application: string;
  Browser: string;
  Platform: string;
  LoginType: string;
}
interface ApexLogRow {
  Id: string;
  StartTime: string;
  Operation: string;
  Request: string;
  Status: string;
  DurationMilliseconds: number;
  LogLength: number;
}
interface TraceFlag {
  Id: string;
  StartDate: string | null;
  ExpirationDate: string;
  DebugLevel?: { DeveloperName: string } | null;
}

interface Data {
  user: UserFull;
  assignments: Assignment[];
  psls: Array<{ Id: string; PermissionSetLicense: { MasterLabel: string } }>;
  groups: Array<{ Group: { Id: string; Name: string; Type: string } }>;
  logins: Login[] | string;
  login: { Id: string; IsFrozen: boolean; IsPasswordLocked: boolean } | null;
}

export function UserDetail({ userId }: { userId: string }) {
  const st = orgState.value!;
  const sf = st.sf;
  const isProd = st.env === "production";
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const [confirm, setConfirm] = useState<null | "loginas" | "freeze" | "unfreeze">(null);
  const [busy, setBusy] = useState(false);
  const lightning = "https://" + sf.lightningHost;

  useEffect(() => {
    (async () => {
      try {
        const q = <T,>(soql: string) => sf.queryAllRecords<T>(soql);
        const [users, assignments, psls, groups, logins, login] = await Promise.all([
          q<UserFull>(
            `SELECT Id, Name, Username, Email, Alias, IsActive, UserType, Title, Department, LastLoginDate, CreatedDate, TimeZoneSidKey, LocaleSidKey, LanguageLocaleKey, FederationIdentifier, Manager.Id, Manager.Name, Profile.Id, Profile.Name, Profile.UserLicense.Name, UserRole.Id, UserRole.Name FROM User WHERE Id = '${userId}'`,
          ),
          q<Assignment>(
            `SELECT Id, PermissionSetId, PermissionSetGroupId, PermissionSet.Label, PermissionSet.Name, PermissionSetGroup.MasterLabel, PermissionSetGroup.DeveloperName, SystemModstamp FROM PermissionSetAssignment WHERE AssigneeId = '${userId}' AND PermissionSet.IsOwnedByProfile = false`,
          ).catch(() => []),
          q<Data["psls"][number]>(`SELECT Id, PermissionSetLicense.MasterLabel FROM PermissionSetLicenseAssign WHERE AssigneeId = '${userId}' ORDER BY PermissionSetLicense.MasterLabel`).catch(() => []),
          q<Data["groups"][number]>(`SELECT Group.Id, Group.Name, Group.Type FROM GroupMember WHERE UserOrGroupId = '${userId}' ORDER BY Group.Name`).catch(() => []),
          sf
            .query<Login>(`SELECT LoginTime, Status, SourceIp, Application, Browser, Platform, LoginType FROM LoginHistory WHERE UserId = '${userId}' ORDER BY LoginTime DESC LIMIT 15`)
            .then((r) => r.records)
            .catch((e: Error) => e.message),
          q<NonNullable<Data["login"]>>(`SELECT Id, IsFrozen, IsPasswordLocked FROM UserLogin WHERE UserId = '${userId}'`).catch(() => []),
        ]);
        if (!users[0]) throw new SfError(`No user with ID ${userId} is visible to you.`, 404);
        setData({ user: users[0], assignments, psls, groups, logins, login: login[0] ?? null });
        document.title = `${isProd ? "[PROD] " : ""}${users[0].Name} · User — Inspector`;
      } catch (e) {
        setError(e as Error);
      }
    })();
  }, [userId, nonce]);

  const loginAsUrl = () => {
    const orgId = st.org?.Id ?? sf.orgId;
    const back = `/lightning/setup/ManageUsers/page?address=${encodeURIComponent(`/${userId}?noredirect=1`)}`;
    return `https://${sf.host}/servlet/servlet.su?oid=${orgId}&suorgadminid=${userId}&retURL=${encodeURIComponent(back)}&targetURL=${encodeURIComponent("/lightning/page/home")}`;
  };

  const setFrozen = async (frozen: boolean) => {
    if (!data?.login) return;
    setBusy(true);
    try {
      await sf.updateRecord("UserLogin", data.login.Id, { IsFrozen: frozen });
      toast("success", frozen ? `${data.user.Name} is frozen` : `${data.user.Name} is unfrozen`, frozen ? "They can't log in until you unfreeze them." : "They can log in again.");
      setNonce((n) => n + 1);
    } catch (e) {
      toast("error", frozen ? "Couldn't freeze the user" : "Couldn't unfreeze the user", (e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (error)
    return (
      <div class="page">
        <Empty error icon={<KeyRound />} title="Couldn't load this user" action={<Button onClick={() => navigate(links.users())}>All users</Button>}>
          {error.message}
        </Empty>
      </div>
    );
  if (!data)
    return (
      <div class="page">
        <div class="empty">
          <Spinner />
          <span>Loading user…</span>
        </div>
      </div>
    );

  const u = data.user;
  const frozen = !!data.login?.IsFrozen;
  const isMe = st.user?.id?.slice(0, 15) === u.Id.slice(0, 15);
  const setupUrl = `${lightning}/lightning/setup/ManageUsers/page?address=${encodeURIComponent(`/${u.Id}?noredirect=1&isUserEntityOverride=1`)}`;

  return (
    <div class="page">
      <div class="page__body">
        <div class="page__head">
          <div class="grow" style={{ minWidth: 0 }}>
            <div class="crumbs">
              <a href={links.users()}>
                <ChevronLeft class="inline-icon" /> Users
              </a>
            </div>
            <div class="uhead">
              <Avatar id={u.Id} name={u.Name} size={48} />
              <div style={{ minWidth: 0 }}>
                <h1 class="page__title truncate">
                  {u.Name}
                  {isMe && <span class="ucell__you">you</span>}
                </h1>
                <div class="page__subtitle">
                  <span class="idpill">
                    <span class="mono">{u.Username}</span>
                    <CopyButton text={u.Username} label="Copy username" />
                  </span>
                  <span class="idpill">
                    <span class="mono">{u.Id}</span>
                    <CopyButton text={u.Id} label="Copy user ID" />
                  </span>
                  {u.IsActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
                  {frozen && (
                    <Badge tone="info">
                      <Snowflake /> Frozen
                    </Badge>
                  )}
                  {data.login?.IsPasswordLocked && <Badge tone="warning">Locked out</Badge>}
                </div>
              </div>
            </div>
          </div>
          <div class="page__actions">
            {!isMe && u.IsActive && (
              <Button size="sm" onClick={() => setConfirm("loginas")}>
                <LogIn /> Log in as
              </Button>
            )}
            {!isMe && data.login && (
              <Button size="sm" onClick={() => setConfirm(frozen ? "unfreeze" : "freeze")} disabled={busy}>
                {frozen ? <Sun /> : <Snowflake />} {frozen ? "Unfreeze" : "Freeze"}
              </Button>
            )}
            <Button size="sm" onClick={() => navigate(links.record("User", u.Id))}>
              <Database /> Inspect record
            </Button>
            <Button size="sm" variant="primary" onClick={() => window.open(setupUrl, "_blank")}>
              <Settings2 /> Open in Setup
            </Button>
          </div>
        </div>

        <div class="ugrid">
          <div class="ugrid__col">
            <section class="card">
              <div class="card__head">
                <span class="card__title">Details</span>
              </div>
              <dl class="dprops ucard__props">
                <dt>Email</dt>
                <dd>{u.Email}</dd>
                <dt>Profile</dt>
                <dd>{u.Profile ? <a href={links.record("Profile", u.Profile.Id)}>{u.Profile.Name}</a> : "—"}</dd>
                <dt>Role</dt>
                <dd>{u.UserRole ? <a href={links.record("UserRole", u.UserRole.Id)}>{u.UserRole.Name}</a> : "—"}</dd>
                <dt>License</dt>
                <dd>{u.Profile?.UserLicense?.Name ?? "—"}</dd>
                <dt>Manager</dt>
                <dd>{u.Manager ? <a href={links.user(u.Manager.Id)}>{u.Manager.Name}</a> : "—"}</dd>
                {u.Title && (
                  <>
                    <dt>Title</dt>
                    <dd>{u.Title}</dd>
                  </>
                )}
                {u.Department && (
                  <>
                    <dt>Department</dt>
                    <dd>{u.Department}</dd>
                  </>
                )}
                <dt>Alias</dt>
                <dd class="mono">{u.Alias}</dd>
                <dt>User type</dt>
                <dd>{u.UserType}</dd>
                <dt>Federation ID</dt>
                <dd class="mono">{u.FederationIdentifier ?? "—"}</dd>
                <dt>Locale</dt>
                <dd>
                  {u.LocaleSidKey} · {u.LanguageLocaleKey} · {u.TimeZoneSidKey}
                </dd>
                <dt>Last login</dt>
                <dd title={u.LastLoginDate ?? undefined}>{u.LastLoginDate ? `${fmtDateTime(u.LastLoginDate)} (${fmtRelative(Date.parse(u.LastLoginDate))})` : "Never"}</dd>
                <dt>Created</dt>
                <dd>{fmtDate(u.CreatedDate)}</dd>
              </dl>
            </section>

            <AccessCard data={data} />
          </div>
          <div class="ugrid__col">
            <DebugCard userId={u.Id} name={u.Name} />
            <LoginHistory logins={data.logins} />
          </div>
        </div>
      </div>

      {confirm === "loginas" && (
        <Modal
          title={`Log in as ${u.Name}?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button onClick={() => setConfirm(null)} data-autofocus>
                Cancel
              </Button>
              <Button variant={isProd ? "danger" : "primary"} onClick={() => (window.open(loginAsUrl(), "_blank"), setConfirm(null))}>
                <LogIn /> Log in as {u.Name.split(" ")[0]}
              </Button>
            </>
          }
        >
          <div class="modal__body stack" style={{ gap: 10 }}>
            <p>Salesforce switches this browser's session to {u.Name}. Every Salesforce tab for this org, and Inspector, will act as them until you log out of their session.</p>
            {isProd && <Callout tone="warning">This is a production org. Actions you take are recorded under your name in the setup audit trail.</Callout>}
            <p class="muted">Requires the “Log in as any user” org setting or the user granting you access.</p>
          </div>
        </Modal>
      )}
      {(confirm === "freeze" || confirm === "unfreeze") && (
        <Modal
          title={confirm === "freeze" ? `Freeze ${u.Name}?` : `Unfreeze ${u.Name}?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button onClick={() => setConfirm(null)} data-autofocus>
                Cancel
              </Button>
              <Button variant={confirm === "freeze" ? "danger" : "primary"} onClick={() => setFrozen(confirm === "freeze")} disabled={busy}>
                {busy ? <Spinner small /> : confirm === "freeze" ? <Snowflake /> : <Sun />} {confirm === "freeze" ? "Freeze user" : "Unfreeze user"}
              </Button>
            </>
          }
        >
          <div class="modal__body">
            <p>
              {confirm === "freeze"
                ? `${u.Name} won't be able to log in until they're unfrozen. Their licenses, permissions and records are not changed.`
                : `${u.Name} will be able to log in again.`}
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AccessCard({ data }: { data: Data }) {
  const [tab, setTab] = useState<"ps" | "psl" | "groups">("ps");
  const sets = data.assignments
    .map((a) => ({ id: a.PermissionSetGroupId ?? a.PermissionSetId, label: a.PermissionSetGroup?.MasterLabel ?? a.PermissionSet.Label, api: a.PermissionSetGroup?.DeveloperName ?? a.PermissionSet.Name, group: !!a.PermissionSetGroupId, at: a.SystemModstamp }))
    .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
    .sort((a, b) => a.label.localeCompare(b.label));
  return (
    <section class="card">
      <div class="card__head">
        <span class="card__title">Access</span>
        <div class="seg" role="group" aria-label="Access type" style={{ marginLeft: "auto" }}>
          <button aria-pressed={tab === "ps"} onClick={() => setTab("ps")}>
            Permission sets <span class="seg__count">{sets.length}</span>
          </button>
          <button aria-pressed={tab === "psl"} onClick={() => setTab("psl")}>
            Licenses <span class="seg__count">{data.psls.length}</span>
          </button>
          <button aria-pressed={tab === "groups"} onClick={() => setTab("groups")}>
            Groups <span class="seg__count">{data.groups.length}</span>
          </button>
        </div>
      </div>
      <div class="ulist">
        {tab === "ps" &&
          (sets.length ? (
            sets.map((p) => (
              <a class="ulist__row" key={p.id} href={links.record(p.group ? "PermissionSetGroup" : "PermissionSet", p.id)}>
                <span class="grow truncate">{p.label}</span>
                <span class="mono muted truncate ulist__api">{p.api}</span>
                {p.group && <Badge tone="accent">Group</Badge>}
              </a>
            ))
          ) : (
            <div class="ulist__empty">No permission sets assigned beyond the profile.</div>
          ))}
        {tab === "psl" &&
          (data.psls.length ? (
            data.psls.map((p) => (
              <div class="ulist__row" key={p.Id}>
                <span class="grow truncate">{p.PermissionSetLicense.MasterLabel}</span>
              </div>
            ))
          ) : (
            <div class="ulist__empty">No permission set licenses.</div>
          ))}
        {tab === "groups" &&
          (data.groups.length ? (
            data.groups.map((g) => (
              <a class="ulist__row" key={g.Group.Id} href={links.record("Group", g.Group.Id)}>
                <span class="grow truncate">{g.Group.Name || "(unnamed)"}</span>
                <Badge>{g.Group.Type}</Badge>
              </a>
            ))
          ) : (
            <div class="ulist__empty">Not a direct member of any public group or queue.</div>
          ))}
      </div>
    </section>
  );
}

function LoginHistory({ logins }: { logins: Login[] | string }) {
  return (
    <section class="card">
      <div class="card__head">
        <span class="card__title">Recent logins</span>
      </div>
      {typeof logins === "string" ? (
        <div class="card__body">
          <Callout tone="warning">{logins}</Callout>
        </div>
      ) : logins.length === 0 ? (
        <div class="ulist__empty">No logins recorded.</div>
      ) : (
        <div class="ulist">
          {logins.map((l, i) => (
            <div class="ulist__row ulog" key={i}>
              <span class={"status-dot " + (l.Status === "Success" ? "is-ok" : "is-danger")} aria-hidden="true" />
              <span class="ulog__when tabular" title={l.LoginTime}>
                {fmtDateTime(l.LoginTime)}
              </span>
              <span class="grow truncate subtle" title={`${l.Application} · ${l.Browser} · ${l.Platform}`}>
                {l.Status === "Success" ? l.Application || l.LoginType : l.Status}
              </span>
              <span class="mono muted ulog__ip">{l.SourceIp}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Debug logging: turn a USER_DEBUG trace flag on/off for this user, list recent logs and read them. */
function DebugCard({ userId, name }: { userId: string; name: string }) {
  const sf = orgState.value!.sf;
  const [flag, setFlag] = useState<TraceFlag | null | undefined>(undefined);
  const [logs, setLogs] = useState<ApexLogRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<ApexLogRow | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    sf.query<TraceFlag>(`SELECT Id, StartDate, ExpirationDate, DebugLevel.DeveloperName FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'USER_DEBUG' ORDER BY ExpirationDate DESC LIMIT 1`, { tooling: true })
      .then((r) => setFlag(r.records[0] ?? null))
      .catch(() => setFlag(null));
    sf.query<ApexLogRow>(`SELECT Id, StartTime, Operation, Request, Status, DurationMilliseconds, LogLength FROM ApexLog WHERE LogUserId = '${userId}' ORDER BY StartTime DESC LIMIT 20`)
      .then((r) => setLogs(r.records))
      .catch(() => setLogs([]));
  }, [userId, nonce]);

  const active = !!flag && Date.parse(flag.ExpirationDate) > Date.now();

  // While logging is on, pick up new logs every 15 s (only when this tab is visible).
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => document.visibilityState === "visible" && setNonce((n) => n + 1), 15_000);
    return () => clearInterval(h);
  }, [active]);

  /** Use the Developer Console's debug level when it exists, otherwise create a sensible one. */
  const debugLevelId = async () => {
    const existing = await sf.query<{ Id: string }>(`SELECT Id FROM DebugLevel WHERE DeveloperName IN ('SFDC_DevConsole', 'SIE_Debug') ORDER BY DeveloperName LIMIT 1`, { tooling: true });
    if (existing.records[0]) return existing.records[0].Id;
    const created = await sf.createRecord(
      "DebugLevel",
      { DeveloperName: "SIE_Debug", MasterLabel: "SIE_Debug", ApexCode: "FINEST", ApexProfiling: "INFO", Callout: "INFO", Database: "INFO", System: "DEBUG", Validation: "INFO", Visualforce: "INFO", Workflow: "INFO" },
      true,
    );
    return created.id;
  };

  const enable = async (minutes = 30) => {
    setBusy(true);
    const start = new Date();
    // Extending adds to the current expiry; trace flags can last at most 24 hours.
    const from = active ? Math.max(Date.now(), Date.parse(flag!.ExpirationDate)) : Date.now();
    const end = new Date(Math.min(from + minutes * 60_000, Date.now() + 24 * 3600_000 - 60_000));
    try {
      if (flag) await sf.updateRecord("TraceFlag", flag.Id, active ? { ExpirationDate: end.toISOString() } : { StartDate: start.toISOString(), ExpirationDate: end.toISOString() }, true);
      else await sf.createRecord("TraceFlag", { TracedEntityId: userId, DebugLevelId: await debugLevelId(), LogType: "USER_DEBUG", StartDate: start.toISOString(), ExpirationDate: end.toISOString() }, true);
      toast("success", `Debug logging on for ${name}`, `Until ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Logs appear here as they're written.`);
      setNonce((n) => n + 1);
    } catch (e) {
      toast("error", "Couldn't turn on debug logging", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!flag) return;
    setBusy(true);
    try {
      await sf.deleteRecord("TraceFlag", flag.Id, true);
      toast("success", "Debug logging off");
      setNonce((n) => n + 1);
    } catch (e) {
      toast("error", "Couldn't turn off debug logging", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card">
      <div class="card__head">
        <span class="card__title">Debug logs</span>
        <Button size="sm" variant="ghost" icon aria-label="Refresh logs" data-tip="Refresh" data-tip-pos="left" onClick={() => setNonce((n) => n + 1)} style={{ marginLeft: "auto" }}>
          <RefreshCw />
        </Button>
      </div>
      <div class={"udebug" + (active ? " is-on" : "")}>
        {flag === undefined ? (
          <Spinner small />
        ) : active ? (
          <>
            <span class="udebug__dot" aria-hidden="true" />
            <span class="grow">
              Logging until <strong>{new Date(flag!.ExpirationDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
              <span class="muted"> · {flag!.DebugLevel?.DeveloperName ?? "debug level"}</span>
            </span>
            <Button size="sm" onClick={() => enable(30)} disabled={busy}>
              +30 min
            </Button>
            <Button size="sm" variant="ghost" onClick={disable} disabled={busy}>
              Stop
            </Button>
          </>
        ) : (
          <>
            <span class="grow muted">Debug logging is off for this user.</span>
            <Button size="sm" variant="primary" onClick={() => enable(30)} disabled={busy}>
              {busy ? <Spinner small /> : <Bug />} Log for 30 min
            </Button>
          </>
        )}
      </div>
      {logs === null ? (
        <div class="ulist__empty">
          <Spinner small />
        </div>
      ) : logs.length === 0 ? (
        <div class="ulist__empty">No debug logs for this user yet.</div>
      ) : (
        <div class="ulist">
          {logs.map((l) => (
            <button class="ulist__row ulog ulog--btn" key={l.Id} onClick={() => setViewing(l)}>
              <FileText class="ulog__icon" aria-hidden="true" />
              <span class="ulog__when tabular">{fmtDateTime(l.StartTime)}</span>
              <span class="grow truncate" title={l.Operation}>
                {l.Operation}
              </span>
              <span class={"ulog__status" + (l.Status === "Success" ? "" : " t-danger")}>{l.Status === "Success" ? `${fmtNumber(l.DurationMilliseconds)} ms` : l.Status}</span>
              <span class="muted tabular ulog__size">{(l.LogLength / 1024).toFixed(l.LogLength < 10240 ? 1 : 0)} KB</span>
            </button>
          ))}
        </div>
      )}
      {viewing && <LogViewer log={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

const MAX_LINES = 6000;

function LogViewer({ log, onClose }: { log: ApexLogRow; onClose: () => void }) {
  const sf = orgState.value!.sf;
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debugOnly, setDebugOnly] = useState(false);
  useEffect(() => {
    sf.getText(sf.path(`/sobjects/ApexLog/${log.Id}/Body`)).then(setBody, (e) => setError(e.message));
  }, [log.Id]);
  const lines = useMemo(() => {
    if (!body) return [];
    const s = q.trim().toLowerCase();
    return body.split("\n").filter((l) => (!debugOnly || /USER_DEBUG|EXCEPTION|FATAL_ERROR/.test(l)) && (!s || l.toLowerCase().includes(s)));
  }, [body, q, debugOnly]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([body ?? ""], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `apex-${log.Id}.log`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Modal
      title={
        <>
          {log.Operation} <span class="muted">· {fmtDateTime(log.StartTime)}</span>
        </>
      }
      onClose={onClose}
      width={1000}
      footer={
        <>
          <span class="muted grow" style={{ fontSize: "var(--fs-sm)" }}>
            {body ? `${fmtNumber(lines.length)} of ${fmtNumber(body.split("\n").length)} lines` : ""}
          </span>
          <Button onClick={download} disabled={!body}>
            <Download /> Download
          </Button>
        </>
      }
    >
      <div class="modal__body stack" style={{ gap: 10 }}>
        <div class="row">
          <SearchInput value={q} onInput={setQ} placeholder="Filter lines" size="sm" class="grow" />
          <Switch checked={debugOnly} onChange={setDebugOnly}>
            Debug & errors only
          </Switch>
        </div>
        {error ? (
          <Callout tone="danger">{error}</Callout>
        ) : !body ? (
          <div class="row muted">
            <Spinner small /> Loading log…
          </div>
        ) : (
          <pre class="logview">
            {lines.slice(0, MAX_LINES).map((l, i) => (
              <span key={i} class={/USER_DEBUG/.test(l) ? "logview__debug" : /EXCEPTION|FATAL_ERROR/.test(l) ? "logview__error" : undefined}>
                {l + "\n"}
              </span>
            ))}
            {lines.length > MAX_LINES && <span class="muted">… {fmtNumber(lines.length - MAX_LINES)} more lines — download the log to see everything.</span>}
          </pre>
        )}
      </div>
    </Modal>
  );
}

