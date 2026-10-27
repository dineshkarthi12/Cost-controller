import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, BadgeCheck, Ban, FileDown, Plus, Send } from 'lucide-react';
import { api, type Paged } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate, formatMoney, formatMoneyCompact, formatQty, todayIso } from '../../lib/format';
import { Badge, Button, Card, ConfirmDialog, DescriptionList, Dialog, ErrorState, Field, Input, KpiCard, LoadingBlock, PermissionDenied, Select, StatusBadge, TabPanel, Tabs, Textarea, cx } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { RefSelect } from '../../components/forms/RefSelect';
import { ApprovalTimeline, AttachmentsPanel, AuditTimeline, CommentsPanel } from '../../components/record/Panels';
import { Page, PageHeader } from '../../components/layout/AppShell';

interface BillLine {
  id: string;
  description: string;
  unit: string;
  rate: string;
  previousQty: string;
  currentQty: string;
  cumulativeQty: string;
  currentAmount: string;
  cumulativeAmount: string;
  measurementIds?: string[];
}
interface ContractorBill {
  id: string;
  number: string;
  billSeq: number;
  status: string;
  periodFrom: string;
  periodTo: string;
  grossToDate: string;
  previousGross: string;
  currentWorkValue: string;
  variationValue: string;
  retention: string;
  advanceRecovery: string;
  otherDeductions: string;
  deductionNotes: string | null;
  taxAmount: string;
  netPayable: string;
  paidAmount: string;
  contractorInvoiceNo: string | null;
  dueDate: string | null;
  certifiedAt: string | null;
  contractor: { id?: string; name: string };
  subcontract: { id?: string; number: string; title: string; retentionPct?: string; advanceRecoveryPct?: string; taxRate?: string };
  lines?: BillLine[];
  payments?: Array<{ id: string; amount: string; retentionRelease: boolean; payment: { number: string; date: string; status: string } }>;
  _permissions?: { canSubmit: boolean; canCancel: boolean };
}

