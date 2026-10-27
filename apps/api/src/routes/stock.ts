import { Router } from 'express';
import { z } from 'zod';
import { consumptionVariance, D, money, zDate, zDecimal } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { toDateOnly } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { postStock } from '../services/stock.js';
import { assertRefsInScope } from '../services/lookups.js';

export const stockRouter = Router({ mergeParams: true });

stockRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

/** Current balance and weighted-average value per store/material. */
stockRouter.get('/balances', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'stock.view', projectId);
  const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined;
  const rows = await prisma.stockTransaction.groupBy({ by: ['storeId', 'materialId'], where: { projectId, ...(storeId ? { storeId } : {}) }, _sum: { qty: true, value: true } });
  const [materials, stores] = await Promise.all([
    prisma.material.findMany({ where: { id: { in: rows.map((r) => r.materialId) } }, select: { id: true, code: true, name: true, unit: true, reorderLevel: true, category: true } }),
    prisma.store.findMany({ where: { projectId }, select: { id: true, code: true, name: true } }),
  ]);
  const m = new Map(materials.map((x) => [x.id, x]));
  const s = new Map(stores.map((x) => [x.id, x]));
  res.json(
    rows
      .map((r) => {
        const qty = D(r._sum.qty ?? 0);
        const value = D(r._sum.value ?? 0);
        const mat = m.get(r.materialId);
        return {
          storeId: r.storeId,
          store: s.get(r.storeId)?.name,
          materialId: r.materialId,
          materialCode: mat?.code,
          material: mat?.name,
          category: mat?.category,
          unit: mat?.unit,
          qty: qty.toFixed(3),
          value: money(value),
          avgCost: qty.isZero() ? null : value.div(qty).toFixed(4),
          belowReorder: mat?.reorderLevel ? qty.lt(D(mat.reorderLevel)) : false,
        };
      })
      .sort((a, b) => String(a.materialCode).localeCompare(String(b.materialCode))),
  );
});

stockRouter.get('/ledger', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'stock.view', projectId);
  const where = {
    projectId,
    ...(typeof req.query.storeId === 'string' ? { storeId: req.query.storeId } : {}),
    ...(typeof req.query.materialId === 'string' ? { materialId: req.query.materialId } : {}),
    ...(typeof req.query.type === 'string' ? { type: req.query.type as never } : {}),
  };
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(200, Number(req.query.pageSize ?? 50));
  const [items, total] = await Promise.all([prisma.stockTransaction.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }), prisma.stockTransaction.count({ where })]);
  const mats = new Map((await prisma.material.findMany({ where: { id: { in: items.map((i) => i.materialId) } }, select: { id: true, code: true, name: true, unit: true } })).map((x) => [x.id, x]));
  const stores = new Map((await prisma.store.findMany({ where: { projectId } })).map((x) => [x.id, x.name]));
  res.json({ items: items.map((i) => ({ ...i, material: mats.get(i.materialId), store: stores.get(i.storeId) })), total, page, pageSize });
});

/** Opening stock. Posted directly (one-off migration step) with a mandatory reason. */
stockRouter.post('/opening', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'stock.manage', projectId);
  const data = parseBody(z.object({ storeId: z.string(), date: zDate, reason: z.string().min(3), lines: z.array(z.object({ materialId: z.string(), qty: zDecimal(4), unitCost: zDecimal(4), batchNo: z.string().optional() })).min(1) }), req.body);
  await transaction(async (tx) => {
    await assertRefsInScope(tx, 'stores', ctx.orgId, projectId, [data.storeId], 'Store');
    await assertRefsInScope(tx, 'materials', ctx.orgId, projectId, data.lines.map((l) => l.materialId), 'Material');
    const existing = await tx.stockTransaction.count({ where: { projectId, storeId: data.storeId, type: 'OPENING', materialId: { in: data.lines.map((l) => l.materialId) } } });
    if (existing) throw conflict('Opening stock already exists for one or more materials in this store. Use an adjustment instead.');
    for (const l of data.lines) {
      if (D(l.qty).lte(0)) throw validationError('Opening quantities must be positive');
      await postStock(tx, { projectId, storeId: data.storeId, materialId: l.materialId, date: toDateOnly(data.date)!, type: 'OPENING', qty: l.qty, unitCost: l.unitCost, batchNo: l.batchNo, refType: 'OPENING', reason: data.reason, createdById: ctx.user.id });
    }
    await audit(tx, ctx, { action: 'OPENING_STOCK', entityType: 'store', entityId: data.storeId, projectId, summary: `Opening stock posted (${data.lines.length} lines)`, reason: data.reason });
  });
  res.status(201).json({ ok: true });
});

