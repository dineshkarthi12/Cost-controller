import { D, unitFactor } from '@toprock/shared';
import type { Tx } from '../lib/prisma.js';
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
 * rate follows the last purchase rate, so later MR → PR estimates and BOM rates use current prices.
 */
export async function refreshMaterialPurchaseRates(tx: Tx, orgId: string, materialIds: string[]) {
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
  return updated;
}