function NewBillDialog({ open, onOpenChange, subcontractId }: { open: boolean; onOpenChange: (o: boolean) => void; subcontractId?: string | null }) {
  const projectId = useProjectId();
  const navigate = useNavigate();
  const [f, setF] = useState({ subcontractId: subcontractId ?? null, periodFrom: '', periodTo: todayIso(), contractorInvoiceNo: '', otherDeductions: '', deductionNotes: '' });
  useEffect(() => setF((x) => ({ ...x, subcontractId: subcontractId ?? x.subcontractId })), [subcontractId]);
  const m = useMutation({
    mutationFn: () => api.post<ContractorBill>(`/projects/${projectId}/billing/contractor-bills`, { ...f, periodFrom: f.periodFrom || f.periodTo, otherDeductions: f.otherDeductions || undefined, deductionNotes: f.deductionNotes || undefined, contractorInvoiceNo: f.contractorInvoiceNo || undefined }),
    onSuccess: (b) => { toast.success(`RA bill ${b.number} prepared`); navigate(`/subcontractor-bills/${b.id}`); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Prepare RA bill" description="Quantities come only from certified measurements not yet billed. Previous bills, retention, advance recovery and tax are calculated by the system." footer={<Button loading={m.isPending} disabled={!f.subcontractId} onClick={() => m.mutate()}>Prepare bill</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Subcontract" required className="sm:col-span-2"><RefSelect source="subcontracts" value={f.subcontractId} onChange={(v) => setF({ ...f, subcontractId: v })} /></Field>
        <Field label="Period from"><Input type="date" value={f.periodFrom} onChange={(e) => setF({ ...f, periodFrom: e.target.value })} /></Field>
        <Field label="Period to" required help="Certified measurements up to this date are included"><Input type="date" value={f.periodTo} onChange={(e) => setF({ ...f, periodTo: e.target.value })} /></Field>
        <Field label="Contractor invoice no."><Input value={f.contractorInvoiceNo} onChange={(e) => setF({ ...f, contractorInvoiceNo: e.target.value })} /></Field>
        <Field label="Other deductions"><Input inputMode="decimal" value={f.otherDeductions} onChange={(e) => setF({ ...f, otherDeductions: e.target.value })} /></Field>
        <Field label="Deduction notes" className="sm:col-span-2"><Textarea value={f.deductionNotes} onChange={(e) => setF({ ...f, deductionNotes: e.target.value })} placeholder="e.g. material recovery, debit for rework" /></Field>
      </div>
    </Dialog>
  );
}

export function ContractorBillsPage() {
  const projectId = useProjectId();
  const { can, project } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const newFor = params.get('new');
  const [open, setOpen] = useState(!!newFor);
  const q = useQuery({ queryKey: ['p', 'cbills', projectId, status, page], queryFn: () => api.get<Paged<ContractorBill>>(`/projects/${projectId}/billing/contractor-bills`, { status, page }) });
  if (!can('subbill.view')) return <PermissionDenied />;
  const cur = project?.currency;
  return (
    <>
      <PageHeader title="Subcontractor billing" subtitle="Running account (RA) bills. Submission never certifies a bill — certification is a workflow approval, after which actual cost is recognised." actions={can('subbill.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Prepare RA bill</Button>} />
      <Card bodyClassName="p-0">
        <div className="border-b border-line p-3">
          <Select className="w-48" aria-label="Status" options={['DRAFT', 'SUBMITTED', 'RETURNED', 'CERTIFIED', 'PARTIALLY_PAID', 'PAID', 'REJECTED', 'CANCELLED']} placeholder="All statuses" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
        </div>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          error={q.error}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/subcontractor-bills/${r.id}`)}
          empty={{ title: 'No RA bills', description: 'Certify measurements against an approved subcontract, then prepare a bill.' }}
          columns={[
            { key: 'n', header: 'Bill', cell: (r) => <span className="font-medium text-navy-800">{r.number}</span> },
            { key: 'c', header: 'Contractor', cell: (r) => <span><span className="block">{r.contractor.name}</span><span className="text-xs text-muted">{r.subcontract.number}</span></span> },
            { key: 'p', header: 'Period', cell: (r) => `${formatDate(r.periodFrom)} – ${formatDate(r.periodTo)}`, hideOnMobile: true },
            { key: 'w', header: 'Work value', align: 'right', cell: (r) => formatMoney(r.currentWorkValue, cur) },
            { key: 'net', header: 'Net payable', align: 'right', cell: (r) => formatMoney(r.netPayable, cur) },
            { key: 'paid', header: 'Paid', align: 'right', cell: (r) => formatMoney(r.paidAmount, cur), hideOnMobile: true },
            { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          ]}
          pagination={q.data ? { page, pageSize: q.data.pageSize, total: q.data.total, onPage: setPage } : undefined}
        />
      </Card>
      {open && <NewBillDialog open={open} subcontractId={newFor} onOpenChange={(o) => { setOpen(o); if (!o && newFor) { params.delete('new'); setParams(params, { replace: true }); } }} />}
    </>
  );
}

function CalcTable({ b, cur }: { b: { grossToDate: string; previousGross: string; currentWorkValue: string; variationValue: string; taxAmount: string; retention: string; advanceRecovery: string; otherDeductions: string; net: string }; cur?: string }) {
  const rows: Array<[string, string, boolean?]> = [
    ['Gross value to date (incl. variations)', b.grossToDate],
    ['Less: previously certified', `-${b.previousGross}`],
    ['Current work value', b.currentWorkValue, true],
    ['Add: tax', b.taxAmount],
    ['Less: retention', `-${b.retention}`],
    ['Less: advance recovery', `-${b.advanceRecovery}`],
    ['Less: other deductions', `-${b.otherDeductions}`],
    ['Net payable', b.net, true],
  ];
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([l, v, strong]) => (
          <tr key={l} className={cx('border-t border-line', strong && 'font-semibold')}>
            <td className="py-1.5">{l}</td>
            <td className="py-1.5 text-right tabular-nums">{formatMoney(v.replace('--', ''), cur)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LinesTable({ lines, cur }: { lines: BillLine[]; cur?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-muted">
          <tr>
            <th className="px-3 py-2 text-left">Item</th>
            <th className="px-3 py-2 text-right">Rate</th>
            <th className="px-3 py-2 text-right">Previous</th>
            <th className="px-3 py-2 text-right">This bill</th>
            <th className="px-3 py-2 text-right">Cumulative</th>
            <th className="px-3 py-2 text-right">This bill amount</th>
            <th className="px-3 py-2 text-right">Cumulative amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="px-3 py-2">{l.description}{l.measurementIds?.length ? <span className="block text-xs text-muted">{l.measurementIds.length} certified measurement(s)</span> : null}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.rate, cur)}/{l.unit}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatQty(l.previousQty, 3)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">{formatQty(l.currentQty, 3)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatQty(l.cumulativeQty, 3)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.currentAmount, cur)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.cumulativeAmount, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ContractorBillDetail() {
  const { id = '' } = useParams();
  const projectId = useProjectId();
  const { project } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('summary');
  const [cancel, setCancel] = useState(false);
  const q = useQuery({ queryKey: ['p', 'cbill', id], queryFn: () => api.get<ContractorBill>(`/projects/${projectId}/billing/contractor-bills/${id}`) });
  const inv = () => void qc.invalidateQueries({ queryKey: ['p'] });
  const submit = useMutation({ mutationFn: () => api.post(`/projects/${projectId}/billing/contractor-bills/${id}/submit`), onSuccess: () => { toast.success('Submitted for certification'); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const cancelM = useMutation({ mutationFn: (reason: string) => api.post(`/projects/${projectId}/billing/contractor-bills/${id}/cancel`, { reason }), onSuccess: () => { toast.success('Bill cancelled; measurements released'); setCancel(false); inv(); }, onError: (e: Error) => toast.error(e.message) });
  if (q.isLoading) return <Page><LoadingBlock rows={6} /></Page>;
  if (q.error || !q.data) return <Page><ErrorState error={q.error} /></Page>;
  const b = q.data;
  const cur = project?.currency;
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: 'Subcontractor billing', to: '/subcontractor-bills' }, { label: b.number }]}
        title={<span className="flex items-center gap-3">{b.number} <StatusBadge status={b.status} /></span>}
        subtitle={`${b.contractor.name} · ${b.subcontract.number} ${b.subcontract.title} · RA-${b.billSeq}`}
        actions={
          <>
            <Button variant="outline" icon={<FileDown className="h-4 w-4" />} onClick={() => window.open(api.url(`/projects/${projectId}/billing/contractor-bills/${id}/pdf`), '_blank')}>PDF</Button>
            {b._permissions?.canSubmit && <Button icon={<Send className="h-4 w-4" />} loading={submit.isPending} onClick={() => submit.mutate()}>Submit for certification</Button>}
            {b._permissions?.canCancel && <Button variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setCancel(true)}>Cancel</Button>}
          </>
        }
      />
      {['DRAFT', 'SUBMITTED', 'RETURNED'].includes(b.status) && <p className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertTriangle className="h-4 w-4" />Not certified. No cost is recognised until the certification workflow completes.</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Current work value" value={formatMoneyCompact(b.currentWorkValue, cur)} />
        <KpiCard label="Net payable" value={formatMoneyCompact(b.netPayable, cur)} />
        <KpiCard label="Paid" value={formatMoneyCompact(b.paidAmount, cur)} tone="success" />
        <KpiCard label="Retention this bill" value={formatMoneyCompact(b.retention, cur)} tone="neutral" />
      </div>
      <Card bodyClassName="p-0">
        <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'summary', label: 'Calculation' }, { value: 'lines', label: 'Bill lines', count: b.lines?.length }, { value: 'approvals', label: 'Certification' }, { value: 'payments', label: 'Payments', count: b.payments?.length }, { value: 'attachments', label: 'Attachments' }, { value: 'comments', label: 'Comments' }, { value: 'history', label: 'History' }]} className="px-4 pt-1">
          <TabPanel value="summary" className="grid gap-6 py-5 lg:grid-cols-2">
            <CalcTable b={{ ...b, net: b.netPayable }} cur={cur} />
            <DescriptionList columns={2} items={[{ label: 'Bill period', value: `${formatDate(b.periodFrom)} – ${formatDate(b.periodTo)}` }, { label: 'Contractor invoice', value: b.contractorInvoiceNo }, { label: 'Certified on', value: formatDate(b.certifiedAt) }, { label: 'Payment due', value: formatDate(b.dueDate) }, { label: 'Retention %', value: b.subcontract.retentionPct ? `${(Number(b.subcontract.retentionPct) * 100).toFixed(2)}%` : null }, { label: 'Advance recovery %', value: b.subcontract.advanceRecoveryPct ? `${(Number(b.subcontract.advanceRecoveryPct) * 100).toFixed(2)}%` : null }, { label: 'Deduction notes', value: b.deductionNotes, span: 2 }]} />
          </TabPanel>
          <TabPanel value="lines" className="py-4">{b.lines && <LinesTable lines={b.lines} cur={cur} />}</TabPanel>
          <TabPanel value="approvals" className="py-4"><ApprovalTimeline docType="CONTRACTOR_BILL" entityId={b.id} onChanged={inv} /></TabPanel>
          <TabPanel value="payments" className="py-4">
            {b.payments?.length ? (
              <ul className="divide-y divide-line">{b.payments.map((p) => <li key={p.id} className="flex justify-between py-2 text-sm"><span>{p.payment.number} · {formatDate(p.payment.date)} {p.retentionRelease && <Badge>Retention release</Badge>}</span><span className="flex items-center gap-2">{formatMoney(p.amount, cur)} <StatusBadge status={p.payment.status} /></span></li>)}</ul>
            ) : <p className="text-sm text-muted">No payments allocated.</p>}
          </TabPanel>
          <TabPanel value="attachments" className="py-4"><AttachmentsPanel entityType="contractorBill" entityId={b.id} /></TabPanel>
          <TabPanel value="comments" className="py-4"><CommentsPanel entityType="contractorBill" entityId={b.id} /></TabPanel>
          <TabPanel value="history" className="py-4"><AuditTimeline entityType="contractorBill" entityId={b.id} /></TabPanel>
        </Tabs>
      </Card>
      <ConfirmDialog open={cancel} onOpenChange={setCancel} title="Cancel this bill?" message="The measurements included are released and can be billed again." requireReason tone="danger" confirmLabel="Cancel bill" loading={cancelM.isPending} onConfirm={(r) => cancelM.mutate(r)} />
    </Page>
  );
}

interface SubSummary {
  id: string;
  number: string;
  title: string;
  contractor: string;
  status: string;
  contractValue: string;
  certifiedToDate: string;
  percentCertified: string | null;
  netPayableToDate: string;
  paidToDate: string;
  retentionHeld: string;
  advanceOutstanding: string;
}

export function SubcontractSummary() {
  const projectId = useProjectId();
  const { project } = useAuth();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['p', 'sub-summary', projectId], queryFn: () => api.get<SubSummary[]>(`/projects/${projectId}/billing/subcontract-summary`) });
  const cur = project?.currency;
  return (
    <>
      <PageHeader title="Subcontract reconciliation" subtitle="Contract value vs certified, net payable, paid, retention held and advance outstanding." />
      <Card bodyClassName="p-0">
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/subcontractors/contracts/${r.id}`)}
          columns={[
            { key: 'n', header: 'Work order', cell: (r) => <span><span className="block font-medium text-navy-800">{r.number}</span><span className="text-xs text-muted">{r.title}</span></span> },
            { key: 'c', header: 'Contractor', cell: (r) => r.contractor },
            { key: 'cv', header: 'Contract', align: 'right', cell: (r) => formatMoneyCompact(r.contractValue, cur) },
            { key: 'cert', header: 'Certified', align: 'right', cell: (r) => <span>{formatMoneyCompact(r.certifiedToDate, cur)} <span className="text-xs text-muted">{r.percentCertified ? `${(Number(r.percentCertified) * 100).toFixed(0)}%` : ''}</span></span> },
            { key: 'net', header: 'Net payable', align: 'right', cell: (r) => formatMoneyCompact(r.netPayableToDate, cur), hideOnMobile: true },
            { key: 'paid', header: 'Paid', align: 'right', cell: (r) => formatMoneyCompact(r.paidToDate, cur) },
            { key: 'ret', header: 'Retention held', align: 'right', cell: (r) => formatMoneyCompact(r.retentionHeld, cur), hideOnMobile: true },
            { key: 'adv', header: 'Advance o/s', align: 'right', cell: (r) => formatMoneyCompact(r.advanceOutstanding, cur), hideOnMobile: true },
            { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
    </>
  );
}

interface ClientBill {
  id: string;
  number: string;
  billSeq: number;
  type: string;
  status: string;
  periodFrom: string;
  periodTo: string;
  grossToDate: string;
  previousGross: string;
  currentWorkValue: string;
  variationValue: string;
  retention: string;
  advanceRecovery: string;
  otherDeductions: string;
  taxAmount: string;
  netAmount: string;
  certifiedAmount: string | null;
  receivedAmount: string;
  invoiceNo: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  disputeNotes: string | null;
  lines?: BillLine[];
  receipts?: Array<{ id: string; amount: string; payment: { number: string; date: string; status: string } }>;
  _permissions?: { canSubmit: boolean; canCertify: boolean; canDispute: boolean };
}

interface Aging {
  rows: Array<{ id: string; number: string; invoiceNo: string | null; dueDate: string | null; outstanding: string; daysOverdue: number; bucket: string; status: string }>;
  buckets: Record<string, string>;
  retentionReceivable: string;
}

export function ClientBillingPage() {
  const projectId = useProjectId();
  const { can, project } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ periodFrom: '', periodTo: todayIso(), type: 'RA', milestoneId: null as string | null });
  const bills = useQuery({ queryKey: ['p', 'client-bills', projectId], queryFn: () => api.get<Paged<ClientBill>>(`/projects/${projectId}/billing/client-bills`) });
  const aging = useQuery({ queryKey: ['p', 'ar-aging', projectId], queryFn: () => api.get<Aging>(`/projects/${projectId}/billing/receivables-aging`) });
  const create = useMutation({ mutationFn: () => api.post<ClientBill>(`/projects/${projectId}/billing/client-bills`, { ...f, periodFrom: f.periodFrom || f.periodTo, milestoneId: f.milestoneId ?? undefined }), onSuccess: (b) => { toast.success(`Client bill ${b.number} prepared`); navigate(`/client-billing/bills/${b.id}`); }, onError: (e: Error) => toast.error(e.message) });
  if (!can('clientbill.view')) return <PermissionDenied />;
  const cur = project?.currency;
  const total = Object.values(aging.data?.buckets ?? {}).reduce((a, v) => a + Number(v), 0);
  return (
    <>
      <PageHeader title="Client billing & receivables" subtitle="Client RA bills use certified quantities at contract rates plus approved variations. Receivables are kept separate from payables." actions={can('clientbill.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Prepare client bill</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="Outstanding receivables" value={formatMoneyCompact(String(total), cur)} />
        {Object.entries(aging.data?.buckets ?? {}).map(([k, v]) => <KpiCard key={k} label={k === 'current' ? 'Not yet due' : k === 'd90plus' ? '90+ days' : `${k.slice(1)} days`} value={formatMoneyCompact(v, cur)} tone={k !== 'current' && Number(v) > 0 ? 'warning' : 'neutral'} />)}
        <KpiCard label="Retention receivable" value={formatMoneyCompact(aging.data?.retentionReceivable ?? '0', cur)} tone="neutral" />
      </div>
      <Card bodyClassName="p-0" title="Client bills">
        <DataTable
          rows={bills.data?.items}
          loading={bills.isLoading}
          error={bills.error}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/client-billing/bills/${r.id}`)}
          empty={{ title: 'No client bills yet' }}
          columns={[
            { key: 'n', header: 'Bill', cell: (r) => <span className="font-medium text-navy-800">{r.number}</span> },
            { key: 't', header: 'Type', cell: (r) => r.type },
            { key: 'p', header: 'Period', cell: (r) => `${formatDate(r.periodFrom)} – ${formatDate(r.periodTo)}`, hideOnMobile: true },
            { key: 'claim', header: 'Claimed (net)', align: 'right', cell: (r) => formatMoney(r.netAmount, cur) },
            { key: 'cert', header: 'Certified', align: 'right', cell: (r) => (r.certifiedAmount ? formatMoney(r.certifiedAmount, cur) : '—') },
            { key: 'rec', header: 'Received', align: 'right', cell: (r) => formatMoney(r.receivedAmount, cur), hideOnMobile: true },
            { key: 'inv', header: 'Invoice', cell: (r) => r.invoiceNo ?? '—', hideOnMobile: true },
            { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title="Prepare client bill" footer={<Button loading={create.isPending} onClick={() => create.mutate()}>Prepare bill</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bill type"><Select options={['RA', 'MILESTONE', 'FINAL']} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} /></Field>
          {f.type === 'MILESTONE' && <Field label="Milestone"><RefSelect source="milestones" value={f.milestoneId} onChange={(v) => setF({ ...f, milestoneId: v })} /></Field>}
          <Field label="Period from"><Input type="date" value={f.periodFrom} onChange={(e) => setF({ ...f, periodFrom: e.target.value })} /></Field>
          <Field label="Period to"><Input type="date" value={f.periodTo} onChange={(e) => setF({ ...f, periodTo: e.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  );
}

export function ClientBillDetail() {
  const { id = '' } = useParams();
  const projectId = useProjectId();
  const { project } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('summary');
  const [cert, setCert] = useState(false);
  const [dispute, setDispute] = useState(false);
  const [c, setC] = useState({ certifiedAmount: '', invoiceNo: '', invoiceDate: todayIso(), dueDate: '', notes: '' });
  const q = useQuery({ queryKey: ['p', 'client-bill', id], queryFn: () => api.get<ClientBill>(`/projects/${projectId}/billing/client-bills/${id}`) });
  const inv = () => void qc.invalidateQueries({ queryKey: ['p'] });
  const submit = useMutation({ mutationFn: () => api.post(`/projects/${projectId}/billing/client-bills/${id}/submit`), onSuccess: () => { toast.success('Submitted for internal approval'); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const certify = useMutation({ mutationFn: () => api.post(`/projects/${projectId}/billing/client-bills/${id}/client-certification`, { ...c, notes: c.notes || undefined }), onSuccess: () => { toast.success('Client certification recorded'); setCert(false); inv(); }, onError: (e: Error) => toast.error(e.message) });
  const disputeM = useMutation({ mutationFn: (notes: string) => api.post(`/projects/${projectId}/billing/client-bills/${id}/dispute`, { notes }), onSuccess: () => { toast.success('Marked as disputed'); setDispute(false); inv(); }, onError: (e: Error) => toast.error(e.message) });
  if (q.isLoading) return <Page><LoadingBlock rows={6} /></Page>;
  if (q.error || !q.data) return <Page><ErrorState error={q.error} /></Page>;
  const b = q.data;
  const cur = project?.currency;
  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ label: 'Client billing', to: '/client-billing' }, { label: b.number }]}
        title={<span className="flex items-center gap-3">{b.number} <StatusBadge status={b.status} /></span>}
        subtitle={`${b.type} bill ${b.billSeq} · ${formatDate(b.periodFrom)} – ${formatDate(b.periodTo)}`}
        actions={
          <>
            {b._permissions?.canSubmit && <Button icon={<Send className="h-4 w-4" />} loading={submit.isPending} onClick={() => submit.mutate()}>Submit for approval</Button>}
            {b._permissions?.canCertify && <Button variant="success" icon={<BadgeCheck className="h-4 w-4" />} onClick={() => { setC({ ...c, certifiedAmount: b.netAmount }); setCert(true); }}>Record client certification</Button>}
            {b._permissions?.canDispute && <Button variant="outline" onClick={() => setDispute(true)}>Mark disputed</Button>}
          </>
        }
      />
      {b.disputeNotes && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Notes: {b.disputeNotes}</p>}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Claimed (net)" value={formatMoneyCompact(b.netAmount, cur)} />
        <KpiCard label="Certified by client" value={b.certifiedAmount ? formatMoneyCompact(b.certifiedAmount, cur) : '—'} tone="success" />
        <KpiCard label="Received" value={formatMoneyCompact(b.receivedAmount, cur)} tone="success" />
        <KpiCard label="Outstanding" value={formatMoneyCompact(String(Number(b.certifiedAmount ?? 0) - Number(b.receivedAmount)), cur)} tone="warning" />
      </div>
      <Card bodyClassName="p-0">
        <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'summary', label: 'Calculation' }, { value: 'lines', label: 'BOQ lines', count: b.lines?.length }, { value: 'approvals', label: 'Approvals' }, { value: 'receipts', label: 'Receipts', count: b.receipts?.length }, { value: 'attachments', label: 'Attachments' }, { value: 'history', label: 'History' }]} className="px-4 pt-1">
          <TabPanel value="summary" className="grid gap-6 py-5 lg:grid-cols-2">
            <CalcTable b={{ ...b, net: b.netAmount }} cur={cur} />
            <DescriptionList columns={2} items={[{ label: 'Invoice no.', value: b.invoiceNo }, { label: 'Invoice date', value: formatDate(b.invoiceDate) }, { label: 'Payment due', value: formatDate(b.dueDate) }, { label: 'Approved variations to date', value: formatMoney(b.variationValue, cur) }]} />
          </TabPanel>
          <TabPanel value="lines" className="py-4">{b.lines && <LinesTable lines={b.lines} cur={cur} />}</TabPanel>
          <TabPanel value="approvals" className="py-4"><ApprovalTimeline docType="CLIENT_BILL" entityId={b.id} onChanged={inv} /></TabPanel>
          <TabPanel value="receipts" className="py-4">
            {b.receipts?.length ? <ul className="divide-y divide-line">{b.receipts.map((r) => <li key={r.id} className="flex justify-between py-2 text-sm"><span>{r.payment.number} · {formatDate(r.payment.date)}</span><span className="flex items-center gap-2">{formatMoney(r.amount, cur)} <StatusBadge status={r.payment.status} /></span></li>)}</ul> : <p className="text-sm text-muted">No receipts yet. Record receipts in Payments & receipts.</p>}
          </TabPanel>
          <TabPanel value="attachments" className="py-4"><AttachmentsPanel entityType="clientBill" entityId={b.id} /></TabPanel>
          <TabPanel value="history" className="py-4"><AuditTimeline entityType="clientBill" entityId={b.id} /></TabPanel>
        </Tabs>
      </Card>
      <Dialog open={cert} onOpenChange={setCert} title="Client certification" description="Record what the client/engineer certified. It may be less than claimed; it cannot exceed the claim." footer={<Button loading={certify.isPending} disabled={!c.certifiedAmount || !c.invoiceNo || !c.dueDate} onClick={() => certify.mutate()}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Certified amount" required><Input inputMode="decimal" value={c.certifiedAmount} onChange={(e) => setC({ ...c, certifiedAmount: e.target.value })} /></Field>
          <Field label="Tax invoice no." required><Input value={c.invoiceNo} onChange={(e) => setC({ ...c, invoiceNo: e.target.value })} /></Field>
          <Field label="Invoice date" required><Input type="date" value={c.invoiceDate} onChange={(e) => setC({ ...c, invoiceDate: e.target.value })} /></Field>
          <Field label="Payment due" required><Input type="date" value={c.dueDate} onChange={(e) => setC({ ...c, dueDate: e.target.value })} /></Field>
          <Field label="Notes (deductions by client)" className="sm:col-span-2"><Textarea value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} /></Field>
        </div>
      </Dialog>
      <ConfirmDialog open={dispute} onOpenChange={setDispute} title="Mark bill as disputed" message="Record the disputed items and amounts." requireReason reasonLabel="Dispute notes" tone="danger" confirmLabel="Mark disputed" loading={disputeM.isPending} onConfirm={(n) => disputeM.mutate(n)} />
    </Page>
  );
}
