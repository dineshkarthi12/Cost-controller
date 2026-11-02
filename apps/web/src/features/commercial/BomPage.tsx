import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Boxes, Download, FileSpreadsheet, HardHat, IndianRupee, Layers, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatMoney, formatQty } from '../../lib/format';
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Input, KpiCard, LoadingBlock, PermissionDenied, Select, TabPanel, Tabs } from '../../components/ui';
import { RefSelect } from '../../components/forms/RefSelect';
import { PageHeader } from '../../components/layout/AppShell';

interface BomLine {
  id: string;
  lineNo: number;
  kind: string;
  description: string;
  qty: string;
  wastagePct: string;
  totalQty: string;
  unit: string;
  rate: string | null;
  amount: string | null;
  remarks: string | null;
}
interface BomItem {
  id: string;
  sheet: string | null;
  section: string | null;
  refCode: string;
  title: string;
  boqRef: string | null;
  boqNote: string | null;
  takingQty: string | null;
  takingUnit: string | null;
  boqItem: { id: string; itemCode: string; description: string } | null;
  lines: BomLine[];
}
interface SummaryRow {
  kind: string;
  description: string;
  unit: string;
  totalQty: string;
  rate: string | null;
  amount: string | null;
  lines: number;
  usedIn: string[];
}
interface BomData {
  items: BomItem[];
  summary: SummaryRow[];
  totals: { items: number; lines: number; priced: number; amount: string; byKind: Record<string, { lines: number; amount: string }> };
  canManage: boolean;
}
interface Preview {
  id: string;
  summary: { sheets: string[]; items: number; lines: number; material: number; labour: number; other: number; priced: number; boqRefs: number; boqMatched: number; unmatchedRefs: string[]; existingItems: number; warnings: string[] };
}

const KIND_LABEL: Record<string, string> = { MATERIAL: 'Material', LABOUR: 'Man power', EQUIPMENT: 'Equipment', OTHER: 'Other' };
const KIND_TONE = { MATERIAL: 'info', LABOUR: 'warning', EQUIPMENT: 'primary', OTHER: 'neutral' } as const;
const qtyText = (v: string | number) => formatQty(String(v), 2);

