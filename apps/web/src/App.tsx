import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { useAuth } from './lib/auth';
import { AppShell } from './components/layout/AppShell';
import { LoadingBlock, PermissionDenied } from './components/ui';
import { moduleRoutes, type TabDef } from './features/modules';
import { AcceptInvitationPage, AccountPage, ForgotPasswordPage, LoginPage, MfaPage, ResetPasswordPage } from './features/auth/AuthPages';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ProjectDetailPage, ProjectsPage } from './features/projects/ProjectsPage';
import { ApprovalsPage } from './features/approvals/ApprovalsPage';
import { TasksPage } from './features/tasks/TasksPage';
import { TeamPage } from './features/team/TeamPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { EvidencePage } from './features/evidence/EvidencePage';
import { BudgetPage, CashFlowPage, ForecastPage, LedgerPage } from './features/finance/BudgetPages';
import { InvoiceNewPage, PaymentNewPage, PayablesOverview } from './features/finance/PayablesPages';
import { MonthEndPage, PeriodDetailPage } from './features/finance/MonthEndPage';
import { GrnNewPage, RfqDetailPage, RfqListPage } from './features/procurement/ProcurementPages';
import { InventoryPage } from './features/stock/InventoryPage';
import { ClientBillDetail, ClientBillingPage, ContractorBillDetail, ContractorBillsPage, SubcontractSummary } from './features/commercial/BillingPages';
import { AttendancePage, EquipmentUtilisation, ProgressPage, SchedulePage, VerificationQueuePage } from './features/site/SitePages';
import { DailyLabourPage, LabourSummaryPage } from './features/site/LabourReportPages';
import { ImportButton } from './features/admin/ImportDialog';
import { AuditPage, IntegrationsPage, SettingsPage, UsersPage } from './features/admin/AdminPages';
import { ReportsPage } from './features/reports/ReportsPage';
import { CloseoutPage } from './features/closeout/CloseoutPage';
import { ResourceList } from './features/resources/ResourceViews';

function RequireAuth() {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-8"><LoadingBlock rows={6} /></div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Outlet />;
}

