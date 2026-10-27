import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight, Banknote, Building, Camera, ClipboardCheck, ClipboardList, FileWarning, Gauge, HandCoins, HardHat, Info, PackageCheck, Percent, PiggyBank, Receipt, Stamp, Target, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { humanize } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate, formatMoney, formatMoneyCompact, formatPct, relativeTime } from '../../lib/format';
import { Badge, Card, EmptyState, ErrorState, Input, KpiCard, LoadingBlock, ProgressBar, StatusBadge, cx } from '../../components/ui';
import { Page } from '../../components/layout/AppShell';
import { ChartCard, ChartTooltip, GRID, SERIES, axisProps, moneyTick } from '../../components/data/charts';

interface Dashboard {
  project: { name: string; code: string; currency: string; startDate: string | null; plannedCompletionDate: string | null };
  basis: Record<string, string>;
  kpis: Record<string, string | number | null | string[]> & { evmNotes: string[]; alert: string };
  charts: {
    budgetVsActualVsForecast: Array<{ category: string; budget: string; actual: string; committed: string; forecast: string }>;
    costTrend: Array<{ month: string; budget: string; actual: string; cumulativeActual: string; committed: string; labour: string; material: string }>;
    costBreakdown: Array<{ category: string; amount: string }>;
    wbsProgress: Array<{ name: string; percent: number }>;
    cashFlow: Array<{ month: string; plannedInflow: string; plannedOutflow: string; actualInflow: string; actualOutflow: string }>;
    costCodeVariance: Array<{ code: string; name: string; approvedBudget: string; eac: string; variance: string; alert: string }>;
  };
  procurement: Record<string, number>;
}

interface Ops {
  evidence: Array<{ id: string; number: string; caption: string | null; status: string; location: string | null; fileId: string; createdAt: string }>;
  manpowerToday: Array<{ id: string; totalWorkers: number; status: string; contractor: { name: string } | null }>;
  recentGrn: Array<{ id: string; number: string; receivedDate: string; status: string; acceptedValue: string; supplier: { name: string } }>;
  verificationQueue: Array<{ id: string; number: string; status: string; location: string | null; submittedQty: string; unit: string; boqItem: { itemCode: string } }>;
  billsAwaiting: Array<{ id: string; number: string; netPayable: string; contractor: { name: string } }>;
  overdueTasks: Array<{ id: string; number: string; title: string; dueDate: string | null; status: string; priority: string; owner: { name: string } | null }>;
  risks: Array<{ id: string; number: string; title: string; score: number; costExposure: string }>;
  milestones: Array<{ id: string; code: string; name: string; plannedFinish: string | null; percentComplete: string }>;
  workload: Array<{ userId: string; name: string; designation: string | null; open: number; overdue: number; completed: number }>;
}

interface InboxItem {
  id: string;
  title: string;
  docType: string;
  amount: string | null;
  submittedAt: string;
  overdue: boolean;
  link: string | null;
  currentStepName: string;
}

