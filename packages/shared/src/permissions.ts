/**
 * Permission catalogue. Each area has view / manage / approve actions unless noted.
 * The API enforces these; the web app uses them only to hide actions.
 */
export const PERMISSION_AREAS = {
  project: 'Projects',
  team: 'Team & Work Allocation',
  task: 'Tasks & Issues',
  manpower: 'Manpower',
  diary: 'Daily Site Diary',
  progress: 'Work Progress & Schedule',
  costcode: 'WBS & Cost Codes',
  boq: 'BOQ & Estimation',
  measurement: 'Measurement Book & Verification',
  evidence: 'Site Evidence & Photos',
  material: 'Material Master & Stores',
  procurement: 'MR / PR / RFQ / PO',
  receiving: 'GRN & Material Inspection',
  stock: 'Inventory, Issues & Reconciliation',
  expense: 'Cost & Expenses',
  budget: 'Budget Control',
  forecast: 'Cost Forecasting',
  subcontract: 'Subcontractor Management',
  subbill: 'Subcontractor Billing',
  clientbill: 'Client Billing & Receivables',
  payable: 'Accounts Payable & Payments',
  equipment: 'Equipment & Machinery',
  contract: 'Contract Administration',
  variation: 'Change Orders & Variations',
  cashflow: 'Cash Flow',
  quality: 'Quality & Rework',
  safety: 'Safety & Inspections',
  document: 'Drawing & Document Control',
  rfi: 'Transmittals & RFIs',
  risk: 'Risks & Claims',
  period: 'Month-End Closing',
  closeout: 'Project Closeout',
  report: 'Reports & Analytics',
} as const;

export type PermissionArea = keyof typeof PERMISSION_AREAS;
export type PermissionAction = 'view' | 'manage' | 'approve';

export const SPECIAL_PERMISSIONS = {
  'project.all': 'Access every project in the organisation',
  'period.reopen': 'Reopen a closed financial period',
  'report.export': 'Export reports (Excel / CSV / PDF)',
  'user.manage': 'Invite, edit and deactivate users',
  'role.manage': 'Create and edit roles and permissions',
  'settings.manage': 'Organisation settings, document types, workflows, modules',
  'audit.view': 'View the audit trail',
  'integration.manage': 'Configure integrations',
  'import.manage': 'Run data imports',
} as const;

export type Permission = `${PermissionArea}.${PermissionAction}` | keyof typeof SPECIAL_PERMISSIONS;

export const ALL_PERMISSIONS: Permission[] = [
  ...(Object.keys(PERMISSION_AREAS) as PermissionArea[]).flatMap((a) =>
    (['view', 'manage', 'approve'] as const).map((x) => `${a}.${x}` as Permission),
  ),
  ...(Object.keys(SPECIAL_PERMISSIONS) as Permission[]),
];

export function permissionLabel(p: string): string {
  if (p in SPECIAL_PERMISSIONS) return SPECIAL_PERMISSIONS[p as keyof typeof SPECIAL_PERMISSIONS];
  const [area, action] = p.split('.');
  const areaLabel = PERMISSION_AREAS[area as PermissionArea] ?? area;
  return `${areaLabel} — ${action}`;
}

const AREAS = Object.keys(PERMISSION_AREAS) as PermissionArea[];
const view = (...a: PermissionArea[]) => a.map((x) => `${x}.view` as Permission);
const manage = (...a: PermissionArea[]) => a.flatMap((x) => [`${x}.view`, `${x}.manage`] as Permission[]);
const approve = (...a: PermissionArea[]) => a.flatMap((x) => [`${x}.view`, `${x}.approve`] as Permission[]);
const allView = () => view(...AREAS);

export interface RoleTemplate {
  code: string;
  name: string;
  description: string;
  permissions: Permission[];
}

