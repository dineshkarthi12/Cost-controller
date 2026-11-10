/**
 * Daily labour report: morning allocation of workers to work, evening measurement of the work
 * done, and productivity against per-day norms (see packages/shared/src/calc/productivity.ts).
 *
 * This is a productivity report. It posts nothing to the cost ledger; labour cost reaches the
 * ledger only through verified manpower reports (MPR), so nothing is counted twice.
 */
import { z } from 'zod';
import { D, gangProductivity, summariseProductivity, GANG_PROGRESS, type ProductivitySummary } from '@toprock/shared';
import type { Db, Tx } from '../lib/prisma.js';
import { validationError } from '../lib/errors.js';
import { addDays, isoDate, toDateOnly, today } from '../lib/dates.js';
import { getOrgSettings } from './settings.js';
import { normByName } from './labourExcelImport.js';
import { ensureStandardNorms } from './standardNorms.js';

const zQty = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'Enter a number')]).nullable().optional();

export const gangInputSchema = z.object({
  work: z.string().trim().min(1, 'Describe the work').max(300),
  workers: z.array(z.string().trim().min(1).max(80)).max(60).default([]),
  // Half days are entered as 0.5.
  masons: z.coerce.number().min(0).max(60).refine((v) => Number.isInteger(v * 2), 'Use whole or half days (e.g. 0.5)'),
  helpers: z.coerce.number().min(0).max(60).refine((v) => Number.isInteger(v * 2), 'Use whole or half days (e.g. 0.5)'),
  normId: z.string().nullable().optional(),
  doneQty: zQty,
  unit: z.string().trim().max(20).nullable().optional(),
  normId2: z.string().nullable().optional(),
  doneQty2: zQty,
  unit2: z.string().trim().max(20).nullable().optional(),
  progress: z.enum(GANG_PROGRESS).default('PLANNED'),
  outcome: z.string().trim().max(300).nullable().optional(),
});
export type GangInput = z.infer<typeof gangInputSchema>;

export const reportBodySchema = z.object({
  remarks: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['PLANNED', 'COMPLETED']).optional(),
  gangs: z.array(gangInputSchema).max(100),
  expectedUpdatedAt: z.string().optional(),
});
export const createReportSchema = reportBodySchema.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD') });

export function assertReportDate(date: string) {
  const d = toDateOnly(date)!;
  if (d > addDays(today(), 1)) throw validationError('A labour report cannot be made for a future date');
  return d;
}

type NormRow = { id: string; name: string; unit: string; outputPerDay: { toString(): string }; masonsPerCrew: number; helpersPerCrew: number };
const normInputOf = (n: NormRow | null | undefined) => (n ? { outputPerDay: n.outputPerDay.toString(), masonsPerCrew: n.masonsPerCrew, helpersPerCrew: n.helpersPerCrew, unit: n.unit } : null);
const hasValue = (v: unknown) => v !== null && v !== undefined && String(v) !== '';

