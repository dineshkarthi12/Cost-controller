import Decimal from 'decimal.js';

/**
 * Decimal-safe numeric helpers. Money crosses the API as strings and is
 * computed with decimal.js — never with JS floating point.
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;
export type DecInput = Decimal.Value | null | undefined | { toString(): string };

export function D(v: DecInput): Decimal {
  if (v === null || v === undefined || v === '') return new Dec(0);
  if (v instanceof Decimal) return v;
  if (typeof v === 'number' || typeof v === 'string') return new Dec(v);
  return new Dec(v.toString());
}

export const ZERO = new Dec(0);

export function round2(v: DecInput): Decimal {
  return D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function round3(v: DecInput): Decimal {
  return D(v).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

export function round4(v: DecInput): Decimal {
  return D(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function sum(values: DecInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Dec(0));
}

export function min(a: DecInput, b: DecInput): Decimal {
  return Decimal.min(D(a), D(b));
}

export function max(a: DecInput, b: DecInput): Decimal {
  return Decimal.max(D(a), D(b));
}

/** Money string with exactly two decimals, e.g. "1250.00". */
export function money(v: DecInput): string {
  return round2(v).toFixed(2);
}

/** Quantity string with up to three decimals. */
export function qty(v: DecInput): string {
  return round3(v).toFixed(3);
}

/** Safe ratio; returns null when the denominator is zero (metric not calculable). */
export function ratio(num: DecInput, den: DecInput): Decimal | null {
  const d = D(den);
  if (d.isZero()) return null;
  return D(num).div(d);
}

export function isDecimalString(v: unknown): boolean {
  return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim());
}

const inrFull = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Full Indian-grouped money, e.g. ₹ 12,40,000.00 */
export function formatMoney(v: DecInput, currency = 'INR'): string {
  if (v === null || v === undefined || v === '') return '—';
  const symbol = currencySymbol(currency);
  const n = round2(v);
  return `${n.isNeg() ? '-' : ''}${symbol} ${inrFull.format(Math.abs(n.toNumber()))}`;
}

/** Compact Indian notation used on dashboards: ₹ 50.00 Cr, ₹ 12.40 L */
export function formatMoneyCompact(v: DecInput, currency = 'INR'): string {
  if (v === null || v === undefined || v === '') return '—';
  const symbol = currencySymbol(currency);
  const n = D(v);
  const abs = n.abs();
  const sign = n.isNeg() ? '-' : '';
  if (currency === 'INR') {
    if (abs.gte(1e7)) return `${sign}${symbol} ${abs.div(1e7).toFixed(2)} Cr`;
    if (abs.gte(1e5)) return `${sign}${symbol} ${abs.div(1e5).toFixed(2)} L`;
    return `${sign}${symbol} ${inrFull.format(abs.toNumber())}`;
  }
  if (abs.gte(1e9)) return `${sign}${symbol}${abs.div(1e9).toFixed(2)}B`;
  if (abs.gte(1e6)) return `${sign}${symbol}${abs.div(1e6).toFixed(2)}M`;
  if (abs.gte(1e3)) return `${sign}${symbol}${abs.div(1e3).toFixed(1)}K`;
  return `${sign}${symbol}${abs.toFixed(2)}`;
}

export function formatPct(v: DecInput | null, digits = 1): string {
  if (v === null || v === undefined || v === '') return '—';
  return `${D(v).times(100).toFixed(digits)}%`;
}

export function formatQty(v: DecInput, digits = 2): string {
  if (v === null || v === undefined || v === '') return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(D(v).toNumber());
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case 'INR':
      return '₹';
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'AED':
      return 'AED';
    default:
      return currency;
  }
}
