import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { api, type Paged } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate, formatMoney, formatQty, humanize, todayIso } from '../../lib/format';
import { Badge, Button, Card, Dialog, Field, Input, PermissionDenied, Select, TabPanel, Tabs, Textarea, cx } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { RefSelect } from '../../components/forms/RefSelect';
import { PageHeader } from '../../components/layout/AppShell';
import { ImportButton } from '../admin/ImportDialog';

interface Balance {
  storeId: string;
  store: string;
  materialId: string;
  materialCode: string;
  material: string;
  category: string;
  unit: string;
  qty: string;
  value: string;
  avgCost: string | null;
  belowReorder: boolean;
}
interface LedgerRow {
  id: string;
  date: string;
  type: string;
  qty: string;
  unitCost: string;
  value: string;
  refNumber: string | null;
  reason: string | null;
  batchNo: string | null;
  store: string;
  material: { code: string; name: string; unit: string };
}
interface Recon {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  received: string;
  issued: string;
  wastage: string;
  transferredOut: string;
  adjustments: string;
  balance: string;
  theoreticalConsumption: string | null;
  consumptionVariance: string | null;
  consumptionVariancePct: string | null;
  note: string | null;
}

export function InventoryPage() {
  const projectId = useProjectId();
  const { can, project } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('balances');
  const [store, setStore] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [material, setMaterial] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [opening, setOpening] = useState(false);
  const [form, setForm] = useState<{ storeId: string | null; date: string; reason: string; lines: Array<{ materialId: string | null; qty: string; unitCost: string }> }>({ storeId: null, date: todayIso(), reason: 'Opening balance at system go-live', lines: [{ materialId: null, qty: '', unitCost: '' }] });
  const balances = useQuery({ queryKey: ['p', 'stock-bal', projectId, store], queryFn: () => api.get<Balance[]>(`/projects/${projectId}/stock/balances`, { storeId: store ?? undefined }) });
  const ledger = useQuery({ queryKey: ['p', 'stock-ledger', projectId, store, type, material, page], queryFn: () => api.get<Paged<LedgerRow>>(`/projects/${projectId}/stock/ledger`, { storeId: store ?? undefined, type, materialId: material ?? undefined, page }), enabled: tab === 'ledger' });
  const recon = useQuery({ queryKey: ['p', 'stock-recon', projectId], queryFn: () => api.get<Recon[]>(`/projects/${projectId}/stock/reconciliation`), enabled: tab === 'recon' });
  const saveOpening = useMutation({ mutationFn: () => api.post(`/projects/${projectId}/stock/opening`, form), onSuccess: () => { toast.success('Opening stock posted'); setOpening(false); void qc.invalidateQueries({ queryKey: ['p'] }); }, onError: (e: Error) => toast.error(e.message) });
  if (!can('stock.view')) return <PermissionDenied />;
  const cur = project?.currency;
  const totalValue = (balances.data ?? []).reduce((a, b) => a + Number(b.value), 0);
  return (
    <>
      <PageHeader
        title="Inventory & stock reconciliation"
        subtitle="Every movement is a transaction in the stock ledger; balances are never edited directly. Valuation: weighted average cost per store."
        actions={can('stock.manage') && (<><ImportButton kind="OPENING_STOCK" /><Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setOpening(true)}>Opening stock</Button></>)}
      />
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="w-56"><RefSelect source="stores" value={store} onChange={setStore} placeholder="All stores" /></div>
          {tab === 'balances' && <span className="ml-auto text-sm">Stock value <strong className="tabular-nums">{formatMoney(String(totalValue), cur)}</strong></span>}
        </div>
        <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'balances', label: 'Balances' }, { value: 'ledger', label: 'Stock ledger' }, { value: 'recon', label: 'Reconciliation' }]} className="px-4 pt-1">
          <TabPanel value="balances" className="py-3">
            <DataTable
              rows={balances.data}
              loading={balances.isLoading}
              error={balances.error}
              rowKey={(r) => `${r.storeId}:${r.materialId}`}
              dense
              empty={{ title: 'No stock yet', description: 'Approved GRNs and opening stock create balances.' }}
              columns={[
                { key: 'm', header: 'Material', cell: (r) => <span><span className="block font-medium">{r.materialCode}</span><span className="text-xs text-muted">{r.material}</span></span> },
                { key: 'store', header: 'Store', cell: (r) => r.store },
                { key: 'cat', header: 'Category', cell: (r) => r.category, hideOnMobile: true },
                { key: 'qty', header: 'Balance', align: 'right', cell: (r) => <span className={cx(r.belowReorder && 'font-semibold text-amber-700')}>{formatQty(r.qty, 3)} {r.unit} {r.belowReorder && <AlertTriangle className="inline h-3.5 w-3.5" aria-label="Below reorder level" />}</span> },
                { key: 'avg', header: 'Avg cost', align: 'right', cell: (r) => (r.avgCost ? formatMoney(r.avgCost, cur) : '—'), hideOnMobile: true },
                { key: 'v', header: 'Value', align: 'right', cell: (r) => formatMoney(r.value, cur) },
              ]}
            />
          </TabPanel>
          <TabPanel value="ledger" className="py-3">
            <div className="mb-2 flex flex-wrap gap-2">
              <div className="w-60"><RefSelect source="materials" value={material} onChange={setMaterial} placeholder="All materials" /></div>
              <Select className="w-52" aria-label="Movement type" options={['OPENING', 'RECEIPT', 'ISSUE', 'RETURN_TO_STORE', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN_TO_SUPPLIER', 'WASTAGE', 'DAMAGE', 'ADJUSTMENT', 'REVERSAL']} placeholder="All movements" value={type} onChange={(e) => setType(e.target.value)} />
            </div>
            <DataTable
              rows={ledger.data?.items}
              loading={ledger.isLoading}
              rowKey={(r) => r.id}
              dense
              columns={[
                { key: 'd', header: 'Date', cell: (r) => formatDate(r.date) },
                { key: 't', header: 'Movement', cell: (r) => <Badge tone={Number(r.qty) >= 0 ? 'success' : 'neutral'}>{humanize(r.type)}</Badge> },
                { key: 'm', header: 'Material', cell: (r) => `${r.material.code} ${r.material.name}` },
                { key: 's', header: 'Store', cell: (r) => r.store, hideOnMobile: true },
                { key: 'q', header: 'Qty', align: 'right', cell: (r) => `${formatQty(r.qty, 3)} ${r.material.unit}` },
                { key: 'c', header: 'Unit cost', align: 'right', cell: (r) => formatMoney(r.unitCost, cur), hideOnMobile: true },
                { key: 'v', header: 'Value', align: 'right', cell: (r) => formatMoney(r.value, cur) },
                { key: 'ref', header: 'Reference', cell: (r) => <span className="text-xs">{r.refNumber}{r.batchNo ? ` · lot ${r.batchNo}` : ''}<br /><span className="text-muted">{r.reason}</span></span>, hideOnMobile: true },
              ]}
              pagination={ledger.data ? { page, pageSize: ledger.data.pageSize, total: ledger.data.total, onPage: setPage } : undefined}
            />
          </TabPanel>
          <TabPanel value="recon" className="py-3">
            <p className="mb-2 text-xs text-muted">Theoretical consumption = executed BOQ quantity × material coefficient from rate analysis. Positive variance = more issued than theory (possible wastage or theft).</p>
            <DataTable
              rows={recon.data}
              loading={recon.isLoading}
              rowKey={(r) => r.materialId}
              dense
              columns={[
                { key: 'm', header: 'Material', cell: (r) => <span><span className="block font-medium">{r.code}</span><span className="text-xs text-muted">{r.name}</span></span> },
                { key: 'rec', header: 'Received', align: 'right', cell: (r) => formatQty(r.received, 3) },
                { key: 'iss', header: 'Issued (net)', align: 'right', cell: (r) => formatQty(r.issued, 3) },
                { key: 'w', header: 'Wastage/damage', align: 'right', cell: (r) => formatQty(r.wastage, 3) },
                { key: 'adj', header: 'Adjustments', align: 'right', cell: (r) => formatQty(r.adjustments, 3), hideOnMobile: true },
                { key: 'bal', header: 'Balance', align: 'right', cell: (r) => `${formatQty(r.balance, 3)} ${r.unit}` },
                { key: 'th', header: 'Theoretical', align: 'right', cell: (r) => (r.theoreticalConsumption ? formatQty(r.theoreticalConsumption, 3) : <span title={r.note ?? ''} className="text-slate-400">n/a</span>) },
                { key: 'var', header: 'Variance', align: 'right', cell: (r) => (r.consumptionVariance ? <span className={cx(Number(r.consumptionVariance) > 0 && 'font-semibold text-red-600')}>{formatQty(r.consumptionVariance, 3)} ({(Number(r.consumptionVariancePct) * 100).toFixed(1)}%)</span> : '—') },
              ]}
            />
          </TabPanel>
        </Tabs>
      </Card>
      <Dialog open={opening} onOpenChange={setOpening} size="lg" title="Post opening stock" description="One-time balances when the store starts using the system. Use adjustments for later corrections." footer={<Button loading={saveOpening.isPending} disabled={!form.storeId || form.lines.some((l) => !l.materialId || !l.qty || !l.unitCost)} onClick={() => saveOpening.mutate()}>Post opening stock</Button>}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Store" required><RefSelect source="stores" value={form.storeId} onChange={(v) => setForm({ ...form, storeId: v })} /></Field>
            <Field label="Date" required><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          </div>
          {form.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-line p-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <RefSelect source="materials" value={l.materialId} onChange={(v) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, materialId: v } : x)) })} />
              <Input placeholder="Qty" inputMode="decimal" value={l.qty} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
              <Input placeholder="Unit cost" inputMode="decimal" value={l.unitCost} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)) })} />
              <Button variant="ghost" aria-label="Remove line" icon={<Trash2 className="h-4 w-4 text-red-600" />} onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ ...form, lines: [...form.lines, { materialId: null, qty: '', unitCost: '' }] })}>Add line</Button>
          <Field label="Reason" required><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  );
}
