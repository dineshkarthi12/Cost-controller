import { D, type DecInput, money } from '../money.js';

/**
 * Payroll from the attendance register, per worker for a period.
 *
 *  paid days    = present days + ½ × half days        (leave and absence are not paid)
 *  regular pay  = regular hours × hourly rate
 *  overtime pay = overtime hours × hourly rate × OT multiplier (1.5, as on manpower reports)
 *  gross        = regular pay + overtime pay
 *
 * Hours come from the attendance records as entered (a half day carries its own hours).
 */
export const PAYROLL_OT_MULTIPLIER = '1.5';

export interface PayrollWorker {
  id: string;
  workerCode: string;
  name: string;
  trade: string;
  category: string;
  hourlyRate: DecInput;
  contractor: string | null;
}
export interface PayrollRecord {
  workerId: string;
  /** YYYY-MM-DD */
  date: string;
  status: string; // PRESENT | HALF_DAY | ABSENT | LEAVE
  regularHours: DecInput;
  overtimeHours: DecInput;
}
export interface PayrollRow {
  worker: PayrollWorker;
  present: number;
  halfDays: number;
  absent: number;
  leave: number;
  paidDays: string;
  regularHours: string;
  overtimeHours: string;
  hourlyRate: string;
  overtimeRate: string;
  regularPay: string;
  overtimePay: string;
  gross: string;
  /** Status per date, for the attendance grid: P, H, A, L. */
  days: Record<string, 'P' | 'H' | 'A' | 'L'>;
}

const CODE: Record<string, 'P' | 'H' | 'A' | 'L'> = { PRESENT: 'P', HALF_DAY: 'H', ABSENT: 'A', LEAVE: 'L' };

export function payrollRows(workers: PayrollWorker[], records: PayrollRecord[], otMultiplier: DecInput = PAYROLL_OT_MULTIPLIER) {
  const byWorker = new Map<string, PayrollRecord[]>();
  for (const r of records) byWorker.set(r.workerId, [...(byWorker.get(r.workerId) ?? []), r]);
  const rows: PayrollRow[] = workers.map((w) => {
    const recs = byWorker.get(w.id) ?? [];
    const count = (s: string) => recs.filter((r) => r.status === s).length;
    const paid = recs.filter((r) => r.status === 'PRESENT' || r.status === 'HALF_DAY');
    const regularHours = paid.reduce((a, r) => a.plus(D(r.regularHours)), D(0));
    const overtimeHours = paid.reduce((a, r) => a.plus(D(r.overtimeHours)), D(0));
    const rate = D(w.hourlyRate);
    const otRate = rate.times(D(otMultiplier));
    const regularPay = regularHours.times(rate);
    const overtimePay = overtimeHours.times(otRate);
    const days: PayrollRow['days'] = {};
    for (const r of recs) if (CODE[r.status]) days[r.date] = CODE[r.status];
    return {
      worker: w,
      present: count('PRESENT'),
      halfDays: count('HALF_DAY'),
      absent: count('ABSENT'),
      leave: count('LEAVE'),
      paidDays: D(count('PRESENT')).plus(D(count('HALF_DAY')).div(2)).toString(),
      regularHours: regularHours.toFixed(2),
      overtimeHours: overtimeHours.toFixed(2),
      hourlyRate: rate.toFixed(2),
      overtimeRate: otRate.toFixed(2),
      regularPay: money(regularPay),
      overtimePay: money(overtimePay),
      gross: money(regularPay.plus(overtimePay)),
      days,
    };
  });
  const sum = (k: 'regularHours' | 'overtimeHours' | 'regularPay' | 'overtimePay' | 'gross' | 'paidDays') => rows.reduce((a, r) => a.plus(D(r[k])), D(0));
  const totals = {
    workers: rows.length,
    paidDays: sum('paidDays').toString(),
    regularHours: sum('regularHours').toFixed(2),
    overtimeHours: sum('overtimeHours').toFixed(2),
    regularPay: money(sum('regularPay')),
    overtimePay: money(sum('overtimePay')),
    gross: money(sum('gross')),
  };
  return { rows, totals };
}
