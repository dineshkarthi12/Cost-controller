import type { RefSource } from '@toprock/shared';
import type { Db } from '../lib/prisma.js';
import { validationError } from '../lib/errors.js';

type Scope = 'project' | 'org' | 'orgUsers';

interface LookupDef {
  model: string;
  scope: Scope;
  /** Column used as the stored value (default id). */
  valueField?: string;
  label: (r: Record<string, unknown>) => string;
  search: string[];
  where?: Record<string, unknown>;
  select: Record<string, boolean>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  /** Extra fields returned to the client (e.g. unit, rate) for form auto-fill. */
  extra?: string[];
}

const kind = (k: string) => ({ kinds: { has: k } });

export const LOOKUPS: Record<RefSource, LookupDef> = {
  costCodes: { model: 'costCode', scope: 'project', label: (r) => `${r.code} — ${r.name}`, search: ['code', 'name'], select: { id: true, code: true, name: true, category: true }, orderBy: { code: 'asc' }, extra: ['category'] },
  wbsNodes: { model: 'wbsNode', scope: 'project', label: (r) => `${r.code} — ${r.name}`, search: ['code', 'name'], select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } },
  parties: { model: 'party', scope: 'org', label: (r) => `${r.name}`, search: ['code', 'name'], select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } },
  suppliers: { model: 'party', scope: 'org', where: kind('SUPPLIER'), label: (r) => `${r.name}`, search: ['code', 'name'], select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } },
  subcontractors: { model: 'party', scope: 'org', where: kind('SUBCONTRACTOR'), label: (r) => `${r.name}`, search: ['code', 'name'], select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } },
  clients: { model: 'party', scope: 'org', where: kind('CLIENT'), label: (r) => `${r.name}`, search: ['code', 'name'], select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } },
  materials: { model: 'material', scope: 'org', label: (r) => `${r.code} — ${r.name}`, search: ['code', 'name'], select: { id: true, code: true, name: true, unit: true, standardRate: true }, orderBy: { code: 'asc' }, extra: ['unit', 'standardRate'] },
  users: { model: 'user', scope: 'orgUsers', label: (r) => `${r.name}`, search: ['name', 'email'], select: { id: true, name: true, email: true, designation: true }, orderBy: { name: 'asc' }, extra: ['designation'] },
  boqItems: { model: 'boqItem', scope: 'project', label: (r) => `${r.itemCode} — ${String(r.description).slice(0, 60)}`, search: ['itemCode', 'description'], select: { id: true, itemCode: true, description: true, unit: true, unitRate: true }, orderBy: { itemCode: 'asc' }, extra: ['unit', 'unitRate'] },
  activities: { model: 'activity', scope: 'project', label: (r) => `${r.code} — ${r.name}`, search: ['code', 'name'], select: { id: true, code: true, name: true, unit: true }, orderBy: { code: 'asc' }, extra: ['unit'] },
  stores: { model: 'store', scope: 'project', label: (r) => `${r.code} — ${r.name}`, search: ['code', 'name'], select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } },
  equipment: { model: 'equipment', scope: 'org', label: (r) => `${r.code} — ${r.name}`, search: ['code', 'name'], select: { id: true, code: true, name: true, ownership: true }, orderBy: { code: 'asc' }, extra: ['ownership'] },
  subcontracts: { model: 'subcontract', scope: 'project', label: (r) => `${r.number} — ${r.title}`, search: ['number', 'title'], select: { id: true, number: true, title: true }, orderBy: { number: 'asc' } },
  purchaseOrders: { model: 'purchaseOrder', scope: 'project', label: (r) => `${r.number}`, search: ['number'], select: { id: true, number: true, status: true }, orderBy: { number: 'desc' }, extra: ['status'] },
  poLines: { model: 'purchaseOrderLine', scope: 'project', label: (r) => `#${r.lineNo} ${r.description} (${r.qty} ${r.unit})`, search: ['description'], select: { id: true, lineNo: true, description: true, qty: true, unit: true, rate: true, receivedQty: true, invoicedQty: true, poId: true, costCodeId: true, taxRate: true }, orderBy: { lineNo: 'asc' }, extra: ['rate', 'qty', 'unit', 'receivedQty', 'invoicedQty', 'poId', 'costCodeId', 'taxRate', 'description'] },
  grns: { model: 'grn', scope: 'project', label: (r) => `${r.number}`, search: ['number'], select: { id: true, number: true }, orderBy: { number: 'desc' } },
  mrs: { model: 'materialRequisition', scope: 'project', label: (r) => `${r.number}`, search: ['number'], select: { id: true, number: true, status: true }, orderBy: { number: 'desc' }, extra: ['status'] },
  prs: { model: 'purchaseRequisition', scope: 'project', label: (r) => `${r.number}`, search: ['number'], select: { id: true, number: true, status: true }, orderBy: { number: 'desc' }, extra: ['status'] },
  contracts: { model: 'contract', scope: 'project', label: (r) => `${r.number} — ${r.title}`, search: ['number', 'title'], select: { id: true, number: true, title: true }, orderBy: { number: 'asc' } },
  uoms: { model: 'uom', scope: 'org', valueField: 'code', label: (r) => `${r.code} — ${r.name}`, search: ['code', 'name'], select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } },
  documents: { model: 'document', scope: 'project', label: (r) => `${r.number} — ${r.title}`, search: ['number', 'title'], select: { id: true, number: true, title: true }, orderBy: { number: 'asc' } },
  clientBills: { model: 'clientBill', scope: 'project', label: (r) => `${r.number}`, search: ['number'], select: { id: true, number: true }, orderBy: { billSeq: 'desc' } },
  ncrs: { model: 'ncr', scope: 'project', label: (r) => `${r.number} — ${r.title}`, search: ['number', 'title'], select: { id: true, number: true, title: true }, orderBy: { number: 'desc' } },
  inspections: { model: 'inspection', scope: 'project', label: (r) => `${r.number} — ${r.title}`, search: ['number', 'title'], select: { id: true, number: true, title: true }, orderBy: { number: 'desc' } },
  labourNorms: { model: 'labourNorm', scope: 'org', where: { active: true }, label: (r) => `${r.name} — ${Number(r.outputPerDay)} ${r.unit}/day`, search: ['code', 'name'], select: { id: true, code: true, name: true, unit: true, outputPerDay: true, masonsPerCrew: true, helpersPerCrew: true }, orderBy: { name: 'asc' }, extra: ['code', 'unit', 'outputPerDay', 'masonsPerCrew', 'helpersPerCrew'] },
  checklistTemplates: { model: 'checklistTemplate', scope: 'org', label: (r) => `${r.name}${r.active ? '' : ' (inactive)'}`, search: ['name'], select: { id: true, name: true, type: true, active: true }, orderBy: { name: 'asc' }, extra: ['type', 'active'] },
  measurements: { model: 'measurement', scope: 'project', label: (r) => `${r.number} — ${r.location ?? ''}`, search: ['number', 'location'], select: { id: true, number: true, location: true }, orderBy: { number: 'desc' } },
  milestones: { model: 'billingMilestone', scope: 'project', label: (r) => `${r.name}`, search: ['name'], select: { id: true, name: true }, orderBy: { dueDate: 'asc' } },
};

