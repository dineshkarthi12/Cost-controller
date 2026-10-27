import { D, type DecInput, ratio, sum } from '../money.js';

export interface EvmActivity {
  weight: DecInput;
  percentComplete: DecInput; // 0..100
  baselineStart?: Date | string | null;
  baselineFinish?: Date | string | null;
}

export interface EvmResult {
  physicalPct: string | null; // 0..1
  plannedPct: string | null; // 0..1
  pv: string | null;
  ev: string | null;
  ac: string;
  cpi: string | null;
  spi: string | null;
  notes: string[];
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Linear baseline % complete at `asOf` (0..1). */
export function plannedFraction(start: Date | null, finish: Date | null, asOf: Date): number | null {
  if (!start || !finish) return null;
  if (asOf <= start) return 0;
  if (asOf >= finish) return 1;
  const total = finish.getTime() - start.getTime();
  if (total <= 0) return 1;
  return (asOf.getTime() - start.getTime()) / total;
}

/** Earned value per BUSINESS_RULES.md §3. Returns nulls with notes when not calculable. */
export function computeEvm(activities: EvmActivity[], bac: DecInput, actualCost: DecInput, asOf: Date): EvmResult {
  const notes: string[] = [];
  const weighted = activities.filter((a) => D(a.weight).gt(0));
  const ac = D(actualCost);
  if (weighted.length === 0) {
    notes.push('No weighted activities — physical progress and EVM cannot be calculated.');
    return { physicalPct: null, plannedPct: null, pv: null, ev: null, ac: ac.toFixed(2), cpi: null, spi: null, notes };
  }
  const totalW = sum(weighted.map((a) => a.weight));
  const physical = sum(weighted.map((a) => D(a.weight).times(D(a.percentComplete).div(100)))).div(totalW);
  const withBaseline = weighted.filter((a) => toDate(a.baselineStart) && toDate(a.baselineFinish));
  let planned: ReturnType<typeof D> | null = null;
  if (withBaseline.length === weighted.length) {
    planned = sum(
      weighted.map((a) => D(a.weight).times(plannedFraction(toDate(a.baselineStart), toDate(a.baselineFinish), asOf) ?? 0)),
    ).div(totalW);
  } else {
    notes.push('Some weighted activities have no baseline dates — PV and SPI cannot be calculated.');
  }
  const B = D(bac);
  const ev = B.times(physical);
  const pv = planned ? B.times(planned) : null;
  const cpi = ratio(ev, ac);
  if (cpi === null) notes.push('Actual cost is zero — CPI cannot be calculated.');
  const spi = pv ? ratio(ev, pv) : null;
  if (pv && spi === null) notes.push('Planned value is zero at this date — SPI cannot be calculated.');
  if (B.isZero()) notes.push('Approved budget is zero — PV and EV are zero.');
  return {
    physicalPct: physical.toFixed(4),
    plannedPct: planned ? planned.toFixed(4) : null,
    pv: pv ? pv.toFixed(2) : null,
    ev: ev.toFixed(2),
    ac: ac.toFixed(2),
    cpi: cpi ? cpi.toFixed(3) : null,
    spi: spi ? spi.toFixed(3) : null,
    notes,
  };
}
