import type { Permission } from './permissions.js';

export interface ModuleDef {
  key: string;
  label: string;
  /** Short name for the navigation menu (falls back to label). */
  navLabel?: string;
  path: string;
  icon: string; // lucide-react icon name
  permission: Permission | null; // null = every authenticated user
  group: string;
  description: string;
  projectScoped: boolean;
}

export const MODULE_GROUPS = [
  'Overview',
  'Site Operations',
  'Quantities & BOQ',
  'Materials & Procurement',
  'Cost & Finance',
  'Commercial',
  'Quality, Safety & Documents',
  'Insights & Close',
  'Administration',
] as const;

const m = (group: string, key: string, label: string, path: string, icon: string, permission: Permission | null, description: string, projectScoped = true): ModuleDef => ({
  key,
  label,
  path,
  icon,
  permission,
  group,
  description,
  projectScoped,
});

export const MODULES: ModuleDef[] = [
  m('Overview', 'dashboard', 'Dashboard', '/', 'LayoutDashboard', null, 'Executive cost control overview', true),
  m('Overview', 'projects', 'Projects', '/projects', 'Building2', 'project.view', 'Project register, setup and team', false),
  m('Overview', 'approvals', 'Approvals & Workflow', '/approvals', 'BadgeCheck', null, 'Approval inbox, history and workflow rules', false),
  m('Overview', 'tasks', 'Tasks & Issues', '/tasks', 'ListTodo', 'task.view', 'My tasks, team board, calendar'),
  m('Overview', 'team', 'Team Management', '/team', 'Users', 'team.view', 'Team members, workload and responsibility matrix'),
  m('Overview', 'notifications', 'Notifications', '/notifications', 'Bell', null, 'Alerts and preferences', false),

  m('Site Operations', 'manpower', 'Manpower Management', '/manpower', 'HardHat', 'manpower.view', 'Daily manpower reports, attendance, labour cost'),
  m('Site Operations', 'diary', 'Daily Site Diary', '/site-diary', 'NotebookPen', 'diary.view', 'Daily progress report and site diary'),
  m('Site Operations', 'progress', 'Work Progress', '/progress', 'TrendingUp', 'progress.view', 'Planned vs executed progress'),
  m('Site Operations', 'schedule', 'Planning & Schedule', '/schedule', 'CalendarRange', 'progress.view', 'WBS activities, Gantt and look-ahead'),
  m('Site Operations', 'evidence', 'Site Evidence & Photos', '/evidence', 'Camera', 'evidence.view', 'Photo evidence capture and verification'),
  m('Site Operations', 'equipment', 'Equipment & Machinery', '/equipment', 'Truck', 'equipment.view', 'Equipment register, logs, utilisation'),

  m('Quantities & BOQ', 'costcodes', 'WBS & Cost Codes', '/cost-codes', 'Network', 'costcode.view', 'Work breakdown structure and cost codes'),
  m('Quantities & BOQ', 'boq', 'BOQ & Estimation', '/boq', 'Calculator', 'boq.view', 'Bill of quantities and rate analysis'),
  m('Quantities & BOQ', 'takeoff', 'Quantity Takeoff', '/takeoff', 'Ruler', 'boq.view', 'Quantity takeoff records'),
  m('Quantities & BOQ', 'measurements', 'Measurement Book', '/measurements', 'ClipboardList', 'measurement.view', 'MB and joint measurement records'),
  m('Quantities & BOQ', 'verification', 'Measurement Verification', '/measurement-verification', 'ClipboardCheck', 'measurement.view', 'Verification and certification queue'),

  m('Materials & Procurement', 'materials', 'Material Management', '/materials', 'Boxes', 'material.view', 'Material master, units and stores'),
  m('Materials & Procurement', 'mr', 'Material Requisition (MR)', '/procurement/mr', 'FilePlus2', 'requisition.view', 'Site material requests'),
  m('Materials & Procurement', 'pr', 'Purchase Requisition (PR)', '/procurement/pr', 'FileText', 'procurement.view', 'Purchase requisitions with budget check'),
  m('Materials & Procurement', 'rfq', 'RFQ & Quotations', '/procurement/rfq', 'Scale', 'procurement.view', 'Supplier quotations and comparison'),
  m('Materials & Procurement', 'po', 'Purchase Orders (PO)', '/procurement/po', 'ShoppingCart', 'procurement.view', 'Purchase orders and amendments'),
  m('Materials & Procurement', 'grn', 'Goods Receipt (GRN)', '/procurement/grn', 'PackageCheck', 'receiving.view', 'Goods receipt notes'),
  m('Materials & Procurement', 'mir', 'Material Inspection (MIR)', '/procurement/mir', 'SearchCheck', 'receiving.view', 'Material inspection reports'),
  m('Materials & Procurement', 'issues', 'Material Issue & Consumption', '/stock/issues', 'PackageMinus', 'stock.view', 'Issues, returns, wastage and consumption'),
  m('Materials & Procurement', 'inventory', 'Inventory & Reconciliation', '/stock', 'Warehouse', 'stock.view', 'Stock ledger, balances and reconciliation'),

  m('Cost & Finance', 'expenses', 'Cost & Expenses', '/expenses', 'Receipt', 'expense.view', 'Expense vouchers and cost entries'),
  m('Cost & Finance', 'budget', 'Budget Control', '/budget', 'PiggyBank', 'budget.view', 'Budgets, revisions, transfers, variance'),
  m('Cost & Finance', 'forecast', 'Cost Forecasting', '/forecast', 'LineChart', 'forecast.view', 'ETC, EAC and earned value'),
  m('Cost & Finance', 'cashflow', 'Cash Flow', '/cash-flow', 'Wallet', 'cashflow.view', 'Planned vs actual cash flow'),
  m('Cost & Finance', 'payables', 'Accounts Payable & Payments', '/payables', 'Landmark', 'payable.view', 'Supplier invoices, matching and payments'),
  m('Cost & Finance', 'monthend', 'Month-End Closing', '/month-end', 'CalendarCheck', 'period.view', 'Period checklist, sign-off and lock'),

  m('Commercial', 'subcontractors', 'Subcontractor Management', '/subcontractors', 'Handshake', 'subcontract.view', 'Contractor master and subcontracts'),
  m('Commercial', 'subbills', 'Subcontractor Billing', '/subcontractor-bills', 'FileSpreadsheet', 'subbill.view', 'RA bills and certification'),
  m('Commercial', 'clientbilling', 'Client Billing & Receivables', '/client-billing', 'BadgeIndianRupee', 'clientbill.view', 'Client RA bills, invoices, receipts'),
  m('Commercial', 'contracts', 'Contract Administration', '/contracts', 'ScrollText', 'contract.view', 'Contracts, clauses, guarantees'),
  m('Commercial', 'variations', 'Change Orders & Variations', '/variations', 'GitPullRequestArrow', 'variation.view', 'Variations, EOT and change impact'),
  m('Commercial', 'risks', 'Risks & Claims', '/risks', 'ShieldAlert', 'risk.view', 'Risk register and claims'),

  m('Quality, Safety & Documents', 'quality', 'Quality & Rework', '/quality', 'BadgeCheck', 'quality.view', 'Inspections, ITP, NCR and rework'),
  m('Quality, Safety & Documents', 'safety', 'Safety & Inspections', '/safety', 'ShieldCheck', 'safety.view', 'Safety inspections, incidents, toolbox talks'),
  m('Quality, Safety & Documents', 'documents', 'Drawing & Document Control', '/documents', 'FolderOpen', 'document.view', 'Drawing and document register with revisions'),
  m('Quality, Safety & Documents', 'transmittals', 'Transmittals & RFIs', '/transmittals', 'Send', 'rfi.view', 'Transmittals, RFIs and technical queries'),

  m('Insights & Close', 'reports', 'Reports & Analytics', '/reports', 'BarChart3', 'report.view', 'Report library with export'),
  m('Insights & Close', 'closeout', 'Project Closeout', '/closeout', 'Flag', 'closeout.view', 'Final accounts, handover and archive'),

  m('Administration', 'users', 'Users, Roles & Permissions', '/admin/users', 'UserCog', 'user.manage', 'Users, invitations, roles', false),
  m('Administration', 'audit', 'Audit Trail', '/admin/audit', 'History', 'audit.view', 'Immutable audit events', false),
  m('Administration', 'integrations', 'Integrations', '/admin/integrations', 'Plug', 'integration.manage', 'Integration interfaces and imports', false),
  m('Administration', 'settings', 'Settings', '/admin/settings', 'Settings', 'settings.manage', 'Organisation, document types, workflows, modules', false),
];

