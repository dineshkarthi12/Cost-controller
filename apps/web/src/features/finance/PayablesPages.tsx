import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { RESOURCES } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate, formatMoney, formatMoneyCompact, todayIso } from '../../lib/format';
import { Button, Card, Field, Input, KpiCard, LoadingBlock, PermissionDenied, Select, Textarea } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { RefSelect } from '../../components/forms/RefSelect';
import { ResourceForm } from '../../components/forms/ResourceForm';
import { Page, PageHeader } from '../../components/layout/AppShell';
import type { Rec } from '../resources/ResourceViews';

interface ReportResult {
  columns: Array<{ key: string; label: string; type?: string }>;
  rows: Array<Record<string, string | number>>;
  totals?: Record<string, string>;
}

export function PayablesOverview() {
  const projectId = useProjectId();
  const { can, project } = useAuth();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['p', 'report', 'ap-aging', projectId], queryFn: () => api.get<ReportResult>(`/projects/${projectId}/reports/ap-aging`) });
  const cur = project?.currency;
  if (!can('payable.view')) return <PermissionDenied />;
  const buckets = ['Current', '1–30', '31–60', '61–90', '90+'].map((b) => ({ b, v: (q.data?.rows ?? []).filter((r) => r.bucket === b).reduce((a, r) => a + Number(r.outstanding), 0) }));
  return (
    <>
      <PageHeader
        title="Accounts payable"
        subtitle="Approved supplier invoices and certified contractor bills awaiting payment. Approving an invoice is not payment; payments never change cost."
        actions={
          <>
            {can('payable.manage') && <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/payables/invoices/new')}>Record invoice</Button>}
            {can('payable.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/payables/payments/new')}>New payment</Button>}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total outstanding" value={formatMoneyCompact(q.data?.totals?.outstanding ?? '0', cur)} />
        {buckets.map((b) => (
          <KpiCard key={b.b} label={b.b === 'Current' ? 'Not yet due' : `${b.b} days overdue`} value={formatMoneyCompact(String(b.v), cur)} tone={b.b === '90+' && b.v > 0 ? 'danger' : b.b !== 'Current' && b.v > 0 ? 'warning' : 'neutral'} />
        ))}
      </div>
      <Card bodyClassName="p-0" title="Payables aging">
        {q.isLoading ? (
          <LoadingBlock rows={4} />
        ) : (
          <DataTable
            rows={q.data?.rows}
            rowKey={(r) => String(r.document)}
            columns={[
              { key: 'type', header: 'Type', cell: (r) => String(r.type) },
              { key: 'party', header: 'Party', cell: (r) => String(r.party) },
              { key: 'document', header: 'Document', cell: (r) => String(r.document) },
              { key: 'due', header: 'Due', cell: (r) => formatDate(String(r.dueDate ?? '')) },
              { key: 'days', header: 'Days overdue', align: 'right', cell: (r) => <span className={Number(r.days) > 30 ? 'font-semibold text-red-600' : ''}>{String(r.days)}</span> },
              { key: 'out', header: 'Outstanding', align: 'right', cell: (r) => formatMoney(String(r.outstanding), cur) },
            ]}
            empty={{ title: 'Nothing outstanding' }}
          />
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">
        See also <Link className="text-brand-600 hover:underline" to="/reports?r=po-grn-invoice">PO–GRN–invoice reconciliation</Link> and <Link className="text-brand-600 hover:underline" to="/reports?r=certified-vs-paid">certified vs paid</Link>.
      </p>
    </>
  );
}

interface OpenLine {
  id: string;
  lineNo: number;
  description: string;
  qty: string;
  rate: string;
  taxRate: string;
  costCodeId: string;
  invoiceableQty: string;
  receivedQty: string;
  invoicedQty: string;
}

/** Supplier invoice entry. Selecting a PO pre-fills lines with received-but-not-invoiced quantities at PO rates. */
export function InvoiceNewPage() {
  const projectId = useProjectId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [poId, setPoId] = useState<string | null>(params.get('poId'));
  const [nonPo, setNonPo] = useState(false);
  const po = useQuery({ queryKey: ['p', 'rec', 'purchaseOrders', poId], queryFn: () => api.get<Rec>(`/projects/${projectId}/r/purchaseOrders/${poId}`), enabled: !!poId });
  const lines = useQuery({ queryKey: ['p', 'po-open', poId], queryFn: () => api.get<OpenLine[]>(`/projects/${projectId}/procurement/po/${poId}/open-lines`), enabled: !!poId });
  const initial = useMemo(() => {
    if (!po.data || !lines.data) return null;
    const open = lines.data.filter((l) => Number(l.invoiceableQty) > 0);
    return {
      supplierId: po.data.supplierId as string,
      poId: po.data.id,
      invoiceDate: todayIso(),
      lines: (open.length ? open : lines.data).map((l) => ({ poLineId: l.id, description: l.description, qty: open.length ? l.invoiceableQty : '', rate: l.rate, taxRate: l.taxRate, costCodeId: l.costCodeId, _labels: { poLineId: `#${l.lineNo} ${l.description}` } })),
    };
  }, [po.data, lines.data]);
  if (!can('payable.manage')) return <Page><PermissionDenied /></Page>;
  const def = RESOURCES.supplierInvoices;
  const submit = async (body: Record<string, unknown>) => {
    const rec = await api.post<Rec>(`/projects/${projectId}/r/supplierInvoices`, body);
    toast.success(`Invoice ${String(rec.number)} saved`);
    void qc.invalidateQueries({ queryKey: ['p'] });
    navigate(`/payables/invoices/${rec.id}`, { replace: true });
  };
  return (
    <Page className="max-w-5xl">
      <PageHeader breadcrumbs={[{ label: 'Supplier invoices', to: '/payables/invoices' }, { label: 'New' }]} title="Record supplier invoice" subtitle="PO-backed invoices are three-way matched against the PO and goods receipts when submitted." />
      <Card>
        {!poId && !nonPo ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Purchase order" help="Approved or partially received POs">
              <RefSelect source="purchaseOrders" value={poId} onChange={setPoId} params={{ status: 'APPROVED,PARTIALLY_RECEIVED,RECEIVED' }} />
            </Field>
            <div className="flex items-end">
              <Button variant="outline" onClick={() => setNonPo(true)}>Invoice without a PO</Button>
            </div>
          </div>
        ) : nonPo ? (
          <ResourceForm def={def} mode="create" draftKey={`${projectId}:invoice:nonpo`} hideFields={['poId']} initial={{ invoiceDate: todayIso() }} onCancel={() => navigate('/payables/invoices')} onSubmit={submit} />
        ) : !initial ? (
          <LoadingBlock rows={4} />
        ) : (
          <ResourceForm def={def} mode="create" initial={initial} lockedFields={['supplierId', 'poId']} refParams={(field) => (field === 'poLineId' ? { poId: poId ?? undefined } : undefined)} onCancel={() => navigate('/payables/invoices')} onSubmit={submit} />
        )}
      </Card>
    </Page>
  );
}

interface Outstanding {
  kind: 'supplierInvoiceId' | 'contractorBillId' | 'clientBillId' | 'expenseId';
  id: string;
  number: string;
  ref: string | null;
  dueDate: string | null;
  total: string;
  outstanding: string;
}

export function PaymentNewPage() {
  const projectId = useProjectId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can, project } = useAuth();
  const [f, setF] = useState({ direction: 'OUT', partyId: null as string | null, date: todayIso(), method: 'BANK_TRANSFER', reference: '', remarks: '' });
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [retention, setRetention] = useState<Record<string, boolean>>({});
  const docs = useQuery({ queryKey: ['p', 'outstanding', projectId, f.direction, f.partyId], queryFn: () => api.get<Outstanding[]>(`/projects/${projectId}/billing/outstanding`, { direction: f.direction, partyId: f.partyId ?? '' }), enabled: f.direction === 'IN' || !!f.partyId });
  const total = Object.values(alloc).reduce((a, v) => a + Number(v || 0), 0);
  const save = useMutation({
    mutationFn: () =>
      api.post<Rec>(`/projects/${projectId}/r/payments`, {
        direction: f.direction,
        partyId: f.partyId,
        date: f.date,
        method: f.method,
        reference: f.reference || undefined,
        remarks: f.remarks || undefined,
        allocations: (docs.data ?? []).filter((d) => Number(alloc[d.id] || 0) > 0).map((d) => ({ [d.kind]: d.id, amount: Number(alloc[d.id]).toFixed(2), retentionRelease: !!retention[d.id] })),
      }),
    onSuccess: (rec) => {
      toast.success(`${f.direction === 'IN' ? 'Receipt' : 'Payment'} ${String(rec.number)} saved as draft`);
      void qc.invalidateQueries({ queryKey: ['p'] });
      navigate(`/payables/payments/${rec.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!can('payable.manage')) return <Page><PermissionDenied /></Page>;
  const cur = project?.currency;
  return (
    <Page className="max-w-5xl">
      <PageHeader breadcrumbs={[{ label: 'Payments & receipts', to: '/payables/payments' }, { label: 'New' }]} title={f.direction === 'IN' ? 'Record client receipt' : 'New payment'} subtitle="Allocate against approved invoices, certified bills or approved expenses. The voucher goes through finance approval before balances change." />
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Direction" required>
            <Select options={[{ value: 'OUT', label: 'Payment to supplier / contractor' }, { value: 'IN', label: 'Receipt from client' }]} value={f.direction} onChange={(e) => { setF({ ...f, direction: e.target.value, partyId: null }); setAlloc({}); }} />
          </Field>
          <Field label={f.direction === 'IN' ? 'Client' : 'Payee'} required>
            <RefSelect source={f.direction === 'IN' ? 'clients' : 'parties'} value={f.partyId} onChange={(v) => { setF({ ...f, partyId: v }); setAlloc({}); }} />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Method">
            <Select options={['BANK_TRANSFER', 'CHEQUE', 'CASH', 'CARD', 'OTHER']} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} />
          </Field>
          <Field label="Bank / cheque reference">
            <Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </Field>
          <Field label="Remarks">
            <Textarea rows={1} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />
          </Field>
        </div>
        <h3 className="mb-2 mt-6 text-sm font-semibold">Allocate to open documents</h3>
        {docs.isLoading && <LoadingBlock rows={3} />}
        {(f.direction === 'IN' || f.partyId) && (
          <DataTable
            rows={docs.data}
            rowKey={(r) => r.id}
            empty={{ title: 'No open documents for this party', description: 'Only approved invoices, certified bills and approved expenses can be paid.' }}
            columns={[
              { key: 'doc', header: 'Document', cell: (r) => <span><span className="block font-medium">{r.number}</span><span className="text-xs text-muted">{r.ref}</span></span> },
              { key: 'kind', header: 'Type', cell: (r) => ({ supplierInvoiceId: 'Supplier invoice', contractorBillId: 'Contractor bill', clientBillId: 'Client bill', expenseId: 'Expense' })[r.kind] },
              { key: 'due', header: 'Due', cell: (r) => formatDate(r.dueDate) },
              { key: 'out', header: 'Outstanding', align: 'right', cell: (r) => formatMoney(r.outstanding, cur) },
              {
                key: 'amt',
                header: 'Pay now',
                align: 'right',
                cell: (r) => (
                  <span className="flex items-center justify-end gap-2">
                    <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => setAlloc({ ...alloc, [r.id]: r.outstanding })}>Full</button>
                    <Input className="num h-8 w-32" inputMode="decimal" aria-label={`Amount for ${r.number}`} value={alloc[r.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [r.id]: e.target.value })} />
                  </span>
                ),
              },
              ...(f.direction === 'OUT' ? [{ key: 'ret', header: 'Retention release', cell: (r: Outstanding) => (r.kind === 'contractorBillId' ? <input type="checkbox" aria-label="Retention release" checked={!!retention[r.id]} onChange={(e) => setRetention({ ...retention, [r.id]: e.target.checked })} /> : null) }] : []),
            ]}
          />
        )}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm">
            Total <strong className="tabular-nums">{formatMoney(String(total), cur)}</strong>
          </span>
          <Button variant="outline" onClick={() => navigate('/payables/payments')}>Cancel</Button>
          <Button loading={save.isPending} disabled={!f.partyId || total <= 0} onClick={() => save.mutate()}>Save draft</Button>
        </div>
      </Card>
    </Page>
  );
}
