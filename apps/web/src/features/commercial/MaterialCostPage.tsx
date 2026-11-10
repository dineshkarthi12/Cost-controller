import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, Boxes, IndianRupee, PackageCheck, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate, formatMoney, formatQty } from '../../lib/format';
import { Card, EmptyState, ErrorState, Input, KpiCard, LoadingBlock, PermissionDenied, Select, cx } from '../../components/ui';
import { PageHeader } from '../../components/layout/AppShell';

interface Row {
  materialId: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  requiredQty: string;
  bomAmount: string | null;
  bomRate: string | null;
  bomFullyPriced: boolean;
  orderedQty: string;
  orderedValue: string;
  receivedQty: string;
  issuedQty: string;
  wastedQty: string;
  stockQty: string;
  stockValue: string;
  toOrderQty: string;
  beyondBomQty: string;
  projectPoRate: string | null;
  standardRate: string | null;
  lastPurchaseRate: string | null;
  avgPurchaseRate: string | null;
  lastPurchaseDate: string | null;
  lastPurchaseRef: string | null;
  projectedCost: string | null;
  variance: string | null;
  unitIssues: number;
  usedIn: string[];
}
interface Data {
  rows: Row[];
  totals: { materials: number; bomAmount: string; orderedValue: string; stockValue: string; projectedCost: string; variance: string; withoutProjection: number };
  unlinkedBom: { lines: number; amount: string };
}

const q = (v: string | null) => (v === null ? '—' : Number(v) === 0 ? '—' : formatQty(v, 2));
const m = (v: string | null) => (v === null ? '—' : formatMoney(v));

/**
 * One row per material for the current project: BOM need, orders, receipts, issues, stock, rates and
 * projected cost, all in the material's own unit. Rates follow approved POs; BOM lines are linked on
 * the BOM page.
 */