/** Posts a physical stock count: variances become ADJUSTMENT transactions. */
stockRouter.post('/counts/:id/post', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'stock.manage', projectId);
  const out = await transaction(async (tx) => {
    const count = await tx.stockCount.findFirst({ where: { id: param(req, 'id'), projectId }, include: { lines: true } });
    if (!count) throw notFound('Stock count');
    if (count.status !== 'DRAFT') throw conflict('This count is already posted');
    for (const l of count.lines) {
      if (D(l.varianceQty).isZero()) continue;
      await postStock(tx, { projectId, storeId: count.storeId, materialId: l.materialId, date: count.countDate, type: 'ADJUSTMENT', qty: l.varianceQty.toString(), refType: 'STOCK_COUNT', refId: count.id, refNumber: count.number, reason: `Physical count variance ${l.remarks ?? ''}`.trim(), createdById: ctx.user.id });
    }
    const u = await tx.stockCount.update({ where: { id: count.id }, data: { status: 'POSTED', postedAt: new Date() } });
    await tx.registerEntry.updateMany({ where: { entityType: 'stockCount', entityId: count.id }, data: { status: 'POSTED' } });
    await audit(tx, ctx, { action: 'POST_COUNT', entityType: 'stockCount', entityId: count.id, projectId, summary: `Stock count ${count.number} posted` });
    return u;
  });
  res.json(out);
});

/**
 * Material reconciliation: received vs issued vs balance, and theoretical vs actual consumption
 * where BOQ rate analysis provides material coefficients.
 */
stockRouter.get('/reconciliation', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'stock.view', projectId);
  const rows = await prisma.stockTransaction.groupBy({ by: ['materialId', 'type'], where: { projectId }, _sum: { qty: true, value: true } });
  const materialIds = [...new Set(rows.map((r) => r.materialId))];
  const mats = await prisma.material.findMany({ where: { id: { in: materialIds } }, select: { id: true, code: true, name: true, unit: true } });
  const rate = await prisma.rateAnalysisLine.findMany({ where: { materialId: { in: materialIds }, boqItem: { projectId } }, include: { boqItem: { select: { executedQty: true, certifiedQty: true } } } });
  res.json(
    mats.map((m) => {
      const g = (t: string) => D(rows.find((r) => r.materialId === m.id && r.type === t)?._sum.qty ?? 0);
      const received = g('OPENING').plus(g('RECEIPT')).plus(g('TRANSFER_IN'));
      const issued = g('ISSUE').neg().minus(g('RETURN_TO_STORE'));
      const wastage = g('WASTAGE').neg().plus(g('DAMAGE').neg());
      const balance = rows.filter((r) => r.materialId === m.id).reduce((a, r) => a.plus(D(r._sum.qty ?? 0)), D(0));
      const theoretical = rate.filter((r) => r.materialId === m.id).reduce((a, r) => a.plus(D(r.boqItem.executedQty).times(D(r.coefficient))), D(0));
      const cv = theoretical.isZero() ? null : consumptionVariance(1, theoretical, issued);
      return {
        materialId: m.id,
        code: m.code,
        name: m.name,
        unit: m.unit,
        received: received.toFixed(3),
        issued: issued.toFixed(3),
        wastage: wastage.toFixed(3),
        transferredOut: g('TRANSFER_OUT').neg().toFixed(3),
        returnedToSupplier: g('RETURN_TO_SUPPLIER').neg().toFixed(3),
        adjustments: g('ADJUSTMENT').toFixed(3),
        balance: balance.toFixed(3),
        theoreticalConsumption: theoretical.isZero() ? null : theoretical.toFixed(3),
        consumptionVariance: cv?.variance ?? null,
        consumptionVariancePct: cv?.variancePct ?? null,
        note: theoretical.isZero() ? 'No rate-analysis coefficient — theoretical consumption not available' : null,
      };
    }),
  );
});
