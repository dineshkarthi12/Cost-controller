import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Lock, Pencil, Save } from 'lucide-react';
import type { CostPosition } from '@toprock/shared';
import { api, type Paged } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate, formatMoney, formatMoneyCompact, formatPct, humanize } from '../../lib/format';
import { Badge, Button, Card, ConfirmDialog, Dialog, ErrorState, Field, Input, KpiCard, LoadingBlock, PermissionDenied, Select, StatusBadge, Textarea, cx } from '../../components/ui';
import { DataTable } from '../../components/data/DataTable';
import { RefSelect } from '../../components/forms/RefSelect';
import { ChartCard, ChartTooltip, GRID, SERIES, axisProps, moneyTick } from '../../components/data/charts';
import { PageHeader } from '../../components/layout/AppShell';

interface Row {
  costCodeId: string;
  code: string;
  name: string;
  category: string;
  position: CostPosition;
  forecastAssumptions: string | null;
  forecastPeriod: string | null;
}
interface BudgetResp {
  rows: Row[];
  total: CostPosition;
  byCategory: Array<{ category: string; position: CostPosition }>;
  baselinedAt: string | null;
  currency: string;
  basis: string;
  revisions: Array<{ id: string; number: string; type: string; title: string; totalDelta: string; status: string; createdAt: string }>;
}

const money = (v: string, c?: string) => <span className="tabular-nums">{formatMoney(v, c)}</span>;

