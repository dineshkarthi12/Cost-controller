import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, Plus, Trophy } from 'lucide-react';
import { RESOURCES } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate, formatMoney, formatQty, todayIso } from '../../lib/format';
import { Badge, Button, Card, Checkbox, Dialog, ErrorState, Field, Input, LoadingBlock, PermissionDenied, Select, StatusBadge, Textarea, cx } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { RefSelect } from '../../components/forms/RefSelect';
import { ResourceForm } from '../../components/forms/ResourceForm';
import { Page, PageHeader } from '../../components/layout/AppShell';
import type { Rec } from '../resources/ResourceViews';

interface RfqRow {
  id: string;
  number: string;
  title: string;
  dueDate: string;
  status: string;
  prNumber: string | null;
  quotationCount: number;
  supplierIds: string[];
}

export function RfqListPage() {
  const projectId = useProjectId();
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['p', 'rfqs', projectId], queryFn: () => api.get<RfqRow[]>(`/projects/${projectId}/procurement/rfqs`) });
  if (!can('procurement.view')) return <Page><PermissionDenied /></Page>;
  return (
    <Page>
      <PageHeader title="RFQ & quotation comparison" subtitle="Raise an RFQ from an approved purchase requisition (PR → Raise RFQ), record supplier quotations, compare and award with a justification." />
      <Card bodyClassName="p-0">
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/procurement/rfq/${r.id}`)}
          empty={{ title: 'No RFQs yet', description: 'Open an approved PR and choose “Raise RFQ”.' }}
          columns={[
            { key: 'n', header: 'RFQ', cell: (r) => <span className="font-medium text-navy-800">{r.number}</span> },
            { key: 't', header: 'Title', cell: (r) => r.title },
            { key: 'pr', header: 'PR', cell: (r) => r.prNumber },
            { key: 'due', header: 'Due', cell: (r) => formatDate(r.dueDate) },
            { key: 'q', header: 'Quotations', align: 'right', cell: (r) => `${r.quotationCount} / ${r.supplierIds.length}` },
            { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
    </Page>
  );
}

interface RfqDetail {
  id: string;
  number: string;
  title: string;
  status: string;
  dueDate: string;
  selectionJustification: string | null;
  selectedQuotationId: string | null;
  lowestQuotationId: string | null;
  pr: { id: string; number: string; lines: Array<{ id: string; materialName: string; materialCode: string; qty: string; unit: string; estimatedRate: string }> };
  suppliers: Array<{ id: string; name: string; quoted: boolean }>;
  quotations: Array<{ id: string; supplierId: string; supplierName: string; quoteRef: string | null; total: string; subtotal: string; taxAmount: string; deliveryDays: number | null; paymentTerms: string | null; validityDays: number | null; technicalScore: string | null; technicallyAccepted: boolean; isLowest: boolean; remarks: string | null; lines: Array<{ prLineId: string; rate: string; amount: string }> }>;
}

export function RfqDetailPage() {
  const { id = '' } = useParams();
  const projectId = useProjectId();
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['p', 'rfq', id], queryFn: () => api.get<RfqDetail>(`/projects/${projectId}/procurement/rfqs/${id}`) });
  const [quote, setQuote] = useState<{ supplierId: string; quoteRef: string; quotedAt: string; deliveryDays: string; paymentTerms: string; validityDays: string; taxRate: string; technicalScore: string; technicallyAccepted: boolean; remarks: string; rates: Record<string, string> } | null>(null);
  const [award, setAward] = useState<{ quotationId: string; justification: string } | null>(null);
  const saveQuote = useMutation({
    mutationFn: () =>
      api.post(`/projects/${projectId}/procurement/rfqs/${id}/quotations`, {
        supplierId: quote!.supplierId,
        quoteRef: quote!.quoteRef || undefined,
        quotedAt: quote!.quotedAt,
        deliveryDays: quote!.deliveryDays || undefined,
        paymentTerms: quote!.paymentTerms || undefined,
        validityDays: quote!.validityDays || undefined,
        taxRate: (Number(quote!.taxRate || 0) / 100).toFixed(6),
        technicalScore: quote!.technicalScore || undefined,
        technicallyAccepted: quote!.technicallyAccepted,
        remarks: quote!.remarks || undefined,
        lines: Object.entries(quote!.rates).map(([prLineId, rate]) => ({ prLineId, rate })),
      }),
    onSuccess: () => { toast.success('Quotation recorded'); setQuote(null); void qc.invalidateQueries({ queryKey: ['p', 'rfq', id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const awardM = useMutation({ mutationFn: () => api.post<Rec>(`/projects/${projectId}/procurement/rfqs/${id}/award`, award), onSuccess: (po) => { toast.success(`Awarded — draft PO ${String(po.number)} created`); navigate(`/procurement/po/${po.id}`); }, onError: (e: Error) => toast.error(e.message) });
  if (q.isLoading) return <Page><LoadingBlock rows={6} /></Page>;
  if (q.error || !q.data) return <Page><ErrorState error={q.error} /></Page>;
  const r = q.data;
  const editable = ['OPEN', 'EVALUATION'].includes(r.status) && can('procurement.manage');
  return (
    <Page>
      <PageHeader breadcrumbs={[{ label: 'RFQs', to: '/procurement/rfq' }, { label: r.number }]} title={<span className="flex items-center gap-3">{r.number} <StatusBadge status={r.status} /></span>} subtitle={`${r.title} · PR ${r.pr.number} · quotations due ${formatDate(r.dueDate)}`} actions={editable && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setQuote({ supplierId: r.suppliers.find((s) => !s.quoted)?.id ?? r.suppliers[0].id, quoteRef: '', quotedAt: todayIso(), deliveryDays: '', paymentTerms: '', validityDays: '30', taxRate: '18', technicalScore: '', technicallyAccepted: true, remarks: '', rates: Object.fromEntries(r.pr.lines.map((l) => [l.id, ''])) })}>Record quotation</Button>} />
      {r.selectionJustification && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><Trophy className="mr-1 inline h-4 w-4" />Awarded: {r.selectionJustification}</p>}
      <Card title="Commercial comparison" bodyClassName="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Estimate</th>
              {r.quotations.map((qt) => (
                <th key={qt.id} className={cx('px-3 py-2 text-right', qt.isLowest && 'bg-emerald-50 text-emerald-800')}>
                  {qt.supplierName}
                  {qt.isLowest && <Badge tone="success" className="ml-1">Lowest</Badge>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.pr.lines.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="px-3 py-2">{l.materialCode} {l.materialName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(l.qty)} {l.unit}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.estimatedRate)}</td>
                {r.quotations.map((qt) => {
                  const ql = qt.lines.find((x) => x.prLineId === l.id);
                  const best = Math.min(...r.quotations.map((x) => Number(x.lines.find((y) => y.prLineId === l.id)?.rate ?? Infinity)));
                  return (
                    <td key={qt.id} className={cx('px-3 py-2 text-right tabular-nums', ql && Number(ql.rate) === best && 'font-semibold text-emerald-700')}>
                      {ql ? formatMoney(ql.rate) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
            {[
              ['Net', (qt: RfqDetail['quotations'][number]) => formatMoney(qt.subtotal)],
              ['Tax', (qt: RfqDetail['quotations'][number]) => formatMoney(qt.taxAmount)],
              ['Total', (qt: RfqDetail['quotations'][number]) => <strong>{formatMoney(qt.total)}</strong>],
              ['Delivery (days)', (qt: RfqDetail['quotations'][number]) => qt.deliveryDays ?? '—'],
              ['Payment terms', (qt: RfqDetail['quotations'][number]) => qt.paymentTerms ?? '—'],
              ['Validity (days)', (qt: RfqDetail['quotations'][number]) => qt.validityDays ?? '—'],
              ['Technical', (qt: RfqDetail['quotations'][number]) => (qt.technicallyAccepted ? <Badge tone="success">Accepted {qt.technicalScore ?? ''}</Badge> : <Badge tone="danger">Rejected</Badge>)],
            ].map(([label, fn]) => (
              <tr key={label as string} className="border-t border-line bg-slate-50/50">
                <td className="px-3 py-2 font-medium" colSpan={3}>{label as string}</td>
                {r.quotations.map((qt) => <td key={qt.id} className="px-3 py-2 text-right tabular-nums">{(fn as (q: RfqDetail['quotations'][number]) => React.ReactNode)(qt)}</td>)}
              </tr>
            ))}
            {editable && r.quotations.length > 0 && (
              <tr className="border-t border-line">
                <td colSpan={3} />
                {r.quotations.map((qt) => (
                  <td key={qt.id} className="px-3 py-2 text-right">
                    <Button size="sm" variant={qt.isLowest ? 'success' : 'outline'} disabled={!qt.technicallyAccepted} icon={<Award className="h-4 w-4" />} onClick={() => setAward({ quotationId: qt.id, justification: qt.isLowest ? 'Lowest technically acceptable quotation.' : '' })}>Award</Button>
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
        {r.quotations.length === 0 && <p className="p-4 text-sm text-muted">No quotations recorded yet.</p>}
      </Card>
      <Card className="mt-4" title="Invited suppliers">
        <ul className="flex flex-wrap gap-2">{r.suppliers.map((s) => <Badge key={s.id} tone={s.quoted ? 'success' : 'neutral'}>{s.name}{s.quoted ? ' — quoted' : ' — awaiting'}</Badge>)}</ul>
      </Card>
      <Dialog open={!!quote} onOpenChange={(o) => !o && setQuote(null)} size="lg" title="Record quotation" footer={<Button loading={saveQuote.isPending} disabled={!quote || Object.values(quote.rates).some((v) => !v)} onClick={() => saveQuote.mutate()}>Save quotation</Button>}>
        {quote && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Supplier" className="sm:col-span-2">
              <Select options={r.suppliers.map((s) => ({ value: s.id, label: s.name }))} value={quote.supplierId} onChange={(e) => setQuote({ ...quote, supplierId: e.target.value })} />
            </Field>
            <Field label="Quotation ref"><Input value={quote.quoteRef} onChange={(e) => setQuote({ ...quote, quoteRef: e.target.value })} /></Field>
            <Field label="Quotation date"><Input type="date" value={quote.quotedAt} onChange={(e) => setQuote({ ...quote, quotedAt: e.target.value })} /></Field>
            <Field label="Delivery (days)"><Input inputMode="numeric" value={quote.deliveryDays} onChange={(e) => setQuote({ ...quote, deliveryDays: e.target.value })} /></Field>
            <Field label="Validity (days)"><Input inputMode="numeric" value={quote.validityDays} onChange={(e) => setQuote({ ...quote, validityDays: e.target.value })} /></Field>
            <Field label="Payment terms"><Input value={quote.paymentTerms} onChange={(e) => setQuote({ ...quote, paymentTerms: e.target.value })} /></Field>
            <Field label="Tax rate (%)"><Input inputMode="decimal" value={quote.taxRate} onChange={(e) => setQuote({ ...quote, taxRate: e.target.value })} /></Field>
            <Field label="Technical score"><Input inputMode="decimal" value={quote.technicalScore} onChange={(e) => setQuote({ ...quote, technicalScore: e.target.value })} /></Field>
            <div className="flex items-end pb-2 sm:col-span-3"><Checkbox label="Technically acceptable" checked={quote.technicallyAccepted} onChange={(e) => setQuote({ ...quote, technicallyAccepted: e.target.checked })} /></div>
            {r.pr.lines.map((l) => (
              <Field key={l.id} label={`Rate — ${l.materialName} (${formatQty(l.qty)} ${l.unit})`} required className="sm:col-span-3">
                <Input inputMode="decimal" value={quote.rates[l.id]} onChange={(e) => setQuote({ ...quote, rates: { ...quote.rates, [l.id]: e.target.value } })} />
              </Field>
            ))}
            <Field label="Remarks" className="sm:col-span-3"><Textarea value={quote.remarks} onChange={(e) => setQuote({ ...quote, remarks: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
      <Dialog open={!!award} onOpenChange={(o) => !o && setAward(null)} title="Award RFQ" description="A draft PO is created from the selected quotation and goes through the normal PO approval." footer={<Button loading={awardM.isPending} disabled={(award?.justification.trim().length ?? 0) < 5} onClick={() => awardM.mutate()}>Award & create PO</Button>}>
        <Field label="Selection justification" required>
          <Textarea value={award?.justification ?? ''} onChange={(e) => award && setAward({ ...award, justification: e.target.value })} />
        </Field>
      </Dialog>
    </Page>
  );
}

interface OpenLine {
  id: string;
  lineNo: number;
  description: string;
  unit: string;
  qty: string;
  rate: string;
  pendingQty: string;
}

/** GRN entry: choose an open PO; lines default to the pending quantity, fully accepted. */
export function GrnNewPage() {
  const projectId = useProjectId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [poId, setPoId] = useState<string | null>(params.get('poId'));
  const lines = useQuery({ queryKey: ['p', 'po-open', poId], queryFn: () => api.get<OpenLine[]>(`/projects/${projectId}/procurement/po/${poId}/open-lines`), enabled: !!poId });
  const stores = useQuery({ queryKey: ['p', 'lookup-stores', projectId], queryFn: () => api.get<Array<{ value: string }>>(`/projects/${projectId}/lookups/stores`) });
  const initial = useMemo(() => {
    if (!lines.data) return null;
    const open = lines.data.filter((l) => Number(l.pendingQty) > 0);
    return {
      poId,
      receivedDate: todayIso(),
      storeId: stores.data?.[0]?.value ?? '',
      inspectionStatus: 'NOT_REQUIRED',
      lines: open.map((l) => ({ poLineId: l.id, receivedQty: l.pendingQty, acceptedQty: l.pendingQty, rejectedQty: '0', _labels: { poLineId: `#${l.lineNo} ${l.description} (${formatQty(l.qty)} ${l.unit})` } })),
    };
  }, [lines.data, poId, stores.data]);
  if (!can('receiving.manage')) return <Page><PermissionDenied /></Page>;
  return (
    <Page className="max-w-5xl">
      <PageHeader breadcrumbs={[{ label: 'Goods receipts', to: '/procurement/grn' }, { label: 'New' }]} title="Record goods receipt" subtitle="Accepted + rejected must equal received. Approval posts accepted quantities to stock at the PO rate." />
      <Card>
        <Field label="Purchase order" required className="mb-4 max-w-md">
          <RefSelect source="purchaseOrders" value={poId} onChange={setPoId} params={{ status: 'APPROVED,PARTIALLY_RECEIVED' }} />
        </Field>
        {poId && (!initial ? <LoadingBlock rows={3} /> : initial.lines.length === 0 ? (
          <p className="text-sm text-muted">Everything on this PO has been received.</p>
        ) : (
          <ResourceForm
            key={poId}
            def={RESOURCES.grns}
            mode="create"
            initial={initial}
            lockedFields={['poId']}
            hideFields={['poId']}
            refParams={(field) => (field === 'poLineId' ? { poId } : undefined)}
            onCancel={() => navigate('/procurement/grn')}
            onSubmit={async (body) => {
              const rec = await api.post<Rec>(`/projects/${projectId}/r/grns`, { ...body, poId });
              toast.success(`GRN ${String(rec.number)} saved`);
              void qc.invalidateQueries({ queryKey: ['p'] });
              navigate(`/procurement/grn/${rec.id}`, { replace: true });
            }}
          />
        ))}
      </Card>
    </Page>
  );
}
