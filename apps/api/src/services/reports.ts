/* eslint-disable @typescript-eslint/no-explicit-any */
import { computeEvm, D, humanize, money, sum, TASK_STATUS_LABEL } from '@toprock/shared';
import { prisma } from '../lib/prisma.js';
import { isoDate, periodCode, today, toDateOnly } from '../lib/dates.js';
import { can, type AccessContext } from './access.js';
import { projectCostPositions } from './budget.js';

export type ColType = 'text' | 'money' | 'qty' | 'pct' | 'date' | 'int' | 'status';
export interface ReportColumn {
  key: string;
  label: string;
  type?: ColType;
}
export interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  notes?: string[];
}
export interface ReportParams {
  projectId: string;
  from?: Date;
  to?: Date;
}
interface ReportDef {
  key: string;
  title: string;
  group: string;
  permission: string;
  description: string;
  dateFilter?: boolean;
  run: (p: ReportParams, ctx: AccessContext) => Promise<ReportResult>;
}

const dr = (p: ReportParams, field = 'date') => (p.from || p.to ? { [field]: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {});
const totalOf = (rows: Record<string, unknown>[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, money(sum(rows.map((r) => (r[k] as string) ?? 0)))]));
const names = async (ids: (string | null | undefined)[]) => new Map((await prisma.user.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
const partyNames = async (ids: (string | null | undefined)[]) => new Map((await prisma.party.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

const positionCols: ReportColumn[] = [
  { key: 'code', label: 'Cost code' },
  { key: 'name', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'approvedBudget', label: 'Approved budget', type: 'money' },
  { key: 'incurred', label: 'Cost incurred', type: 'money' },
  { key: 'openCommitments', label: 'Open commitments', type: 'money' },
  { key: 'etc', label: 'ETC', type: 'money' },
  { key: 'eac', label: 'EAC', type: 'money' },
  { key: 'costVariance', label: 'Variance (BAC−EAC)', type: 'money' },
  { key: 'costVariancePct', label: 'Var %', type: 'pct' },
  { key: 'alert', label: 'Alert', type: 'status' },
];

async function positionRows(projectId: string, asOf?: Date) {
  const p = await projectCostPositions(prisma, projectId, { asOf });
  return { p, rows: p.rows.map((r) => ({ code: r.code, name: r.name, category: r.category, ...r.position, assumptions: r.forecastAssumptions, forecastPeriod: r.forecastPeriod })) };
}

const REPORTS: ReportDef[] = [
  // ───────── Project & cost ─────────
  {
    key: 'project-cost-summary',
    title: 'Project Cost Summary',
    group: 'Project & Cost',
    permission: 'budget.view',
    description: 'Cost position by category: budget, actual, accrued, commitments, EAC and variance.',
    async run(p) {
      const pos = await projectCostPositions(prisma, p.projectId, { asOf: p.to });
      const rows = pos.byCategory.map((c) => ({ category: humanize(c.category), ...c.position }));
      return {
        columns: [
          { key: 'category', label: 'Category' },
          { key: 'originalBudget', label: 'Original budget', type: 'money' },
          { key: 'approvedBudget', label: 'Approved budget', type: 'money' },
          { key: 'actual', label: 'Actual', type: 'money' },
          { key: 'accrued', label: 'Accrued', type: 'money' },
          { key: 'openCommitments', label: 'Open commitments', type: 'money' },
          { key: 'eac', label: 'Forecast final (EAC)', type: 'money' },
          { key: 'costVariance', label: 'Variance', type: 'money' },
        ],
        rows,
        totals: { category: 'TOTAL', ...pos.total },
        notes: ['Amounts exclude tax unless configured otherwise. Pending variations are excluded from budget.', `Pending variation exposure: ${pos.total.pendingVariationExposure}`],
      };
    },
  },
  {
    key: 'budget-vs-actual',
    title: 'Budget vs Actual',
    group: 'Project & Cost',
    permission: 'budget.view',
    description: 'Approved budget against cost incurred per cost code.',
    async run(p) {
      const { p: pos, rows } = await positionRows(p.projectId, p.to);
      const out = rows.map((r) => ({ ...r, spentPct: D(r.approvedBudget).isZero() ? null : D(r.incurred).div(D(r.approvedBudget)).toFixed(4), diff: money(D(r.approvedBudget).minus(D(r.incurred))) }));
      return {
        columns: [positionCols[0], positionCols[1], { key: 'originalBudget', label: 'Original', type: 'money' }, positionCols[3], { key: 'actual', label: 'Actual', type: 'money' }, { key: 'accrued', label: 'Accrued', type: 'money' }, positionCols[4], { key: 'diff', label: 'Budget − incurred', type: 'money' }, { key: 'spentPct', label: '% spent', type: 'pct' }],
        rows: out,
        totals: { code: 'TOTAL', ...pos.total, diff: money(D(pos.total.approvedBudget).minus(D(pos.total.incurred))) },
      };
    },
  },
  {
    key: 'budget-actual-forecast',
    title: 'Budget vs Actual vs Forecast',
    group: 'Project & Cost',
    permission: 'forecast.view',
    description: 'Full cost position per cost code including ETC and EAC.',
    async run(p) {
      const { p: pos, rows } = await positionRows(p.projectId, p.to);
      return { columns: positionCols, rows, totals: { code: 'TOTAL', ...pos.total } };
    },
  },
  {
    key: 'cost-code-variance',
    title: 'Cost Code Variance',
    group: 'Project & Cost',
    permission: 'budget.view',
    description: 'Cost codes ordered by variance (worst first).',
    async run(p) {
      const { rows } = await positionRows(p.projectId, p.to);
      return { columns: positionCols, rows: rows.sort((a, b) => D(a.costVariance).cmp(D(b.costVariance))) };
    },
  },
  {
    key: 'cost-overrun',
    title: 'Cost Overrun Analysis',
    group: 'Project & Cost',
    permission: 'budget.view',
    description: 'Cost codes at warning or critical level.',
    async run(p) {
      const { rows } = await positionRows(p.projectId, p.to);
      const r = rows.filter((x) => x.alert !== 'OK');
      return { columns: [...positionCols, { key: 'pending', label: 'Pending (unapproved)', type: 'money' }, { key: 'assumptions', label: 'Forecast assumptions' }], rows: r, notes: r.length ? [] : ['No cost code is at warning or critical level.'] };
    },
  },
  {
    key: 'cost-to-complete',
    title: 'Cost-to-Complete / EAC-ETC',
    group: 'Project & Cost',
    permission: 'forecast.view',
    description: 'ETC, method and documented assumptions per cost code.',
    async run(p) {
      const { p: pos, rows } = await positionRows(p.projectId);
      return {
        columns: [positionCols[0], positionCols[1], positionCols[4], positionCols[5], { key: 'uncommittedEtc', label: 'Uncommitted ETC', type: 'money' }, positionCols[6], positionCols[7], { key: 'forecastMethod', label: 'Method', type: 'status' }, { key: 'forecastPeriod', label: 'Period' }, { key: 'assumptions', label: 'Assumptions' }],
        rows,
        totals: { code: 'TOTAL', ...pos.total },
      };
    },
  },
  {
    key: 'forecast-history',
    title: 'Historical Forecasts',
    group: 'Project & Cost',
    permission: 'forecast.view',
    description: 'EAC snapshots recorded per period.',
    async run(p) {
      const rows = await prisma.costForecast.groupBy({ by: ['periodCode'], where: { projectId: p.projectId }, _sum: { eacSnapshot: true, uncommittedEtc: true }, _count: true, orderBy: { periodCode: 'asc' } });
      return { columns: [{ key: 'periodCode', label: 'Period' }, { key: 'entries', label: 'Cost codes forecast', type: 'int' }, { key: 'uncommittedEtc', label: 'Uncommitted ETC', type: 'money' }, { key: 'eac', label: 'EAC (forecast codes)', type: 'money' }], rows: rows.map((r) => ({ periodCode: r.periodCode, entries: r._count, uncommittedEtc: money(r._sum.uncommittedEtc ?? 0), eac: money(r._sum.eacSnapshot ?? 0) })), notes: ['EAC here sums only cost codes that had a forecast entry in the period.'] };
    },
  },
  {
    key: 'monthly-cost',
    title: 'Monthly Cost Report',
    group: 'Project & Cost',
    permission: 'budget.view',
    description: 'Ledger movements by month and kind.',
    dateFilter: true,
    async run(p) {
      const rows = await prisma.costLedgerEntry.findMany({ where: { projectId: p.projectId, ...dr(p) }, select: { date: true, kind: true, amount: true } });
      const by = new Map<string, Record<string, ReturnType<typeof D>>>();
      for (const r of rows) {
        const m = periodCode(r.date);
        const cur = by.get(m) ?? { ACTUAL: D(0), ACCRUAL: D(0), COMMITMENT: D(0) };
        cur[r.kind] = cur[r.kind].plus(D(r.amount));
        by.set(m, cur);
      }
      const out = [...by.entries()].sort().map(([month, v]) => ({ month, actual: money(v.ACTUAL), accrued: money(v.ACCRUAL), incurred: money(v.ACTUAL.plus(v.ACCRUAL)), commitmentMovement: money(v.COMMITMENT) }));
      return { columns: [{ key: 'month', label: 'Month' }, { key: 'actual', label: 'Actual', type: 'money' }, { key: 'accrued', label: 'Accrual movement', type: 'money' }, { key: 'incurred', label: 'Cost incurred', type: 'money' }, { key: 'commitmentMovement', label: 'Commitment movement', type: 'money' }], rows: out, totals: { month: 'TOTAL', ...totalOf(out, ['actual', 'accrued', 'incurred', 'commitmentMovement']) } };
    },
  },
  {
    key: 'earned-value',
    title: 'Earned Value Report',
    group: 'Project & Cost',
    permission: 'forecast.view',
    description: 'PV, EV, AC, CPI and SPI with calculation notes.',
    async run(p) {
      const pos = await projectCostPositions(prisma, p.projectId);
      const acts = await prisma.activity.findMany({ where: { projectId: p.projectId }, select: { weight: true, percentComplete: true, baselineStart: true, baselineFinish: true } });
      const e = computeEvm(acts, pos.total.approvedBudget, pos.total.incurred, p.to ?? today());
      return {
        columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }, { key: 'source', label: 'Source' }],
        rows: [
          { metric: 'Budget at completion (BAC)', value: pos.total.approvedBudget, source: 'Approved budget' },
          { metric: 'Planned value (PV)', value: e.pv ?? 'Not calculable', source: 'Activity baselines × weights' },
          { metric: 'Earned value (EV)', value: e.ev ?? 'Not calculable', source: 'Activity % complete × weights' },
          { metric: 'Actual cost (AC)', value: e.ac, source: 'Cost incurred (actual + accrued)' },
          { metric: 'CPI', value: e.cpi ?? 'Not calculable', source: 'EV ÷ AC' },
          { metric: 'SPI', value: e.spi ?? 'Not calculable', source: 'EV ÷ PV' },
          { metric: 'Physical progress', value: e.physicalPct ? `${(Number(e.physicalPct) * 100).toFixed(1)}%` : 'Not calculable', source: 'Weighted activity progress' },
        ],
        notes: e.notes,
      };
    },
  },
  {
    key: 'cvr',
    title: 'Cost Value Reconciliation (CVR)',
    group: 'Project & Cost',
    permission: 'forecast.view',
    description: 'Value earned (client certified + approved variations) against cost incurred.',
    async run(p) {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: p.projectId } });
      const pos = await projectCostPositions(prisma, p.projectId);
      const lastCert = await prisma.clientBill.findFirst({ where: { projectId: p.projectId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID', 'PAID'] } }, orderBy: { billSeq: 'desc' } });
      const vo = await prisma.variation.aggregate({ where: { projectId: p.projectId, status: 'APPROVED' }, _sum: { approvedValue: true } });
      const unbilledCertified = await prisma.measurement.findMany({ where: { projectId: p.projectId, status: 'CERTIFIED', clientBillId: null }, include: { boqItem: { select: { unitRate: true, revisedRate: true } } } });
      const unbilledValue = sum(unbilledCertified.map((m) => D(m.verifiedQty ?? 0).times(D(m.boqItem.revisedRate ?? m.boqItem.unitRate))));
      const value = D(lastCert?.grossToDate ?? 0).plus(unbilledValue);
      const revisedContract = D(project.contractValue).plus(D(vo._sum.approvedValue ?? 0));
      const rows = [
        { item: 'Revised contract value', amount: money(revisedContract) },
        { item: 'Gross value certified by client to date', amount: money(lastCert?.grossToDate ?? 0) },
        { item: 'Certified work not yet billed to client', amount: money(unbilledValue) },
        { item: 'Total value earned', amount: money(value) },
        { item: 'Cost incurred to date', amount: pos.total.incurred },
        { item: 'Margin to date (value − cost)', amount: money(value.minus(D(pos.total.incurred))) },
        { item: 'Forecast final cost (EAC)', amount: pos.total.eac },
        { item: 'Forecast final margin', amount: money(revisedContract.minus(D(pos.total.eac))) },
      ];
      return { columns: [{ key: 'item', label: 'Item' }, { key: 'amount', label: 'Amount', type: 'money' }], rows, notes: ['Value excludes tax, unapproved variations and claims.'] };
    },
  },
  {
    key: 'project-profitability',
    title: 'Project Profitability',
    group: 'Project & Cost',
    permission: 'forecast.view',
    description: 'Revised contract value vs EAC and projected margin.',
    async run(p) {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: p.projectId } });
      const pos = await projectCostPositions(prisma, p.projectId);
      const vo = await prisma.variation.aggregate({ where: { projectId: p.projectId, status: 'APPROVED' }, _sum: { approvedValue: true } });
      const revenue = D(project.contractValue).plus(D(vo._sum.approvedValue ?? 0));
      const margin = revenue.minus(D(pos.total.eac));
      return {
        columns: [{ key: 'item', label: 'Item' }, { key: 'amount', label: 'Amount', type: 'money' }],
        rows: [
          { item: 'Original contract value', amount: money(project.contractValue) },
          { item: 'Approved variations', amount: money(vo._sum.approvedValue ?? 0) },
          { item: 'Revised contract value', amount: money(revenue) },
          { item: 'Approved budget (BAC)', amount: pos.total.approvedBudget },
          { item: 'Forecast final cost (EAC)', amount: pos.total.eac },
          { item: 'Projected margin', amount: money(margin) },
          { item: 'Projected margin %', amount: revenue.isZero() ? '—' : `${margin.div(revenue).times(100).toFixed(2)}%` },
        ],
      };
    },
  },
  {
    key: 'cash-flow',
    title: 'Cash Flow Forecast',
    group: 'Project & Cost',
    permission: 'cashflow.view',
    description: 'Planned vs actual inflow and outflow by month.',
    async run(p) {
      const [plans, pays] = await Promise.all([prisma.cashFlowPlan.findMany({ where: { projectId: p.projectId }, orderBy: { month: 'asc' } }), prisma.payment.findMany({ where: { projectId: p.projectId, status: 'APPROVED' } })]);
      const months = [...new Set([...plans.map((x) => x.month), ...pays.map((x) => periodCode(x.date))])].sort();
      let cum = D(0);
      const rows = months.map((m) => {
        const pl = plans.find((x) => x.month === m);
        const inn = sum(pays.filter((x) => x.direction === 'IN' && periodCode(x.date) === m).map((x) => x.amount));
        const out = sum(pays.filter((x) => x.direction === 'OUT' && periodCode(x.date) === m).map((x) => x.amount));
        cum = cum.plus(inn).minus(out);
        return { month: m, plannedInflow: money(pl?.plannedInflow ?? 0), actualInflow: money(inn), plannedOutflow: money(pl?.plannedOutflow ?? 0), actualOutflow: money(out), net: money(inn.minus(out)), cumulative: money(cum) };
      });
      return { columns: [{ key: 'month', label: 'Month' }, { key: 'plannedInflow', label: 'Planned in', type: 'money' }, { key: 'actualInflow', label: 'Actual in', type: 'money' }, { key: 'plannedOutflow', label: 'Planned out', type: 'money' }, { key: 'actualOutflow', label: 'Actual out', type: 'money' }, { key: 'net', label: 'Net', type: 'money' }, { key: 'cumulative', label: 'Cumulative', type: 'money' }], rows };
    },
  },
  // ───────── Manpower & progress ─────────
  {
    key: 'daily-manpower',
    title: 'Daily Manpower Report',
    group: 'Manpower & Progress',
    permission: 'manpower.view',
    description: 'Manpower lines by date, contractor and trade.',
    dateFilter: true,
    async run(p) {
      const reps = await prisma.manpowerReport.findMany({ where: { projectId: p.projectId, ...dr(p) }, include: { lines: true, contractor: { select: { name: true } } }, orderBy: { date: 'desc' } });
      const rows = reps.flatMap((r) => r.lines.map((l) => ({ date: isoDate(r.date), number: r.number, shift: r.shift, contractor: r.contractor?.name ?? 'Own labour', trade: l.trade, category: humanize(l.category), planned: l.plannedCount, actual: l.actualCount, regularHours: l.regularHours, overtimeHours: l.overtimeHours, cost: l.amount, status: r.status })));
      return { columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'number', label: 'MPR' }, { key: 'shift', label: 'Shift' }, { key: 'contractor', label: 'Contractor' }, { key: 'trade', label: 'Trade' }, { key: 'category', label: 'Category' }, { key: 'planned', label: 'Planned', type: 'int' }, { key: 'actual', label: 'Actual', type: 'int' }, { key: 'regularHours', label: 'Reg hrs', type: 'qty' }, { key: 'overtimeHours', label: 'OT hrs', type: 'qty' }, { key: 'cost', label: 'Cost', type: 'money' }, { key: 'status', label: 'Status', type: 'status' }], rows, totals: { date: 'TOTAL', planned: rows.reduce((a, r) => a + r.planned, 0), actual: rows.reduce((a, r) => a + r.actual, 0), cost: money(sum(rows.map((r) => r.cost))) } };
    },
  },
  {
    key: 'labour-cost',
    title: 'Labour Cost Report',
    group: 'Manpower & Progress',
    permission: 'manpower.view',
    description: 'Labour cost and man-days by trade.',
    dateFilter: true,
    async run(p) {
      const lines = await prisma.manpowerLine.findMany({ where: { report: { projectId: p.projectId, ...dr(p) } }, include: { report: { select: { status: true } } } });
      const by = new Map<string, { workers: number; regular: ReturnType<typeof D>; ot: ReturnType<typeof D>; cost: ReturnType<typeof D>; verified: ReturnType<typeof D> }>();
      for (const l of lines) {
        const c = by.get(l.trade) ?? { workers: 0, regular: D(0), ot: D(0), cost: D(0), verified: D(0) };
        c.workers += l.actualCount;
        c.regular = c.regular.plus(D(l.regularHours).times(l.actualCount));
        c.ot = c.ot.plus(D(l.overtimeHours).times(l.actualCount));
        c.cost = c.cost.plus(D(l.amount));
        if (l.report.status === 'VERIFIED') c.verified = c.verified.plus(D(l.amount));
        by.set(l.trade, c);
      }
      const rows = [...by.entries()].map(([trade, c]) => ({ trade, manDays: c.workers, regularHours: c.regular.toFixed(1), overtimeHours: c.ot.toFixed(1), cost: money(c.cost), verifiedCost: money(c.verified) }));
      return { columns: [{ key: 'trade', label: 'Trade' }, { key: 'manDays', label: 'Man-days', type: 'int' }, { key: 'regularHours', label: 'Regular man-hours', type: 'qty' }, { key: 'overtimeHours', label: 'OT man-hours', type: 'qty' }, { key: 'cost', label: 'Reported cost', type: 'money' }, { key: 'verifiedCost', label: 'Verified cost', type: 'money' }], rows, totals: { trade: 'TOTAL', ...totalOf(rows, ['cost', 'verifiedCost']) }, notes: ['Only verified own-labour cost is posted to the cost ledger.'] };
    },
  },
  {
    key: 'attendance-overtime',
    title: 'Attendance & Overtime',
    group: 'Manpower & Progress',
    permission: 'manpower.view',
    description: 'Attendance records with overtime and corrections.',
    dateFilter: true,
    async run(p) {
      const recs = await prisma.attendanceRecord.findMany({ where: { projectId: p.projectId, ...dr(p) }, include: { worker: { select: { name: true, workerCode: true, trade: true } } }, orderBy: [{ date: 'desc' }] });
      return { columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'code', label: 'Worker ID' }, { key: 'name', label: 'Name' }, { key: 'trade', label: 'Trade' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'regularHours', label: 'Reg hrs', type: 'qty' }, { key: 'overtimeHours', label: 'OT hrs', type: 'qty' }, { key: 'correction', label: 'Correction reason' }], rows: recs.map((r) => ({ date: isoDate(r.date), code: r.worker.workerCode, name: r.worker.name, trade: r.worker.trade, status: r.status, regularHours: r.regularHours, overtimeHours: r.overtimeHours, correction: r.correctionReason })) };
    },
  },
  {
    key: 'labour-productivity',
    title: 'Labour Productivity',
    group: 'Manpower & Progress',
    permission: 'progress.view',
    description: 'Executed quantity per man-hour by activity.',
    async run(p) {
      const acts = await prisma.activity.findMany({ where: { projectId: p.projectId } });
      const lines = await prisma.manpowerLine.findMany({ where: { report: { projectId: p.projectId }, activityId: { not: null } } });
      const rows = acts
        .map((a) => {
          const mh = sum(lines.filter((l) => l.activityId === a.id).map((l) => D(l.regularHours).plus(D(l.overtimeHours)).times(l.actualCount)));
          return { code: a.code, activity: a.name, unit: a.unit, executedQty: a.executedQty, manHours: mh.toFixed(1), productivity: mh.isZero() ? null : D(a.executedQty).div(mh).toFixed(4) };
        })
        .filter((r) => D(r.manHours).gt(0));
      return { columns: [{ key: 'code', label: 'Code' }, { key: 'activity', label: 'Activity' }, { key: 'unit', label: 'Unit' }, { key: 'executedQty', label: 'Executed qty', type: 'qty' }, { key: 'manHours', label: 'Man-hours', type: 'qty' }, { key: 'productivity', label: 'Qty / man-hour', type: 'qty' }], rows, notes: rows.length ? [] : ['Productivity needs manpower lines linked to activities.'] };
    },
  },
  {
    key: 'daily-progress',
    title: 'Daily Progress Report Register',
    group: 'Manpower & Progress',
    permission: 'diary.view',
    description: 'Site diaries with weather, stoppages and delays.',
    dateFilter: true,
    async run(p) {
      const rows = await prisma.siteDiary.findMany({ where: { projectId: p.projectId, ...dr(p) }, orderBy: { date: 'desc' } });
      return { columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'number', label: 'DPR' }, { key: 'shift', label: 'Shift' }, { key: 'weather', label: 'Weather' }, { key: 'activitiesPerformed', label: 'Activities' }, { key: 'workStoppages', label: 'Stoppages' }, { key: 'delays', label: 'Delays' }, { key: 'status', label: 'Status', type: 'status' }], rows: rows.map((r) => ({ ...r, date: isoDate(r.date) })) };
    },
  },
  {
    key: 'planned-vs-actual',
    title: 'Planned vs Actual Progress',
    group: 'Manpower & Progress',
    permission: 'progress.view',
    description: 'Activity planned vs actual dates and completion.',
    async run(p) {
      const acts = await prisma.activity.findMany({ where: { projectId: p.projectId }, orderBy: { sortOrder: 'asc' } });
      const now = p.to ?? today();
      return {
        columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Activity' }, { key: 'plannedStart', label: 'Planned start', type: 'date' }, { key: 'plannedFinish', label: 'Planned finish', type: 'date' }, { key: 'actualStart', label: 'Actual start', type: 'date' }, { key: 'actualFinish', label: 'Actual finish', type: 'date' }, { key: 'plannedPct', label: 'Planned %', type: 'qty' }, { key: 'percentComplete', label: 'Actual %', type: 'qty' }, { key: 'scheduleVarianceDays', label: 'Finish variance (days)', type: 'int' }, { key: 'status', label: 'Status', type: 'status' }],
        rows: acts.map((a) => {
          const ps = a.baselineStart ?? a.plannedStart;
          const pf = a.baselineFinish ?? a.plannedFinish;
          const planned = ps && pf ? Math.min(100, Math.max(0, ((now.getTime() - ps.getTime()) / Math.max(1, pf.getTime() - ps.getTime())) * 100)) : null;
          const finish = a.actualFinish ?? a.plannedFinish;
          return { ...a, plannedStart: isoDate(a.plannedStart), plannedFinish: isoDate(a.plannedFinish), actualStart: isoDate(a.actualStart), actualFinish: isoDate(a.actualFinish), plannedPct: planned === null ? null : planned.toFixed(1), scheduleVarianceDays: a.baselineFinish && finish ? Math.round((finish.getTime() - a.baselineFinish.getTime()) / 86_400_000) : null };
        }),
      };
    },
  },
  {
    key: 'delay-report',
    title: 'Delay & Lost-Time Report',
    group: 'Manpower & Progress',
    permission: 'progress.view',
    description: 'Delays recorded on activities and progress entries.',
    dateFilter: true,
    async run(p) {
      const [acts, entries] = await Promise.all([prisma.activity.findMany({ where: { projectId: p.projectId, delayReason: { not: null } } }), prisma.progressEntry.findMany({ where: { projectId: p.projectId, delayReason: { not: null }, ...dr(p) }, include: { activity: { select: { code: true, name: true } } } })]);
      const rows = [
        ...acts.map((a) => ({ date: null, source: 'Activity', activity: `${a.code} ${a.name}`, reason: a.delayReason, party: a.delayParty, delayCost: a.delayCost })),
        ...entries.map((e) => ({ date: isoDate(e.date), source: 'Progress entry', activity: `${e.activity.code} ${e.activity.name}`, reason: e.delayReason, party: e.responsibleParty, delayCost: null })),
      ];
      return { columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'source', label: 'Source' }, { key: 'activity', label: 'Activity' }, { key: 'reason', label: 'Reason' }, { key: 'party', label: 'Responsible party' }, { key: 'delayCost', label: 'Delay cost', type: 'money' }], rows };
    },
  },
  // ───────── Materials & procurement ─────────
  ...(['mr', 'pr', 'po', 'grn'] as const).map(
    (kind): ReportDef => ({
      key: `${kind}-register`,
      title: `${kind.toUpperCase()} Register`,
      group: 'Materials & Procurement',
      permission: kind === 'grn' ? 'receiving.view' : 'procurement.view',
      description: `All ${kind.toUpperCase()} documents with status.`,
      dateFilter: true,
      async run(p) {
        if (kind === 'mr') {
          const rows = await prisma.materialRequisition.findMany({ where: { projectId: p.projectId, ...dr(p, 'requiredBy') }, include: { lines: true, requestedBy: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
          return { columns: [{ key: 'number', label: 'MR' }, { key: 'requiredBy', label: 'Required by', type: 'date' }, { key: 'requestedBy', label: 'Requested by' }, { key: 'lines', label: 'Items', type: 'int' }, { key: 'priority', label: 'Priority', type: 'status' }, { key: 'status', label: 'Status', type: 'status' }], rows: rows.map((r) => ({ number: r.number, requiredBy: isoDate(r.requiredBy), requestedBy: r.requestedBy.name, lines: r.lines.length, priority: r.priority, status: r.status })) };
        }
        if (kind === 'pr') {
          const rows = await prisma.purchaseRequisition.findMany({ where: { projectId: p.projectId, ...dr(p, 'requiredBy') }, include: { mr: { select: { number: true } } }, orderBy: { createdAt: 'desc' } });
          return { columns: [{ key: 'number', label: 'PR' }, { key: 'mr', label: 'MR' }, { key: 'requiredBy', label: 'Required by', type: 'date' }, { key: 'estimatedTotal', label: 'Estimated', type: 'money' }, { key: 'budgetExceeded', label: 'Budget check' }, { key: 'status', label: 'Status', type: 'status' }], rows: rows.map((r) => ({ number: r.number, mr: r.mr?.number, requiredBy: isoDate(r.requiredBy), estimatedTotal: r.estimatedTotal, budgetExceeded: r.budgetCheck ? ((r.budgetCheck as any).exceeded ? 'Exceeded' : 'Within budget') : '—', status: r.status })), totals: { number: 'TOTAL', estimatedTotal: money(sum(rows.map((r) => r.estimatedTotal))) } };
        }
        if (kind === 'po') {
          const rows = await prisma.purchaseOrder.findMany({ where: { projectId: p.projectId, ...dr(p, 'orderDate') }, include: { supplier: { select: { name: true } } }, orderBy: { orderDate: 'desc' } });
          return { columns: [{ key: 'number', label: 'PO' }, { key: 'orderDate', label: 'Date', type: 'date' }, { key: 'supplier', label: 'Supplier' }, { key: 'netAmount', label: 'Net', type: 'money' }, { key: 'total', label: 'Total incl. tax', type: 'money' }, { key: 'deliveryDate', label: 'Delivery', type: 'date' }, { key: 'status', label: 'Status', type: 'status' }], rows: rows.map((r) => ({ number: r.number, orderDate: isoDate(r.orderDate), supplier: r.supplier.name, netAmount: r.netAmount, total: r.total, deliveryDate: isoDate(r.deliveryDate), status: r.status })), totals: { number: 'TOTAL', netAmount: money(sum(rows.map((r) => r.netAmount))), total: money(sum(rows.map((r) => r.total))) } };
        }
        const rows = await prisma.grn.findMany({ where: { projectId: p.projectId, ...dr(p, 'receivedDate') }, include: { supplier: { select: { name: true } }, po: { select: { number: true } } }, orderBy: { receivedDate: 'desc' } });
        return { columns: [{ key: 'number', label: 'GRN' }, { key: 'receivedDate', label: 'Received', type: 'date' }, { key: 'po', label: 'PO' }, { key: 'supplier', label: 'Supplier' }, { key: 'deliveryNoteNo', label: 'Delivery note' }, { key: 'acceptedValue', label: 'Accepted value', type: 'money' }, { key: 'inspectionStatus', label: 'Inspection', type: 'status' }, { key: 'status', label: 'Status', type: 'status' }], rows: rows.map((r) => ({ ...r, receivedDate: isoDate(r.receivedDate), po: r.po.number, supplier: r.supplier.name })), totals: { number: 'TOTAL', acceptedValue: money(sum(rows.map((r) => r.acceptedValue))) } };
      },
    }),
  ),
  {
    key: 'pending-procurement',
    title: 'Pending Procurement & Delivery Delays',
    group: 'Materials & Procurement',
    permission: 'procurement.view',
    description: 'Approved MRs without PR, approved PRs without PO, overdue deliveries.',
    async run(p) {
      const [mrs, prs, pos] = await Promise.all([
        prisma.materialRequisition.findMany({ where: { projectId: p.projectId, status: 'APPROVED' } }),
        prisma.purchaseRequisition.findMany({ where: { projectId: p.projectId, status: 'APPROVED' } }),
        prisma.purchaseOrder.findMany({ where: { projectId: p.projectId, status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } }, include: { supplier: { select: { name: true } } } }),
      ]);
      const prMrIds = new Set((await prisma.purchaseRequisition.findMany({ where: { projectId: p.projectId, mrId: { not: null }, status: { notIn: ['REJECTED', 'CANCELLED'] } }, select: { mrId: true } })).map((x) => x.mrId));
      const poPrIds = new Set((await prisma.purchaseOrder.findMany({ where: { projectId: p.projectId, prId: { not: null }, status: { notIn: ['REJECTED', 'CANCELLED'] } }, select: { prId: true } })).map((x) => x.prId));
      const now = today();
      const rows = [
        ...mrs.filter((m) => !prMrIds.has(m.id)).map((m) => ({ stage: 'MR approved — no PR', number: m.number, party: '', dueDate: isoDate(m.requiredBy), daysLate: m.requiredBy < now ? Math.round((now.getTime() - m.requiredBy.getTime()) / 86_400_000) : 0 })),
        ...prs.filter((r) => !poPrIds.has(r.id)).map((r) => ({ stage: 'PR approved — no PO', number: r.number, party: '', dueDate: isoDate(r.requiredBy), daysLate: r.requiredBy < now ? Math.round((now.getTime() - r.requiredBy.getTime()) / 86_400_000) : 0 })),
        ...pos.map((o) => ({ stage: o.deliveryDate && o.deliveryDate < now ? 'Delivery overdue' : 'Awaiting delivery', number: o.number, party: o.supplier.name, dueDate: isoDate(o.deliveryDate), daysLate: o.deliveryDate && o.deliveryDate < now ? Math.round((now.getTime() - o.deliveryDate.getTime()) / 86_400_000) : 0 })),
      ];
      return { columns: [{ key: 'stage', label: 'Stage' }, { key: 'number', label: 'Document' }, { key: 'party', label: 'Supplier' }, { key: 'dueDate', label: 'Required / due', type: 'date' }, { key: 'daysLate', label: 'Days late', type: 'int' }], rows: rows.sort((a, b) => b.daysLate - a.daysLate) };
    },
  },
  {
    key: 'pending-commitments',
    title: 'Pending Commitments',
    group: 'Materials & Procurement',
    permission: 'procurement.view',
    description: 'Open commitment balance by source document.',
    async run(p) {
      const g = await prisma.costLedgerEntry.groupBy({ by: ['sourceType', 'sourceId', 'sourceNumber', 'partyId'], where: { projectId: p.projectId, kind: 'COMMITMENT', sourceType: { in: ['PO', 'SUBCONTRACT'] } }, _sum: { amount: true } });
      const parties = await partyNames(g.map((x) => x.partyId));
      const rows = g.filter((x) => D(x._sum.amount ?? 0).gt(0)).map((x) => ({ type: x.sourceType, number: x.sourceNumber, party: parties.get(x.partyId ?? '') ?? '', openCommitment: money(x._sum.amount ?? 0) }));
      return { columns: [{ key: 'type', label: 'Type' }, { key: 'number', label: 'Document' }, { key: 'party', label: 'Party' }, { key: 'openCommitment', label: 'Open commitment', type: 'money' }], rows, totals: { type: 'TOTAL', ...totalOf(rows, ['openCommitment']) } };
    },
  },
  {
    key: 'material-consumption',
    title: 'Material Consumption',
    group: 'Materials & Procurement',
    permission: 'stock.view',
    description: 'Issues by material and cost code.',
    dateFilter: true,
    async run(p) {
      const tx = await prisma.stockTransaction.findMany({ where: { projectId: p.projectId, type: { in: ['ISSUE', 'RETURN_TO_STORE'] }, ...dr(p) } });
      const mats = new Map((await prisma.material.findMany({ where: { id: { in: tx.map((t) => t.materialId) } } })).map((m) => [m.id, m]));
      const by = new Map<string, { qty: ReturnType<typeof D>; value: ReturnType<typeof D> }>();
      for (const t of tx) {
        const c = by.get(t.materialId) ?? { qty: D(0), value: D(0) };
        c.qty = c.qty.minus(D(t.qty));
        c.value = c.value.minus(D(t.value));
        by.set(t.materialId, c);
      }
      const rows = [...by.entries()].map(([id, c]) => ({ code: mats.get(id)?.code, name: mats.get(id)?.name, unit: mats.get(id)?.unit, consumedQty: c.qty.toFixed(3), value: money(c.value) }));
      return { columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Material' }, { key: 'unit', label: 'Unit' }, { key: 'consumedQty', label: 'Net issued', type: 'qty' }, { key: 'value', label: 'Value (WAC)', type: 'money' }], rows, totals: { code: 'TOTAL', ...totalOf(rows, ['value']) } };
    },
  },
  {
    key: 'stock-valuation',
    title: 'Stock Valuation',
    group: 'Materials & Procurement',
    permission: 'stock.view',
    description: 'Balance quantity and value per store (weighted average cost).',
    async run(p) {
      const g = await prisma.stockTransaction.groupBy({ by: ['storeId', 'materialId'], where: { projectId: p.projectId, ...(p.to ? { date: { lte: p.to } } : {}) }, _sum: { qty: true, value: true } });
      const mats = new Map((await prisma.material.findMany({ where: { id: { in: g.map((x) => x.materialId) } } })).map((m) => [m.id, m]));
      const stores = new Map((await prisma.store.findMany({ where: { projectId: p.projectId } })).map((s) => [s.id, s.name]));
      const rows = g.filter((x) => !D(x._sum.qty ?? 0).isZero()).map((x) => ({ store: stores.get(x.storeId), code: mats.get(x.materialId)?.code, name: mats.get(x.materialId)?.name, unit: mats.get(x.materialId)?.unit, qty: D(x._sum.qty ?? 0).toFixed(3), avgCost: D(x._sum.value ?? 0).div(D(x._sum.qty ?? 1)).toFixed(4), value: money(x._sum.value ?? 0) }));
      return { columns: [{ key: 'store', label: 'Store' }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Material' }, { key: 'unit', label: 'Unit' }, { key: 'qty', label: 'Balance', type: 'qty' }, { key: 'avgCost', label: 'Avg cost', type: 'qty' }, { key: 'value', label: 'Value', type: 'money' }], rows, totals: { store: 'TOTAL', ...totalOf(rows, ['value']) } };
    },
  },
  {
    key: 'stock-ledger',
    title: 'Stock Ledger',
    group: 'Materials & Procurement',
    permission: 'stock.view',
    description: 'Every stock movement in the period.',
    dateFilter: true,
    async run(p) {
      const tx = await prisma.stockTransaction.findMany({ where: { projectId: p.projectId, ...dr(p) }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], take: 5000 });
      const mats = new Map((await prisma.material.findMany({ where: { id: { in: tx.map((t) => t.materialId) } } })).map((m) => [m.id, m]));
      return { columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'type', label: 'Type', type: 'status' }, { key: 'material', label: 'Material' }, { key: 'qty', label: 'Qty', type: 'qty' }, { key: 'unitCost', label: 'Unit cost', type: 'qty' }, { key: 'value', label: 'Value', type: 'money' }, { key: 'ref', label: 'Reference' }, { key: 'reason', label: 'Reason' }], rows: tx.map((t) => ({ date: isoDate(t.date), type: t.type, material: `${mats.get(t.materialId)?.code} ${mats.get(t.materialId)?.name}`, qty: t.qty, unitCost: t.unitCost, value: t.value, ref: t.refNumber, reason: t.reason })) };
    },
  },
  {
    key: 'material-wastage',
    title: 'Material Wastage & Damage',
    group: 'Materials & Procurement',
    permission: 'stock.view',
    description: 'Wastage and damage movements.',
    dateFilter: true,
    async run(p) {
      const tx = await prisma.stockTransaction.findMany({ where: { projectId: p.projectId, type: { in: ['WASTAGE', 'DAMAGE'] }, ...dr(p) }, orderBy: { date: 'desc' } });
      const mats = new Map((await prisma.material.findMany({ where: { id: { in: tx.map((t) => t.materialId) } } })).map((m) => [m.id, m]));
      const rows = tx.map((t) => ({ date: isoDate(t.date), type: t.type, material: mats.get(t.materialId)?.name, qty: D(t.qty).neg().toFixed(3), value: money(D(t.value).neg()), reason: t.reason, ref: t.refNumber }));
      return { columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'type', label: 'Type', type: 'status' }, { key: 'material', label: 'Material' }, { key: 'qty', label: 'Qty', type: 'qty' }, { key: 'value', label: 'Value', type: 'money' }, { key: 'reason', label: 'Reason' }, { key: 'ref', label: 'Ref' }], rows, totals: { date: 'TOTAL', ...totalOf(rows, ['value']) } };
    },
  },
  {
    key: 'supplier-performance',
    title: 'Supplier Performance',
    group: 'Materials & Procurement',
    permission: 'procurement.view',
    description: 'Order value, on-time delivery and rejection rates per supplier.',
    async run(p) {
      const pos = await prisma.purchaseOrder.findMany({ where: { projectId: p.projectId, status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED', 'SUBMITTED', 'RETURNED'] } }, include: { supplier: { select: { name: true } } } });
      const grns = await prisma.grn.findMany({ where: { projectId: p.projectId, status: 'APPROVED' }, include: { lines: true, po: { select: { deliveryDate: true } } } });
      const sup = new Map<string, { name: string; pos: number; value: ReturnType<typeof D>; grns: number; onTime: number; received: ReturnType<typeof D>; rejected: ReturnType<typeof D> }>();
      for (const o of pos) {
        const s = sup.get(o.supplierId) ?? { name: o.supplier.name, pos: 0, value: D(0), grns: 0, onTime: 0, received: D(0), rejected: D(0) };
        s.pos++;
        s.value = s.value.plus(D(o.netAmount));
        sup.set(o.supplierId, s);
      }
      for (const g of grns) {
        const s = sup.get(g.supplierId);
        if (!s) continue;
        s.grns++;
        if (!g.po.deliveryDate || g.receivedDate <= g.po.deliveryDate) s.onTime++;
        s.received = s.received.plus(sum(g.lines.map((l) => l.receivedQty)));
        s.rejected = s.rejected.plus(sum(g.lines.map((l) => l.rejectedQty)));
      }
      const rows = [...sup.values()].map((s) => ({ supplier: s.name, pos: s.pos, value: money(s.value), deliveries: s.grns, onTimePct: s.grns ? (s.onTime / s.grns).toFixed(4) : null, rejectionPct: s.received.isZero() ? null : s.rejected.div(s.received).toFixed(4) }));
      return { columns: [{ key: 'supplier', label: 'Supplier' }, { key: 'pos', label: 'POs', type: 'int' }, { key: 'value', label: 'Order value', type: 'money' }, { key: 'deliveries', label: 'Deliveries', type: 'int' }, { key: 'onTimePct', label: 'On time', type: 'pct' }, { key: 'rejectionPct', label: 'Rejected qty', type: 'pct' }], rows };
    },
  },
  {
    key: 'po-grn-invoice',
    title: 'PO–GRN–Invoice Reconciliation',
    group: 'Materials & Procurement',
    permission: 'procurement.view',
    description: 'Ordered, received and invoiced quantity per PO line.',
    async run(p) {
      const lines = await prisma.purchaseOrderLine.findMany({ where: { po: { projectId: p.projectId, status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED'] } } }, include: { po: { select: { number: true, supplier: { select: { name: true } } } } }, orderBy: [{ po: { number: 'asc' } }, { lineNo: 'asc' }] });
      const rows = lines.map((l) => ({ po: l.po.number, supplier: l.po.supplier.name, line: l.lineNo, description: l.description, ordered: l.qty, received: l.receivedQty, invoiced: l.invoicedQty, toReceive: D(l.qty).minus(D(l.receivedQty)).toFixed(3), receivedNotInvoiced: D(l.receivedQty).minus(D(l.invoicedQty)).toFixed(3), flag: D(l.invoicedQty).gt(D(l.receivedQty)) ? 'Invoiced > received' : D(l.receivedQty).gt(D(l.qty)) ? 'Over-received' : '' }));
      return { columns: [{ key: 'po', label: 'PO' }, { key: 'supplier', label: 'Supplier' }, { key: 'line', label: 'Line', type: 'int' }, { key: 'description', label: 'Description' }, { key: 'ordered', label: 'Ordered', type: 'qty' }, { key: 'received', label: 'Received', type: 'qty' }, { key: 'invoiced', label: 'Invoiced', type: 'qty' }, { key: 'toReceive', label: 'To receive', type: 'qty' }, { key: 'receivedNotInvoiced', label: 'Received not invoiced', type: 'qty' }, { key: 'flag', label: 'Exception' }], rows };
    },
  },
  // ───────── Measurement & billing ─────────
  {
    key: 'boq-summary',
    title: 'BOQ Summary',
    group: 'Measurement & Billing',
    permission: 'boq.view',
    description: 'Contract, executed, verified and certified quantity and value per BOQ item.',
    async run(p) {
      const items = await prisma.boqItem.findMany({ where: { projectId: p.projectId, isActive: true }, orderBy: { itemCode: 'asc' } });
      const rows = items.map((b) => {
        const rate = D(b.revisedRate ?? b.unitRate);
        const qtyC = D(b.revisedQty ?? b.contractQty);
        return { itemCode: b.itemCode, description: b.description, unit: b.unit, contractQty: qtyC.toFixed(3), rate: rate.toFixed(2), contractValue: money(qtyC.times(rate)), executedQty: b.executedQty, verifiedQty: b.verifiedQty, certifiedQty: b.certifiedQty, certifiedValue: money(D(b.certifiedQty).times(rate)), remainingQty: qtyC.minus(D(b.certifiedQty)).toFixed(3), nonBoq: b.isNonBoq ? 'Yes' : '' };
      });
      return { columns: [{ key: 'itemCode', label: 'Item' }, { key: 'description', label: 'Description' }, { key: 'unit', label: 'Unit' }, { key: 'contractQty', label: 'Contract qty', type: 'qty' }, { key: 'rate', label: 'Rate', type: 'money' }, { key: 'contractValue', label: 'Contract value', type: 'money' }, { key: 'executedQty', label: 'Executed', type: 'qty' }, { key: 'verifiedQty', label: 'Verified', type: 'qty' }, { key: 'certifiedQty', label: 'Certified', type: 'qty' }, { key: 'certifiedValue', label: 'Certified value', type: 'money' }, { key: 'remainingQty', label: 'Remaining', type: 'qty' }, { key: 'nonBoq', label: 'Non-BOQ' }], rows, totals: { itemCode: 'TOTAL', ...totalOf(rows, ['contractValue', 'certifiedValue']) } };
    },
  },
  {
    key: 'quantity-takeoff',
    title: 'Quantity Takeoff',
    group: 'Measurement & Billing',
    permission: 'boq.view',
    description: 'Takeoff records with dimensions.',
    async run(p) {
      const rows = await prisma.quantityTakeoff.findMany({ where: { projectId: p.projectId }, include: { boqItem: { select: { itemCode: true, unit: true } } }, orderBy: { date: 'desc' } });
      return { columns: [{ key: 'number', label: 'QTO' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'item', label: 'BOQ item' }, { key: 'location', label: 'Location' }, { key: 'formula', label: 'Formula' }, { key: 'quantity', label: 'Qty', type: 'qty' }, { key: 'unit', label: 'Unit' }], rows: rows.map((r) => ({ ...r, date: isoDate(r.date), item: r.boqItem.itemCode, unit: r.boqItem.unit })) };
    },
  },
  {
    key: 'measurement-book',
    title: 'Measurement Book',
    group: 'Measurement & Billing',
    permission: 'measurement.view',
    description: 'All measurements with dimensions and status.',
    dateFilter: true,
    async run(p) {
      const rows = await prisma.measurement.findMany({ where: { projectId: p.projectId, ...dr(p, 'measuredOn') }, include: { boqItem: { select: { itemCode: true } } }, orderBy: { measuredOn: 'desc' } });
      return { columns: [{ key: 'number', label: 'Ref' }, { key: 'type', label: 'Type' }, { key: 'measuredOn', label: 'Date', type: 'date' }, { key: 'item', label: 'BOQ item' }, { key: 'location', label: 'Location' }, { key: 'grid', label: 'Grid' }, { key: 'formula', label: 'Formula' }, { key: 'calculatedQty', label: 'Calculated', type: 'qty' }, { key: 'submittedQty', label: 'Submitted', type: 'qty' }, { key: 'verifiedQty', label: 'Verified', type: 'qty' }, { key: 'unit', label: 'Unit' }, { key: 'status', label: 'Status', type: 'status' }], rows: rows.map((r) => ({ ...r, measuredOn: isoDate(r.measuredOn), item: r.boqItem.itemCode })) };
    },
  },
  {
    key: 'measurement-verification',
    title: 'Measurement Verification',
    group: 'Measurement & Billing',
    permission: 'measurement.view',
    description: 'Submitted vs verified quantities and variance.',
    async run(p) {
      const rows = await prisma.measurement.findMany({ where: { projectId: p.projectId, verifiedQty: { not: null } }, include: { boqItem: { select: { itemCode: true } } }, orderBy: { verifiedAt: 'desc' } });
      const users = await names(rows.map((r) => r.verifiedById));
      return { columns: [{ key: 'number', label: 'Ref' }, { key: 'item', label: 'BOQ item' }, { key: 'submittedQty', label: 'Submitted', type: 'qty' }, { key: 'verifiedQty', label: 'Verified', type: 'qty' }, { key: 'variance', label: 'Variance', type: 'qty' }, { key: 'verifiedBy', label: 'Verified by' }, { key: 'verifiedAt', label: 'Verified on', type: 'date' }, { key: 'status', label: 'Status', type: 'status' }], rows: rows.map((r) => ({ ...r, item: r.boqItem.itemCode, verifiedBy: users.get(r.verifiedById ?? ''), verifiedAt: isoDate(r.verifiedAt) })) };
    },
  },
  {
    key: 'contractor-bill-register',
    title: 'Contractor Bill Register',
    group: 'Measurement & Billing',
    permission: 'subbill.view',
    description: 'All RA bills with deductions and payment.',
    async run(p) {
      const rows = await prisma.contractorBill.findMany({ where: { projectId: p.projectId }, include: { contractor: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
      const out = rows.map((r) => ({ number: r.number, contractor: r.contractor.name, period: `${isoDate(r.periodFrom)} – ${isoDate(r.periodTo)}`, currentWorkValue: r.currentWorkValue, retention: r.retention, advanceRecovery: r.advanceRecovery, taxAmount: r.taxAmount, netPayable: r.netPayable, paidAmount: r.paidAmount, status: r.status }));
      return { columns: [{ key: 'number', label: 'Bill' }, { key: 'contractor', label: 'Contractor' }, { key: 'period', label: 'Period' }, { key: 'currentWorkValue', label: 'Work value', type: 'money' }, { key: 'retention', label: 'Retention', type: 'money' }, { key: 'advanceRecovery', label: 'Adv. recovery', type: 'money' }, { key: 'taxAmount', label: 'Tax', type: 'money' }, { key: 'netPayable', label: 'Net payable', type: 'money' }, { key: 'paidAmount', label: 'Paid', type: 'money' }, { key: 'status', label: 'Status', type: 'status' }], rows: out, totals: { number: 'TOTAL', ...totalOf(out.filter((r) => !['DRAFT', 'REJECTED', 'CANCELLED'].includes(r.status)), ['currentWorkValue', 'retention', 'advanceRecovery', 'taxAmount', 'netPayable', 'paidAmount']) }, notes: ['Totals exclude draft, rejected and cancelled bills.'] };
    },
  },
  {
    key: 'client-bill-register',
    title: 'Client RA Bill Register',
    group: 'Measurement & Billing',
    permission: 'clientbill.view',
    description: 'Client bills: claimed, certified and received.',
    async run(p) {
      const rows = await prisma.clientBill.findMany({ where: { projectId: p.projectId }, orderBy: { billSeq: 'asc' } });
      const out = rows.map((r) => ({ number: r.number, type: r.type, invoiceNo: r.invoiceNo, currentWorkValue: r.currentWorkValue, netAmount: r.netAmount, certifiedAmount: r.certifiedAmount, receivedAmount: r.receivedAmount, outstanding: money(D(r.certifiedAmount ?? 0).minus(D(r.receivedAmount))), status: r.status }));
      return { columns: [{ key: 'number', label: 'Bill' }, { key: 'type', label: 'Type' }, { key: 'invoiceNo', label: 'Invoice' }, { key: 'currentWorkValue', label: 'Work value', type: 'money' }, { key: 'netAmount', label: 'Claimed (net)', type: 'money' }, { key: 'certifiedAmount', label: 'Certified', type: 'money' }, { key: 'receivedAmount', label: 'Received', type: 'money' }, { key: 'outstanding', label: 'Outstanding', type: 'money' }, { key: 'status', label: 'Status', type: 'status' }], rows: out, totals: { number: 'TOTAL', ...totalOf(out, ['certifiedAmount', 'receivedAmount', 'outstanding']) } };
    },
  },
  {
    key: 'certified-vs-paid',
    title: 'Certified vs Invoiced vs Paid',
    group: 'Measurement & Billing',
    permission: 'subbill.view',
    description: 'Subcontract reconciliation of certified, invoiced and paid amounts.',
    async run(p) {
      const subs = await prisma.subcontract.findMany({ where: { projectId: p.projectId }, include: { contractor: { select: { name: true } } } });
      const bills = await prisma.contractorBill.findMany({ where: { projectId: p.projectId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID', 'PAID'] } } });
      const rows = subs.map((s) => {
        const b = bills.filter((x) => x.subcontractId === s.id);
        return { number: s.number, contractor: s.contractor.name, contractValue: s.contractValue, certifiedGross: money(sum(b.map((x) => x.currentWorkValue))), netPayable: money(sum(b.map((x) => x.netPayable))), invoicedRef: b.filter((x) => x.contractorInvoiceNo).length, paid: money(sum(b.map((x) => x.paidAmount))), outstanding: money(sum(b.map((x) => D(x.netPayable).minus(D(x.paidAmount))))) };
      });
      return { columns: [{ key: 'number', label: 'WO' }, { key: 'contractor', label: 'Contractor' }, { key: 'contractValue', label: 'Contract', type: 'money' }, { key: 'certifiedGross', label: 'Certified (gross)', type: 'money' }, { key: 'netPayable', label: 'Net payable', type: 'money' }, { key: 'invoicedRef', label: 'Bills with contractor invoice', type: 'int' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'outstanding', label: 'Outstanding', type: 'money' }], rows, totals: { number: 'TOTAL', ...totalOf(rows, ['contractValue', 'certifiedGross', 'netPayable', 'paid', 'outstanding']) } };
    },
  },
  {
    key: 'retention',
    title: 'Retention Report',
    group: 'Measurement & Billing',
    permission: 'subbill.view',
    description: 'Retention payable (subcontractors) and receivable (client).',
    async run(p) {
      const bills = await prisma.contractorBill.findMany({ where: { projectId: p.projectId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID', 'PAID'] } }, include: { contractor: { select: { name: true } } } });
      const releases = await prisma.paymentAllocation.findMany({ where: { retentionRelease: true, payment: { projectId: p.projectId, status: 'APPROVED' } } });
      const client = await prisma.clientBill.findMany({ where: { projectId: p.projectId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID', 'PAID'] } } });
      const rows = [
        ...bills.map((b) => ({ side: 'Payable', party: b.contractor.name, document: b.number, retention: b.retention, released: money(sum(releases.filter((r) => r.contractorBillId === b.id).map((r) => r.amount))), held: money(D(b.retention).minus(sum(releases.filter((r) => r.contractorBillId === b.id).map((r) => r.amount)))) })),
        ...client.map((b) => ({ side: 'Receivable', party: 'Client', document: b.number, retention: b.retention, released: '0.00', held: money(b.retention) })),
      ];
      return { columns: [{ key: 'side', label: 'Side' }, { key: 'party', label: 'Party' }, { key: 'document', label: 'Bill' }, { key: 'retention', label: 'Retention', type: 'money' }, { key: 'released', label: 'Released', type: 'money' }, { key: 'held', label: 'Held', type: 'money' }], rows };
    },
  },
  {
    key: 'ap-aging',
    title: 'Accounts Payable Aging',
    group: 'Measurement & Billing',
    permission: 'payable.view',
    description: 'Outstanding supplier invoices and contractor bills by age.',
    async run(p) {
      const now = today().getTime();
      const inv = await prisma.supplierInvoice.findMany({ where: { projectId: p.projectId, status: { in: ['APPROVED', 'PARTIALLY_PAID'] } }, include: { supplier: { select: { name: true } } } });
      const bills = await prisma.contractorBill.findMany({ where: { projectId: p.projectId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID'] } }, include: { contractor: { select: { name: true } } } });
      const bucket = (d: Date | null) => {
        const days = d ? Math.floor((now - d.getTime()) / 86_400_000) : 0;
        return { days: Math.max(0, days), bucket: days <= 0 ? 'Current' : days <= 30 ? '1–30' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : '90+' };
      };
      const rows = [
        ...inv.map((i) => ({ type: 'Supplier invoice', party: i.supplier.name, document: `${i.number} / ${i.invoiceNo}`, dueDate: isoDate(i.dueDate), outstanding: money(D(i.total).minus(D(i.paidAmount))), ...bucket(i.dueDate) })),
        ...bills.map((b) => ({ type: 'Contractor bill', party: b.contractor.name, document: b.number, dueDate: isoDate(b.dueDate), outstanding: money(D(b.netPayable).minus(D(b.paidAmount))), ...bucket(b.dueDate) })),
      ].sort((a, b) => b.days - a.days);
      return { columns: [{ key: 'type', label: 'Type' }, { key: 'party', label: 'Party' }, { key: 'document', label: 'Document' }, { key: 'dueDate', label: 'Due', type: 'date' }, { key: 'days', label: 'Days overdue', type: 'int' }, { key: 'bucket', label: 'Bucket' }, { key: 'outstanding', label: 'Outstanding', type: 'money' }], rows, totals: { type: 'TOTAL', ...totalOf(rows, ['outstanding']) } };
    },
  },
  {
    key: 'ar-aging',
    title: 'Accounts Receivable Aging',
    group: 'Measurement & Billing',
    permission: 'clientbill.view',
    description: 'Outstanding certified client bills by age.',
    async run(p) {
      const now = today().getTime();
      const bills = await prisma.clientBill.findMany({ where: { projectId: p.projectId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID', 'DISPUTED'] } } });
      const rows = bills.map((b) => {
        const days = b.dueDate ? Math.max(0, Math.floor((now - b.dueDate.getTime()) / 86_400_000)) : 0;
        return { document: b.number, invoiceNo: b.invoiceNo, dueDate: isoDate(b.dueDate), days, bucket: days <= 0 ? 'Current' : days <= 30 ? '1–30' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : '90+', outstanding: money(D(b.certifiedAmount ?? b.netAmount).minus(D(b.receivedAmount))), status: b.status };
      });
      return { columns: [{ key: 'document', label: 'Bill' }, { key: 'invoiceNo', label: 'Invoice' }, { key: 'dueDate', label: 'Due', type: 'date' }, { key: 'days', label: 'Days overdue', type: 'int' }, { key: 'bucket', label: 'Bucket' }, { key: 'outstanding', label: 'Outstanding', type: 'money' }, { key: 'status', label: 'Status', type: 'status' }], rows, totals: { document: 'TOTAL', ...totalOf(rows, ['outstanding']) } };
    },
  },
  {
    key: 'variation-register',
    title: 'Variation Register',
    group: 'Measurement & Billing',
    permission: 'variation.view',
    description: 'Variations with revenue, cost and schedule impact.',
    async run(p) {
      const rows = await prisma.variation.findMany({ where: { projectId: p.projectId }, orderBy: { createdAt: 'desc' } });
      return { columns: [{ key: 'number', label: 'VO' }, { key: 'title', label: 'Title' }, { key: 'origin', label: 'Origin' }, { key: 'revenueImpact', label: 'Revenue', type: 'money' }, { key: 'costImpact', label: 'Cost', type: 'money' }, { key: 'scheduleImpactDays', label: 'Days', type: 'int' }, { key: 'approvedValue', label: 'Approved', type: 'money' }, { key: 'status', label: 'Status', type: 'status' }], rows, totals: { number: 'APPROVED', revenueImpact: money(sum(rows.filter((r) => r.status === 'APPROVED').map((r) => r.revenueImpact))), costImpact: money(sum(rows.filter((r) => r.status === 'APPROVED').map((r) => r.costImpact))) }, notes: ['Totals include approved variations only; pending variations are exposure.'] };
    },
  },
  {
    key: 'claims-register',
    title: 'Claims & EOT Register',
    group: 'Measurement & Billing',
    permission: 'risk.view',
    description: 'Claims by and against the company.',
    async run(p) {
      const rows = await prisma.claim.findMany({ where: { projectId: p.projectId }, orderBy: { createdAt: 'desc' } });
      const parties = await partyNames(rows.map((r) => r.counterpartyId));
      return { columns: [{ key: 'number', label: 'Claim' }, { key: 'type', label: 'Type' }, { key: 'direction', label: 'Direction' }, { key: 'counterparty', label: 'Counterparty' }, { key: 'title', label: 'Title' }, { key: 'claimedAmount', label: 'Claimed', type: 'money' }, { key: 'claimedDays', label: 'Days', type: 'int' }, { key: 'approvedAmount', label: 'Approved', type: 'money' }, { key: 'status', label: 'Status', type: 'status' }], rows: rows.map((r) => ({ ...r, counterparty: parties.get(r.counterpartyId ?? '') })) };
    },
  },
  // ───────── Operational ─────────
  {
    key: 'evidence-register',
    title: 'Site Evidence Register',
    group: 'Operational',
    permission: 'evidence.view',
    description: 'Photos with category, uploader and verification status.',
    dateFilter: true,
    async run(p) {
      const rows = await prisma.evidence.findMany({ where: { projectId: p.projectId, ...dr(p, 'createdAt') }, include: { file: { select: { originalName: true, sha256: true } } }, orderBy: { createdAt: 'desc' } });
      const users = await names(rows.flatMap((r) => [r.submittedById, r.verifiedById]));
      return { columns: [{ key: 'number', label: 'Ref' }, { key: 'uploaded', label: 'Uploaded (server time)', type: 'date' }, { key: 'category', label: 'Category' }, { key: 'caption', label: 'Caption' }, { key: 'location', label: 'Location' }, { key: 'submittedBy', label: 'Uploaded by' }, { key: 'verifiedBy', label: 'Reviewed by' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'sha256', label: 'SHA-256' }], rows: rows.map((r) => ({ number: r.number, uploaded: isoDate(r.createdAt), category: humanize(r.category), caption: r.caption, location: r.location, submittedBy: users.get(r.submittedById), verifiedBy: users.get(r.verifiedById ?? ''), status: r.status, sha256: r.file.sha256.slice(0, 16) + '…' })), notes: ['Capture time and GPS reported by devices are not independently validated.'] };
    },
  },
  {
    key: 'inspection-register',
    title: 'Inspection Register',
    group: 'Operational',
    permission: 'quality.view',
    description: 'All inspections and results.',
    async run(p) {
      const rows = await prisma.inspection.findMany({ where: { projectId: p.projectId }, orderBy: { requestedDate: 'desc' } });
      return { columns: [{ key: 'number', label: 'No.' }, { key: 'type', label: 'Type' }, { key: 'title', label: 'Title' }, { key: 'location', label: 'Location' }, { key: 'requestedDate', label: 'Requested', type: 'date' }, { key: 'inspectedDate', label: 'Inspected', type: 'date' }, { key: 'result', label: 'Result', type: 'status' }, { key: 'status', label: 'Status', type: 'status' }], rows: rows.map((r) => ({ ...r, requestedDate: isoDate(r.requestedDate), inspectedDate: isoDate(r.inspectedDate) })) };
    },
  },
  {
    key: 'ncr-report',
    title: 'NCR & Rework Report',
    group: 'Operational',
    permission: 'quality.view',
    description: 'Non-conformances with estimated and actual rework cost.',
    async run(p) {
      const rows = await prisma.ncr.findMany({ where: { projectId: p.projectId }, orderBy: { createdAt: 'desc' } });
      const actual = await prisma.expense.groupBy({ by: ['ncrId'], where: { projectId: p.projectId, ncrId: { not: null }, status: 'APPROVED' }, _sum: { amountBeforeTax: true } });
      const out = rows.map((r) => ({ number: r.number, title: r.title, severity: r.severity, dueDate: isoDate(r.dueDate), estimatedReworkCost: r.estimatedReworkCost, actualReworkCost: money(actual.find((a) => a.ncrId === r.id)?._sum.amountBeforeTax ?? 0), status: r.status }));
      return { columns: [{ key: 'number', label: 'NCR' }, { key: 'title', label: 'Title' }, { key: 'severity', label: 'Severity', type: 'status' }, { key: 'dueDate', label: 'Due', type: 'date' }, { key: 'estimatedReworkCost', label: 'Est. rework', type: 'money' }, { key: 'actualReworkCost', label: 'Actual rework', type: 'money' }, { key: 'status', label: 'Status', type: 'status' }], rows: out, totals: { number: 'TOTAL', ...totalOf(out, ['estimatedReworkCost', 'actualReworkCost']) } };
    },
  },
  {
    key: 'safety-report',
    title: 'Safety Inspection & Incident Report',
    group: 'Operational',
    permission: 'safety.view',
    description: 'Incidents, near misses and observations.',
    dateFilter: true,
    async run(p) {
      const rows = await prisma.safetyIncident.findMany({ where: { projectId: p.projectId, ...dr(p) }, orderBy: { date: 'desc' } });
      return { columns: [{ key: 'number', label: 'No.' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'type', label: 'Type', type: 'status' }, { key: 'severity', label: 'Severity', type: 'status' }, { key: 'description', label: 'Description' }, { key: 'injuredCount', label: 'Injured', type: 'int' }, { key: 'status', label: 'Status', type: 'status' }], rows: rows.map((r) => ({ ...r, date: isoDate(r.date) })) };
    },
  },
  {
    key: 'document-register',
    title: 'Document Register',
    group: 'Operational',
    permission: 'document.view',
    description: 'Controlled documents with current approved revision.',
    async run(p, ctx) {
      const docs = await prisma.document.findMany({ where: { projectId: p.projectId, ...(can(ctx, 'document.manage', p.projectId) ? {} : { confidential: false }) }, include: { revisions: true }, orderBy: { number: 'asc' } });
      return { columns: [{ key: 'number', label: 'Number' }, { key: 'docType', label: 'Type' }, { key: 'discipline', label: 'Discipline' }, { key: 'title', label: 'Title' }, { key: 'current', label: 'Current approved rev' }, { key: 'latest', label: 'Latest rev' }, { key: 'latestStatus', label: 'Latest status', type: 'status' }], rows: docs.map((d) => { const cur = d.revisions.find((r) => r.id === d.currentRevisionId); const latest = [...d.revisions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]; return { number: d.number, docType: d.docType, discipline: d.discipline, title: d.title, current: cur?.revision ?? '—', latest: latest?.revision ?? '—', latestStatus: latest?.status ?? null }; }) };
    },
  },
  {
    key: 'pending-approvals',
    title: 'Pending Approvals',
    group: 'Operational',
    permission: 'project.view',
    description: 'All pending approval requests with step and age.',
    async run(p) {
      const rows = await prisma.approvalRequest.findMany({ where: { projectId: p.projectId, status: 'PENDING' }, orderBy: { submittedAt: 'asc' } });
      const users = await names(rows.map((r) => r.submittedById));
      return { columns: [{ key: 'docType', label: 'Type' }, { key: 'title', label: 'Document' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'step', label: 'Current step' }, { key: 'submittedBy', label: 'Submitted by' }, { key: 'submittedAt', label: 'Submitted', type: 'date' }, { key: 'ageDays', label: 'Age (days)', type: 'int' }], rows: rows.map((r) => ({ docType: r.docType, title: r.title, amount: r.amount, step: (r.steps as any[]).find((s) => s.stepNo === r.currentStepNo)?.name, submittedBy: users.get(r.submittedById), submittedAt: isoDate(r.submittedAt), ageDays: Math.floor((Date.now() - r.submittedAt.getTime()) / 86_400_000) })) };
    },
  },
  {
    key: 'overdue-tasks',
    title: 'Overdue Tasks',
    group: 'Operational',
    permission: 'task.view',
    description: 'Open tasks past their due date.',
    async run(p) {
      const rows = await prisma.task.findMany({ where: { projectId: p.projectId, dueDate: { lt: today() }, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, include: { owner: { select: { name: true } } }, orderBy: { dueDate: 'asc' } });
      return { columns: [{ key: 'number', label: 'Task' }, { key: 'title', label: 'Title' }, { key: 'owner', label: 'Owner' }, { key: 'priority', label: 'Priority', type: 'status' }, { key: 'dueDate', label: 'Due', type: 'date' }, { key: 'daysOverdue', label: 'Days overdue', type: 'int' }, { key: 'status', label: 'Status' }], rows: rows.map((r) => ({ number: r.number, title: r.title, owner: r.owner?.name, priority: r.priority, dueDate: isoDate(r.dueDate), daysOverdue: Math.floor((today().getTime() - r.dueDate!.getTime()) / 86_400_000), status: TASK_STATUS_LABEL[r.status as keyof typeof TASK_STATUS_LABEL] ?? r.status })) };
    },
  },
  {
    key: 'team-workload',
    title: 'Team Workload & Productivity',
    group: 'Operational',
    permission: 'team.view',
    description: 'Open, overdue and completed tasks per team member.',
    async run(p) {
      const members = await prisma.projectMember.findMany({ where: { projectId: p.projectId, isActive: true }, include: { user: { select: { id: true, name: true, designation: true } } } });
      const rows = await Promise.all(
        members.map(async (m) => {
          const base = { projectId: p.projectId, ownerId: m.userId };
          const [open, overdue, completed, eff] = await Promise.all([prisma.task.count({ where: { ...base, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }), prisma.task.count({ where: { ...base, status: { notIn: ['COMPLETED', 'CANCELLED'] }, dueDate: { lt: today() } } }), prisma.task.count({ where: { ...base, status: 'COMPLETED', ...(p.from ? { completedAt: { gte: p.from } } : {}) } }), prisma.task.aggregate({ where: { ...base, status: 'COMPLETED' }, _sum: { estimatedHours: true, actualHours: true } })]);
          return { name: m.user.name, designation: m.user.designation, open, overdue, completed, estimatedHours: eff._sum.estimatedHours ?? '0', actualHours: eff._sum.actualHours ?? '0' };
        }),
      );
      return { columns: [{ key: 'name', label: 'Member' }, { key: 'designation', label: 'Designation' }, { key: 'open', label: 'Open', type: 'int' }, { key: 'overdue', label: 'Overdue', type: 'int' }, { key: 'completed', label: 'Completed', type: 'int' }, { key: 'estimatedHours', label: 'Est. hrs (done)', type: 'qty' }, { key: 'actualHours', label: 'Actual hrs (done)', type: 'qty' }], rows };
    },
  },
  {
    key: 'responsibility-matrix',
    title: 'Responsibility Matrix',
    group: 'Operational',
    permission: 'team.view',
    description: 'RACI assignments per process.',
    async run(p, ctx) {
      const rows = await prisma.responsibilityAssignment.findMany({ where: { orgId: ctx.orgId, OR: [{ projectId: p.projectId }, { projectId: null }] }, orderBy: { processType: 'asc' } });
      const users = await names(rows.flatMap((r) => [r.responsibleId, r.accountableId, r.reviewerId, r.approverId, r.backupId, r.escalationUserId]));
      return { columns: [{ key: 'processType', label: 'Process' }, { key: 'scope', label: 'Scope' }, { key: 'responsible', label: 'Responsible' }, { key: 'accountable', label: 'Accountable' }, { key: 'reviewer', label: 'Reviewer' }, { key: 'approver', label: 'Approver' }, { key: 'backup', label: 'Backup' }, { key: 'slaHours', label: 'SLA (h)', type: 'int' }, { key: 'escalation', label: 'Escalation' }], rows: rows.map((r) => ({ processType: humanize(r.processType), scope: r.projectId ? 'This project' : 'Organisation default', responsible: users.get(r.responsibleId ?? ''), accountable: users.get(r.accountableId ?? ''), reviewer: users.get(r.reviewerId ?? ''), approver: users.get(r.approverId ?? ''), backup: users.get(r.backupId ?? ''), slaHours: r.slaHours, escalation: users.get(r.escalationUserId ?? '') })) };
    },
  },
  {
    key: 'audit-trail',
    title: 'Audit Trail',
    group: 'Operational',
    permission: 'audit.view',
    description: 'Audit events for this project.',
    dateFilter: true,
    async run(p) {
      const rows = await prisma.auditEvent.findMany({ where: { projectId: p.projectId, ...dr(p, 'createdAt') }, orderBy: { createdAt: 'desc' }, take: 5000 });
      const users = await names(rows.map((r) => r.actorId));
      return { columns: [{ key: 'at', label: 'When (UTC)' }, { key: 'actor', label: 'User' }, { key: 'action', label: 'Action' }, { key: 'entityType', label: 'Record type' }, { key: 'summary', label: 'Summary' }, { key: 'reason', label: 'Reason' }], rows: rows.map((r) => ({ at: r.createdAt.toISOString().slice(0, 19).replace('T', ' '), actor: users.get(r.actorId ?? '') ?? 'System', action: r.action, entityType: r.entityType, summary: r.summary, reason: r.reason })) };
    },
  },
  {
    key: 'month-end',
    title: 'Month-End Closing Status',
    group: 'Operational',
    permission: 'period.view',
    description: 'Period status and checklist completion.',
    async run(p) {
      const periods = await prisma.reportingPeriod.findMany({ where: { projectId: p.projectId }, include: { checklist: true }, orderBy: { code: 'desc' } });
      const users = await names(periods.map((x) => x.closedById));
      return { columns: [{ key: 'code', label: 'Period' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'done', label: 'Items done', type: 'int' }, { key: 'waived', label: 'Waived', type: 'int' }, { key: 'pending', label: 'Pending', type: 'int' }, { key: 'closedBy', label: 'Closed by' }, { key: 'closedAt', label: 'Closed', type: 'date' }], rows: periods.map((x) => ({ code: x.code, status: x.status, done: x.checklist.filter((c) => c.status === 'DONE').length, waived: x.checklist.filter((c) => c.status === 'WAIVED').length, pending: x.checklist.filter((c) => c.status === 'PENDING').length, closedBy: users.get(x.closedById ?? ''), closedAt: isoDate(x.closedAt) })) };
    },
  },
  {
    key: 'closeout',
    title: 'Project Closeout',
    group: 'Operational',
    permission: 'closeout.view',
    description: 'Closeout checklist and final cost.',
    async run(p) {
      const c = await prisma.closeout.findUnique({ where: { projectId: p.projectId }, include: { items: true } });
      const pos = await projectCostPositions(prisma, p.projectId);
      return { columns: [{ key: 'label', label: 'Item' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'note', label: 'Note' }], rows: c?.items.map((i) => ({ label: i.label, status: i.status, note: i.note })) ?? [], notes: [c ? `Closeout status: ${c.status}` : 'Closeout not started', `Final EAC: ${pos.total.eac} · Approved budget: ${pos.total.approvedBudget} · Variance: ${pos.total.costVariance}`] };
    },
  },
];

export function reportCatalog(ctx: AccessContext, projectId: string) {
  return REPORTS.filter((r) => can(ctx, r.permission, projectId)).map(({ key, title, group, description, dateFilter }) => ({ key, title, group, description, dateFilter: !!dateFilter }));
}

export function findReport(key: string) {
  return REPORTS.find((r) => r.key === key);
}

export function parseRange(from?: unknown, to?: unknown) {
  return { from: typeof from === 'string' && from ? toDateOnly(from)! : undefined, to: typeof to === 'string' && to ? toDateOnly(to)! : undefined };
}