const n = (v: unknown) => Number(v ?? 0);
const short = (m: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(m + '-01T00:00:00Z'));

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage() {
  const projectId = useProjectId();
  const { me, project } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState({ from: '', to: '' });
  const dash = useQuery({ queryKey: ['p', 'dashboard', projectId, range], queryFn: () => api.get<Dashboard>(`/projects/${projectId}/dashboard`, range), enabled: !!projectId });
  const ops = useQuery({ queryKey: ['p', 'dashboard-ops', projectId], queryFn: () => api.get<Ops>(`/projects/${projectId}/dashboard/operations`), enabled: !!projectId });
  const inbox = useQuery({ queryKey: ['approvals', 'inbox', projectId], queryFn: () => api.get<InboxItem[]>('/approvals/inbox', { projectId }), enabled: !!projectId });

  if (!projectId) return <Page><EmptyState title="No project access yet" description="Ask an administrator to add you to a project." /></Page>;
  if (dash.error) return <Page><ErrorState error={dash.error} onRetry={() => dash.refetch()} /></Page>;
  const d = dash.data;
  const k = d?.kpis;
  const cur = project?.currency ?? 'INR';
  const pctOf = (a: unknown, b: unknown) => (n(b) ? `${((n(a) / n(b)) * 100).toFixed(1)}%` : '—');
  const cvNeg = n(k?.costVariance) < 0;
  const physical = k?.physicalProgress ? Number(k.physicalProgress) * 100 : null;

  return (
    <Page>
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            {greeting()}, {me?.user.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Cost control overview for <strong className="text-ink">{project?.name}</strong> · {formatDate(new Date())}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range for trends">
          <Input type="date" className="w-auto" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="Trend from" />
          <span className="text-xs text-muted">to</span>
          <Input type="date" className="w-auto" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="Trend to" />
        </div>
      </div>

      {!d || !k ? (
        <LoadingBlock rows={8} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard label="Approved budget" value={formatMoneyCompact(k.approvedBudget as string, cur)} sub={`Original ${formatMoneyCompact(k.originalBudget as string, cur)}`} icon={<PiggyBank className="h-5 w-5" />} hint="Original budget plus approved revisions. Pending revisions and variations are excluded." />
            <KpiCard label="Actual cost (incurred)" value={formatMoneyCompact(k.incurredCost as string, cur)} sub={`${pctOf(k.incurredCost, k.approvedBudget)} · accrued ${formatMoneyCompact(k.accruedCost as string, cur)}`} icon={<Receipt className="h-5 w-5" />} tone="success" hint="Actual + accrued (received not yet invoiced), excluding tax." />
            <KpiCard label="Committed (open)" value={formatMoneyCompact(k.committedCost as string, cur)} sub={pctOf(k.committedCost, k.approvedBudget)} icon={<HandCoins className="h-5 w-5" />} tone="neutral" hint="Approved PO and subcontract value not yet received or certified." />
            <KpiCard label="Remaining budget" value={formatMoneyCompact(k.remainingBudget as string, cur)} sub={pctOf(k.remainingBudget, k.approvedBudget)} icon={<Wallet className="h-5 w-5" />} tone={n(k.remainingBudget) < 0 ? 'danger' : 'primary'} hint="Approved budget − cost incurred − open commitments." />
            <KpiCard
              label="Forecast final cost (EAC)"
              value={formatMoneyCompact(k.forecastFinalCost as string, cur)}
              sub={
                <span className={cx('inline-flex items-center gap-1 font-medium', cvNeg ? 'text-red-600' : 'text-emerald-700')}>
                  {cvNeg ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {k.costVariancePct ? `${(Number(k.costVariancePct) * 100).toFixed(1)}%` : '—'} {cvNeg ? 'overrun' : 'under budget'}
                </span>
              }
              icon={<Target className="h-5 w-5" />}
              tone={k.alert === 'CRITICAL' ? 'danger' : k.alert === 'WARNING' ? 'warning' : 'success'}
              hint="EAC = cost incurred + open commitments + forecast uncommitted cost to complete."
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard label="Contract value" value={formatMoneyCompact(k.revisedContractValue as string, cur)} sub={`Original ${formatMoneyCompact(k.contractValue as string, cur)}`} icon={<Building className="h-4 w-4" />} />
            <KpiCard label="Cost variance" value={formatMoneyCompact(k.costVariance as string, cur)} sub="Budget − EAC" icon={<Gauge className="h-4 w-4" />} tone={cvNeg ? 'danger' : 'success'} />
            <KpiCard label="Physical progress" value={physical === null ? '—' : `${physical.toFixed(1)}%`} sub={`Financial ${formatPct(k.financialProgress as string)}`} icon={<Percent className="h-4 w-4" />} hint={(k.evmNotes as string[]).join(' ') || 'Weighted activity progress'} />
            <KpiCard label="CPI / SPI" value={`${k.cpi ?? '—'} / ${k.spi ?? '—'}`} sub="Earned value indices" icon={<Gauge className="h-4 w-4" />} tone={k.cpi && Number(k.cpi) < 1 ? 'warning' : 'neutral'} hint={(k.evmNotes as string[]).join(' ') || 'CPI = EV/AC, SPI = EV/PV'} />
            <KpiCard label="Receivables" value={formatMoneyCompact(k.outstandingReceivables as string, cur)} sub="Certified, not received" icon={<Banknote className="h-4 w-4" />} />
            <KpiCard label="Payables" value={formatMoneyCompact(k.outstandingPayables as string, cur)} sub="Approved, not paid" icon={<Wallet className="h-4 w-4" />} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Link to="/approvals" className="card flex items-center gap-3 p-3 hover:bg-slate-50">
              <Stamp className="h-5 w-5 text-navy-700" />
              <span className="text-sm">
                <strong className="text-base">{k.pendingApprovals as number}</strong> pending approvals
              </span>
            </Link>
            <Link to="/tasks" className="card flex items-center gap-3 p-3 hover:bg-slate-50">
              <AlertTriangle className={cx('h-5 w-5', n(k.overdueTasks) ? 'text-red-600' : 'text-muted')} />
              <span className="text-sm">
                <strong className="text-base">{k.overdueTasks as number}</strong> overdue tasks
              </span>
            </Link>
            <Link to="/procurement/mr" className="card flex items-center gap-3 p-3 hover:bg-slate-50">
              <PackageCheck className="h-5 w-5 text-navy-700" />
              <span className="text-sm">
                <strong className="text-base">{k.pendingProcurement as number}</strong> pending procurement
              </span>
            </Link>
            <Link to="/variations" className="card flex items-center gap-3 p-3 hover:bg-slate-50" title="Cost impact of variations awaiting approval — not included in budget">
              <FileWarning className="h-5 w-5 text-amber-600" />
              <span className="text-sm">
                <strong className="text-base">{formatMoneyCompact(k.pendingVariationExposure as string, cur)}</strong> pending VO exposure
              </span>
            </Link>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <Card title="Project progress" className="lg:col-span-3" subtitle="Weighted by activity">
              <div className="flex items-center gap-4 lg:flex-col">
                <div className="relative h-36 w-36 shrink-0">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={[{ v: physical ?? 0 }, { v: 100 - (physical ?? 0) }]} dataKey="v" innerRadius="72%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                        <Cell fill={SERIES[0]} />
                        <Cell fill="#e8edf4" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-semibold">{physical === null ? '—' : `${physical.toFixed(0)}%`}</span>
                    <span className="text-[11px] text-muted">physical</span>
                  </div>
                </div>
                <ul className="w-full space-y-2">
                  {d.charts.wbsProgress.slice(0, 6).map((w) => (
                    <li key={w.name}>
                      <div className="mb-0.5 flex justify-between text-xs">
                        <span className="truncate text-muted">{w.name}</span>
                        <span className="font-medium tabular-nums">{w.percent}%</span>
                      </div>
                      <ProgressBar value={w.percent} tone={w.percent >= 100 ? 'success' : 'primary'} label={w.name} />
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
            <ChartCard
              className="lg:col-span-6"
              title="Cost trend (cumulative)"
              subtitle="Cost incurred vs time-phased approved budget"
              legend={[
                { label: 'Planned budget (linear)', color: SERIES[0] },
                { label: 'Cost incurred', color: SERIES[1] },
                { label: 'New commitments / month', color: SERIES[2] },
              ]}
              table={{ columns: ['Month', 'Planned', 'Incurred (cum.)', 'Committed'], rows: d.charts.costTrend.map((r) => [short(r.month), formatMoneyCompact(r.budget), formatMoneyCompact(r.cumulativeActual), formatMoneyCompact(r.committed)]) }}
              chart={
                <div className="h-64">
                  <ResponsiveContainer>
                    <ComposedChart data={d.charts.costTrend.map((r) => ({ month: short(r.month), Planned: n(r.budget), Incurred: n(r.cumulativeActual), Committed: n(r.committed) }))} margin={{ left: 4, right: 8, top: 4 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="month" {...axisProps} />
                      <YAxis tickFormatter={moneyTick} {...axisProps} width={64} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="Committed" name="New commitments / month" fill={SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={18} />
                      <Line type="monotone" dataKey="Planned" name="Planned budget (linear)" stroke={SERIES[0]} strokeWidth={2} dot={false} />
                      <Area type="monotone" dataKey="Incurred" name="Cost incurred" stroke={SERIES[1]} strokeWidth={2} fill={SERIES[1]} fillOpacity={0.08} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              }
            />
            <ChartCard
              className="lg:col-span-3"
              title="Cost distribution"
              subtitle="Cost incurred by category"
              table={{ columns: ['Category', 'Amount', 'Share'], rows: d.charts.costBreakdown.map((c) => [humanize(c.category), formatMoneyCompact(c.amount), pctOf(c.amount, k.incurredCost)]) }}
              chart={
                <div>
                  <div className="relative mx-auto h-36 w-36">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={d.charts.costBreakdown.map((c) => ({ name: humanize(c.category), value: n(c.amount) }))} dataKey="value" innerRadius="62%" outerRadius="100%" paddingAngle={1} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
                          {d.charts.costBreakdown.map((c, i) => (
                            <Cell key={c.category} fill={SERIES[i % SERIES.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-sm font-semibold">{formatMoneyCompact(k.incurredCost as string, cur)}</span>
                      <span className="text-[10px] text-muted">total</span>
                    </div>
                  </div>
                  <ul className="mt-3 space-y-1">
                    {d.charts.costBreakdown.map((c, i) => (
                      <li key={c.category} className="flex items-center gap-2 text-xs">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i] }} aria-hidden />
                        <span className="text-muted">{humanize(c.category)}</span>
                        <span className="ml-auto font-medium tabular-nums">{pctOf(c.amount, k.incurredCost)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Budget vs actual vs forecast"
              subtitle="By cost category (excl. tax)"
              legend={[
                { label: 'Approved budget', color: SERIES[0] },
                { label: 'Cost incurred', color: SERIES[1] },
                { label: 'Forecast (EAC)', color: SERIES[2] },
              ]}
              table={{ columns: ['Category', 'Budget', 'Incurred', 'Committed', 'EAC'], rows: d.charts.budgetVsActualVsForecast.map((c) => [humanize(c.category), formatMoneyCompact(c.budget), formatMoneyCompact(c.actual), formatMoneyCompact(c.committed), formatMoneyCompact(c.forecast)]) }}
              chart={
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={d.charts.budgetVsActualVsForecast.map((c) => ({ category: humanize(c.category), Budget: n(c.budget), Incurred: n(c.actual), EAC: n(c.forecast) }))} barGap={2} margin={{ left: 4, right: 8, top: 4 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="category" {...axisProps} />
                      <YAxis tickFormatter={moneyTick} {...axisProps} width={64} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f4f9' }} />
                      <Bar dataKey="Budget" name="Approved budget" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} />
                      <Bar dataKey="Incurred" name="Cost incurred" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={22} />
                      <Bar dataKey="EAC" name="Forecast (EAC)" fill={SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              }
            />
            <ChartCard
              title="Cash flow"
              subtitle="Approved payments and receipts vs plan"
              legend={[
                { label: 'Planned inflow', color: SERIES[0] },
                { label: 'Actual inflow', color: SERIES[2] },
                { label: 'Planned outflow', color: SERIES[1] },
                { label: 'Actual outflow', color: SERIES[3] },
              ]}
              table={{ columns: ['Month', 'Plan in', 'Actual in', 'Plan out', 'Actual out'], rows: d.charts.cashFlow.map((c) => [short(c.month), formatMoneyCompact(c.plannedInflow), formatMoneyCompact(c.actualInflow), formatMoneyCompact(c.plannedOutflow), formatMoneyCompact(c.actualOutflow)]) }}
              chart={
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={d.charts.cashFlow.map((c) => ({ month: short(c.month), 'Planned inflow': n(c.plannedInflow), 'Actual inflow': n(c.actualInflow), 'Planned outflow': n(c.plannedOutflow), 'Actual outflow': n(c.actualOutflow) }))} barGap={1} margin={{ left: 4, right: 8, top: 4 }}>
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
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Today’s activities">
          {ops.data ? (
            <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {[
                { icon: <HardHat className="mx-auto h-5 w-5 text-navy-700" />, v: ops.data.manpowerToday.reduce((a, m) => a + m.totalWorkers, 0), l: 'Manpower on site', to: '/manpower' },
                { icon: <PackageCheck className="mx-auto h-5 w-5 text-navy-700" />, v: ops.data.recentGrn.filter((g) => g.receivedDate.slice(0, 10) === new Date().toISOString().slice(0, 10)).length, l: 'Material receipts', to: '/procurement/grn' },
                { icon: <ClipboardList className="mx-auto h-5 w-5 text-navy-700" />, v: ops.data.verificationQueue.length, l: 'Measurements in queue', to: '/measurement-verification' },
                { icon: <Receipt className="mx-auto h-5 w-5 text-navy-700" />, v: ops.data.billsAwaiting.length, l: 'Bills to certify', to: '/subcontractor-bills' },
              ].map((x) => (
                <Link key={x.l} to={x.to} className="rounded-lg bg-slate-50 p-3 hover:bg-brand-50">
                  {x.icon}
                  <p className="mt-1 text-xl font-semibold">{x.v}</p>
                  <p className="text-[11px] text-muted">{x.l}</p>
                </Link>
              ))}
            </div>
          ) : (
            <LoadingBlock rows={2} />
          )}
        </Card>
        <Card title="My pending approvals" actions={<Link to="/approvals" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>}>
          {inbox.data?.length === 0 && <p className="text-sm text-muted">Nothing awaiting your approval.</p>}
          <ul className="divide-y divide-line">
            {inbox.data?.slice(0, 5).map((a) => (
              <li key={a.id}>
                <button onClick={() => a.link && navigate(a.link)} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{a.title}</span>
                    <span className="text-xs text-muted">
                      {a.currentStepName} · {relativeTime(a.submittedAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    {a.amount && <span className="block font-medium tabular-nums">{formatMoneyCompact(a.amount)}</span>}
                    {a.overdue && <Badge tone="danger">Overdue</Badge>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Overdue & blocked tasks" actions={<Link to="/tasks" className="text-xs font-medium text-brand-600 hover:underline">Task board</Link>}>
          {ops.data?.overdueTasks.length === 0 && <p className="text-sm text-muted">No overdue tasks.</p>}
          <ul className="divide-y divide-line">
            {ops.data?.overdueTasks.slice(0, 5).map((t) => (
              <li key={t.id}>
                <Link to={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <span className="text-xs text-muted">
                      {t.owner?.name ?? 'Unassigned'} · due {formatDate(t.dueDate)}
                    </span>
                  </span>
                  <StatusBadge status={t.status === 'BLOCKED' ? 'BLOCKED' : 'OVERDUE'} label={t.status === 'BLOCKED' ? 'Blocked' : 'Overdue'} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Recent site photos" className="lg:col-span-2" actions={<Link to="/evidence" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">View all <ArrowRight className="h-3 w-3" /></Link>}>
          {ops.data?.evidence.length === 0 && <EmptyState title="No site photos yet" icon={<Camera className="h-6 w-6" />} />}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ops.data?.evidence.slice(0, 8).map((e) => (
              <li key={e.id}>
                <Link to={`/evidence?focus=${e.id}`} className="group block overflow-hidden rounded-lg border border-line">
                  <img src={api.url(`/files/${e.fileId}`)} alt={e.caption ?? e.number} loading="lazy" className="aspect-[4/3] w-full object-cover transition group-hover:opacity-90" />
                  <div className="p-2">
                    <p className="truncate text-xs font-medium">{e.caption ?? e.number}</p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-[11px] text-muted">{relativeTime(e.createdAt)}</span>
                      <StatusBadge status={e.status} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Team workload" actions={<Link to="/team" className="text-xs font-medium text-brand-600 hover:underline">Team</Link>}>
          <ul className="space-y-3">
            {ops.data?.workload.map((w) => {
              const total = w.open + w.completed;
              return (
                <li key={w.userId}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="truncate font-medium">{w.name}</span>
                    <span className="text-xs tabular-nums text-muted">
                      {w.open} open{w.overdue ? <span className="text-red-600"> · {w.overdue} overdue</span> : null}
                    </span>
                  </div>
                  <ProgressBar value={total ? (w.completed / total) * 100 : 0} tone={w.overdue ? 'danger' : 'success'} label={`${w.name} completion`} />
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="High-risk cost alerts" actions={<Link to="/budget" className="text-xs font-medium text-brand-600 hover:underline">Budget</Link>}>
          {d?.charts.costCodeVariance.length === 0 && ops.data?.risks.length === 0 && <p className="text-sm text-muted">No cost codes at warning or critical level.</p>}
          <ul className="divide-y divide-line">
            {d?.charts.costCodeVariance.map((c) => (
              <li key={c.code} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {c.code} {c.name}
                  </span>
                  <span className="text-xs text-muted">
                    EAC {formatMoneyCompact(c.eac)} vs {formatMoneyCompact(c.approvedBudget)}
                  </span>
                </span>
                <StatusBadge status={c.alert} />
              </li>
            ))}
            {ops.data?.risks.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link to={`/risks/${r.id}`} className="min-w-0 hover:underline">
                  <span className="block truncate font-medium">{r.title}</span>
                  <span className="text-xs text-muted">Risk score {r.score} · exposure {formatMoneyCompact(r.costExposure)}</span>
                </Link>
                <Badge tone="danger">Risk</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Measurement verification queue" actions={<Link to="/measurement-verification" className="text-xs font-medium text-brand-600 hover:underline">Queue</Link>}>
          {ops.data?.verificationQueue.length === 0 && <p className="text-sm text-muted">Queue is empty.</p>}
          <ul className="divide-y divide-line">
            {ops.data?.verificationQueue.slice(0, 6).map((m) => (
              <li key={m.id}>
                <Link to={`/measurements/${m.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {m.number} · {m.boqItem.itemCode}
                    </span>
                    <span className="text-xs text-muted">{m.location}</span>
                  </span>
                  <StatusBadge status={m.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Upcoming milestones" actions={<Link to="/schedule" className="text-xs font-medium text-brand-600 hover:underline">Schedule</Link>}>
          <ul className="divide-y divide-line">
            {ops.data?.milestones.length === 0 && <li className="text-sm text-muted">No open milestones.</li>}
            {ops.data?.milestones.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="text-xs text-muted">Planned {formatDate(m.plannedFinish)}</span>
                </span>
                <span className="text-xs tabular-nums">{Number(m.percentComplete).toFixed(0)}%</span>
              </li>
            ))}
            {ops.data?.billsAwaiting.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link to={`/subcontractor-bills/${b.id}`} className="min-w-0 hover:underline">
                  <span className="block truncate font-medium">{b.number} awaiting certification</span>
                  <span className="text-xs text-muted">{b.contractor.name}</span>
                </Link>
                <span className="text-xs tabular-nums">{formatMoneyCompact(b.netPayable)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {d && (
        <details className="mt-4 rounded-lg border border-line bg-white p-4 text-xs text-muted">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink">
            <Info className="h-4 w-4" /> How these figures are calculated
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {Object.values(d.basis).map((b) => (
              <li key={b}>{b}</li>
            ))}
            <li>Values in {cur}; compact notation (Cr = crore, L = lakh). Full figures are shown in reports and tables: approved budget {formatMoney(k?.approvedBudget as string, cur)}.</li>
          </ul>
        </details>
      )}
      {k && Number(k.pendingCost) > 0 && (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted">
          <ClipboardCheck className="h-3.5 w-3.5" /> {formatMoneyCompact(k.pendingCost as string, cur)} of submitted costs await approval and are not in actuals.
        </p>
      )}
    </Page>
  );
}
