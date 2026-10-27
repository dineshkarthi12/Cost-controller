import { computeEvm, D, money, ratio, sum } from '@toprock/shared';
import type { Db } from '../lib/prisma.js';
import { addDays, periodCode, toDateOnly, today } from '../lib/dates.js';
import { projectCostPositions } from './budget.js';

function monthsBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (d <= end && out.length < 60) {
    out.push(periodCode(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/** Executive dashboard. Every figure is derived from persisted records; see BUSINESS_RULES.md. */
export async function projectDashboard(db: Db, projectId: string, opts: { from?: Date; to?: Date; userId: string }) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const to = opts.to ?? today();
  const from = opts.from ?? toDateOnly(project.startDate ?? addDays(to, -365))!;
  const positions = await projectCostPositions(db, projectId);
  const t = positions.total;

  const [activities, approvedVo, pendingVo, clientBills, invoicesOpen, billsOpen, overdueTasks, pendingProc, ledgerMonthly, payments, cashPlan] = await Promise.all([
    db.activity.findMany({ where: { projectId }, select: { id: true, name: true, weight: true, percentComplete: true, baselineStart: true, baselineFinish: true, plannedFinish: true, isMilestone: true, status: true, wbsNode: { select: { code: true, name: true } } } }),
    db.variation.aggregate({ where: { projectId, status: 'APPROVED' }, _sum: { approvedValue: true } }),
    db.variation.aggregate({ where: { projectId, status: { in: ['SUBMITTED', 'PENDING_CLIENT', 'DISPUTED'] } }, _sum: { costImpact: true, revenueImpact: true }, _count: true }),
    db.clientBill.findMany({ where: { projectId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID'] } }, select: { certifiedAmount: true, netAmount: true, receivedAmount: true, dueDate: true } }),
    db.supplierInvoice.findMany({ where: { projectId, status: { in: ['APPROVED', 'PARTIALLY_PAID'] } }, select: { total: true, paidAmount: true, dueDate: true } }),
    db.contractorBill.findMany({ where: { projectId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID'] } }, select: { netPayable: true, paidAmount: true, dueDate: true } }),
    db.task.count({ where: { projectId, dueDate: { lt: today() }, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
    Promise.all([
      db.materialRequisition.count({ where: { projectId, status: 'SUBMITTED' } }),
      db.purchaseRequisition.count({ where: { projectId, status: 'SUBMITTED' } }),
      db.purchaseOrder.count({ where: { projectId, status: 'SUBMITTED' } }),
      db.grn.count({ where: { projectId, status: { in: ['DRAFT', 'SUBMITTED'] } } }),
      db.materialRequisition.count({ where: { projectId, status: 'APPROVED' } }),
    ]),
    db.$queryRaw<{ month: string; kind: string; category: string; amount: string }[]>`
      SELECT to_char(date, 'YYYY-MM') AS month, kind::text AS kind, category, SUM(amount)::text AS amount
      FROM "CostLedgerEntry" WHERE "projectId" = ${projectId} GROUP BY 1, 2, 3 ORDER BY 1`,
    db.payment.findMany({ where: { projectId, status: 'APPROVED' }, select: { direction: true, amount: true, date: true } }),
    db.cashFlowPlan.findMany({ where: { projectId }, orderBy: { month: 'asc' } }),
  ]);

  const evm = computeEvm(activities, t.approvedBudget, t.incurred, to);
  const revisedContract = D(project.contractValue).plus(D(approvedVo._sum.approvedValue ?? 0));
  const receivable = sum(clientBills.map((b) => D(b.certifiedAmount ?? b.netAmount).minus(D(b.receivedAmount))));
  const payable = sum([...invoicesOpen.map((i) => D(i.total).minus(D(i.paidAmount))), ...billsOpen.map((b) => D(b.netPayable).minus(D(b.paidAmount)))]);

  // Monthly trend: cumulative actual+accrued vs straight-line budget; commitments by month.
  const months = monthsBetween(from, to);
  const byMonth = new Map<string, { actual: ReturnType<typeof D>; commitment: ReturnType<typeof D>; labour: ReturnType<typeof D>; material: ReturnType<typeof D> }>();
  for (const r of ledgerMonthly) {
    const m = byMonth.get(r.month) ?? { actual: D(0), commitment: D(0), labour: D(0), material: D(0) };
    if (r.kind === 'ACTUAL' || r.kind === 'ACCRUAL') {
      m.actual = m.actual.plus(D(r.amount));
      if (r.category === 'LABOUR') m.labour = m.labour.plus(D(r.amount));
      if (r.category === 'MATERIAL') m.material = m.material.plus(D(r.amount));
    }
    if (r.kind === 'COMMITMENT' && D(r.amount).gt(0)) m.commitment = m.commitment.plus(D(r.amount));
    byMonth.set(r.month, m);
  }
  const projStart = project.startDate ?? from;
  const projEnd = project.plannedCompletionDate ?? to;
  const totalMonths = Math.max(1, monthsBetween(projStart, projEnd).length);
  let cumActual = sum(ledgerMonthly.filter((r) => r.month < (months[0] ?? '') && (r.kind === 'ACTUAL' || r.kind === 'ACCRUAL')).map((r) => r.amount));
  const costTrend = months.map((month) => {
    const m = byMonth.get(month);
    cumActual = cumActual.plus(m?.actual ?? 0);
    const elapsed = monthsBetween(projStart, toDateOnly(`${month}-01`)!).length;
    const plannedCum = D(t.approvedBudget).times(Math.min(1, elapsed / totalMonths));
    return { month, budget: money(plannedCum), actual: money(m?.actual ?? 0), cumulativeActual: money(cumActual), committed: money(m?.commitment ?? 0), labour: money(m?.labour ?? 0), material: money(m?.material ?? 0) };
  });

  const cashFlow = months.map((month) => {
    const plan = cashPlan.find((c) => c.month === month);
    const inflow = sum(payments.filter((p) => p.direction === 'IN' && periodCode(p.date) === month).map((p) => p.amount));
    const outflow = sum(payments.filter((p) => p.direction === 'OUT' && periodCode(p.date) === month).map((p) => p.amount));
    return { month, plannedInflow: money(plan?.plannedInflow ?? 0), plannedOutflow: money(plan?.plannedOutflow ?? 0), actualInflow: money(inflow), actualOutflow: money(outflow) };
  });

  const wbsProgress = Object.values(
    activities.reduce<Record<string, { name: string; w: number; done: number }>>((acc, a) => {
      const key = a.wbsNode ? `${a.wbsNode.code} ${a.wbsNode.name}` : 'Unassigned';
      const cur = acc[key] ?? { name: key, w: 0, done: 0 };
      cur.w += Number(a.weight);
      cur.done += Number(a.weight) * Number(a.percentComplete);
      acc[key] = cur;
      return acc;
    }, {}),
  ).map((g) => ({ name: g.name, percent: g.w ? +(g.done / g.w).toFixed(1) : 0 }));

  const plannedVsActual = months.map((month) => {
    const end = toDateOnly(`${month}-28`)!;
    const e = computeEvm(activities, 1, 1, end);
    return { month, planned: e.plannedPct ? +(Number(e.plannedPct) * 100).toFixed(1) : null };
  });

  const [pendingMr, pendingPr, pendingPo, pendingGrn, approvedMrAwaitingPr] = pendingProc;

  return {
    project: { id: project.id, code: project.code, name: project.name, currency: project.currency, isDemo: project.isDemo, startDate: project.startDate, plannedCompletionDate: project.plannedCompletionDate, status: project.status },
    basis: {
      currency: project.currency,
      tax: 'Excludes tax (unless organisation setting treats tax as cost)',
      accrual: 'Actual cost = approved invoices, certified bills, approved expenses, verified own labour and equipment logs. Accrued = accepted GRNs not yet invoiced.',
      commitments: 'Open commitments = approved PO / subcontract value not yet received or certified.',
      retention: 'Receivables and payables are net of retention; retention is reported separately.',
      pending: 'Pending (unapproved) costs and pending variations are shown separately and never included in actuals or budget.',
    },
    kpis: {
      contractValue: money(project.contractValue),
      revisedContractValue: money(revisedContract),
      originalBudget: t.originalBudget,
      approvedBudget: t.approvedBudget,
      actualCost: t.actual,
      accruedCost: t.accrued,
      incurredCost: t.incurred,
      committedCost: t.openCommitments,
      remainingBudget: t.remainingBudget,
      forecastFinalCost: t.eac,
      costVariance: t.costVariance,
      costVariancePct: t.costVariancePct,
      pendingCost: t.pending,
      physicalProgress: evm.physicalPct,
      financialProgress: ratio(t.incurred, t.approvedBudget)?.toFixed(4) ?? null,
      cpi: evm.cpi,
      spi: evm.spi,
      evmNotes: evm.notes,
      pendingApprovals: await db.approvalRequest.count({ where: { projectId, status: 'PENDING' } }),
      overdueTasks,
      pendingProcurement: pendingMr + pendingPr + pendingPo + pendingGrn,
      outstandingReceivables: money(receivable),
      outstandingPayables: money(payable),
      pendingVariationExposure: t.pendingVariationExposure,
      pendingVariationCount: pendingVo._count,
      alert: t.alert,
    },
    charts: {
      budgetVsActualVsForecast: positions.byCategory.map((c) => ({ category: c.category, budget: c.position.approvedBudget, actual: c.position.incurred, committed: c.position.openCommitments, forecast: c.position.eac })),
      costTrend,
      costBreakdown: positions.byCategory.map((c) => ({ category: c.category, amount: c.position.incurred })),
      wbsProgress,
      plannedVsActual: plannedVsActual.map((p) => ({ ...p, actual: p.month === periodCode(to) && evm.physicalPct ? +(Number(evm.physicalPct) * 100).toFixed(1) : null })),
      cashFlow,
      costCodeVariance: positions.rows
        .filter((r) => r.position.alert !== 'OK')
        .map((r) => ({ code: r.code, name: r.name, approvedBudget: r.position.approvedBudget, eac: r.position.eac, variance: r.position.costVariance, alert: r.position.alert }))
        .slice(0, 10),
    },
    procurement: { pendingMr, pendingPr, pendingPo, pendingGrn, approvedMrAwaitingPr },
  };
}

/** Operational widgets — lists for the dashboard. */
export async function projectOperations(db: Db, projectId: string) {
  const d = today();
  const [evidence, manpowerToday, recentGrn, verificationQueue, billsAwaiting, tasks, risks, milestones, members] = await Promise.all([
    db.evidence.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, number: true, caption: true, category: true, status: true, location: true, fileId: true, createdAt: true } }),
    db.manpowerReport.findMany({ where: { projectId, date: d }, select: { id: true, number: true, totalWorkers: true, status: true, shift: true, contractor: { select: { name: true } } } }),
    db.grn.findMany({ where: { projectId }, orderBy: { receivedDate: 'desc' }, take: 5, select: { id: true, number: true, receivedDate: true, status: true, acceptedValue: true, supplier: { select: { name: true } } } }),
    db.measurement.findMany({ where: { projectId, status: { in: ['SUBMITTED', 'VERIFIED', 'PENDING_CERTIFICATION'] } }, orderBy: { measuredOn: 'asc' }, take: 8, select: { id: true, number: true, status: true, location: true, submittedQty: true, unit: true, boqItem: { select: { itemCode: true } } } }),
    db.contractorBill.findMany({ where: { projectId, status: 'SUBMITTED' }, take: 8, select: { id: true, number: true, netPayable: true, contractor: { select: { name: true } } } }),
    db.task.findMany({ where: { projectId, status: { notIn: ['COMPLETED', 'CANCELLED'] }, OR: [{ dueDate: { lt: d } }, { status: 'BLOCKED' }] }, orderBy: { dueDate: 'asc' }, take: 8, select: { id: true, number: true, title: true, dueDate: true, status: true, priority: true, owner: { select: { name: true } } } }),
    db.risk.findMany({ where: { projectId, status: { not: 'CLOSED' }, score: { gte: 12 } }, orderBy: { score: 'desc' }, take: 5, select: { id: true, number: true, title: true, score: true, costExposure: true } }),
    db.activity.findMany({ where: { projectId, isMilestone: true, actualFinish: null }, orderBy: { plannedFinish: 'asc' }, take: 5, select: { id: true, code: true, name: true, plannedFinish: true, percentComplete: true } }),
    db.projectMember.findMany({ where: { projectId, isActive: true }, select: { user: { select: { id: true, name: true, designation: true } } } }),
  ]);
  const workload = await Promise.all(
    members.map(async (m) => {
      const [open, overdue, done] = await Promise.all([
        db.task.count({ where: { projectId, ownerId: m.user.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
        db.task.count({ where: { projectId, ownerId: m.user.id, status: { notIn: ['COMPLETED', 'CANCELLED'] }, dueDate: { lt: d } } }),
        db.task.count({ where: { projectId, ownerId: m.user.id, status: 'COMPLETED' } }),
      ]);
      return { userId: m.user.id, name: m.user.name, designation: m.user.designation, open, overdue, completed: done };
    }),
  );
  return { evidence, manpowerToday, recentGrn, verificationQueue, billsAwaiting, overdueTasks: tasks, risks, milestones, workload: workload.filter((w) => w.open + w.completed > 0).sort((a, b) => b.open - a.open) };
}

export async function portfolio(db: Db, projectIds: string[]) {
  return Promise.all(
    projectIds.map(async (id) => {
      const p = await db.project.findUniqueOrThrow({ where: { id }, select: { id: true, code: true, name: true, status: true, contractValue: true, currency: true } });
      const pos = await projectCostPositions(db, id);
      return { ...p, approvedBudget: pos.total.approvedBudget, incurred: pos.total.incurred, committed: pos.total.openCommitments, eac: pos.total.eac, costVariance: pos.total.costVariance, costVariancePct: pos.total.costVariancePct, alert: pos.total.alert };
    }),
  );
}
