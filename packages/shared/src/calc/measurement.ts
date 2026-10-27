import { D, type DecInput, qty } from '../money.js';

export interface MeasurementDims {
  nos?: DecInput;
  length?: DecInput;
  width?: DecInput;
  depth?: DecInput;
}

function present(v: DecInput): boolean {
  return v !== null && v !== undefined && v !== '' && !D(v).isZero();
}

/**
 * Calculated qty = nos × L × W × D using only the dimensions entered.
 * Blank dimensions are treated as 1. At least one value is required.
 */
export function calculateMeasurementQty(d: MeasurementDims): { quantity: string; formula: string } {
  const parts: Array<[string, DecInput]> = [
    ['Nos', d.nos],
    ['L', d.length],
    ['W', d.width],
    ['D', d.depth],
  ];
  const used = parts.filter(([, v]) => present(v));
  if (used.length === 0) throw new Error('At least one of nos, length, width or depth is required');
  const q = used.reduce((acc, [, v]) => acc.times(D(v)), D(1));
  return { quantity: qty(q), formula: used.map(([k, v]) => `${k} ${D(v).toString()}`).join(' × ') };
}

export function measurementVariance(submitted: DecInput, verified: DecInput) {
  const diff = D(verified).minus(D(submitted));
  const pct = D(submitted).isZero() ? null : diff.div(D(submitted));
  return { difference: qty(diff), pct: pct ? pct.toFixed(4) : null };
}