export function BudgetPage() {
  const projectId = useProjectId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['p', 'budget', projectId], queryFn: () => api.get<BudgetResp>(`/projects/${projectId}/budget`) });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, { originalAmount: string; contingencyAmount: string }>>({});
  const [confirmBaseline, setConfirmBaseline] = useState(false);
  useEffect(() => {
    if (q.data) setDraft(Object.fromEntries(q.data.rows.map((r) => [r.costCodeId, { originalAmount: r.position.originalBudget, contingencyAmount: r.position.contingency }])));
  }, [q.data]);
  const save = useMutation({ mutationFn: () => api.put(`/projects/${projectId}/budget/lines`, { lines: Object.entries(draft).map(([costCodeId, v]) => ({ costCodeId, ...v })) }), onSuccess: () => { toast.success('Original budget saved'); setEditing(false); void qc.invalidateQueries({ queryKey: ['p'] }); }, onError: (e: Error) => toast.error(e.message) });
  const baseline = useMutation({ mutationFn: () => api.post(`/projects/${projectId}/budget/baseline`), onSuccess: () => { toast.success('Budget baselined'); setConfirmBaseline(false); void qc.invalidateQueries({ queryKey: ['p'] }); }, onError: (e: Error) => toast.error(e.message) });
  if (!can('budget.view')) return <PermissionDenied />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingBlock rows={8} />;
  const t = q.data.total;
  const cur = q.data.currency;
  const draftTotal = Object.values(draft).reduce((a, v) => a + Number(v.originalAmount || 0), 0);
  return (
    <>
      <PageHeader
        title="Budget control"
        subtitle={q.data.basis}
        actions={
          <>
            {!q.data.baselinedAt && can('budget.manage') && (editing ? <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>Save original budget</Button> : <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit original budget</Button>)}
            {!q.data.baselinedAt && can('budget.approve') && !editing && <Button icon={<Lock className="h-4 w-4" />} onClick={() => setConfirmBaseline(true)}>Baseline budget</Button>}
            {q.data.baselinedAt && <Badge tone="success">Baselined {formatDate(q.data.baselinedAt)}</Badge>}
            <Link to="/budget/revisions/new"><Button variant="outline">New revision / transfer</Button></Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Original budget" value={formatMoneyCompact(t.originalBudget, cur)} />
        <KpiCard label="Approved budget (BAC)" value={formatMoneyCompact(t.approvedBudget, cur)} sub={`Contingency ${formatMoneyCompact(t.contingency, cur)}`} />
        <KpiCard label="Cost incurred" value={formatMoneyCompact(t.incurred, cur)} sub={`Actual ${formatMoneyCompact(t.actual, cur)} · accrued ${formatMoneyCompact(t.accrued, cur)}`} tone="success" />
        <KpiCard label="Open commitments" value={formatMoneyCompact(t.openCommitments, cur)} tone="neutral" />
        <KpiCard label="Remaining budget" value={formatMoneyCompact(t.remainingBudget, cur)} tone={Number(t.remainingBudget) < 0 ? 'danger' : 'primary'} />
        <KpiCard label="Pending (unapproved)" value={formatMoneyCompact(t.pending, cur)} sub={`VO exposure ${formatMoneyCompact(t.pendingVariationExposure, cur)}`} tone="warning" hint="Submitted costs awaiting approval and pending variations — excluded from actual cost and budget." />
      </div>
      <Card bodyClassName="p-0" title="Cost codes" subtitle={editing ? `Editing original budget — total ${formatMoney(String(draftTotal), cur)}` : 'Click a cost code to see its ledger entries.'}>
        <DataTable
          rows={q.data.rows}
          rowKey={(r) => r.costCodeId}
          dense
          caption="Budget by cost code"
          columns={[
            { key: 'code', header: 'Code', cell: (r) => <Link to={`/budget/ledger?costCodeId=${r.costCodeId}`} className="font-medium text-navy-800 hover:underline">{r.code}</Link> },
            { key: 'name', header: 'Description', cell: (r) => <span><span className="block">{r.name}</span><span className="text-xs text-muted">{humanize(r.category)}</span></span> },
            {
              key: 'ob',
              header: 'Original',
              align: 'right',
              cell: (r) =>
                editing ? (
                  <Input className="num h-8 w-36" inputMode="decimal" aria-label={`Original budget ${r.code}`} value={draft[r.costCodeId]?.originalAmount ?? ''} onChange={(e) => setDraft({ ...draft, [r.costCodeId]: { ...draft[r.costCodeId], originalAmount: e.target.value } })} />
                ) : (
                  money(r.position.originalBudget, cur)
                ),
            },
            { key: 'cont', header: 'Contingency', align: 'right', hideOnMobile: true, cell: (r) => (editing ? <Input className="num h-8 w-28" inputMode="decimal" aria-label={`Contingency ${r.code}`} value={draft[r.costCodeId]?.contingencyAmount ?? ''} onChange={(e) => setDraft({ ...draft, [r.costCodeId]: { ...draft[r.costCodeId], contingencyAmount: e.target.value } })} /> : money(r.position.contingency, cur)) },
            { key: 'bac', header: 'Approved', align: 'right', cell: (r) => money(r.position.approvedBudget, cur) },
            { key: 'inc', header: 'Incurred', align: 'right', cell: (r) => money(r.position.incurred, cur) },
            { key: 'com', header: 'Committed', align: 'right', hideOnMobile: true, cell: (r) => money(r.position.openCommitments, cur) },
            { key: 'rem', header: 'Remaining', align: 'right', cell: (r) => <span className={cx(Number(r.position.remainingBudget) < 0 && 'font-semibold text-red-600')}>{money(r.position.remainingBudget, cur)}</span> },
            { key: 'used', header: 'Consumed', align: 'right', hideOnMobile: true, cell: (r) => formatPct(Number(r.position.approvedBudget) ? (Number(r.position.incurred) + Number(r.position.openCommitments)) / Number(r.position.approvedBudget) : null) },
            { key: 'eac', header: 'EAC', align: 'right', hideOnMobile: true, cell: (r) => money(r.position.eac, cur) },
            { key: 'alert', header: 'Alert', cell: (r) => <StatusBadge status={r.position.alert} /> },
          ]}
          footer={
            <tr className="bg-slate-50 font-semibold">
              <td className="px-3 py-2" colSpan={2}>Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(editing ? String(draftTotal) : t.originalBudget, cur)}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{formatMoney(t.contingency, cur)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(t.approvedBudget, cur)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(t.incurred, cur)}</td>
              <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{formatMoney(t.openCommitments, cur)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(t.remainingBudget, cur)}</td>
              <td className="hidden px-3 py-2 md:table-cell" />
              <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{formatMoney(t.eac, cur)}</td>
              <td className="px-3 py-2"><StatusBadge status={t.alert} /></td>
            </tr>
          }
        />
      </Card>
      <Card className="mt-4" title="Recent revisions & transfers" actions={<Link to="/budget/revisions" className="text-xs font-medium text-brand-600 hover:underline">All</Link>}>
        {q.data.revisions.length === 0 ? (
          <p className="text-sm text-muted">No revisions yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {q.data.revisions.map((r) => (
              <li key={r.id}>
                <Link to={`/budget/revisions/${r.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-slate-50">
                  <span><span className="font-medium">{r.number}</span> · {r.title} <Badge>{humanize(r.type)}</Badge></span>
                  <span className="flex items-center gap-2">{money(r.totalDelta, cur)} <StatusBadge status={r.status} /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ConfirmDialog open={confirmBaseline} onOpenChange={setConfirmBaseline} title="Baseline the original budget?" message={`The original budget of ${formatMoney(t.originalBudget, cur)} will be frozen. Later changes must go through approved budget revisions or transfers.`} confirmLabel="Baseline" loading={baseline.isPending} onConfirm={() => baseline.mutate()} />
    </>
  );
}

interface ForecastResp extends BudgetResp {
  evm: { physicalPct: string | null; plannedPct: string | null; pv: string | null; ev: string | null; ac: string; cpi: string | null; spi: string | null; notes: string[] };
  history: Array<{ periodCode: string; uncommittedEtc: string | null; eacSnapshot: string | null; entries: number }>;
  currentPeriod: string;
}

export function ForecastPage() {
  const projectId = useProjectId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['p', 'forecast', projectId], queryFn: () => api.get<ForecastResp>(`/projects/${projectId}/forecast`) });
  const [edit, setEdit] = useState<{ row: Row; method: string; etc: string; assumptions: string } | null>(null);
  const save = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/forecast`, { entries: [{ costCodeId: edit!.row.costCodeId, method: edit!.method, uncommittedEtc: edit!.method === 'MANUAL' ? edit!.etc : undefined, assumptions: edit!.assumptions || undefined }] }),
    onSuccess: () => { toast.success('Forecast updated for the current period'); setEdit(null); void qc.invalidateQueries({ queryKey: ['p'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!can('forecast.view')) return <PermissionDenied />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <LoadingBlock rows={8} />;
  const { total: t, evm, currency: cur } = q.data;
  return (
    <>
      <PageHeader title="Cost forecasting" subtitle={`ETC = open commitments + forecast uncommitted cost. EAC = cost incurred + ETC. Entries are recorded for period ${q.data.currentPeriod} and kept as history.`} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="BAC" value={formatMoneyCompact(t.approvedBudget, cur)} />
        <KpiCard label="Cost incurred (AC)" value={formatMoneyCompact(t.incurred, cur)} />
        <KpiCard label="ETC" value={formatMoneyCompact(t.etc, cur)} />
        <KpiCard label="EAC" value={formatMoneyCompact(t.eac, cur)} tone={t.alert === 'CRITICAL' ? 'danger' : 'primary'} />
        <KpiCard label="Variance at completion" value={formatMoneyCompact(t.costVariance, cur)} sub={t.costVariancePct ? `${(Number(t.costVariancePct) * 100).toFixed(2)}%` : '—'} tone={Number(t.costVariance) < 0 ? 'danger' : 'success'} />
        <KpiCard label="CPI" value={evm.cpi ?? 'n/a'} sub={`EV ${evm.ev ? formatMoneyCompact(evm.ev, cur) : '—'}`} tone={evm.cpi && Number(evm.cpi) < 1 ? 'warning' : 'neutral'} />
        <KpiCard label="SPI" value={evm.spi ?? 'n/a'} sub={`PV ${evm.pv ? formatMoneyCompact(evm.pv, cur) : '—'}`} tone={evm.spi && Number(evm.spi) < 1 ? 'warning' : 'neutral'} />
      </div>
      {evm.notes.length > 0 && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{evm.notes.join(' ')}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card bodyClassName="p-0" title="Forecast by cost code" className="lg:col-span-2" subtitle="Click a row to update its forecast (assumptions are required for manual forecasts).">
          <DataTable
            rows={q.data.rows}
            rowKey={(r) => r.costCodeId}
            dense
            onRowClick={can('forecast.manage') ? (r) => setEdit({ row: r, method: r.position.forecastMethod, etc: r.position.uncommittedEtc, assumptions: r.forecastAssumptions ?? '' }) : undefined}
            columns={[
              { key: 'code', header: 'Cost code', cell: (r) => <span><span className="block font-medium">{r.code}</span><span className="text-xs text-muted">{r.name}</span></span> },
              { key: 'bac', header: 'BAC', align: 'right', cell: (r) => money(r.position.approvedBudget, cur) },
              { key: 'inc', header: 'Incurred', align: 'right', hideOnMobile: true, cell: (r) => money(r.position.incurred, cur) },
              { key: 'com', header: 'Committed', align: 'right', hideOnMobile: true, cell: (r) => money(r.position.openCommitments, cur) },
              { key: 'unc', header: 'Uncommitted ETC', align: 'right', cell: (r) => money(r.position.uncommittedEtc, cur) },
              { key: 'eac', header: 'EAC', align: 'right', cell: (r) => money(r.position.eac, cur) },
              { key: 'cv', header: 'Variance', align: 'right', cell: (r) => <span className={cx(Number(r.position.costVariance) < 0 && 'font-semibold text-red-600')}>{money(r.position.costVariance, cur)}</span> },
              { key: 'm', header: 'Method', cell: (r) => <span title={r.forecastAssumptions ?? undefined}><Badge tone={r.position.forecastMethod === 'MANUAL' ? 'primary' : 'neutral'}>{r.position.forecastMethod === 'MANUAL' ? 'Manual' : 'Remaining budget'}</Badge>{r.forecastPeriod && <span className="ml-1 text-xs text-muted">{r.forecastPeriod}</span>}</span> },
            ]}
          />
        </Card>
        <ChartCard
          title="EAC history"
          subtitle="Sum of EAC snapshots for cost codes forecast in each period"
          table={{ columns: ['Period', 'Codes', 'EAC'], rows: q.data.history.map((h) => [h.periodCode, h.entries, formatMoneyCompact(h.eacSnapshot ?? '0', cur)]) }}
          chart={
            q.data.history.length === 0 ? (
              <p className="text-sm text-muted">No forecast history yet.</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer>
                  <LineChart data={q.data.history.map((h) => ({ period: h.periodCode, EAC: Number(h.eacSnapshot ?? 0) }))} margin={{ left: 4, right: 8, top: 8 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="period" {...axisProps} />
                    <YAxis tickFormatter={moneyTick} {...axisProps} width={64} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line dataKey="EAC" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )
          }
        />
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={`Forecast — ${edit?.row.code} ${edit?.row.name}`} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Save forecast</Button>}>
        {edit && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Incurred {formatMoney(edit.row.position.incurred, cur)} · open commitments {formatMoney(edit.row.position.openCommitments, cur)} · remaining budget {formatMoney(edit.row.position.remainingBudget, cur)}
            </p>
            <Field label="Method">
              <Select options={[{ value: 'REMAINING_BUDGET', label: 'Remaining budget (default)' }, { value: 'MANUAL', label: 'Manual estimate' }]} value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value })} />
            </Field>
            {edit.method === 'MANUAL' && (
              <Field label="Uncommitted cost to complete" required>
                <Input inputMode="decimal" value={edit.etc} onChange={(e) => setEdit({ ...edit, etc: e.target.value })} />
              </Field>
            )}
            <Field label="Assumptions" required={edit.method === 'MANUAL'} help="Quantities, rates and sources used — reviewers rely on this.">
              <Textarea value={edit.assumptions} onChange={(e) => setEdit({ ...edit, assumptions: e.target.value })} />
            </Field>
            {edit.method === 'MANUAL' && edit.etc && (
              <p className="rounded-lg bg-slate-50 p-2 text-sm">
                New EAC ≈ <strong>{formatMoney(String(Number(edit.row.position.incurred) + Number(edit.row.position.openCommitments) + Number(edit.etc)), cur)}</strong> vs budget {formatMoney(edit.row.position.approvedBudget, cur)}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

interface ReportResult {
  columns: Array<{ key: string; label: string; type?: string }>;
  rows: Array<Record<string, string>>;
}

export function CashFlowPage() {
  const projectId = useProjectId();
  const { project } = useAuth();
  const q = useQuery({ queryKey: ['p', 'report', 'cash-flow', projectId], queryFn: () => api.get<ReportResult>(`/projects/${projectId}/reports/cash-flow`) });
  const rows = q.data?.rows ?? [];
  const cur = project?.currency;
  const data = useMemo(() => rows.map((r) => ({ month: r.month, 'Planned inflow': Number(r.plannedInflow), 'Actual inflow': Number(r.actualInflow), 'Planned outflow': Number(r.plannedOutflow), 'Actual outflow': Number(r.actualOutflow), Cumulative: Number(r.cumulative) })), [rows]);
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <>
      <PageHeader title="Cash flow" subtitle="Actual cash = approved payments (out) and receipts (in). Cost recognition, invoice value and certified amounts are tracked separately and do not appear here." actions={<Link to="/cash-flow/plan"><Button variant="outline">Edit plan</Button></Link>} />
      {!q.data ? (
        <LoadingBlock rows={6} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Monthly inflow and outflow"
            legend={[{ label: 'Planned inflow', color: SERIES[0] }, { label: 'Actual inflow', color: SERIES[2] }, { label: 'Planned outflow', color: SERIES[1] }, { label: 'Actual outflow', color: SERIES[3] }]}
            table={{ columns: ['Month', 'Plan in', 'Actual in', 'Plan out', 'Actual out'], rows: rows.map((r) => [r.month, formatMoneyCompact(r.plannedInflow, cur), formatMoneyCompact(r.actualInflow, cur), formatMoneyCompact(r.plannedOutflow, cur), formatMoneyCompact(r.actualOutflow, cur)]) }}
            chart={
              <div className="h-72">
                <ResponsiveContainer>
                  <BarChart data={data} barGap={1} margin={{ left: 4, right: 8, top: 4 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="month" {...axisProps} />
                    <YAxis tickFormatter={moneyTick} {...axisProps} width={64} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f4f9' }} />
                    <Bar dataKey="Planned inflow" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={10} />
                    <Bar dataKey="Actual inflow" fill={SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={10} />
                    <Bar dataKey="Planned outflow" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={10} />
                    <Bar dataKey="Actual outflow" fill={SERIES[3]} radius={[4, 4, 0, 0]} maxBarSize={10} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            }
          />
          <ChartCard
            title="Cumulative net cash position"
            subtitle="Actual receipts minus payments, cumulative"
            table={{ columns: ['Month', 'Net', 'Cumulative'], rows: rows.map((r) => [r.month, formatMoneyCompact(r.net, cur), formatMoneyCompact(r.cumulative, cur)]) }}
            chart={
              <div className="h-72">
                <ResponsiveContainer>
                  <LineChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="month" {...axisProps} />
                    <YAxis tickFormatter={moneyTick} {...axisProps} width={64} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line dataKey="Cumulative" stroke={SERIES[0]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            }
          />
          <Card bodyClassName="p-0" title="Cash flow table" className="lg:col-span-2">
            <DataTable rows={rows} rowKey={(r) => r.month} dense columns={(q.data.columns ?? []).map((c, i) => ({ key: c.key, header: c.label, align: i ? 'right' : 'left', cell: (r) => (i ? formatMoney(r[c.key], cur) : r[c.key]) }))} empty={{ title: 'No cash plan or payments yet' }} />
          </Card>
        </div>
      )}
    </>
  );
}

interface LedgerRow {
  id: string;
  date: string;
  kind: string;
  amount: string;
  sourceType: string;
  sourceNumber: string | null;
  description: string | null;
  costCode: { code: string; name: string };
}

export function LedgerPage() {
  const projectId = useProjectId();
  const { project } = useAuth();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const filters = { costCodeId: params.get('costCodeId') ?? '', kind: params.get('kind') ?? '', sourceType: params.get('sourceType') ?? '' };
  const q = useQuery({ queryKey: ['p', 'ledger', projectId, filters, page], queryFn: () => api.get<Paged<LedgerRow> & { totals: Record<string, string>; net: string }>(`/projects/${projectId}/ledger`, { ...filters, page }) });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
    setPage(1);
  };
  const cur = project?.currency;
  return (
    <>
      <PageHeader title="Cost ledger" subtitle="Append-only record of every commitment, accrual and actual cost posting. Corrections appear as reversal entries." />
      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
          <div className="w-64"><RefSelect source="costCodes" value={filters.costCodeId || null} placeholder="All cost codes" onChange={(v) => set('costCodeId', v ?? '')} /></div>
          <Select className="w-44" aria-label="Kind" options={['ACTUAL', 'ACCRUAL', 'COMMITMENT']} placeholder="All kinds" value={filters.kind} onChange={(e) => set('kind', e.target.value)} />
          <Select className="w-52" aria-label="Source" options={['PO', 'GRN', 'SUPPLIER_INVOICE', 'SUBCONTRACT', 'CONTRACTOR_BILL', 'EXPENSE', 'MPR', 'EQUIPMENT_LOG']} placeholder="All sources" value={filters.sourceType} onChange={(e) => set('sourceType', e.target.value)} />
          {q.data && (
            <div className="ml-auto flex flex-wrap gap-2 text-xs">
              {Object.entries(q.data.totals).map(([k, v]) => <Badge key={k}>{humanize(k)}: {formatMoneyCompact(v, cur)}</Badge>)}
            </div>
          )}
        </div>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          error={q.error}
          rowKey={(r) => r.id}
          dense
          columns={[
            { key: 'date', header: 'Date', cell: (r) => formatDate(r.date) },
            { key: 'cc', header: 'Cost code', cell: (r) => r.costCode.code },
            { key: 'kind', header: 'Kind', cell: (r) => <Badge tone={r.kind === 'ACTUAL' ? 'success' : r.kind === 'ACCRUAL' ? 'info' : 'neutral'}>{humanize(r.kind)}</Badge> },
            { key: 'src', header: 'Source', cell: (r) => `${humanize(r.sourceType)} ${r.sourceNumber ?? ''}` },
            { key: 'desc', header: 'Description', hideOnMobile: true, cell: (r) => <span className="text-muted">{r.description}</span> },
            { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className={cx(Number(r.amount) < 0 && 'text-red-600')}>{formatMoney(r.amount, cur)}</span> },
          ]}
          pagination={q.data ? { page, pageSize: q.data.pageSize, total: q.data.total, onPage: setPage } : undefined}
        />
      </Card>
    </>
  );
}
