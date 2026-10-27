import { ALL_PERMISSIONS, DEFAULT_DOC_TYPES, DEFAULT_ROLES, permissionLabel } from '@toprock/shared';
import type { Db } from '../lib/prisma.js';
import { orgSettingsSchema } from './settings.js';

const L = (n: number) => String(n * 100_000); // lakh
const CR = (n: number) => String(n * 10_000_000); // crore

interface StepSpec {
  name: string;
  role: string;
  min?: string;
  max?: string;
  sla?: number;
  esc?: string;
  required?: number;
}

/** Default approval chains (configurable in Settings → Workflows). */
export const DEFAULT_WORKFLOWS: Record<string, StepSpec[]> = {
  MPR: [{ name: 'Site engineer verification', role: 'SITE_ENGINEER', sla: 24, esc: 'PROJECT_MANAGER' }],
  DPR: [{ name: 'Project manager review', role: 'PROJECT_MANAGER', sla: 24 }],
  MR: [{ name: 'Project manager approval', role: 'PROJECT_MANAGER', sla: 24, esc: 'PROJECT_DIRECTOR' }],
  PR: [
    { name: 'Project manager approval', role: 'PROJECT_MANAGER', sla: 24 },
    { name: 'Cost control budget check', role: 'COST_CONTROL_LEAD', min: L(5), sla: 24 },
  ],
  PO: [
    { name: 'Project manager approval', role: 'PROJECT_MANAGER', sla: 24, esc: 'PROJECT_DIRECTOR' },
    { name: 'Cost control review', role: 'COST_CONTROL_LEAD', min: L(10), sla: 24 },
    { name: 'Project director approval', role: 'PROJECT_DIRECTOR', min: CR(1), sla: 48 },
  ],
  PO_AMENDMENT: [
    { name: 'Project manager approval', role: 'PROJECT_MANAGER' },
    { name: 'Cost control review', role: 'COST_CONTROL_LEAD' },
  ],
  GRN: [{ name: 'Site engineer verification', role: 'SITE_ENGINEER', sla: 24 }],
  MIR: [{ name: 'Quality engineer approval', role: 'QUALITY_ENGINEER', sla: 24 }],
  MATERIAL_ISSUE: [{ name: 'Site engineer approval', role: 'SITE_ENGINEER', sla: 24 }],
  EXPENSE: [
    { name: 'Project manager approval', role: 'PROJECT_MANAGER' },
    { name: 'Cost control approval', role: 'COST_CONTROL_LEAD', min: '50000' },
  ],
  SUPPLIER_INVOICE: [
    { name: 'Cost control verification', role: 'COST_CONTROL_LEAD' },
    { name: 'Finance approval', role: 'FINANCE_OFFICER' },
  ],
  PAYMENT: [
    { name: 'Finance approval', role: 'FINANCE_OFFICER' },
    { name: 'Project director approval', role: 'PROJECT_DIRECTOR', min: L(25) },
  ],
  BUDGET_REVISION: [
    { name: 'Project manager review', role: 'PROJECT_MANAGER' },
    { name: 'Project director approval', role: 'PROJECT_DIRECTOR' },
  ],
  VARIATION: [
    { name: 'Project manager approval', role: 'PROJECT_MANAGER' },
    { name: 'Cost control review', role: 'COST_CONTROL_LEAD' },
    { name: 'Project director approval', role: 'PROJECT_DIRECTOR', min: L(50) },
  ],
  SUBCONTRACT: [
    { name: 'Project manager approval', role: 'PROJECT_MANAGER' },
    { name: 'Cost control review', role: 'COST_CONTROL_LEAD' },
    { name: 'Project director approval', role: 'PROJECT_DIRECTOR', min: CR(1) },
  ],
  CONTRACTOR_BILL: [
    { name: 'Project manager verification', role: 'PROJECT_MANAGER', sla: 48 },
    { name: 'Cost control certification', role: 'COST_CONTROL_LEAD', sla: 48, esc: 'PROJECT_DIRECTOR' },
  ],
  CLIENT_BILL: [
    { name: 'Project manager review', role: 'PROJECT_MANAGER' },
    { name: 'Cost control approval', role: 'COST_CONTROL_LEAD' },
    { name: 'Project director approval', role: 'PROJECT_DIRECTOR', min: CR(5) },
  ],
  MB: [{ name: 'Certification', role: 'PROJECT_MANAGER', sla: 48 }],
  JMR: [{ name: 'Certification', role: 'PROJECT_MANAGER', sla: 48 }],
  EQUIPMENT_LOG: [{ name: 'Site engineer approval', role: 'SITE_ENGINEER' }],
  DOCUMENT_REVISION: [{ name: 'Document approval', role: 'PROJECT_MANAGER' }],
  PERIOD_CLOSE: [{ name: 'Reviewer sign-off & lock', role: 'PROJECT_DIRECTOR', sla: 72 }],
  CLOSEOUT: [
    { name: 'Project manager review', role: 'PROJECT_MANAGER' },
    { name: 'Project director approval', role: 'PROJECT_DIRECTOR' },
  ],
};

