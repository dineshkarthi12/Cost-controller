import { Router } from 'express';
import { z } from 'zod';
import { computeEvm, D, money, sum, zDecimal } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { parseBody, param } from '../lib/http.js';
import { conflict, validationError } from '../lib/errors.js';
import { periodCode, toDateOnly } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { projectCostPositions } from '../services/budget.js';

export const budgetRouter = Router({ mergeParams: true });

budgetRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

budgetRouter.get('/budget', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'budget.view', projectId);
  const asOf = typeof req.query.asOf === 'string' ? toDateOnly(req.query.asOf)! : undefined;
  const [positions, project, revisions] = await Promise.all([
    projectCostPositions(prisma, projectId, { asOf }),
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { budgetBaselinedAt: true, contractValue: true, currency: true } }),
    prisma.budgetRevision.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, number: true, type: true, title: true, totalDelta: true, status: true, approvedAt: true, createdAt: true } }),
  ]);
  res.json({ ...positions, baselinedAt: project.budgetBaselinedAt, contractValue: project.contractValue, currency: project.currency, revisions, basis: 'Amounts exclude tax unless the organisation treats tax as cost. Accrual basis: cost incurred = actual + accrued.' });
});

const linesSchema = z.object({ lines: z.array(z.object({ costCodeId: z.string(), originalAmount: zDecimal(2), contingencyAmount: zDecimal(2).default('0'), notes: z.string().max(500).nullish() })).min(1) });

/** Edits the original budget. Only allowed before the baseline is approved. */
budgetRouter.put('/budget/lines', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'budget.manage', projectId);
  const { lines } = parseBody(linesSchema, req.body);
  await transaction(async (tx) => {
    const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    if (p.budgetBaselinedAt) throw conflict('The original budget is baselined. Use a budget revision or transfer instead.');
    const codes = await tx.costCode.findMany({ where: { projectId, id: { in: lines.map((l) => l.costCodeId) } }, select: { id: true } });
    if (codes.length !== new Set(lines.map((l) => l.costCodeId)).size) throw validationError('Unknown cost code');
    for (const l of lines) {
      if (D(l.originalAmount).isNeg() || D(l.contingencyAmount).isNeg()) throw validationError('Budget amounts cannot be negative');
      if (D(l.contingencyAmount).gt(D(l.originalAmount))) throw validationError('Contingency is part of the budget and cannot exceed it');
      await tx.budgetLine.upsert({ where: { costCodeId: l.costCodeId }, create: { projectId, costCodeId: l.costCodeId, originalAmount: l.originalAmount, contingencyAmount: l.contingencyAmount, notes: l.notes ?? null }, update: { originalAmount: l.originalAmount, contingencyAmount: l.contingencyAmount, notes: l.notes ?? null } });
    }
    await audit(tx, ctx, { action: 'BUDGET_LINES_UPDATED', entityType: 'project', entityId: projectId, projectId, summary: `Original budget edited (${lines.length} lines)`, after: lines });
  });
  res.json({ ok: true });
});

budgetRouter.post('/budget/baseline', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'budget.approve', projectId);
  const r = await transaction(async (tx) => {
    const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    if (p.budgetBaselinedAt) throw conflict('Budget is already baselined');
    const total = await tx.budgetLine.aggregate({ where: { projectId }, _sum: { originalAmount: true } });
    if (D(total._sum.originalAmount ?? 0).lte(0)) throw validationError('Enter the original budget before baselining');
    const updated = await tx.project.update({ where: { id: projectId }, data: { budgetBaselinedAt: new Date() } });
    await audit(tx, ctx, { action: 'BUDGET_BASELINED', entityType: 'project', entityId: projectId, projectId, summary: `Original budget baselined at ${money(total._sum.originalAmount ?? 0)}` });
    return updated;
  });
  res.json(r);
});