function scopeWhere(def: LookupDef, orgId: string, projectId: string | null): Record<string, unknown> {
  if (def.model === 'purchaseOrderLine') return { po: { projectId } };
  if (def.scope === 'project') return { projectId };
  if (def.scope === 'orgUsers') return { orgId, status: 'ACTIVE' };
  return { orgId };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const delegate = (db: Db, model: string) => (db as any)[model];

export async function searchLookup(db: Db, source: RefSource, orgId: string, projectId: string | null, q: string, extraWhere: Record<string, unknown> = {}, limit = 50) {
  const def = LOOKUPS[source];
  if (!def) throw validationError(`Unknown lookup ${source}`);
  const where: Record<string, unknown> = { ...scopeWhere(def, orgId, projectId), ...(def.where ?? {}), ...extraWhere };
  if (q) where.OR = def.search.map((f) => ({ [f]: { contains: q, mode: 'insensitive' } }));
  const rows: Record<string, unknown>[] = await delegate(db, def.model).findMany({ where, select: def.select, orderBy: def.orderBy, take: limit });
  return rows.map((r) => ({
    value: String(r[def.valueField ?? 'id']),
    label: def.label(r),
    extra: def.extra ? Object.fromEntries(def.extra.map((k) => [k, r[k] === null || r[k] === undefined ? null : String(r[k])])) : undefined,
  }));
}

/** Resolves display labels for a set of ids. */
export async function resolveLabels(db: Db, source: RefSource, orgId: string, projectId: string | null, ids: string[]): Promise<Map<string, string>> {
  const def = LOOKUPS[source];
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!def || uniq.length === 0) return new Map();
  const vf = def.valueField ?? 'id';
  const rows: Record<string, unknown>[] = await delegate(db, def.model).findMany({ where: { ...scopeWhere(def, orgId, projectId), [vf]: { in: uniq } }, select: def.select });
  return new Map(rows.map((r) => [String(r[vf]), def.label(r)]));
}

/**
 * Ensures every referenced id exists inside the caller's organisation / project.
 * This is the data-separation guard for all writes.
 */
export async function assertRefsInScope(db: Db, source: RefSource, orgId: string, projectId: string | null, ids: string[], label: string) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return;
  const def = LOOKUPS[source];
  const vf = def.valueField ?? 'id';
  const count: number = await delegate(db, def.model).count({ where: { ...scopeWhere(def, orgId, projectId), ...(def.where ?? {}), [vf]: { in: uniq } } });
  if (count !== uniq.length) throw validationError(`${label}: referenced record not found in this ${def.scope === 'project' ? 'project' : 'organisation'}`);
}