export const DEFAULT_UOMS: Array<[string, string, string]> = [
  ['NOS', 'Numbers', 'COUNT'],
  ['M', 'Metre', 'LENGTH'],
  ['RM', 'Running metre', 'LENGTH'],
  ['SQM', 'Square metre', 'AREA'],
  ['CUM', 'Cubic metre', 'VOLUME'],
  ['KG', 'Kilogram', 'WEIGHT'],
  ['MT', 'Metric tonne', 'WEIGHT'],
  ['BAG', 'Bag (50 kg)', 'COUNT'],
  ['LTR', 'Litre', 'VOLUME'],
  ['HR', 'Hour', 'TIME'],
  ['DAY', 'Day', 'TIME'],
  ['LS', 'Lump sum', 'LUMPSUM'],
  ['SET', 'Set', 'COUNT'],
];

/** Global permission catalogue (idempotent). */
export async function syncPermissions(db: Db) {
  for (const code of ALL_PERMISSIONS) {
    await db.permission.upsert({ where: { code }, create: { code, area: code.split('.')[0], description: permissionLabel(code) }, update: { description: permissionLabel(code) } });
  }
}

/** Creates an organisation with default roles, document types, units and workflows. Idempotent. */
export async function bootstrapOrganisation(db: Db, args: { code: string; name: string; isDemo?: boolean }) {
  await syncPermissions(db);
  const org = await db.organisation.upsert({
    where: { code: args.code },
    create: { code: args.code, name: args.name, isDemo: !!args.isDemo, settings: orgSettingsSchema.parse({}) as never },
    update: {},
  });
  for (const r of DEFAULT_ROLES) {
    const role = await db.role.upsert({ where: { orgId_code: { orgId: org.id, code: r.code } }, create: { orgId: org.id, code: r.code, name: r.name, description: r.description, isSystem: true }, update: { name: r.name, description: r.description } });
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({ data: [...new Set(r.permissions)].map((p) => ({ roleId: role.id, permissionCode: p })) });
  }
  for (const d of DEFAULT_DOC_TYPES) {
    await db.documentType.upsert({ where: { orgId_code: { orgId: org.id, code: d.code } }, create: { orgId: org.id, code: d.code, name: d.name, abbreviation: d.abbreviation, numberFormat: d.numberFormat, resetPolicy: d.resetPolicy }, update: {} });
  }
  for (const [code, name, dimension] of DEFAULT_UOMS) {
    await db.uom.upsert({ where: { orgId_code: { orgId: org.id, code } }, create: { orgId: org.id, code, name, dimension }, update: {} });
  }
  for (const [docType, steps] of Object.entries(DEFAULT_WORKFLOWS)) {
    const existing = await db.workflowDefinition.findFirst({ where: { orgId: org.id, projectId: null, docType } });
    if (existing) continue;
    await db.workflowDefinition.create({
      data: {
        orgId: org.id,
        docType,
        name: `${DEFAULT_DOC_TYPES.find((d) => d.code === docType)?.name ?? docType} approval`,
        steps: { create: steps.map((s, i) => ({ stepNo: i + 1, name: s.name, approverRoleCode: s.role, minAmount: s.min ?? null, maxAmount: s.max ?? null, slaHours: s.sla ?? 48, escalateToRoleCode: s.esc ?? null, requiredApprovals: s.required ?? 1 })) },
      },
    });
  }
  return org;
}
