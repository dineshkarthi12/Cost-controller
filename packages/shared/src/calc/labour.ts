import { D, type DecInput, money, round2 } from '../money.js';

/**
 * Labour cost for a manpower line:
 *  cost = workers × (regularHours × hourlyRate + overtimeHours × overtimeRate)
 * where hours are per worker and rates are per hour.
 */
export function labourLineCost(l: { actualCount: DecInput; regularHours: DecInput; overtimeHours: DecInput; hourlyRate: DecInput; overtimeRate: DecInput }) {
  const perWorker = D(l.regularHours).times(D(l.hourlyRate)).plus(D(l.overtimeHours).times(D(l.overtimeRate)));
  return money(round2(D(l.actualCount).times(perWorker)));
}

/** Productivity = executed qty per man-hour. */
export function labourProductivity(executedQty: DecInput, manHours: DecInput): string | null {
  if (D(manHours).isZero()) return null;
  return D(executedQty).div(D(manHours)).toFixed(4);
}
