import { Router } from 'express';
import { D, rateSupplier, type SupplierFacts } from '@toprock/shared';
import { prisma } from '../lib/prisma.js';
import { forbidden } from '../lib/errors.js';
import { ctxOf } from '../middleware/auth.js';
import { accessibleProjectIds, can } from '../services/access.js';
import { PURCHASED_PO_STATUSES } from '../services/materialRates.js';

/**
 * Supplier rating from goods receipts, inspections, invoices and PO rates (see rateSupplier):
 * across the projects where the viewer can see procurement, or one project with ?projectId=.
 */
export const supplierRatingsRouter = Router();

const LIVE_INVOICE = { notIn: ['DRAFT', 'CANCELLED', 'REJECTED', 'RETURNED'] };

export async function supplierRatings(orgId: string, projectIds: string[], supplierIds?: string[]) {
  const sup = supplierIds ? { in: supplierIds } : undefined;
  const [grns, mirs, invoices, poLines] = await Promise.all([
    prisma.grn.findMany({ where: { projectId: { in: projectIds }, status: 'APPROVED', ...(sup ? { supplierId: sup } : {}) }, select: { supplierId: true, receivedDate: true, po: { select: { deliveryDate: true } }, lines: { select: { receivedQty: true, acceptedQty: true } } } }),
    prisma.mir.findMany({ where: { projectId: { in: projectIds }, status: 'APPROVED', grn: sup ? { supplierId: sup } : { isNot: null } }, select: { result: true, grn: { select: { supplierId: true } } } }),
    prisma.supplierInvoice.findMany({ where: { projectId: { in: projectIds }, status: LIVE_INVOICE, matchResult: { not: undefined }, ...(sup ? { supplierId: sup } : {}) }, select: { supplierId: true, matchResult: true } }),
    // Every supplier's PO lines, so prices are compared with the whole market of the viewer's projects.
    prisma.purchaseOrderLine.findMany({ where: { materialId: { not: null }, po: { projectId: { in: projectIds }, status: { in: PURCHASED_PO_STATUSES } } }, select: { materialId: true, unit: true, qty: true, rate: true, discountPct: true, po: { select: { supplierId: true } } } }),
  ]);
  const facts = new Map<string, SupplierFacts>();
  const get = (id: string) => {
    let f = facts.get(id);
    if (!f) facts.set(id, (f = { deliveries: { total: 0, onTime: 0 }, receipts: { count: 0, received: 0, accepted: 0 }, inspections: { total: 0, rejected: 0 }, invoices: { total: 0, exceptions: 0 }, priceIndex: [] }));
    return f;
  };
  for (const g of grns) {
    const f = get(g.supplierId);
    f.receipts.count++;
    for (const l of g.lines) {
      f.receipts.received += Number(l.receivedQty);
      f.receipts.accepted += Number(l.acceptedQty);
    }
    if (g.po.deliveryDate) {
      f.deliveries.total++;
      if (g.receivedDate <= g.po.deliveryDate) f.deliveries.onTime++;
    }
  }
  for (const m of mirs) {
    if (!m.grn || m.result === 'PENDING') continue;
    const f = get(m.grn.supplierId);
    f.inspections.total++;
    if (m.result === 'REJECTED') f.inspections.rejected++;
  }
  for (const i of invoices) {
    const r = i.matchResult as { matched?: boolean; unlinkedLines?: number } | null;
    if (!r) continue;
    const f = get(i.supplierId);
    f.invoices.total++;
    if (r.matched === false || (r.unlinkedLines ?? 0) > 0) f.invoices.exceptions++;
  }
  // Price: per material and unit, each supplier's average net rate against the average of all suppliers.
  const market = new Map<string, Map<string, { qty: ReturnType<typeof D>; value: ReturnType<typeof D> }>>();
  for (const l of poLines) {
    const key = `${l.materialId}|${l.unit.toLowerCase()}`;
    const bySup = market.get(key) ?? new Map();
    const net = D(l.rate).times(D(1).minus(D(l.discountPct)));
    const cur = bySup.get(l.po.supplierId) ?? { qty: D(0), value: D(0) };
    bySup.set(l.po.supplierId, { qty: cur.qty.plus(D(l.qty)), value: cur.value.plus(net.times(D(l.qty))) });
    market.set(key, bySup);
  }
  for (const bySup of market.values()) {
    if (bySup.size < 2) continue;
    let q = D(0), v = D(0);
    for (const x of bySup.values()) { q = q.plus(x.qty); v = v.plus(x.value); }
    if (q.isZero() || v.isZero()) continue;
    const avg = v.div(q);
    for (const [sid, x] of bySup) {
      if (sup && !supplierIds!.includes(sid)) continue;
      if (x.qty.isZero()) continue;
      get(sid).priceIndex.push({ index: x.value.div(x.qty).div(avg).toNumber(), weight: x.value.toNumber() });
    }
  }
  const parties = await prisma.party.findMany({ where: { orgId, id: { in: [...facts.keys()] } }, select: { id: true, code: true, name: true } });
  return parties
    .map((p) => {
      const f = facts.get(p.id)!;
      return { supplier: p, ...rateSupplier(f), counts: { receipts: f.receipts.count, deliveries: f.deliveries.total, onTime: f.deliveries.onTime, inspections: f.inspections.total, rejectedInspections: f.inspections.rejected, invoices: f.invoices.total, invoiceExceptions: f.invoices.exceptions, pricedMaterials: f.priceIndex.length } };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.supplier.name.localeCompare(b.supplier.name));
}

supplierRatingsRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : null;
  const ids = (await accessibleProjectIds(prisma, ctx)).filter((id) => (projectId ? id === projectId : true) && can(ctx, 'procurement.view', id));
  if (!ids.length) throw forbidden('You cannot see procurement in any project');
  res.json({ projects: ids.length, rows: await supplierRatings(ctx.orgId, ids) });
});