export function MaterialCostPage() {
  const projectId = useProjectId();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [view, setView] = useState<'all' | 'toOrder' | 'over'>('all');
  const data = useQuery({ queryKey: ['p', 'material-cost', projectId], queryFn: () => api.get<Data>(`/projects/${projectId}/bom/material-cost`), enabled: !!projectId });
  const rows = data.data?.rows ?? [];
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))], [rows]);
  const shown = rows.filter((r) => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const text = `${r.code} ${r.name} ${r.category}`.toLowerCase();
    if (!words.every((w) => text.includes(w))) return false;
    if (category && r.category !== category) return false;
    if (view === 'toOrder') return Number(r.toOrderQty) > 0;
    if (view === 'over') return r.variance !== null && Number(r.variance) < 0;
    return true;
  });
  if (!['boq.view', 'procurement.view', 'stock.view'].some((p) => can(p))) return <PermissionDenied />;
  const t = data.data?.totals;
  const variance = Number(t?.variance ?? 0);

  return (
    <div>
      <PageHeader
        title="Material cost"
        subtitle="Per material: what the BOM needs, what is ordered, received, issued and in stock, and the projected cost at current rates. Rates update when purchase orders are approved."
      />
      {data.isLoading ? (
        <LoadingBlock rows={6} />
      ) : data.error ? (
        <ErrorState error={data.error} onRetry={() => void data.refetch()} />
      ) : !rows.length ? (
        <Card>
          <EmptyState
            icon={<Boxes className="h-6 w-6" />}
            title="No material data for this project yet"
            description="Import the BOM and link its material lines to the material list, or approve a purchase order with materials. Each material then appears here."
            action={<Link className="text-sm font-medium text-brand-600 hover:underline" to="/boq/bom">Go to the BOM</Link>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="BOM material amount" value={formatMoney(t!.bomAmount)} icon={<IndianRupee className="h-5 w-5" />} sub={`${t!.materials} materials`} />
            <KpiCard label="Ordered (approved POs)" value={formatMoney(t!.orderedValue)} icon={<PackageCheck className="h-5 w-5" />} sub="All orders of the project, before tax" />
            <KpiCard label="Projected cost of BOM need" value={formatMoney(t!.projectedCost)} icon={<Boxes className="h-5 w-5" />} sub="For the BOM quantity: ordered part at this project's PO rate, the rest at current rates" />
            <KpiCard
              label={variance >= 0 ? 'Saving against BOM' : 'Over the BOM'}
              value={formatMoney(String(Math.abs(variance)))}
              icon={variance >= 0 ? <TrendingDown className="h-5 w-5" /> : <TrendingUp className="h-5 w-5" />}
              tone={variance >= 0 ? 'success' : 'danger'}
              sub="Materials with a fully priced BOM"
            />
          </div>
          {data.data!.unlinkedBom.lines > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {data.data!.unlinkedBom.lines} BOM material line{data.data!.unlinkedBom.lines === 1 ? ' is' : 's are'} not linked to the material list
                {Number(data.data!.unlinkedBom.amount) ? ` (${formatMoney(data.data!.unlinkedBom.amount)})` : ''} and not counted here.{' '}
                <Link className="font-medium underline" to="/boq/bom">Link them on the BOM page</Link>.
              </span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted" />
              <Input className="pl-9" placeholder="Search materials…" aria-label="Search materials" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select className="w-48" aria-label="Category" options={categories.map((c) => ({ value: c, label: c }))} placeholder="All categories" value={category} onChange={(e) => setCategory(e.target.value)} />
            <Select
              className="w-48"
              aria-label="Show"
              options={[
                { value: 'all', label: 'All materials' },
                { value: 'toOrder', label: 'Still to order' },
                { value: 'over', label: 'Over the BOM' },
              ]}
              value={view}
              onChange={(e) => setView(e.target.value as typeof view)}
            />
          </div>

          {/* Phone: one card per material */}
          <ul className="space-y-2 sm:hidden">
            {shown.map((r) => (
              <li key={r.materialId} className="card p-3 text-sm">
                <p className="font-medium text-ink">{r.name}</p>
                <p className="text-xs text-muted">{r.code} · {r.unit} · {r.category}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted">BOM need</dt><dd className="text-right">{q(r.requiredQty)}</dd>
                  <dt className="text-muted">Ordered</dt><dd className="text-right">{q(r.orderedQty)}</dd>
                  <dt className="text-muted">Received</dt><dd className="text-right">{q(r.receivedQty)}</dd>
                  <dt className="text-muted">In stock</dt><dd className="text-right">{q(r.stockQty)}</dd>
                  <dt className="text-muted">To order</dt><dd className="text-right font-medium">{q(r.toOrderQty)}</dd>
                  {Number(r.beyondBomQty) > 0 && (<><dt className="text-amber-700">Ordered beyond BOM</dt><dd className="text-right text-amber-700">{formatQty(r.beyondBomQty, 2)}</dd></>)}
                  <dt className="text-muted">Rate (last / avg)</dt><dd className="text-right">{m(r.lastPurchaseRate)} / {m(r.avgPurchaseRate)}</dd>
                  <dt className="text-muted">BOM amount</dt><dd className="text-right">{m(r.bomAmount)}</dd>
                  <dt className="text-muted">Projected</dt><dd className="text-right">{m(r.projectedCost)}</dd>
                  <dt className="text-muted">Variance</dt><dd className={cx('text-right font-medium', r.variance && Number(r.variance) < 0 && 'text-red-600', r.variance && Number(r.variance) > 0 && 'text-emerald-700')}>{m(r.variance)}</dd>
                </dl>
              </li>
            ))}
          </ul>

          {/* Desktop: table, scrolling sideways inside the card when narrow */}
          <Card bodyClassName="p-0" className="hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-muted uppercase">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Material</th>
                    {['BOM need', 'Ordered', 'Received', 'Issued', 'In stock', 'To order', 'BOM rate', 'Std rate', 'Last PO rate', 'Avg PO rate', 'BOM amount', 'Ordered value', 'Projected', 'Variance'].map((h) => (
                      <th key={h} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((r) => (
                    <tr key={r.materialId} className="align-top">
                      <td className="min-w-56 px-3 py-2">
                        <span className="block text-ink">{r.name}</span>
                        <span className="block text-xs text-muted">{r.code} · {r.unit} · {r.category}</span>
                        {r.unitIssues > 0 && <span className="block text-xs text-amber-700">{r.unitIssues} line{r.unitIssues === 1 ? '' : 's'} in a unit that cannot be converted to {r.unit}</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{q(r.requiredQty)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{q(r.orderedQty)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{q(r.receivedQty)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{q(r.issuedQty)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{q(r.stockQty)}</td>
                      <td className={cx('px-3 py-2 text-right whitespace-nowrap', Number(r.toOrderQty) > 0 && 'font-medium text-ink')}>
                        {q(r.toOrderQty)}
                        {Number(r.beyondBomQty) > 0 && <span className="block text-[11px] text-amber-700">{formatQty(r.beyondBomQty, 2)} beyond BOM</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{m(r.bomRate)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{m(r.standardRate)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap" title={r.lastPurchaseRef ? `${r.lastPurchaseRef}, ${formatDate(r.lastPurchaseDate)}` : undefined}>{m(r.lastPurchaseRate)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{m(r.avgPurchaseRate)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{m(r.bomAmount)}{r.bomAmount && !r.bomFullyPriced && <span className="block text-[11px] text-amber-700">some lines unpriced</span>}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{Number(r.orderedValue) ? m(r.orderedValue) : '—'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{m(r.projectedCost)}</td>
                      <td className={cx('px-3 py-2 text-right font-medium whitespace-nowrap', r.variance && Number(r.variance) < 0 && 'text-red-600', r.variance && Number(r.variance) > 0 && 'text-emerald-700')}>{m(r.variance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {!shown.length && <p className="text-sm text-muted">Nothing matches the filters.</p>}
          <p className="text-xs text-muted">
            Quantities are in each material's unit (BOM lines in Kg are shown in MT when the material is kept in MT). Projected cost is for the BOM quantity only: the part already ordered at this project's average PO rate, the rest at the standard rate (else last purchase rate). Orders beyond the BOM quantity are shown under “To order” and not counted. Variance = BOM amount − projected: green is a saving, red is over the BOM. Values are before tax.
          </p>
        </div>
      )}
    </div>
  );
}
