import type { StockTxnType } from '@prisma/client';
import { D, money, round4, valueIssue } from '@toprock/shared';
import type { Db, Tx } from '../lib/prisma.js';
import { businessRule } from '../lib/errors.js';

export async function stockBalance(db: Db, storeId: string, materialId: string) {
  const agg = await db.stockTransaction.aggregate({ where: { storeId, materialId }, _sum: { qty: true, value: true } });
  return { qty: D(agg._sum.qty ?? 0), value: D(agg._sum.value ?? 0) };
}

export async function projectStock(db: Db, projectId: string, materialIds: string[]) {
  const rows = await db.stockTransaction.groupBy({ by: ['materialId'], where: { projectId, materialId: { in: materialIds } }, _sum: { qty: true } });
  return new Map(rows.map((r) => [r.materialId, D(r._sum.qty ?? 0)]));
}

/** Serialises stock postings for a store/material pair inside the current transaction. */
async function lock(tx: Tx, storeId: string, materialId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${storeId + ':' + materialId}))`;
}

export interface StockMove {
  projectId: string;
  storeId: string;
  materialId: string;
  date: Date;
  type: StockTxnType;
  qty: string; // positive magnitude; sign derived from type (ADJUSTMENT keeps sign)
  unitCost?: string; // required for inbound receipts / opening
  batchNo?: string | null;
  refType?: string;
  refId?: string;
  refNumber?: string | null;
  costCodeId?: string | null;
  activityId?: string | null;
  reason?: string | null;
  createdById: string;
}

const OUTBOUND: StockTxnType[] = ['ISSUE', 'TRANSFER_OUT', 'RETURN_TO_SUPPLIER', 'WASTAGE', 'DAMAGE'];

/** Posts one stock transaction. Outbound moves are valued at weighted average cost. */
export async function postStock(tx: Tx, m: StockMove) {
  await lock(tx, m.storeId, m.materialId);
  const bal = await stockBalance(tx, m.storeId, m.materialId);
  let qty = D(m.qty);
  let unitCost: string;
  let value: string;
  if (OUTBOUND.includes(m.type) || (m.type === 'ADJUSTMENT' && qty.isNeg())) {
    const magnitude = qty.abs();
    try {
      const v = valueIssue(bal.qty, bal.value, magnitude);
      unitCost = v.unitCost;
      value = D(v.value).neg().toFixed(2);
    } catch (e) {
      throw businessRule((e as Error).message);
    }
    qty = magnitude.neg();
  } else {
    if (m.unitCost === undefined) {
      // inbound without explicit cost (returns to store, positive adjustments): use current average
      unitCost = bal.qty.isZero() ? '0' : round4(bal.value.div(bal.qty)).toFixed(4);
    } else unitCost = D(m.unitCost).toFixed(4);
    qty = qty.abs();
    value = money(qty.times(D(unitCost)));
  }
  return tx.stockTransaction.create({
    data: {
      projectId: m.projectId,
      storeId: m.storeId,
      materialId: m.materialId,
      date: m.date,
      type: m.type,
      qty: qty.toFixed(4),
      unitCost,
      value,
      batchNo: m.batchNo ?? null,
      refType: m.refType ?? null,
      refId: m.refId ?? null,
      refNumber: m.refNumber ?? null,
      costCodeId: m.costCodeId ?? null,
      activityId: m.activityId ?? null,
      reason: m.reason ?? null,
      createdById: m.createdById,
    },
  });
}
