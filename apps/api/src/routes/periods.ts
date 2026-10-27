import { Router } from 'express';
import { z } from 'zod';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess, can } from '../services/access.js';
import { audit } from '../services/audit.js';
import { ensurePeriod, refreshChecklist } from '../services/periodClose.js';
import { submitDocument } from '../services/workflow.js';
import { projectCostPositions } from '../services/budget.js';
import { periodBounds, toDateOnly, today } from '../lib/dates.js';

export const periodsRouter = Router({ mergeParams: true });

periodsRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

periodsRouter.get('/periods', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'period.view', projectId);
  await ensurePeriod(prisma, projectId, today());
  res.json(await prisma.reportingPeriod.findMany({ where: { projectId }, orderBy: { code: 'desc' }, include: { checklist: true } }));
});

periodsRouter.post('/periods', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'period.manage', projectId);
  const { code } = parseBody(z.object({ code: z.string().regex(/^\d{4}-\d{2}$/) }), req.body);
  res.status(201).json(await ensurePeriod(prisma, projectId, periodBounds(code).start));
});

periodsRouter.get('/periods/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'period.view', projectId);
  const p = await prisma.reportingPeriod.findFirst({ where: { id: param(req, 'id'), projectId } });
  if (!p) throw notFound('Period');
  const checklist = p.status === 'OPEN' ? await refreshChecklist(prisma, projectId, p.id) : await prisma.periodChecklistItem.findMany({ where: { periodId: p.id }, orderBy: { key: 'asc' } });
  const asOf = toDateOnly(p.endDate)!;
  const positions = await projectCostPositions(prisma, projectId, { asOf });
  const ledger = await prisma.costLedgerEntry.groupBy({ by: ['kind'], where: { projectId, date: { gte: p.startDate, lte: p.endDate } }, _sum: { amount: true } });
  res.json({ ...p, checklist, periodMovements: Object.fromEntries(ledger.map((l) => [l.kind, l._sum.amount])), positionAtPeriodEnd: positions.total, canReopen: can(ctx, 'period.reopen', projectId) });
});

periodsRouter.post('/periods/:id/checklist/:key', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'period.manage', projectId);
  const data = parseBody(z.object({ status: z.enum(['PENDING', 'DONE', 'WAIVED']), note: z.string().max(1000).optional() }), req.body);
  if (data.status === 'WAIVED' && !data.note?.trim()) throw validationError('Explain why this item is waived');
  const out = await transaction(async (tx) => {
    const p = await tx.reportingPeriod.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!p) throw notFound('Period');
    if (p.status !== 'OPEN') throw conflict('The period is not open');
    const item = await tx.periodChecklistItem.update({ where: { periodId_key: { periodId: p.id, key: param(req, 'key') } }, data: { status: data.status, note: data.note ?? null, completedById: data.status === 'PENDING' ? null : ctx.user.id, completedAt: data.status === 'PENDING' ? null : new Date() } });
    await audit(tx, ctx, { action: 'CHECKLIST_ITEM', entityType: 'reportingPeriod', entityId: p.id, projectId, summary: `${p.code}: ${item.label} → ${data.status}`, reason: data.note });
    return item;
  });
  res.json(out);
});

periodsRouter.patch('/periods/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'period.manage', projectId);
  const { varianceNotes } = parseBody(z.object({ varianceNotes: z.string().max(10000) }), req.body);
  const p = await prisma.reportingPeriod.findFirst({ where: { id: param(req, 'id'), projectId } });
  if (!p) throw notFound('Period');
  if (p.status !== 'OPEN') throw conflict('The period is not open');
  const u = await prisma.reportingPeriod.update({ where: { id: p.id }, data: { varianceNotes } });
  await audit(prisma, ctx, { action: 'VARIANCE_NOTES', entityType: 'reportingPeriod', entityId: p.id, projectId });
  res.json(u);
});

periodsRouter.post('/periods/:id/close', async (req, res) => {
  const p = await prisma.reportingPeriod.findFirst({ where: { id: param(req, 'id'), projectId: param(req, 'projectId') } });
  if (!p) throw notFound('Period');
  res.json(await submitDocument(ctxOf(req), 'PERIOD_CLOSE', p.id, req.body?.comment));
});

periodsRouter.post('/periods/:id/reopen', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'period.reopen', projectId);
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(10).max(2000) }), req.body);
  const out = await transaction(async (tx) => {
    const p = await tx.reportingPeriod.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!p) throw notFound('Period');
    if (p.status !== 'CLOSED') throw conflict('Only closed periods can be reopened');
    const u = await tx.reportingPeriod.update({ where: { id: p.id }, data: { status: 'OPEN', reopenedReason: reason, closedAt: null, closedById: null } });
    await audit(tx, ctx, { action: 'PERIOD_REOPENED', entityType: 'reportingPeriod', entityId: p.id, projectId, summary: `Period ${p.code} reopened`, reason });
    return u;
  });
  res.json(out);
});

// ───────── Project closeout ─────────

