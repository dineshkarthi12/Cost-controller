import type { Db } from '../lib/prisma.js';
import { ensurePeriod, DEFAULT_CHECKLIST } from './periods.js';

/**
 * Recomputes the automatic counts of the month-end checklist. Items whose count drops to
 * zero are not auto-ticked: a person still confirms each item (or waives it with a note).
 */
export async function refreshChecklist(db: Db, projectId: string, periodId: string) {
  const p = await db.reportingPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const inPeriod = { gte: p.startDate, lte: p.endDate };
  const counts: Record<string, number> = {
    unposted_expenses: await db.expense.count({ where: { projectId, date: inPeriod, status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED'] } } }),
    pending_invoices: await db.supplierInvoice.count({ where: { projectId, invoiceDate: inPeriod, status: { in: ['DRAFT', 'SUBMITTED', 'EXCEPTION', 'RETURNED'] } } }),
    uninvoiced_grn: await db.grnLine.count({ where: { grn: { projectId, status: 'APPROVED', receivedDate: { lte: p.endDate } }, invoicedQty: { lt: db.grnLine.fields.acceptedQty } } }),
    open_commitments: await db.purchaseOrder.count({ where: { projectId, status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } } }),
    contractor_bills: await db.contractorBill.count({ where: { projectId, status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED'] } } }),
    unbilled_work: await db.measurement.count({ where: { projectId, status: 'CERTIFIED', clientBillId: null } }),
    stock_reconciliation: (await db.stockCount.count({ where: { projectId, status: 'POSTED', countDate: inPeriod } })) > 0 ? 0 : 1,
    manpower_reports: await db.manpowerReport.count({ where: { projectId, date: inPeriod, status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED'] } } }),
    cost_code_corrections: 0,
    forecast_updated: (await db.costForecast.count({ where: { projectId, periodCode: p.code } })) > 0 ? 0 : 1,
    variance_analysis: p.varianceNotes ? 0 : 1,
  };
  for (const c of DEFAULT_CHECKLIST) {
    await db.periodChecklistItem.upsert({
      where: { periodId_key: { periodId, key: c.key } },
      create: { periodId, key: c.key, label: c.label, autoCount: counts[c.key] ?? null },
      update: { autoCount: counts[c.key] ?? null },
    });
  }
  return db.periodChecklistItem.findMany({ where: { periodId }, orderBy: { key: 'asc' } });
}

export { ensurePeriod };
