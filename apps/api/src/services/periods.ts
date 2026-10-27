import type { Db } from '../lib/prisma.js';
import { businessRule } from '../lib/errors.js';
import { periodBounds, periodCode, toDateOnly } from '../lib/dates.js';

export const DEFAULT_CHECKLIST: Array<{ key: string; label: string }> = [
  { key: 'unposted_expenses', label: 'No expenses awaiting approval in the period' },
  { key: 'pending_invoices', label: 'Supplier invoices for the period approved or carried forward' },
  { key: 'uninvoiced_grn', label: 'Uninvoiced GRNs reviewed (accruals confirmed)' },
  { key: 'open_commitments', label: 'Open purchase commitments reviewed' },
  { key: 'contractor_bills', label: 'Contractor bills reconciled with certified measurements' },
  { key: 'unbilled_work', label: 'Unbilled certified work reviewed for client billing' },
  { key: 'stock_reconciliation', label: 'Stock reconciliation / physical count completed' },
  { key: 'manpower_reports', label: 'All manpower reports for the period verified' },
  { key: 'cost_code_corrections', label: 'Cost-code corrections posted' },
  { key: 'forecast_updated', label: 'Cost forecast (ETC/EAC) updated for the period' },
  { key: 'variance_analysis', label: 'Period variance analysis written' },
];

/** Returns the reporting period for a date, creating an OPEN monthly period if missing. */
export async function ensurePeriod(db: Db, projectId: string, date: Date) {
  const code = periodCode(date);
  const existing = await db.reportingPeriod.findUnique({ where: { projectId_code: { projectId, code } } });
  if (existing) return existing;
  const { start, end } = periodBounds(code);
  return db.reportingPeriod.upsert({
    where: { projectId_code: { projectId, code } },
    create: { projectId, code, startDate: start, endDate: end, checklist: { create: DEFAULT_CHECKLIST.map((c) => ({ key: c.key, label: c.label })) } },
    update: {},
  });
}

/** Throws if the date falls in a closed (or closing) period. */
export async function assertPeriodOpen(db: Db, projectId: string, date: Date | string) {
  const d = toDateOnly(date as string) as Date;
  const period = await ensurePeriod(db, projectId, d);
  if (period.status === 'CLOSED') throw businessRule(`Period ${period.code} is closed. Post into an open period or ask an authorised user to reopen it.`);
  return period;
}

/**
 * Posting date for documents whose cost belongs to a work period (RA bills, subcontract award):
 * the preferred date if its period is open, otherwise today (the current open period).
 */
export async function postingDate(db: Db, projectId: string, preferred: Date | null | undefined): Promise<Date> {
  const t = toDateOnly(new Date()) as Date;
  if (!preferred || preferred > t) return t;
  const period = await ensurePeriod(db, projectId, preferred);
  return period.status === 'CLOSED' ? t : preferred;
}