const CLOSEOUT_ITEMS: Array<[string, string]> = [
  ['final_boq', 'Final BOQ quantities reconciled'],
  ['final_measurements', 'All measurements certified or closed'],
  ['final_contractor_accounts', 'Final subcontractor accounts agreed'],
  ['final_client_account', 'Final client account agreed'],
  ['outstanding_claims', 'Outstanding claims resolved or provisioned'],
  ['retention_release', 'Retention release scheduled (payable and receivable)'],
  ['final_payments', 'Final payment reconciliation complete'],
  ['remaining_stock', 'Remaining stock transferred, returned or written off'],
  ['asset_handover', 'Equipment and assets handed over / demobilised'],
  ['as_built', 'As-built drawings issued'],
  ['defects_snagging', 'Defects and snagging list closed'],
  ['warranties', 'Warranties and guarantees collected'],
  ['closeout_documents', 'Closeout documents archived'],
  ['final_cost_report', 'Final cost report reviewed'],
  ['lessons_learned', 'Lessons learned recorded'],
];

periodsRouter.get('/closeout', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'closeout.view', projectId);
  let c = await prisma.closeout.findUnique({ where: { projectId }, include: { items: { orderBy: { key: 'asc' } } } });
  const positions = await projectCostPositions(prisma, projectId);
  const indicators = {
    uncertifiedMeasurements: await prisma.measurement.count({ where: { projectId, status: { in: ['DRAFT', 'SUBMITTED', 'VERIFIED', 'PENDING_CERTIFICATION', 'RETURNED'] } } }),
    openPos: await prisma.purchaseOrder.count({ where: { projectId, status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } } }),
    unpaidInvoices: await prisma.supplierInvoice.count({ where: { projectId, status: { in: ['APPROVED', 'PARTIALLY_PAID'] } } }),
    openClaims: await prisma.claim.count({ where: { projectId, status: { in: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'DISPUTED'] } } }),
    openNcrs: await prisma.ncr.count({ where: { projectId, status: { not: 'CLOSED' } } }),
    stockLines: (await prisma.stockTransaction.groupBy({ by: ['materialId', 'storeId'], where: { projectId }, _sum: { qty: true } })).filter((r) => Number(r._sum.qty) !== 0).length,
    openPeriods: await prisma.reportingPeriod.count({ where: { projectId, status: { not: 'CLOSED' } } }),
  };
  if (!c) c = null;
  res.json({ closeout: c, finalCost: positions.total, byCategory: positions.byCategory, indicators });
});

periodsRouter.post('/closeout/start', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'closeout.manage', projectId);
  const out = await transaction(async (tx) => {
    const existing = await tx.closeout.findUnique({ where: { projectId } });
    if (existing) throw conflict('Closeout already started');
    const c = await tx.closeout.create({ data: { projectId, createdById: ctx.user.id, items: { create: CLOSEOUT_ITEMS.map(([key, label]) => ({ key, label })) } } });
    await tx.project.update({ where: { id: projectId }, data: { closeoutStatus: 'IN_PROGRESS' } });
    await audit(tx, ctx, { action: 'CLOSEOUT_STARTED', entityType: 'closeout', entityId: c.id, projectId });
    return c;
  });
  res.status(201).json(out);
});

periodsRouter.post('/closeout/items/:key', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'closeout.manage', projectId);
  const data = parseBody(z.object({ status: z.enum(['PENDING', 'DONE', 'NOT_APPLICABLE']), note: z.string().max(2000).optional(), ownerId: z.string().optional() }), req.body);
  const c = await prisma.closeout.findUnique({ where: { projectId } });
  if (!c) throw notFound('Closeout');
  if (!['IN_PROGRESS', 'RETURNED'].includes(c.status)) throw conflict('Closeout is not editable');
  if (data.status === 'NOT_APPLICABLE' && !data.note) throw validationError('Explain why the item is not applicable');
  const item = await prisma.closeoutItem.update({ where: { closeoutId_key: { closeoutId: c.id, key: param(req, 'key') } }, data: { status: data.status, note: data.note ?? null, ownerId: data.ownerId ?? undefined, completedAt: data.status === 'PENDING' ? null : new Date() } });
  await audit(prisma, ctx, { action: 'CLOSEOUT_ITEM', entityType: 'closeout', entityId: c.id, projectId, summary: `${item.label} → ${data.status}`, reason: data.note });
  res.json(item);
});

periodsRouter.patch('/closeout', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'closeout.manage', projectId);
  const { lessonsLearned } = parseBody(z.object({ lessonsLearned: z.string().max(20000) }), req.body);
  const c = await prisma.closeout.findUnique({ where: { projectId } });
  if (!c) throw notFound('Closeout');
  if (!['IN_PROGRESS', 'RETURNED'].includes(c.status)) throw conflict('Closeout is not editable');
  res.json(await prisma.closeout.update({ where: { id: c.id }, data: { lessonsLearned } }));
});

periodsRouter.post('/closeout/submit', async (req, res) => {
  const c = await prisma.closeout.findUnique({ where: { projectId: param(req, 'projectId') } });
  if (!c) throw notFound('Closeout');
  res.json(await submitDocument(ctxOf(req), 'CLOSEOUT', c.id, req.body?.comment));
});

periodsRouter.post('/closeout/archive', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'closeout.approve', projectId);
  const c = await prisma.closeout.findUnique({ where: { projectId } });
  if (!c || c.status !== 'APPROVED') throw conflict('Closeout must be approved before archiving');
  const out = await prisma.closeout.update({ where: { id: c.id }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
  await prisma.project.update({ where: { id: projectId }, data: { closeoutStatus: 'ARCHIVED' } });
  await audit(prisma, ctx, { action: 'PROJECT_ARCHIVED', entityType: 'closeout', entityId: c.id, projectId });
  res.json(out);
});