budgetRouter.get('/forecast', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'forecast.view', projectId);
  const asOf = typeof req.query.asOf === 'string' ? toDateOnly(req.query.asOf)! : new Date();
  const [positions, activities, history] = await Promise.all([
    projectCostPositions(prisma, projectId),
    prisma.activity.findMany({ where: { projectId }, select: { weight: true, percentComplete: true, baselineStart: true, baselineFinish: true } }),
    prisma.costForecast.groupBy({ by: ['periodCode'], where: { projectId }, _sum: { uncommittedEtc: true, eacSnapshot: true }, _count: true, orderBy: { periodCode: 'asc' } }),
  ]);
  const evm = computeEvm(activities, positions.total.approvedBudget, positions.total.incurred, asOf);
  res.json({ ...positions, evm, history: history.map((h) => ({ periodCode: h.periodCode, uncommittedEtc: h._sum.uncommittedEtc, eacSnapshot: h._sum.eacSnapshot, entries: h._count })), currentPeriod: periodCode(new Date()) });
});

const forecastSchema = z.object({
  periodCode: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  entries: z.array(z.object({ costCodeId: z.string(), method: z.enum(['MANUAL', 'REMAINING_BUDGET']), uncommittedEtc: zDecimal(2).optional(), assumptions: z.string().max(2000).optional() })).min(1),
});

/** Records the forecast (uncommitted cost to go) per cost code for a period. History is kept per period. */
budgetRouter.post('/forecast', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'forecast.manage', projectId);
  const data = parseBody(forecastSchema, req.body);
  const pc = data.periodCode ?? periodCode(new Date());
  await transaction(async (tx) => {
    const positions = await projectCostPositions(tx, projectId);
    for (const e of data.entries) {
      const row = positions.rows.find((r) => r.costCodeId === e.costCodeId);
      if (!row) throw validationError('Unknown cost code');
      if (e.method === 'MANUAL' && (e.uncommittedEtc === undefined || D(e.uncommittedEtc).isNeg())) throw validationError(`${row.code}: enter a non-negative uncommitted ETC`);
      if (e.method === 'MANUAL' && !e.assumptions?.trim()) throw validationError(`${row.code}: document the forecast assumptions`);
      const etc = e.method === 'MANUAL' ? D(e.uncommittedEtc!) : D(row.position.remainingBudget).isNeg() ? D(0) : D(row.position.remainingBudget);
      const eac = D(row.position.incurred).plus(D(row.position.openCommitments)).plus(etc);
      await tx.costForecast.upsert({
        where: { projectId_costCodeId_periodCode: { projectId, costCodeId: e.costCodeId, periodCode: pc } },
        create: { projectId, costCodeId: e.costCodeId, periodCode: pc, method: e.method, uncommittedEtc: money(etc), assumptions: e.assumptions ?? null, eacSnapshot: money(eac), createdById: ctx.user.id },
        update: { method: e.method, uncommittedEtc: money(etc), assumptions: e.assumptions ?? null, eacSnapshot: money(eac), createdById: ctx.user.id },
      });
    }
    await audit(tx, ctx, { action: 'FORECAST_UPDATED', entityType: 'costForecast', projectId, summary: `Forecast ${pc} updated for ${data.entries.length} cost codes`, after: data });
  });
  res.json({ ok: true, periodCode: pc });
});

budgetRouter.get('/ledger', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'budget.view', projectId);
  const where = {
    projectId,
    ...(typeof req.query.costCodeId === 'string' ? { costCodeId: req.query.costCodeId } : {}),
    ...(typeof req.query.kind === 'string' ? { kind: req.query.kind as never } : {}),
    ...(typeof req.query.sourceType === 'string' ? { sourceType: req.query.sourceType } : {}),
  };
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(200, Number(req.query.pageSize ?? 50));
  const [items, total, sums] = await Promise.all([
    prisma.costLedgerEntry.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: { costCode: { select: { code: true, name: true } } } }),
    prisma.costLedgerEntry.count({ where }),
    prisma.costLedgerEntry.groupBy({ by: ['kind'], where, _sum: { amount: true } }),
  ]);
  res.json({ items, total, page, pageSize, totals: Object.fromEntries(sums.map((s) => [s.kind, money(s._sum.amount ?? 0)])), net: money(sum(sums.map((s) => s._sum.amount ?? 0))) });
});
