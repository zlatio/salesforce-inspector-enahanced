import { useEffect, useMemo, useState } from "preact/hooks";
import { GitFork, Hash, TerminalSquare } from "lucide-preact";
import { orgState } from "../../../lib/org";
import type { DescribeSObjectResult, GlobalSObject } from "../../../lib/types";
import { fmtNumber, plural } from "../../../lib/format";
import { Badge, Button, Empty, SearchInput, Spinner, Switch, toast } from "../../../ui";
import { links, navigate } from "../../router";
import { buildDefaultQuery } from "../../../lib/queries";

type Count = number | "loading" | "error";

export function RelationshipsTab({ describe, recordId }: { describe: DescribeSObjectResult; recordId?: string }) {
  const sf = orgState.value!.sf;
  const [q, setQ] = useState("");
  const cacheKey = recordId ? `sie.relcounts.${sf.host}.${recordId}` : null;
  const [counts, setCounts] = useState<Record<string, Count>>(() => {
    try {
      return cacheKey ? JSON.parse(sessionStorage.getItem(cacheKey) ?? "{}") : {};
    } catch {
      return {};
    }
  });
  const [countingAll, setCountingAll] = useState(false);
  const [hideEmpty, setHideEmptyState] = useState(() => localStorage.getItem("sie.rel.hideEmpty") !== "false");
  const setHideEmpty = (v: boolean) => {
    setHideEmptyState(v);
    localStorage.setItem("sie.rel.hideEmpty", String(v));
  };
  const [labels, setLabels] = useState<Map<string, GlobalSObject>>(new Map());

  useEffect(() => {
    sf.describeGlobal().then((g) => setLabels(new Map(g.sobjects.map((o) => [o.name, o]))));
    // Counts are the reason to open this tab on a record — but wait a beat, so arrowing past the tab is free.
    if (!recordId || Object.keys(counts).length) return;
    const h = setTimeout(() => countAll(), 400);
    return () => clearTimeout(h);
  }, []);

  const all = useMemo(() => describe.childRelationships.filter((r) => r.relationshipName && !r.deprecatedAndHidden), [describe]);
  const keyOf = (r: (typeof all)[number]) => r.relationshipName + ":" + r.childSObject;
  const countable = (r: (typeof all)[number]) => labels.get(r.childSObject)?.queryable !== false;
  const counted = Object.values(counts).filter((c) => typeof c === "number").length;
  const allDone = all.length > 0 && all.every((r) => typeof counts[keyOf(r)] === "number" || counts[keyOf(r)] === "error");

  const rels = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all
      .filter((r) => !s || r.relationshipName!.toLowerCase().includes(s) || r.childSObject.toLowerCase().includes(s) || r.field.toLowerCase().includes(s) || (labels.get(r.childSObject)?.label.toLowerCase().includes(s) ?? false))
      .filter((r) => !hideEmpty || !recordId || (counts[keyOf(r)] !== 0 && counts[keyOf(r)] !== "error"))
      .sort((a, b) => {
        const ca = counts[keyOf(a)];
        const cb = counts[keyOf(b)];
        const na = typeof ca === "number" ? ca : -1;
        const nb = typeof cb === "number" ? cb : -1;
        return nb - na || a.relationshipName!.localeCompare(b.relationshipName!);
      });
  }, [all, q, counts, hideEmpty, labels]);

  const countQuery = (child: string, field: string) => `SELECT COUNT() FROM ${child} WHERE ${field} = '${recordId}'`;

  const count = async (key: string, child: string, field: string) => {
    setCounts((c) => ({ ...c, [key]: "loading" }));
    try {
      const res = await sf.query(countQuery(child, field));
      setCounts((c) => ({ ...c, [key]: res.totalSize }));
    } catch {
      setCounts((c) => ({ ...c, [key]: "error" }));
    }
  };

  // Batch every COUNT() through the Composite Batch API: 25 queries per request instead of one each.
  const countAll = async (manual = false, fresh = false) => {
    // Count every relationship: the global "queryable" flag is unreliable for child lookups, and
    // the few that genuinely can't be queried just come back as n/a.
    const todo = fresh ? all : all.filter((r) => typeof counts[keyOf(r)] !== "number");
    if (!todo.length) return;
    setCountingAll(true);
    setCounts((c) => ({ ...c, ...Object.fromEntries(todo.map((r) => [keyOf(r), "loading" as Count])) }));
    try {
      const res = await sf.batch<{ totalSize?: number }>(todo.map((r) => sf.path("/query/") + "?q=" + encodeURIComponent(countQuery(r.childSObject, r.field))));
      const next: Record<string, Count> = {};
      todo.forEach((r, i) => (next[keyOf(r)] = res[i]?.status === 200 && typeof res[i].body?.totalSize === "number" ? res[i].body.totalSize! : "error"));
      setCounts((c) => {
        const merged = { ...c, ...next };
        if (cacheKey) sessionStorage.setItem(cacheKey, JSON.stringify(merged));
        return merged;
      });
      const withRecords = Object.values(next).filter((v) => typeof v === "number" && v > 0).length;
      if (manual) toast("success", `Counted ${plural(todo.length, "relationship")}`, `${withRecords} with related records · ${Math.ceil(todo.length / 25)} API ${Math.ceil(todo.length / 25) === 1 ? "call" : "calls"}`);
    } catch (e) {
      toast("error", "Couldn't count relationships", (e as Error).message);
      setCounts((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v === "loading" ? "error" : v])));
    } finally {
      setCountingAll(false);
    }
  };

  /** One related record opens it; more open a query listing them. */
  const openChildren = async (child: string, field: string, n: number) => {
    if (n === 1) {
      try {
        const res = await sf.query<{ Id: string }>(`SELECT Id FROM ${child} WHERE ${field} = '${recordId}' LIMIT 1`);
        if (res.records[0]) return navigate(links.record(child, res.records[0].Id));
      } catch {
        /* fall through to the query */
      }
    }
    navigate(links.query(await buildDefaultQuery(sf, child, { where: `${field} = '${recordId}'`, extra: [field] })));
  };

  const cascade = all.filter((r) => r.cascadeDelete).length;
  const withRecords = Object.values(counts).filter((c) => typeof c === "number" && c > 0).length;

  return (
    <div class="fields">
      <div class="toolbar">
        <SearchInput value={q} onInput={setQ} placeholder="Filter by name, object or field" class="toolbar__search" />
        {recordId && (
          <>
            <Button size="sm" onClick={() => countAll(true, allDone)} disabled={countingAll}>
              {countingAll ? <Spinner small /> : <Hash />} {countingAll ? "Counting…" : allDone ? "Recount" : "Count all"}
            </Button>
            {counted > 0 && (
              <Switch checked={hideEmpty} onChange={setHideEmpty}>
                Hide empty
              </Switch>
            )}
          </>
        )}
        <span class="muted tabular" style={{ marginLeft: "auto" }}>
          {fmtNumber(all.length)} relationships · {cascade} cascade-delete{counted > 0 ? ` · ${withRecords} with records` : ""}
          {hideEmpty && counted > 0 && rels.length < all.length ? ` · ${all.length - rels.length} empty hidden` : ""}
        </span>
      </div>
      {rels.length === 0 ? (
        <Empty icon={<GitFork />} title="No child relationships">
          {q || hideEmpty ? "Nothing matches your filter." : `${describe.label} has no child relationships visible to you.`}
        </Empty>
      ) : (
        <div class="tablewrap reltable">
          <table class="table">
            <thead>
              <tr>
                <th>Child object</th>
                <th>Relationship</th>
                <th>Via field</th>
                <th>On delete</th>
                <th style={{ textAlign: "right" }}>{recordId ? "Records" : ""}</th>
                <th>
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rels.map((r) => {
                const key = keyOf(r);
                const c = counts[key];
                const child = labels.get(r.childSObject);
                return (
                  <tr key={key}>
                    <td>
                      <a href={links.object(r.childSObject)} class="rel__obj">
                        <span class="rel__label">{child?.label ?? r.childSObject}</span>
                        <span class="mono muted rel__api">{r.childSObject}</span>
                      </a>
                    </td>
                    <td class="mono subtle">{r.relationshipName}</td>
                    <td class="mono subtle">{r.field}</td>
                    <td>{r.cascadeDelete ? <Badge tone="warning">Cascade delete</Badge> : r.restrictedDelete ? <Badge tone="danger">Restricted</Badge> : <Badge>Clear lookup</Badge>}</td>
                    <td class="tabular" style={{ textAlign: "right" }}>
                      {recordId &&
                        (c === "loading" ? (
                          <Spinner small />
                        ) : typeof c === "number" ? (
                          c ? (
                            <button class="link-btn rel__n" onClick={() => openChildren(r.childSObject, r.field, c)} aria-label={c === 1 ? `Open the ${r.childSObject} record` : `Query ${c} ${r.childSObject} records`} title={c === 1 ? "Open the record" : "Query these records"}>
                              {fmtNumber(c)}
                            </button>
                          ) : (
                            <span class="muted">0</span>
                          )
                        ) : c === "error" ? (
                          <span class="muted" title="This relationship can't be counted">
                            n/a
                          </span>
                        ) : (
                          <button class="link-btn rel__count" onClick={() => count(key, r.childSObject, r.field)} aria-label={`Count ${r.relationshipName}`}>
                            Count
                          </button>
                        ))}
                    </td>
                    <td class="rel__actions">
                      {countable(r) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon
                          data-tip="Query in SOQL"
                          data-tip-pos="left"
                          aria-label={`Query ${r.childSObject}`}
                          onClick={async () => navigate(links.query(await buildDefaultQuery(sf, r.childSObject, { where: recordId ? `${r.field} = '${recordId}'` : undefined, extra: [r.field] })))}
                        >
                          <TerminalSquare />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
