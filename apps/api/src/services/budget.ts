import { computeCostPosition, rollupPositions, D, money, sum, type CostPosition } from '@toprock/shared';
import type { Db } from '../lib/prisma.js';
import { getOrgSettings } from './settings.js';

const PENDING_VARIATION = ['SUBMITTED', 'PENDING_CLIENT', 'DISPUTED', 'RETURNED'];

export interface CostCodePosition {
  costCodeId: string;
  code: string;
  name: string;
  category: string;
  position: CostPosition;
  forecastAssumptions: string | null;
  forecastPeriod: string | null;
}

/** Builds the cost position of every cost code in a project (BUSINESS_RULES §3). */
export async function projectCostPositions(db: Db, projectId: string, opts: { asOf?: Date } = {}) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { orgId: true } });
  const settings = await getOrgSettings(db, project.orgId);
  const dateFilter = opts.asOf ? { date: { lte: opts.asOf } } : {};
  const [codes, revisions, ledger, pendingExp, pendingInv, pendingBills, forecasts, variations] = await Promise.all([
    db.costCode.findMany({ where: { projectId }, include: { budgetLine: true }, orderBy: { code: 'asc' } }),
    db.budgetRevisionLine.groupBy({ by: ['costCodeId'], where: { revision: { projectId, status: 'APPROVED' } }, _sum: { delta: true } }),
    db.costLedgerEntry.groupBy({ by: ['costCodeId', 'kind'], where: { projectId, ...dateFilter }, _sum: { amount: true } }),
    db.expense.groupBy({ by: ['costCodeId'], where: { projectId, status: 'SUBMITTED', invoiceId: null }, _sum: { amountBeforeTax: true } }),
    db.supplierInvoiceLine.groupBy({ by: ['costCodeId'], where: { invoice: { projectId, status: { in: ['SUBMITTED', 'EXCEPTION'] } } }, _sum: { amount: true } }),
    db.contractorBill.findMany({ where: { projectId, status: 'SUBMITTED' }, select: { currentWorkValue: true, subcontractId: true } }),
    db.costForecast.findMany({ where: { projectId }, orderBy: [{ periodCode: 'desc' }, { createdAt: 'desc' }] }),
    db.variation.findMany({ where: { projectId, status: { in: PENDING_VARIATION } }, select: { costCodeId: true, costImpact: true } }),
  ]);
  const subCodes = new Map(
    (await db.subcontract.findMany({ where: { id: { in: pendingBills.map((b) => b.subcontractId) } }, select: { id: true, costCodeId: true } })).map((s) => [s.id, s.costCodeId]),
  );
  const pendingBy = new Map<string, ReturnType<typeof D>>();
  const addPending = (cc: string | null | undefined, v: unknown) => {
    if (!cc) return;
    pendingBy.set(cc, (pendingBy.get(cc) ?? D(0)).plus(D(v as string)));
  };
  pendingExp.forEach((r) => addPending(r.costCodeId, r._sum.amountBeforeTax));
  pendingInv.forEach((r) => addPending(r.costCodeId, r._sum.amount));
  pendingBills.forEach((b) => addPending(subCodes.get(b.subcontractId), b.currentWorkValue));

  const revBy = new Map(revisions.map((r) => [r.costCodeId, r._sum.delta]));
  const ledgerBy = new Map<string, { ACTUAL: unknown; ACCRUAL: unknown; COMMITMENT: unknown }>();
  for (const l of ledger) {
    const cur = ledgerBy.get(l.costCodeId) ?? { ACTUAL: 0, ACCRUAL: 0, COMMITMENT: 0 };
    cur[l.kind] = l._sum.amount ?? 0;
    ledgerBy.set(l.costCodeId, cur);
  }
  const latestForecast = new Map<string, (typeof forecasts)[number]>();
  for (const f of forecasts) if (!latestForecast.has(f.costCodeId)) latestForecast.set(f.costCodeId, f);
  const exposureBy = new Map<string, ReturnType<typeof D>>();
  let unallocatedExposure = D(0);
  for (const v of variations) {
    if (v.costCodeId) exposureBy.set(v.costCodeId, (exposureBy.get(v.costCodeId) ?? D(0)).plus(D(v.costImpact)));
    else unallocatedExposure = unallocatedExposure.plus(D(v.costImpact));
  }

  const rows: CostCodePosition[] = codes.map((c) => {
    const l = ledgerBy.get(c.id) ?? { ACTUAL: 0, ACCRUAL: 0, COMMITMENT: 0 };
    const f = latestForecast.get(c.id);
    const position = computeCostPosition(
      {
        originalBudget: c.budgetLine?.originalAmount ?? 0,
        approvedRevisions: (revBy.get(c.id) as never) ?? 0,
        contingency: c.budgetLine?.contingencyAmount ?? 0,
        actual: l.ACTUAL as never,
        accrued: l.ACCRUAL as never,
        openCommitments: l.COMMITMENT as never,
        pending: pendingBy.get(c.id) ?? 0,
        uncommittedEtc: f && f.method === 'MANUAL' ? f.uncommittedEtc : null,
        pendingVariationExposure: exposureBy.get(c.id) ?? 0,
      },
      settings.alertWarnPct,
    );
    return { costCodeId: c.id, code: c.code, name: c.name, category: c.category, position, forecastAssumptions: f?.assumptions ?? null, forecastPeriod: f?.periodCode ?? null };
  });
  const total = rows.length ? rollupPositions(rows.map((r) => r.position), settings.alertWarnPct) : computeCostPosition({ originalBudget: 0, approvedRevisions: 0, actual: 0, accrued: 0, openCommitments: 0 });
  total.pendingVariationExposure = money(D(total.pendingVariationExposure).plus(unallocatedExposure));
  const byCategory = Object.entries(
    rows.reduce<Record<string, CostPosition[]>>((acc, r) => {
      (acc[r.category] ??= []).push(r.position);
      return acc;
    }, {}),
  ).map(([category, ps]) => ({ category, position: rollupPositions(ps, settings.alertWarnPct) }));
  return { rows, total, byCategory, unallocatedExposure: money(unallocatedExposure) };
}

/** Remaining budget for each cost code (used for PR/PO budget checks). */
export async function remainingByCostCode(db: Db, projectId: string): Promise<Map<string, string>> {
  const { rows } = await projectCostPositions(db, projectId);
  return new Map(rows.map((r) => [r.costCodeId, r.position.remainingBudget]));
}

export interface BudgetCheckLine {
  costCodeId: string;
  amount: string;
}

export async function budgetCheck(db: Db, projectId: string, lines: BudgetCheckLine[]) {
  const remaining = await remainingByCostCode(db, projectId);
  const codes = new Map((await db.costCode.findMany({ where: { projectId }, select: { id: true, code: true } })).map((c) => [c.id, c.code]));
  const grouped = new Map<string, ReturnType<typeof D>>();
  for (const l of lines) grouped.set(l.costCodeId, (grouped.get(l.costCodeId) ?? D(0)).plus(D(l.amount)));
  const result = [...grouped.entries()].map(([cc, amt]) => {
    const avail = D(remaining.get(cc) ?? 0);
    return { costCodeId: cc, costCode: codes.get(cc) ?? cc, available: money(avail), requested: money(amt), after: money(avail.minus(amt)), exceeded: avail.minus(amt).isNeg() };
  });
  return { lines: result, exceeded: result.some((r) => r.exceeded), total: money(sum(result.map((r) => r.requested))) };
}
