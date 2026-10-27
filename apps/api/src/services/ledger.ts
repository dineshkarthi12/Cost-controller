import type { LedgerKind } from '@prisma/client';
import { D, money } from '@toprock/shared';
import type { Db } from '../lib/prisma.js';
import { businessRule } from '../lib/errors.js';
import { assertPeriodOpen } from './periods.js';

export interface LedgerPosting {
  projectId: string;
  costCodeId: string;
  date: Date;
  kind: LedgerKind;
  amount: string;
  sourceType: string;
  sourceId: string;
  sourceNumber?: string | null;
  partyId?: string | null;
  description?: string | null;
}

/**
 * Appends entries to the cost ledger. Zero amounts are skipped. Validates the cost code
 * belongs to the project and the period is open. Never updates or deletes entries.
 */
export async function postLedger(db: Db, actorId: string | null, entries: LedgerPosting[]) {
  const nonZero = entries.filter((e) => !D(e.amount).isZero());
  if (nonZero.length === 0) return;
  const codes = await db.costCode.findMany({ where: { id: { in: [...new Set(nonZero.map((e) => e.costCodeId))] } }, select: { id: true, projectId: true, category: true } });
  const byId = new Map(codes.map((c) => [c.id, c]));
  for (const e of nonZero) {
    const cc = byId.get(e.costCodeId);
    if (!cc || cc.projectId !== e.projectId) throw businessRule('Cost code does not belong to this project');
  }
  const periods = new Map<string, string>();
  for (const e of nonZero) {
    const key = e.date.toISOString().slice(0, 7);
    if (!periods.has(key)) periods.set(key, (await assertPeriodOpen(db, e.projectId, e.date)).id);
  }
  await db.costLedgerEntry.createMany({
    data: nonZero.map((e) => ({
      projectId: e.projectId,
      costCodeId: e.costCodeId,
      periodId: periods.get(e.date.toISOString().slice(0, 7)) ?? null,
      date: e.date,
      kind: e.kind,
      amount: money(e.amount),
      category: byId.get(e.costCodeId)!.category,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      sourceNumber: e.sourceNumber ?? null,
      partyId: e.partyId ?? null,
      description: e.description?.slice(0, 300) ?? null,
      createdById: actorId,
    })),
  });
}

/** Net ledger balance for a source (e.g. remaining open commitment of a PO / cost code). */
export async function sourceBalance(db: Db, where: { projectId: string; kind: LedgerKind; sourceType?: string; sourceId?: string; costCodeId?: string; sourceTypes?: string[]; sourceIds?: string[] }) {
  const agg = await db.costLedgerEntry.aggregate({
    _sum: { amount: true },
    where: {
      projectId: where.projectId,
      kind: where.kind,
      ...(where.sourceType ? { sourceType: where.sourceType } : {}),
      ...(where.sourceTypes ? { sourceType: { in: where.sourceTypes } } : {}),
      ...(where.sourceId ? { sourceId: where.sourceId } : {}),
      ...(where.sourceIds ? { sourceId: { in: where.sourceIds } } : {}),
      ...(where.costCodeId ? { costCodeId: where.costCodeId } : {}),
    },
  });
  return D(agg._sum.amount ?? 0);
}

/** Reverses every entry of a source (used when an approved document is cancelled). */
export async function reverseSource(db: Db, actorId: string | null, projectId: string, sourceType: string, sourceId: string, date: Date, reason: string) {
  const rows = await db.costLedgerEntry.groupBy({ by: ['costCodeId', 'kind'], where: { projectId, sourceType, sourceId }, _sum: { amount: true } });
  await postLedger(
    db,
    actorId,
    rows.map((r) => ({ projectId, costCodeId: r.costCodeId, date, kind: r.kind, amount: D(r._sum.amount ?? 0).neg().toFixed(2), sourceType, sourceId, description: `Reversal: ${reason}` })),
  );
}
