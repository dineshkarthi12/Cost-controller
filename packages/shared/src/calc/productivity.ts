/**
 * Daily labour productivity: work done by each gang against a per-day norm.
 *
 * Same rules as TOPROCK's "Daily Labour Productivity Report" workbook:
 *   norm         = output per day for one crew of `masonsPerCrew` masons + `helpersPerCrew` helpers
 *   crew units   = masons used (helpers used when the norm has no mason, or no mason was used)
 *   crew-days earned = done qty ÷ norm output
 *   output %     = crew-days earned ÷ crew units           (1 = exactly on norm)
 *   labour cost  = masons × mason rate + helpers × helper rate
 *   profit/loss  = labour cost × (output % − 1)           (positive = more work than paid for)
 * A gang is "measured" only when it has both a done quantity and a norm; otherwise its
 * labour still counts as used, but it has no output %, and profit/loss is 0.
 */
import { D, round2, round4, sum, type DecInput } from '../money.js';

export const LABOUR_UNITS = ['Sq.ft', 'Nos', 'Rft', 'Rmt', 'Sqm', 'Cum', 'Kg', 'Bags'] as const;
export const GANG_PROGRESS = ['PLANNED', 'IN_PROGRESS', 'DONE'] as const;
export type GangProgress = (typeof GANG_PROGRESS)[number];
export type ProductivityResult = 'NOT_MEASURED' | 'PROFIT' | 'OK' | 'LOSS';

export interface LabourNormInput {
  outputPerDay: DecInput;
  masonsPerCrew: number;
  helpersPerCrew: number;
  unit?: string | null;
}

export interface GangInput {
  masons: number;
  helpers: number;
  doneQty?: DecInput;
  norm?: LabourNormInput | null;
}

export interface LabourRates {
  masonRate: DecInput;
  helperRate: DecInput;
}

export interface GangProductivity {
  labourCost: string;
  measured: boolean;
  /** Fraction, 4 dp (1.2500 = 125 %). Null when not measured. */
  outputPct: string | null;
  shouldDoQty: string | null;
  masonsNeeded: string | null;
  helpersNeeded: string | null;
  result: ProductivityResult;
  profitLoss: string;
}

const resultOf = (measured: boolean, pl: ReturnType<typeof D>): ProductivityResult => {
  if (!measured) return 'NOT_MEASURED';
  const r = pl.toDecimalPlaces(0);
  return r.gt(0) ? 'PROFIT' : r.isZero() ? 'OK' : 'LOSS';
};

export function gangProductivity(g: GangInput, rates: LabourRates): GangProductivity {
  const cost = D(g.masons).times(D(rates.masonRate)).plus(D(g.helpers).times(D(rates.helperRate)));
  const norm = g.norm;
  const hasQty = g.doneQty !== null && g.doneQty !== undefined && String(g.doneQty) !== '';
  const normOutput = norm ? D(norm.outputPerDay) : D(0);
  if (!hasQty || !norm || normOutput.lte(0)) {
    return { labourCost: round2(cost).toFixed(2), measured: false, outputPct: null, shouldDoQty: null, masonsNeeded: null, helpersNeeded: null, result: 'NOT_MEASURED', profitLoss: '0.00' };
  }
  const earned = D(g.doneQty).div(normOutput);
  const crew = norm.masonsPerCrew === 0 ? g.helpers : g.masons > 0 ? g.masons : g.helpers;
  const masonsNeeded = round4(earned.times(norm.masonsPerCrew)).toFixed(4);
  const helpersNeeded = round4(earned.times(norm.helpersPerCrew)).toFixed(4);
  if (crew === 0) {
    // Quantity recorded but nobody on the crew basis: no output % can be worked out.
    return { labourCost: round2(cost).toFixed(2), measured: false, outputPct: null, shouldDoQty: null, masonsNeeded, helpersNeeded, result: 'NOT_MEASURED', profitLoss: '0.00' };
  }
  const pct = earned.div(crew);
  const pl = cost.times(pct.minus(1));
  return {
    labourCost: round2(cost).toFixed(2),
    measured: true,
    outputPct: round4(pct).toFixed(4),
    shouldDoQty: round4(normOutput.times(crew)).toFixed(4),
    masonsNeeded,
    helpersNeeded,
    result: resultOf(true, pl),
    profitLoss: round2(pl).toFixed(2),
  };
}

export interface ProductivitySummary {
  masonDays: number;
  helperDays: number;
  labourCost: string;
  /** Measured work done, by unit. */
  workDone: Record<string, string>;
  masonsUsedMeasured: number;
  helpersUsedMeasured: number;
  masonsNeeded: string;
  helpersNeeded: string;
  outputPct: string | null;
  result: ProductivityResult;
  profitLoss: string;
}

// Unrounded, so day totals match a spreadsheet that sums full-precision cells.
function needed(g: GangInput & { productivity: GangProductivity }, key: 'masonsPerCrew' | 'helpersPerCrew') {
  if (g.productivity.masonsNeeded === null || !g.norm) return D(0);
  return D(g.doneQty).div(D(g.norm.outputPerDay)).times(g.norm[key]);
}

/** Totals for a day (or any set of gangs): output % is weighted by the labour cost of measured gangs. */
export function summariseProductivity(gangs: Array<GangInput & { unit?: string | null; productivity: GangProductivity }>): ProductivitySummary {
  const measured = gangs.filter((g) => g.productivity.measured);
  const measuredCost = sum(measured.map((g) => g.productivity.labourCost));
  const weighted = sum(measured.map((g) => D(g.productivity.labourCost).times(D(g.productivity.outputPct))));
  const pl = sum(gangs.map((g) => g.productivity.profitLoss));
  const workDone: Record<string, ReturnType<typeof D>> = {};
  for (const g of measured) {
    const unit = g.unit || g.norm?.unit || '';
    workDone[unit] = (workDone[unit] ?? D(0)).plus(D(g.doneQty));
  }
  return {
    masonDays: gangs.reduce((a, g) => a + g.masons, 0),
    helperDays: gangs.reduce((a, g) => a + g.helpers, 0),
    labourCost: round2(sum(gangs.map((g) => g.productivity.labourCost))).toFixed(2),
    workDone: Object.fromEntries(Object.entries(workDone).map(([k, v]) => [k, round4(v).toFixed(4)])),
    masonsUsedMeasured: measured.reduce((a, g) => a + g.masons, 0),
    helpersUsedMeasured: measured.reduce((a, g) => a + g.helpers, 0),
    masonsNeeded: round4(sum(gangs.map((g) => needed(g, 'masonsPerCrew')))).toFixed(4),
    helpersNeeded: round4(sum(gangs.map((g) => needed(g, 'helpersPerCrew')))).toFixed(4),
    outputPct: measuredCost.gt(0) ? round4(weighted.div(measuredCost)).toFixed(4) : null,
    result: resultOf(measured.length > 0, pl),
    profitLoss: round2(pl).toFixed(2),
  };
}

/** Default crew split when only names are known: one mason, everyone else a helper. */
export function defaultCrewSplit(workerCount: number): { masons: number; helpers: number } {
  if (workerCount <= 0) return { masons: 0, helpers: 0 };
  return { masons: 1, helpers: workerCount - 1 };
}
