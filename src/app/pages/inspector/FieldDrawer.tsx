import { useEffect, useRef } from "preact/hooks";
import { ChevronRight, Search, TerminalSquare, X } from "lucide-preact";
import { soqlLiteral } from "../../../lib/soql";
import type { DescribeField, DescribeSObjectResult, LookupNames, SfRecord } from "../../../lib/types";
import { fieldTypeLabel, rawString } from "../../../lib/format";
import { Badge, Button, CopyButton } from "../../../ui";
import { links, navigate } from "../../router";
import { FieldFlags, Value } from "./FieldsTable";

export function FieldDrawer({
  field: f,
  describe,
  record,
  staged,
  lookups,
  onClose,
}: {
  field: DescribeField;
  describe: DescribeSObjectResult;
  record: SfRecord | null;
  staged?: { value: unknown };
  lookups: LookupNames;
  onClose: () => void;
}) {
  const titleRef = useRef<HTMLDivElement>(null);
  // Move focus into the drawer when it opens or switches field; hand it back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    titleRef.current?.focus();
  }, [f.name]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement).tagName;
      if (e.key === "Escape" && t !== "INPUT" && t !== "TEXTAREA" && t !== "SELECT") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const value = record?.[f.name];
  const props: Array<[string, unknown]> = [
    ["Type", fieldTypeLabel(f)],
    ["SOAP type", f.soapType],
    ["Length", f.length || null],
    ["Precision / scale", f.precision ? `${f.precision} / ${f.scale}` : null],
    ["References", f.referenceTo?.length ? f.referenceTo.join(", ") : null],
    ["Relationship name", f.relationshipName],
    ["Controlling field", f.controllerName],
    ["Default value", f.defaultValue != null ? rawString(f.defaultValue) : f.defaultValueFormula],
    ["Compound field", f.compoundFieldName],
  ];
  const bools: Array<[string, boolean]> = [
    ["Createable", f.createable],
    ["Updateable", f.updateable],
    ["Nillable", f.nillable],
    ["Filterable", f.filterable],
    ["Sortable", f.sortable],
    ["Groupable", f.groupable],
    ["Unique", f.unique],
    ["External ID", f.externalId],
    ["Id lookup", f.idLookup],
    ["Name field", f.nameField],
    ["Restricted picklist", f.restrictedPicklist],
    ["Cascade delete", f.cascadeDelete],
    ["HTML formatted", f.htmlFormatted],
    ["Encrypted", f.encrypted],
  ];

  return (
    <aside class="drawer" aria-label={`Field ${f.name}`}>
      <div class="drawer__head">
        <div class="grow" style={{ minWidth: 0 }}>
          <div class="drawer__eyebrow">{describe.label} field</div>
          <div class="drawer__title" tabIndex={-1} ref={titleRef}>
            {f.label}
          </div>
          <div class="idpill" style={{ marginTop: 4 }}>
            <span class="mono">{f.name}</span>
            <CopyButton text={f.name} label="Copy API name" />
          </div>
        </div>
        <Button variant="ghost" size="sm" icon aria-label="Close details" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div class="drawer__body">
        <div class="row" style={{ flexWrap: "wrap", gap: 4 }}>
          <FieldFlags f={f} />
          {f.calculated && <Badge tone="info">Formula</Badge>}
          {f.autoNumber && <Badge>Auto number</Badge>}
        </div>

        {record && (
          <section class="dsec">
            <div class="dsec__title">
              Value
              {value != null && <CopyButton text={rawString(value)} label="Copy value" />}
            </div>
            <div class="dvalue">
              <Value f={f} v={value} lookups={lookups} full />
            </div>
            {staged && (
              <div class="dvalue dvalue--staged">
                <span class="dvalue__tag">Unsaved change</span>
                <Value f={f} v={staged.value} lookups={lookups} full />
              </div>
            )}
          </section>
        )}

        {f.inlineHelpText && (
          <section class="dsec">
            <div class="dsec__title">Help text</div>
            <p class="subtle">{f.inlineHelpText}</p>
          </section>
        )}

        {f.calculatedFormula && (
          <section class="dsec">
            <div class="dsec__title">
              Formula <CopyButton text={f.calculatedFormula} label="Copy formula" />
            </div>
            <pre class="dcode">{f.calculatedFormula}</pre>
          </section>
        )}

        <section class="dsec">
          <div class="dsec__title">Details</div>
          <dl class="dprops">
            {props
              .filter(([, v]) => v != null && v !== "")
              .map(([k, v]) => (
                <>
                  <dt>{k}</dt>
                  <dd class={k === "References" || k === "Relationship name" || k === "SOAP type" ? "mono" : ""}>
                    {k === "References"
                      ? f.referenceTo.map((r, i) => (
                          <>
                            {i > 0 && ", "}
                            <a href={links.object(r)}>{r}</a>
                          </>
                        ))
                      : String(v)}
                  </dd>
                </>
              ))}
          </dl>
        </section>

        <section class="dsec">
          <div class="dsec__title">Capabilities</div>
          <div class="dbools">
            {bools.map(([k, v]) => (
              <span class={"dbool" + (v ? " is-on" : "")} key={k}>
                <span class="dbool__dot" aria-hidden="true" />
                {k}
                <span class="sr-only">: {v ? "yes" : "no"}</span>
              </span>
            ))}
          </div>
        </section>

        {f.picklistValues?.length > 0 && (
          <section class="dsec">
            <div class="dsec__title">
              Picklist values <span class="muted">({f.picklistValues.length})</span>
            </div>
            <div class="dpick">
              {f.picklistValues.map((p) => (
                <div class={"dpick__row" + (p.active ? "" : " is-inactive")} key={p.value}>
                  <span class="mono truncate">{p.value}</span>
                  <span class="truncate subtle">{p.label !== p.value ? p.label : ""}</span>
                  <span class="row" style={{ gap: 4 }}>
                    {p.defaultValue && <Badge tone="accent">Default</Badge>}
                    {!p.active && <Badge>Inactive</Badge>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section class="dsec">
          <details class="draw">
            <summary>
              <ChevronRight /> Raw describe
            </summary>
            <pre class="dcode">{JSON.stringify(f, null, 2)}</pre>
          </details>
        </section>

        {describe.queryable && <QueryActions f={f} describe={describe} record={record} />}
      </div>
    </aside>
  );
}

function QueryActions({ f, describe, record }: { f: DescribeField; describe: DescribeSObjectResult; record: SfRecord | null }) {
  const name = describe.fields.find((x) => x.nameField)?.name;
  const select = ["Id", ...(name && name !== "Id" && name !== f.name ? [name] : []), ...(f.name !== "Id" ? [f.name] : [])].join(", ");
  const order = describe.fields.some((x) => x.name === "LastModifiedDate") ? " ORDER BY LastModifiedDate DESC" : "";
  if (record) {
    const v = record[f.name];
    const lit = soqlLiteral(f.type, v);
    const reason = !f.filterable ? "This field type can't be used in a WHERE clause." : lit == null ? "Values of this type can't be compared in SOQL." : null;
    const where = f.type === "multipicklist" && lit !== "null" ? `${f.name} INCLUDES (${lit})` : `${f.name} = ${lit}`;
    return (
      <div class="dactions">
        <Button size="sm" disabled={!!reason} title={reason ?? undefined} onClick={() => navigate(links.query(`SELECT ${select} FROM ${describe.name} WHERE ${where}${order} LIMIT 200`))}>
          <Search /> Find records with this value
        </Button>
        {reason && <span class="muted dactions__why">{reason}</span>}
      </div>
    );
  }
  return (
    <div class="dactions">
      <Button size="sm" onClick={() => navigate(links.query(`SELECT ${select} FROM ${describe.name}${f.filterable && f.nillable ? ` WHERE ${f.name} != null` : ""}${order} LIMIT 200`))}>
        <TerminalSquare /> Query this field
      </Button>
    </div>
  );
}
