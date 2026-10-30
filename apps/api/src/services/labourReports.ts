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

const zQty = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'Enter a number')]).nullable().optional();

export const gangInputSchema = z.object({
  work: z.string().trim().min(1, 'Describe the work').max(300),
  workers: z.array(z.string().trim().min(1).max(80)).max(60).default([]),
  masons: z.coerce.number().int().min(0).max(60),
  helpers: z.coerce.number().int().min(0).max(60),
  normId: z.string().nullable().optional(),
  doneQty: zQty,
  unit: z.string().trim().max(20).nullable().optional(),
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

/** Validates norms, fills units and computes every gang's productivity and the day's totals. */
export async function prepareGangs(tx: Tx, orgId: string, gangs: GangInput[], rates: { masonRate: unknown; helperRate: unknown }) {
  const normIds = [...new Set(gangs.map((g) => g.normId).filter((x): x is string => !!x))];
  const norms = new Map((await tx.labourNorm.findMany({ where: { orgId, id: { in: normIds } } })).map((n) => [n.id, n]));
  const errors: string[] = [];
  const rows = gangs.map((g, i) => {
    const norm = g.normId ? norms.get(g.normId) : undefined;
    if (g.normId && !norm) errors.push(`Line ${i + 1}: norm not found`);
    const hasQty = g.doneQty !== null && g.doneQty !== undefined && String(g.doneQty) !== '';
    const unit = g.unit || (hasQty && norm ? norm.unit : null) || null;
    if (hasQty && norm && unit !== norm.unit) errors.push(`Line ${i + 1}: quantity is in ${unit} but the norm “${norm.name}” is in ${norm.unit}`);
    const normInput = norm ? { outputPerDay: norm.outputPerDay.toString(), masonsPerCrew: norm.masonsPerCrew, helpersPerCrew: norm.helpersPerCrew, unit: norm.unit } : null;
    const productivity = gangProductivity({ masons: g.masons, helpers: g.helpers, doneQty: hasQty ? String(g.doneQty) : null, norm: normInput }, { masonRate: String(rates.masonRate), helperRate: String(rates.helperRate) });
    return {
      input: { masons: g.masons, helpers: g.helpers, doneQty: hasQty ? String(g.doneQty) : null, norm: normInput, unit, productivity },
      data: {
        lineNo: i + 1,
        work: g.work,
        workers: g.workers,
        masons: g.masons,
        helpers: g.helpers,
        normId: norm?.id ?? null,
        doneQty: hasQty ? String(g.doneQty) : null,
        unit,
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

const reportInclude = { gangs: { orderBy: { lineNo: 'asc' as const }, include: { norm: { select: { id: true, code: true, name: true, unit: true, outputPerDay: true, masonsPerCrew: true, helpersPerCrew: true } } } } };

export async function loadReport(db: Db, projectId: string, id: string) {
  return db.dailyLabourReport.findFirst({ where: { id, projectId }, include: reportInclude });
}

type LoadedReport = NonNullable<Awaited<ReturnType<typeof loadReport>>>;

/** Recomputes the day's summary from stored gangs (for screens and exports). */
export function reportSummary(r: LoadedReport): ProductivitySummary {
  return summariseProductivity(
    r.gangs.map((g) => {
      const norm = g.norm ? { outputPerDay: g.norm.outputPerDay.toString(), masonsPerCrew: g.norm.masonsPerCrew, helpersPerCrew: g.norm.helpersPerCrew, unit: g.norm.unit } : null;
      const input = { masons: g.masons, helpers: g.helpers, doneQty: g.doneQty?.toString() ?? null, norm, unit: g.unit };
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