/** Validates norms, fills units and computes every gang's productivity and the day's totals. */
export async function prepareGangs(tx: Tx, orgId: string, gangs: GangInput[], rates: { masonRate: unknown; helperRate: unknown }) {
  // Work with a quantity but no norm chosen: use the norm its name describes (own norms first, then the standard library).
  if (gangs.some((g) => !g.normId && hasValue(g.doneQty))) {
    await ensureStandardNorms(tx, orgId);
    const all = await tx.labourNorm.findMany({ where: { orgId, active: true } });
    gangs = gangs.map((g) => (g.normId || !hasValue(g.doneQty) ? g : { ...g, normId: normByName(g.work, g.unit || null, all)?.id ?? null }));
  }
  const normIds = [...new Set(gangs.flatMap((g) => [g.normId, g.normId2]).filter((x): x is string => !!x))];
  const norms = new Map((await tx.labourNorm.findMany({ where: { orgId, id: { in: normIds } } })).map((n) => [n.id, n]));
  const errors: string[] = [];
  const measurement = (i: number, normId: string | null | undefined, qty: unknown, unitIn: string | null | undefined, label: string) => {
    const norm = normId ? norms.get(normId) : undefined;
    if (normId && !norm) errors.push(`Line ${i + 1}: ${label}norm not found`);
    const q = hasValue(qty) ? String(qty) : null;
    const unit = unitIn || (q && norm ? norm.unit : null) || null;
    if (q && norm && unit !== norm.unit) errors.push(`Line ${i + 1}: ${label}quantity is in ${unit} but the norm “${norm.name}” is in ${norm.unit}`);
    return { norm, qty: q, unit };
  };
  const rows = gangs.map((g, i) => {
    const a = measurement(i, g.normId, g.doneQty, g.unit, '');
    const b = measurement(i, g.normId2, g.doneQty2, g.unit2, 'second ');
    const second = b.qty || b.norm ? { doneQty: b.qty, norm: normInputOf(b.norm), unit: b.unit } : null;
    const input = { masons: g.masons, helpers: g.helpers, doneQty: a.qty, norm: normInputOf(a.norm), unit: a.unit, second };
    const productivity = gangProductivity(input, { masonRate: String(rates.masonRate), helperRate: String(rates.helperRate) });
    return {
      input: { ...input, productivity },
      data: {
        lineNo: i + 1,
        work: g.work,
        workers: g.workers,
        masons: g.masons,
        helpers: g.helpers,
        normId: a.norm?.id ?? null,
        doneQty: a.qty,
        unit: a.unit,
        normId2: b.norm?.id ?? null,
        doneQty2: b.qty,
        unit2: b.qty ? b.unit : null,
        progress: g.progress,
        outcome: g.outcome || null,
        labourCost: productivity.labourCost,
        outputPct: productivity.outputPct,
        masonsNeeded: productivity.masonsNeeded,
        helpersNeeded: productivity.helpersNeeded,
        result: productivity.result,
        profitLoss: productivity.profitLoss,
      },
    };
  });
  if (errors.length) throw validationError(errors[0], { errors });
  const summary = summariseProductivity(rows.map((r) => r.input));
  return {
    gangs: rows.map((r) => r.data),
    summary,
    totals: { masonDays: summary.masonDays, helperDays: summary.helperDays, labourCost: summary.labourCost, outputPct: summary.outputPct, profitLoss: summary.profitLoss },
  };
}

export async function currentRates(db: Db, orgId: string) {
  const s = await getOrgSettings(db, orgId);
  return { masonRate: s.masonDayRate, helperRate: s.helperDayRate };
}

const normSelect = { select: { id: true, code: true, name: true, unit: true, outputPerDay: true, masonsPerCrew: true, helpersPerCrew: true } };
const reportInclude = { gangs: { orderBy: { lineNo: 'asc' as const }, include: { norm: normSelect, norm2: normSelect } } };

export async function loadReport(db: Db, projectId: string, id: string) {
  return db.dailyLabourReport.findFirst({ where: { id, projectId }, include: reportInclude });
}

type LoadedReport = NonNullable<Awaited<ReturnType<typeof loadReport>>>;

/** Recomputes the day's summary from stored gangs (for screens and exports). */
export function reportSummary(r: LoadedReport): ProductivitySummary {
  return summariseProductivity(
    r.gangs.map((g) => {
      const second = g.doneQty2 || g.norm2 ? { doneQty: g.doneQty2?.toString() ?? null, norm: normInputOf(g.norm2), unit: g.unit2 } : null;
      const input = { masons: Number(g.masons), helpers: Number(g.helpers), doneQty: g.doneQty?.toString() ?? null, norm: normInputOf(g.norm), unit: g.unit, second };
      return { ...input, productivity: gangProductivity(input, { masonRate: r.masonRate.toString(), helperRate: r.helperRate.toString() }) };
    }),
  );
}

/** Reports of the given projects in a date range, with project names, oldest first. */
export async function reportsInRange(db: Db, projectIds: string[], from: string, to: string) {
  const reports = await db.dailyLabourReport.findMany({
    where: { projectId: { in: projectIds }, date: { gte: toDateOnly(from)!, lte: toDateOnly(to)! } },
    include: { ...reportInclude, project: { select: { id: true, code: true, name: true } } },
    orderBy: [{ date: 'asc' }, { project: { name: 'asc' } }],
  });
  return reports;
}

export function parseRange(q: Record<string, unknown>, maxDays = 62) {
  const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const date = ymd(q.date);
  const to = ymd(q.to) ?? date ?? isoDate(today())!;
  const from = ymd(q.from) ?? date ?? to;
  if (from > to) throw validationError('“From” must be on or before “To”');
  if ((toDateOnly(to)!.getTime() - toDateOnly(from)!.getTime()) / 86_400_000 > maxDays) throw validationError(`Choose at most ${maxDays} days`);
  return { from, to };
}

export const pct = (v: unknown) => (v === null || v === undefined ? null : D(v as string).toNumber());