/** Compact names keep the navigation narrow; pages still show the full `label`. */
const NAV_LABELS: Record<string, string> = {
  approvals: 'Approvals',
  tasks: 'Tasks',
  team: 'Team',
  manpower: 'Manpower',
  diary: 'Site Diary',
  progress: 'Progress',
  schedule: 'Schedule',
  evidence: 'Site Photos',
  equipment: 'Equipment',
  costcodes: 'WBS & Cost Codes',
  boq: 'BOQ',
  takeoff: 'Quantity Takeoff',
  measurements: 'Measurement Book',
  verification: 'MB Verification',
  materials: 'Materials',
  mr: 'Requisitions (MR)',
  pr: 'Purchase Req. (PR)',
  rfq: 'RFQ & Quotes',
  po: 'Purchase Orders',
  grn: 'Goods Receipt',
  mir: 'Inspection (MIR)',
  issues: 'Material Issues',
  inventory: 'Inventory',
  expenses: 'Expenses',
  budget: 'Budget',
  forecast: 'Forecast',
  cashflow: 'Cash Flow',
  payables: 'Payables',
  monthend: 'Month-End',
  subcontractors: 'Subcontractors',
  subbills: 'Subcontract Bills',
  clientbilling: 'Client Billing',
  contracts: 'Contracts',
  variations: 'Variations',
  risks: 'Risks & Claims',
  quality: 'Quality',
  safety: 'Safety',
  documents: 'Documents',
  transmittals: 'Transmittals & RFIs',
  reports: 'Reports',
  closeout: 'Closeout',
  users: 'Users & Roles',
  audit: 'Audit Trail',
  integrations: 'Integrations',
  settings: 'Settings',
};
for (const m of MODULES) m.navLabel = NAV_LABELS[m.key] ?? m.label;

export function moduleByKey(key: string): ModuleDef | undefined {
  return MODULES.find((x) => x.key === key);
}
