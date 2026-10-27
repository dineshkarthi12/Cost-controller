import type { PermissionArea } from '../permissions.js';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'int'
  | 'decimal' // quantities / rates (4 dp)
  | 'money' // 2 dp
  | 'percent' // stored as fraction, entered as %
  | 'date'
  | 'datetime'
  | 'select'
  | 'boolean'
  | 'ref'
  | 'tags'
  | 'lines';

/** Lookup sources served by GET /api/lookups/:source */
export type RefSource =
  | 'costCodes'
  | 'wbsNodes'
  | 'parties'
  | 'suppliers'
  | 'subcontractors'
  | 'clients'
  | 'materials'
  | 'users'
  | 'boqItems'
  | 'activities'
  | 'stores'
  | 'equipment'
  | 'subcontracts'
  | 'purchaseOrders'
  | 'poLines'
  | 'grns'
  | 'mrs'
  | 'prs'
  | 'contracts'
  | 'uoms'
  | 'documents'
  | 'clientBills'
  | 'ncrs'
  | 'inspections'
  | 'milestones';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: readonly string[];
  ref?: RefSource;
  /** Server-computed — displayed but never accepted from the client. */
  readOnly?: boolean;
  /** Show as a table column. */
  list?: boolean;
  filter?: boolean;
  sortable?: boolean;
  section?: string;
  help?: string;
  placeholder?: string;
  lines?: FieldDef[];
  min?: number;
  max?: number;
  maxLength?: number;
  default?: string | number | boolean;
  span?: 1 | 2 | 3;
  /** Only editable on create. */
  createOnly?: boolean;
  hideInForm?: boolean;
}

export interface ResourceDef {
  key: string;
  model: string; // prisma delegate name
  label: string;
  plural: string;
  area: PermissionArea;
  projectScoped: boolean;
  orgScoped?: boolean;
  docType?: string;
  titleField: string;
  fields: FieldDef[];
  /** Name of the nested lines relation, when a field of type 'lines' is present. */
  linesRelation?: string;
  workflow?: boolean;
  statusField?: string;
  statusOptions?: readonly string[];
  /** Statuses in which the record may be edited. Default: DRAFT, RETURNED (workflow) or any. */
  editableStatuses?: readonly string[];
  /** Status a non-workflow record may be set to through PATCH. */
  manualStatuses?: readonly string[];
  defaultSort?: { field: string; dir: 'asc' | 'desc' };
  searchFields?: string[];
  /** Hard delete allowed (only in editable statuses). Financial docs are cancelled instead. */
  deletable?: boolean;
  /** Field holding the user who created the record. */
  creatorField?: string;
  description?: string;
}

export const DEFAULT_EDITABLE = ['DRAFT', 'RETURNED'] as const;
