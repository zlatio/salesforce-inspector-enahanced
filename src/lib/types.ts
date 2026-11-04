export interface SfAttributes {
  type: string;
  url?: string;
}

export interface SfRecord {
  attributes?: SfAttributes;
  [field: string]: unknown;
}

export interface QueryResult<T = SfRecord> {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: T[];
  entityTypeName?: string;
}

export interface GlobalSObject {
  name: string;
  label: string;
  labelPlural: string;
  keyPrefix: string | null;
  custom: boolean;
  customSetting: boolean;
  queryable: boolean;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
  searchable: boolean;
  layoutable: boolean;
  deprecatedAndHidden: boolean;
  isSubtype?: boolean;
  isInterface?: boolean;
  associateEntityType?: string | null;
}

export interface DescribeGlobalResult {
  encoding: string;
  maxBatchSize: number;
  sobjects: GlobalSObject[];
}

export interface PicklistValue {
  active: boolean;
  defaultValue: boolean;
  label: string;
  value: string;
  validFor?: string | null;
}

export type FieldType =
  | "id"
  | "string"
  | "textarea"
  | "boolean"
  | "int"
  | "long"
  | "double"
  | "currency"
  | "percent"
  | "date"
  | "datetime"
  | "time"
  | "email"
  | "phone"
  | "url"
  | "picklist"
  | "multipicklist"
  | "combobox"
  | "reference"
  | "address"
  | "location"
  | "base64"
  | "encryptedstring"
  | "anyType"
  | "complexvalue"
  | "json";

export interface DescribeField {
  name: string;
  label: string;
  type: FieldType;
  soapType: string;
  length: number;
  precision: number;
  scale: number;
  digits: number;
  byteLength: number;
  nillable: boolean;
  createable: boolean;
  updateable: boolean;
  filterable: boolean;
  sortable: boolean;
  groupable: boolean;
  unique: boolean;
  externalId: boolean;
  idLookup: boolean;
  nameField: boolean;
  custom: boolean;
  calculated: boolean;
  calculatedFormula: string | null;
  autoNumber: boolean;
  defaultedOnCreate: boolean;
  defaultValue: unknown;
  defaultValueFormula: string | null;
  inlineHelpText: string | null;
  htmlFormatted: boolean;
  dependentPicklist: boolean;
  controllerName: string | null;
  restrictedPicklist: boolean;
  picklistValues: PicklistValue[];
  referenceTo: string[];
  relationshipName: string | null;
  relationshipOrder: number | null;
  cascadeDelete: boolean;
  restrictedDelete: boolean;
  compoundFieldName: string | null;
  deprecatedAndHidden: boolean;
  encrypted: boolean;
  polymorphicForeignKey: boolean;
  [key: string]: unknown;
}

export interface ChildRelationship {
  childSObject: string;
  field: string;
  relationshipName: string | null;
  cascadeDelete: boolean;
  restrictedDelete: boolean;
  deprecatedAndHidden: boolean;
}

export interface RecordTypeInfo {
  name: string;
  developerName: string;
  recordTypeId: string;
  active: boolean;
  available: boolean;
  defaultRecordTypeMapping: boolean;
  master: boolean;
}

export interface DescribeSObjectResult extends GlobalSObject {
  fields: DescribeField[];
  childRelationships: ChildRelationship[];
  recordTypeInfos: RecordTypeInfo[];
  [key: string]: unknown;
}

export interface LimitValue {
  Max: number;
  Remaining: number;
  [sub: string]: number | LimitValue | undefined;
}

export type LimitsResult = Record<string, LimitValue>;

export interface OrgInfo {
  Id: string;
  Name: string;
  IsSandbox: boolean;
  InstanceName: string;
  OrganizationType: string;
  TrialExpirationDate: string | null;
  CreatedDate: string;
  NamespacePrefix: string | null;
  LanguageLocaleKey: string;
  TimeZoneSidKey: string;
}

export type OrgEnv = "production" | "sandbox" | "scratch" | "developer" | "trial";

/** Display names for lookup ids on a record, keyed by id. */
export interface LookupNames {
  [id: string]: { name: string; type: string };
}