export function BomPage() {
  const projectId = useProjectId();
  const { can } = useAuth();
  const [tab, setTab] = useState('items');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const data = useQuery({ queryKey: ['p', 'bom', projectId], queryFn: () => api.get<BomData>(`/projects/${projectId}/bom`), enabled: !!projectId });
  if (!can('boq.view')) return <PermissionDenied />;
  const d = data.data;
  const needle = q.trim().toLowerCase();
  const items = (d?.items ?? []).filter((i) => !needle || `${i.refCode} ${i.title} ${i.section ?? ''} ${i.boqItem?.itemCode ?? ''} ${i.lines.map((l) => l.description).join(' ')}`.toLowerCase().includes(needle));
  const summary = (d?.summary ?? []).filter((s) => (!kind || s.kind === kind) && (!needle || s.description.toLowerCase().includes(needle)));

  return (
    <div>
      <PageHeader
        title="Bill of materials (BOM)"
        subtitle="Materials, labour and equipment needed for each BOQ item, with a combined list for procurement. Import the estimator's BOM workbook; procurement can fill in rates."
        actions={
          <div className="flex flex-wrap gap-2">
            {d?.canManage && <ImportBom projectId={projectId} existing={d.totals.items} />}
            {!!d?.totals.items && (
              <a className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-sm font-medium text-ink hover:bg-slate-50" href={api.url(`/projects/${projectId}/bom/export`)} download>
                <Download className="h-4 w-4" /> Excel
              </a>
            )}
          </div>
        }
      />
      {data.isLoading ? (
        <LoadingBlock rows={6} />
      ) : !d?.totals.items ? (
        <Card>
          <EmptyState icon={<Boxes className="h-6 w-6" />} title="No BOM for this project yet" description={d?.canManage ? 'Use “Import BOM” with the estimator’s workbook (one sheet per package, with Description, Qty, % wstg, T. Qty, Unit columns).' : 'The estimator has not imported a BOM yet.'} />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="BOM items" value={d.totals.items} icon={<Layers className="h-5 w-5" />} sub={`${d.items.filter((i) => i.boqItem).length} linked to BOQ items`} />
            <KpiCard label="Material lines" value={d.totals.byKind.MATERIAL?.lines ?? 0} icon={<Boxes className="h-5 w-5" />} sub={`${d.summary.filter((s) => s.kind === 'MATERIAL').length} distinct materials`} />
            <KpiCard label="Man power lines" value={d.totals.byKind.LABOUR?.lines ?? 0} icon={<HardHat className="h-5 w-5" />} />
            <KpiCard label="Priced amount" value={formatMoney(d.totals.amount)} icon={<IndianRupee className="h-5 w-5" />} sub={`${d.totals.priced} of ${d.totals.lines} lines have a rate`} tone={d.totals.priced < d.totals.lines ? 'warning' : 'success'} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted" />
              <Input className="pl-9" placeholder="Search items or materials…" aria-label="Search BOM" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {tab === 'summary' && <Select className="w-44" aria-label="Type" options={[{ value: '', label: 'All types' }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))]} value={kind} onChange={(e) => setKind(e.target.value)} />}
          </div>
          <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'items', label: `By BOQ item (${items.length})` }, { value: 'summary', label: 'Material & labour summary' }]}>
            <TabPanel value="items" className="space-y-3 pt-3">
              {items.map((it) => <BomItemCard key={it.id} item={it} projectId={projectId} manage={d.canManage} />)}
              {!items.length && <p className="text-sm text-muted">Nothing matches the search.</p>}
            </TabPanel>
            <TabPanel value="summary" className="pt-3">
              <Card bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-muted uppercase">
                      <tr>{['Type', 'Description', 'Total qty', 'Unit', 'Rate', 'Amount', 'Used in'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {summary.map((s) => (
                        <tr key={`${s.kind}|${s.description}|${s.unit}`} className="align-top">
                          <td className="px-3 py-2"><Badge tone={KIND_TONE[s.kind as keyof typeof KIND_TONE] ?? 'neutral'}>{KIND_LABEL[s.kind] ?? s.kind}</Badge></td>
                          <td className="px-3 py-2">{s.description}</td>
                          <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{qtyText(s.totalQty)}</td>
                          <td className="px-3 py-2">{s.unit}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{s.rate ? formatMoney(s.rate) : '—'}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{s.amount ? formatMoney(s.amount) : '—'}</td>
                          <td className="px-3 py-2 text-xs text-muted">{s.usedIn.slice(0, 6).join(', ')}{s.usedIn.length > 6 ? ` +${s.usedIn.length - 6}` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <p className="mt-2 text-xs text-muted">Lines with the same description and unit are added together. Total qty includes wastage.</p>
            </TabPanel>
          </Tabs>
        </div>
      )}
    </div>
  );
}

function BomItemCard({ item, projectId, manage }: { item: BomItem; projectId: string; manage: boolean }) {
  const qc = useQueryClient();
  const link = useMutation({ mutationFn: (boqItemId: string | null) => api.patch(`/projects/${projectId}/bom/items/${item.id}`, { boqItemId }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['p', 'bom'] }), onError: (e: Error) => toast.error(e.message) });
  const amount = item.lines.reduce((a, l) => a + Number(l.amount ?? 0), 0);
  return (
    <details className="card overflow-hidden" open={false}>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
        <span className="min-w-0">
          <span className="font-semibold">{item.refCode}</span> {item.title}
          <span className="block text-xs text-muted">{[item.section, item.sheet].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-sm">
          {item.boqItem ? <Badge tone="success">BOQ {item.boqItem.itemCode}</Badge> : item.boqRef ? <Badge tone="warning">BOQ {item.boqRef} not found</Badge> : <Badge>Not linked</Badge>}
          {item.takingQty && <span className="text-muted">Taking {qtyText(item.takingQty)} {item.takingUnit}</span>}
          <span className="text-muted">{item.lines.length} lines</span>
          {amount > 0 && <span className="font-medium">{formatMoney(String(amount))}</span>}
        </span>
      </summary>
      <div className="border-t border-line px-4 py-3">
        {item.boqNote && <p className="mb-2 text-xs text-muted">{item.boqNote}</p>}
        {manage && (
          <div className="mb-3 max-w-md">
            <RefSelect source="boqItems" label="Linked BOQ item" placeholder="Link to a BOQ item…" value={item.boqItem?.id ?? null} initialLabel={item.boqItem ? `${item.boqItem.itemCode} — ${item.boqItem.description.slice(0, 60)}` : null} onChange={(v) => link.mutate(v)} />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted uppercase">
              <tr>{['#', 'Type', 'Description', 'Qty', 'Wstg', 'T. qty', 'Unit', 'Rate', 'Amount', 'Remarks'].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {item.lines.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="px-2 py-1.5">{l.lineNo}</td>
                  <td className="px-2 py-1.5"><Badge tone={KIND_TONE[l.kind as keyof typeof KIND_TONE] ?? 'neutral'}>{KIND_LABEL[l.kind] ?? l.kind}</Badge></td>
                  <td className="min-w-56 px-2 py-1.5">{l.description}</td>
                  <td className="px-2 py-1.5 text-right">{qtyText(l.qty)}</td>
                  <td className="px-2 py-1.5 text-right">{Number(l.wastagePct) ? `${(Number(l.wastagePct) * 100).toFixed(0)}%` : '—'}</td>
                  <td className="px-2 py-1.5 text-right font-medium">{qtyText(l.totalQty)}</td>
                  <td className="px-2 py-1.5">{l.unit}</td>
                  <td className="px-2 py-1.5">{manage ? <RateInput line={l} projectId={projectId} /> : l.rate ? formatMoney(l.rate) : '—'}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">{l.amount ? formatMoney(l.amount) : '—'}</td>
                  <td className="max-w-72 px-2 py-1.5 text-xs text-muted">{l.remarks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

function RateInput({ line, projectId }: { line: BomLine; projectId: string }) {
  const qc = useQueryClient();
  const [v, setV] = useState(line.rate ? String(Number(line.rate)) : '');
  const save = useMutation({
    mutationFn: () => api.patch(`/projects/${projectId}/bom/lines/${line.id}`, { rate: v.trim() === '' ? null : v.trim() }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['p', 'bom'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Input
      className="h-8 w-24 text-right"
      inputMode="decimal"
      aria-label={`Rate for ${line.description}`}
      placeholder="Rate"
      value={v}
      onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))}
      onBlur={() => (v.trim() === '' ? line.rate !== null : Number(v) !== Number(line.rate)) && save.mutate()}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ImportBom({ projectId, existing }: { projectId: string; existing: number }) {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [replace, setReplace] = useState(false);
  const read = useMutation({
    mutationFn: (file: File) => {
      const f = new FormData();
      f.append('file', file);
      return api.upload<Preview>(`/projects/${projectId}/bom/import/preview`, f);
    },
    onSuccess: (p) => {
      setReplace(false);
      setPreview(p);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const commit = useMutation({
    mutationFn: () => api.post<{ items: number; lines: number; replaced: number }>(`/projects/${projectId}/bom/import/${preview!.id}/commit`, { replace }),
    onSuccess: (r) => {
      toast.success(`BOM imported: ${r.items} items, ${r.lines} lines${r.replaced ? ` (replaced ${r.replaced} items)` : ''}`);
      setPreview(null);
      void qc.invalidateQueries({ queryKey: ['p', 'bom'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const s = preview?.summary;
  const needsReplace = !!s && s.existingItems > 0;
  const stats = useMemo(() => (s ? [[`${s.items}`, 'BOM items'], [`${s.lines}`, 'lines'], [`${s.material}`, 'material'], [`${s.labour}`, 'man power'], [`${s.boqMatched}/${s.boqRefs}`, 'BOQ references found']] : []), [s]);
  return (
    <>
      <input ref={input} type="file" accept=".xlsx" className="hidden" aria-label="BOM Excel file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read.mutate(f); }} />
      <Button variant="outline" icon={<FileSpreadsheet className="h-4 w-4" />} loading={read.isPending} onClick={() => input.current?.click()}>
        Import BOM
      </Button>
      {preview && s && (
        <Dialog
          open
          onOpenChange={(o) => !o && setPreview(null)}
          size="lg"
          title="Import BOM"
          description={`Sheets read: ${s.sheets.join(', ')}`}
          footer={
            <Button loading={commit.isPending} disabled={needsReplace && !replace} onClick={() => commit.mutate()}>
              Import {s.items} items
            </Button>
          }
        >
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {stats.map(([n, l]) => (
                <div key={l} className="rounded-lg border border-line p-2 text-center">
                  <p className="text-lg font-semibold">{n}</p>
                  <p className="text-xs text-muted">{l}</p>
                </div>
              ))}
            </div>
            {s.unmatchedRefs.length > 0 && <p className="text-amber-800">BOQ items not found in this project: {s.unmatchedRefs.join(', ')}. Those BOM items are imported without a link; you can link them later.</p>}
            {s.priced === 0 && <p className="text-muted">No rates in the file yet. Procurement can enter them on each line after import.</p>}
            {!!s.warnings.length && (
              <ul className="list-disc pl-5 text-xs text-amber-800">
                {s.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            {needsReplace && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <Checkbox label={`Replace the current BOM (${s.existingItems} items, including rates entered for them)`} checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              </div>
            )}
            {existing === 0 && <p className="text-xs text-muted">Nothing is saved until you press Import.</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