function Guard({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? <>{children}</> : <PermissionDenied />;
}

const T = (label: string, path: string, resource?: string, extra: Partial<TabDef> = {}): TabDef => ({ label, path, resource, ...extra });

const MODULE_TABS: Record<string, TabDef[]> = {
  manpower: [T('Daily labour report', '/manpower/daily', undefined, { element: <DailyLabourPage /> }), T('Labour summary', '/manpower/summary', undefined, { element: <LabourSummaryPage /> }), T('Manpower reports', '/manpower', 'manpowerReports'), T('Attendance register', '/manpower/attendance', undefined, { element: <AttendancePage /> }), T('Workers', '/manpower/workers', 'workers'), T('Labour norms', '/manpower/norms', 'labourNorms')],
  diary: [T('Daily site diary', '/site-diary', 'siteDiaries')],
  progress: [T('Progress overview', '/progress', undefined, { element: <ProgressPage /> }), T('Progress entries', '/progress/entries', 'progressEntries')],
  schedule: [T('Gantt & look-ahead', '/schedule', undefined, { element: <SchedulePage /> }), T('Activities', '/schedule/activities', 'activities')],
  equipment: [T('Equipment register', '/equipment', 'equipment'), T('Daily logs', '/equipment/logs', 'equipmentLogs'), T('Maintenance', '/equipment/maintenance', 'equipmentMaintenance'), T('Utilisation', '/equipment/utilisation', undefined, { element: <EquipmentUtilisation /> })],
  costcodes: [T('Cost codes', '/cost-codes', 'costCodes', { listProps: { actions: <ImportButton kind="COST_CODES" /> } }), T('WBS', '/cost-codes/wbs', 'wbsNodes')],
  boq: [T('BOQ items', '/boq', 'boqItems', { listProps: { actions: <ImportButton kind="BOQ" /> } })],
  takeoff: [T('Quantity takeoff', '/takeoff', 'takeoffs')],
  measurements: [T('Measurement book', '/measurements', 'measurements')],
  verification: [T('Verification queue', '/measurement-verification', undefined, { element: <VerificationQueuePage /> })],
  materials: [
    T('Materials', '/materials', 'materials', { listProps: { actions: <ImportButton kind="MATERIALS" /> } }),
    T('Units', '/materials/units', 'uoms'),
    T('Stores', '/materials/stores', 'stores'),
    T('Suppliers & parties', '/materials/parties', 'parties', { listProps: { actions: <ImportButton kind="SUPPLIERS" /> } }),
  ],
  mr: [T('Material requisitions', '/procurement/mr', 'mrs')],
  pr: [T('Purchase requisitions', '/procurement/pr', 'prs')],
  po: [T('Purchase orders', '/procurement/po', 'purchaseOrders', { listProps: { statusOptions: ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED', 'REJECTED'] } })],
  grn: [T('Goods receipts', '/procurement/grn', 'grns', { createElement: <GrnNewPage /> })],
  mir: [T('Material inspections', '/procurement/mir', 'mirs')],
  issues: [T('Issues & movements', '/stock/issues', 'materialIssues')],
  inventory: [T('Stock & reconciliation', '/stock', undefined, { element: <InventoryPage /> }), T('Physical counts', '/stock/counts', 'stockCounts')],
  expenses: [T('Expenses', '/expenses', 'expenses')],
  budget: [T('Budget control', '/budget', undefined, { element: <BudgetPage /> }), T('Revisions & transfers', '/budget/revisions', 'budgetRevisions'), T('Cost ledger', '/budget/ledger', undefined, { element: <LedgerPage /> })],
  forecast: [T('Cost forecast', '/forecast', undefined, { element: <ForecastPage /> })],
  cashflow: [T('Cash flow', '/cash-flow', undefined, { element: <CashFlowPage /> }), T('Cash flow plan', '/cash-flow/plan', 'cashFlowPlans')],
  payables: [
    T('Overview & aging', '/payables', undefined, { element: <PayablesOverview /> }),
    T('Supplier invoices', '/payables/invoices', 'supplierInvoices', { createElement: <InvoiceNewPage />, listProps: { statusOptions: ['DRAFT', 'SUBMITTED', 'EXCEPTION', 'RETURNED', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'REJECTED', 'CANCELLED'] } }),
    T('Payments & receipts', '/payables/payments', 'payments', { createElement: <PaymentNewPage /> }),
  ],
  subcontractors: [
    T('Subcontractors', '/subcontractors', undefined, { element: <ResourceList resourceKey="parties" basePath="/materials/parties" title="Subcontractors" fixedFilters={{ kinds: 'SUBCONTRACTOR' }} /> }),
    T('Subcontracts', '/subcontractors/contracts', 'subcontracts'),
    T('Reconciliation', '/subcontractors/summary', undefined, { element: <SubcontractSummary /> }),
  ],
  subbills: [T('RA bills', '/subcontractor-bills', undefined, { element: <ContractorBillsPage /> })],
  clientbilling: [T('Client bills & receivables', '/client-billing', undefined, { element: <ClientBillingPage /> }), T('Payment milestones', '/client-billing/milestones', 'billingMilestones'), T('Credit & debit notes', '/client-billing/notes', 'creditNotes')],
  contracts: [T('Contracts', '/contracts', 'contracts')],
  variations: [T('Variations', '/variations', 'variations')],
  risks: [T('Risk register', '/risks', 'risks'), T('Claims & EOT', '/risks/claims', 'claims')],
  quality: [T('Inspections', '/quality', 'inspections'), T('NCR & rework', '/quality/ncrs', 'ncrs'), T('ITP templates', '/quality/templates', 'checklistTemplates')],
  safety: [T('Incidents & observations', '/safety', 'safetyIncidents'), T('Toolbox talks', '/safety/toolbox-talks', 'toolboxTalks')],
  documents: [T('Document register', '/documents', 'documents')],
  transmittals: [T('Transmittals', '/transmittals', 'transmittals'), T('RFIs & technical queries', '/transmittals/rfis', 'rfis')],
  tasks: [T('Tasks', '/tasks', 'tasks', { element: <TasksPage /> })],
};

const generated = Object.entries(MODULE_TABS).flatMap(([k, tabs]) => moduleRoutes(k, tabs));

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/mfa', element: <MfaPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/accept-invitation', element: <AcceptInvitationPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/account', element: <AccountPage /> },
          { path: '/projects', element: <ProjectsPage /> },
          { path: '/projects/:id', element: <ProjectDetailPage /> },
          { path: '/approvals', element: <ApprovalsPage /> },
          { path: '/team', element: <TeamPage /> },
          { path: '/notifications', element: <NotificationsPage /> },
          { path: '/evidence', element: <EvidencePage /> },
          { path: '/procurement/rfq', element: <RfqListPage /> },
          { path: '/procurement/rfq/:id', element: <RfqDetailPage /> },
          { path: '/subcontractor-bills/:id', element: <ContractorBillDetail /> },
          { path: '/client-billing/bills/:id', element: <ClientBillDetail /> },
          { path: '/month-end', element: <MonthEndPage /> },
          { path: '/month-end/:id', element: <PeriodDetailPage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/closeout', element: <CloseoutPage /> },
          { path: '/admin/users', element: <Guard perm="user.manage"><UsersPage /></Guard> },
          { path: '/admin/audit', element: <Guard perm="audit.view"><AuditPage /></Guard> },
          { path: '/admin/integrations', element: <Guard perm="integration.manage"><IntegrationsPage /></Guard> },
          { path: '/admin/settings', element: <SettingsPage /> },
          ...generated,
          { path: '*', element: <div className="p-8"><PermissionDenied message="This page does not exist." /></div> },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