/** Default roles seeded for every organisation. Admins can edit them or create custom roles. */
export const DEFAULT_ROLES: RoleTemplate[] = [
  { code: 'SUPER_ADMIN', name: 'Super Admin', description: 'Full system access', permissions: [...ALL_PERMISSIONS] },
  {
    code: 'COMPANY_ADMIN',
    name: 'Company Admin',
    description: 'Organisation administration, users, settings',
    permissions: [...allView(), 'project.manage', 'team.manage', 'project.all', 'user.manage', 'role.manage', 'settings.manage', 'audit.view', 'integration.manage', 'import.manage', 'report.export'],
  },
  {
    code: 'PROJECT_DIRECTOR',
    name: 'Project Director',
    description: 'Portfolio oversight and high-value approvals',
    permissions: [...allView(), ...approve(...AREAS), 'project.manage', 'project.all', 'period.reopen', 'report.export', 'audit.view'],
  },
  {
    code: 'PROJECT_MANAGER',
    name: 'Project Manager',
    description: 'Runs the project and approves within limits',
    permissions: [...allView(), ...approve(...AREAS), ...manage('project', 'team', 'task', 'progress', 'variation', 'risk', 'document', 'rfi', 'diary', 'contract'), 'report.export'],
  },
  {
    code: 'COST_CONTROL_LEAD',
    name: 'Cost Control Lead',
    description: 'Budget, forecast, cost reporting and final cost review',
    permissions: [
      ...allView(),
      ...manage('budget', 'forecast', 'costcode', 'boq', 'expense', 'cashflow', 'period', 'closeout', 'task', 'team', 'risk', 'variation', 'report'),
      ...approve('budget', 'forecast', 'expense', 'measurement', 'subbill', 'clientbill', 'period', 'procurement', 'payable', 'subcontract', 'variation'),
      'report.export',
      'import.manage',
      'audit.view',
    ],
  },
  {
    code: 'COST_CONTROLLER',
    name: 'Cost Controller',
    description: 'Cost recording, forecasts and reconciliations',
    permissions: [...allView(), ...manage('budget', 'forecast', 'costcode', 'expense', 'cashflow', 'period', 'task', 'report', 'boq'), 'report.export', 'import.manage'],
  },
  {
    code: 'QUANTITY_SURVEYOR',
    name: 'Quantity Surveyor',
    description: 'BOQ, takeoff, measurements, bills and variations',
    permissions: [...allView(), ...manage('boq', 'measurement', 'subbill', 'clientbill', 'variation', 'task', 'evidence'), ...approve('measurement'), 'report.export', 'import.manage'],
  },
  {
    code: 'SITE_ENGINEER',
    name: 'Site Engineer',
    description: 'Daily reporting, progress, measurement and evidence',
    permissions: [
      ...view('project', 'task', 'manpower', 'diary', 'progress', 'boq', 'measurement', 'evidence', 'material', 'procurement', 'receiving', 'stock', 'equipment', 'quality', 'safety', 'document', 'rfi', 'costcode', 'report'),
      ...manage('manpower', 'diary', 'progress', 'measurement', 'evidence', 'procurement', 'equipment', 'quality', 'safety', 'rfi', 'task'),
      ...approve('measurement', 'evidence', 'manpower', 'receiving', 'stock', 'equipment'),
    ],
  },
  {
    code: 'SITE_SUPERVISOR',
    name: 'Site Supervisor',
    description: 'Attendance, manpower and site photos',
    permissions: [...view('project', 'task', 'manpower', 'diary', 'progress', 'evidence', 'boq', 'costcode', 'material', 'safety'), ...manage('manpower', 'diary', 'evidence', 'task', 'safety')],
  },
  {
    code: 'HR_COORDINATOR',
    name: 'HR / Manpower Coordinator',
    description: 'MPR, attendance and labour cost',
    permissions: [...view('project', 'task', 'manpower', 'diary', 'costcode', 'report', 'evidence'), ...manage('manpower', 'diary', 'task', 'evidence'), ...approve('manpower'), 'report.export'],
  },
  {
    code: 'STOREKEEPER',
    name: 'Storekeeper',
    description: 'Receipts, issues, transfers and stock counts',
    permissions: [...view('project', 'task', 'material', 'procurement', 'costcode', 'evidence', 'report'), ...manage('receiving', 'stock', 'material', 'evidence', 'task')],
  },
  {
    code: 'PROCUREMENT_OFFICER',
    name: 'Procurement Officer',
    description: 'PR, RFQ, quotations and purchase orders',
    permissions: [...view('project', 'task', 'material', 'receiving', 'stock', 'costcode', 'budget', 'report', 'payable'), ...manage('procurement', 'material', 'task'), 'report.export'],
  },
  {
    code: 'SUBCONTRACTOR_MANAGER',
    name: 'Subcontractor Manager',
    description: 'Subcontracts, compliance and RA bills',
    permissions: [...view('project', 'task', 'boq', 'measurement', 'costcode', 'report', 'evidence'), ...manage('subcontract', 'subbill', 'task', 'contract'), 'report.export'],
  },
  {
    code: 'FINANCE_OFFICER',
    name: 'Finance Officer',
    description: 'Invoices, payments, receivables and cash flow',
    permissions: [...allView(), ...manage('payable', 'cashflow', 'expense', 'clientbill', 'task'), ...approve('payable', 'expense'), 'report.export'],
  },
  {
    code: 'BILLING_ENGINEER',
    name: 'Billing Engineer',
    description: 'Client and contractor billing',
    permissions: [...view('project', 'task', 'boq', 'measurement', 'variation', 'costcode', 'report', 'subcontract', 'evidence'), ...manage('clientbill', 'subbill', 'measurement', 'task'), 'report.export'],
  },
  {
    code: 'QUALITY_ENGINEER',
    name: 'Quality Engineer',
    description: 'Inspections, ITP, NCR and rework',
    permissions: [...view('project', 'task', 'progress', 'material', 'receiving', 'evidence', 'document', 'costcode'), ...manage('quality', 'evidence', 'task'), ...approve('quality', 'receiving')],
  },
  {
    code: 'SAFETY_OFFICER',
    name: 'Safety Officer',
    description: 'Safety inspections, incidents and toolbox talks',
    permissions: [...view('project', 'task', 'manpower', 'evidence', 'document'), ...manage('safety', 'evidence', 'task'), ...approve('safety')],
  },
  {
    code: 'DOCUMENT_CONTROLLER',
    name: 'Document Controller',
    description: 'Drawing register, revisions, transmittals and RFIs',
    permissions: [...view('project', 'task', 'contract'), ...manage('document', 'rfi', 'task'), ...approve('document')],
  },
  { code: 'APPROVER', name: 'Approver', description: 'Approves documents routed to them', permissions: [...allView(), ...approve(...AREAS)] },
  { code: 'AUDITOR', name: 'Auditor', description: 'Read-only with audit trail', permissions: [...allView(), 'audit.view', 'project.all', 'report.export'] },
  { code: 'MANAGEMENT_READONLY', name: 'Read-only Management User', description: 'Read-only dashboards and reports', permissions: [...allView(), 'project.all'] },
];

export function dedupePermissions(perms: string[]): string[] {
  return Array.from(new Set(perms)).sort();
}
