import { D, money, unitFactor } from '@toprock/shared';
import type { Tx } from '../lib/prisma.js';
import type { AccessContext } from './access.js';
import { audit } from './audit.js';
import { getOrgSettings } from './settings.js';

/** PO statuses whose prices count as purchases (approved, whether or not delivered or closed since). */
export const PURCHASED_PO_STATUSES = ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'];

/** Rate after discount, before tax, per the PO line's own unit. */
export const netLineRate = (l: { rate: unknown; discountPct: unknown }) => D(l.rate as string).times(D(1).minus(D(l.discountPct as string)));

/**
 * Recomputes each material's purchase rates from every approved PO line of the organisation:
 * last purchase rate (latest approved PO, then latest order date) and the quantity-weighted average.
 * Rates are per the material's own unit; PO lines in another unit are converted (Kg → MT) and lines
 * in a unit that cannot be converted are left out. When the organisation setting is on, the standard
 * rate follows the last purchase rate, so later MR → PR estimates and BOM rates use current prices,
 * and BOM lines priced from these materials are re-priced straight away.
 */
export async function refreshMaterialPurchaseRates(tx: Tx, ctx: Pick<AccessContext, 'orgId' | 'user' | 'ip' | 'userAgent'>, materialIds: string[], reason = 'purchase order approved') {
  const orgId = ctx.orgId;
  const ids = [...new Set(materialIds.filter(Boolean))];
  if (!ids.length) return [];
  const settings = await getOrgSettings(tx, orgId);
  const materials = await tx.material.findMany({ where: { orgId, id: { in: ids } } });
  const lines = await tx.purchaseOrderLine.findMany({
    where: { materialId: { in: ids }, po: { status: { in: PURCHASED_PO_STATUSES }, project: { orgId } } },
    select: { materialId: true, qty: true, unit: true, rate: true, discountPct: true, po: { select: { number: true, orderDate: true, approvedAt: true } } },
  });
  const updated = [];
  for (const m of materials) {
    let qty = D(0);
    let value = D(0);
    let last: { rate: ReturnType<typeof D>; at: number; date: Date; ref: string } | null = null;
    for (const l of lines.filter((x) => x.materialId === m.id)) {
      const f = unitFactor(l.unit, m.unit); // 1 line unit = f material units
      if (!f || f.isZero()) continue;
      const rate = netLineRate(l).div(f); // per material unit
      const q = D(l.qty).times(f);
      qty = qty.plus(q);
      value = value.plus(q.times(rate));
      const at = (l.po.approvedAt ?? l.po.orderDate).getTime() + l.po.orderDate.getTime() / 1e6;
      if (!last || at > last.at) last = { rate, at, date: l.po.orderDate, ref: l.po.number };
    }
    const data = last
      ? {
          lastPurchaseRate: last.rate.toDecimalPlaces(4).toString(),
          lastPurchaseDate: last.date,
          lastPurchaseRef: last.ref,
          avgPurchaseRate: qty.isZero() ? null : value.div(qty).toDecimalPlaces(4).toString(),
          ...(settings.updateStandardRateFromPo ? { standardRate: last.rate.toDecimalPlaces(4).toString() } : {}),
        }
      : { lastPurchaseRate: null, lastPurchaseDate: null, lastPurchaseRef: null, avgPurchaseRate: null };
    updated.push(await tx.material.update({ where: { id: m.id }, data }));
  }
  // BOM lines priced from these materials follow the new rates.
  await repriceBomForMaterials(tx, ctx, ids, reason);
  return updated;
}

/**
 * The material's current rate expressed per a BOM line's unit (standard rate, else last purchase rate).
 * A rate per MT on a line in Kg is converted; a line whose unit cannot be converted (Bag vs Kg) gets no rate.
 */
export function rateForLine(m: { unit: string; standardRate: unknown; lastPurchaseRate: unknown }, lineUnit: string): { rate: string | null; reason: 'OK' | 'NO_RATE' | 'UNIT' } {
  const base = m.standardRate ?? m.lastPurchaseRate;
  if (base === null || base === undefined) return { rate: null, reason: 'NO_RATE' };
  const f = unitFactor(lineUnit, m.unit); // 1 line unit = f material units
  if (!f) return { rate: null, reason: 'UNIT' };
  return { rate: D(base as string).times(f).toDecimalPlaces(4).toString(), reason: 'OK' };
}

/**
 * After a material's rate changes (edited, or moved by an approved PO), every BOM line in every project of
 * the organisation that takes its rate from that material is re-priced. Rates typed in by hand or read from
 * the estimator's file are left alone. One audit entry per project records the lines and the BOM total change.
 */
export async function repriceBomForMaterials(tx: Tx, ctx: Pick<AccessContext, 'orgId' | 'user' | 'ip' | 'userAgent'>, materialIds: string[], reason: string) {
  const ids = [...new Set(materialIds.filter(Boolean))];
  if (!ids.length) return { lines: 0, projects: 0 };
  const lines = await tx.bomLine.findMany({
    // Lines priced from the material, and linked lines still without a rate. Typed and file rates are left alone.
    where: { materialId: { in: ids }, OR: [{ rateSource: 'MATERIAL' }, { rate: null }], bomItem: { project: { orgId: ctx.orgId } } },
    include: { material: { select: { unit: true, standardRate: true, lastPurchaseRate: true, code: true } }, bomItem: { select: { projectId: true } } },
  });
  const perProject = new Map<string, { lines: number; before: ReturnType<typeof D>; after: ReturnType<typeof D>; codes: Set<string> }>();
  for (const l of lines) {
    if (!l.material) continue;
    const r = rateForLine(l.material, l.unit);
    if (!r.rate || (l.rate !== null && D(l.rate).eq(D(r.rate)))) continue;
    const amount = money(D(l.totalQty).times(D(r.rate)));
    await tx.bomLine.update({ where: { id: l.id }, data: { rate: r.rate, rateSource: 'MATERIAL', amount } });
    const p = perProject.get(l.bomItem.projectId) ?? { lines: 0, before: D(0), after: D(0), codes: new Set<string>() };
    p.lines++;
    p.before = p.before.plus(D(l.amount ?? 0));
    p.after = p.after.plus(D(amount));
    p.codes.add(l.material.code);
    perProject.set(l.bomItem.projectId, p);
  }
  let total = 0;
  for (const [projectId, p] of perProject) {
    total += p.lines;
    await audit(tx, ctx, { action: 'UPDATE', entityType: 'bom', projectId, summary: `BOM re-priced automatically (${reason}): ${p.lines} line(s) of ${[...p.codes].join(', ')}, ${money(p.before)} → ${money(p.after)}` });
  }
  return { lines: total, projects: perProject.size };
}
