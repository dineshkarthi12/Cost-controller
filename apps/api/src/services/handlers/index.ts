/* eslint-disable @typescript-eslint/no-explicit-any */
import { D, money, sum, threeWayMatch, validateGrnLine, max } from '@toprock/shared';
import type { Tx } from '../../lib/prisma.js';
import { businessRule, validationError } from '../../lib/errors.js';
import { addDays, today } from '../../lib/dates.js';
import type { AccessContext } from '../access.js';
import { registerHandler } from '../workflow.js';
import { postLedger, sourceBalance, type LedgerPosting } from '../ledger.js';
import { postStock } from '../stock.js';
import { getOrgSettings } from '../settings.js';
import { budgetCheck, projectCostPositions } from '../budget.js';
import { nextNumber } from '../numbering.js';
import { upsertRegister } from '../register.js';
import { notify } from '../notifications.js';
import { refreshChecklist } from '../periodClose.js';
import { postingDate } from '../periods.js';
import type { DocHandler, WorkflowEntity } from './types.js';

const link = (path: string) => (e: WorkflowEntity) => `${path}/${e.id}`;

async function taxPart(tx: Tx, ctx: AccessContext, tax: unknown) {
  const s = await getOrgSettings(tx, ctx.orgId);
  return s.taxIsCost ? D(tax as string) : D(0);
}

async function checkBudget(tx: Tx, ctx: AccessContext, projectId: string, lines: { costCodeId: string; amount: string }[]) {
  const result = await budgetCheck(tx, projectId, lines);
  const settings = await getOrgSettings(tx, ctx.orgId);
  if (result.exceeded && settings.budgetCheckMode === 'BLOCK') {
    throw businessRule('Budget exceeded for one or more cost codes. Raise a budget revision or transfer first.', result);
  }
  return result;
}

// ───────────── Site operations ─────────────

const mpr: DocHandler = {
  docType: 'MPR',
  area: 'manpower',
  model: 'manpowerReport',
  link: link('/manpower'),
  approvedStatus: 'VERIFIED',
  async validateSubmit(tx, _ctx, e) {
    const lines = await tx.manpowerLine.findMany({ where: { reportId: e.id } });
    if (!lines.length) throw validationError('Add at least one manpower line');
    if (lines.some((l) => l.chargeable && !l.costCodeId)) throw validationError('Chargeable (own labour) lines need a cost code');
    return { amount: String(e.totalCost), title: `MPR ${e.number} — ${String((e.date as Date).toISOString()).slice(0, 10)}` };
  },
  async onApproved(tx, ctx, e) {
    await tx.manpowerReport.update({ where: { id: e.id }, data: { verifiedById: ctx.user.id, verifiedAt: new Date() } });
    const lines = await tx.manpowerLine.findMany({ where: { reportId: e.id, chargeable: true } });
    const byCode = new Map<string, ReturnType<typeof D>>();
    for (const l of lines) if (l.costCodeId) byCode.set(l.costCodeId, (byCode.get(l.costCodeId) ?? D(0)).plus(D(l.amount)));
    await postLedger(
      tx,
      ctx.user.id,
      [...byCode].map(([costCodeId, amt]) => ({ projectId: e.projectId, costCodeId, date: e.date as Date, kind: 'ACTUAL' as const, amount: money(amt), sourceType: 'MPR', sourceId: e.id, sourceNumber: e.number, description: 'Own labour (verified MPR)' })),
    );
  },
};

const dpr: DocHandler = {
  docType: 'DPR',
  area: 'diary',
  model: 'siteDiary',
  link: link('/site-diary'),
  async validateSubmit(_tx, ctx, e) {
    await Promise.resolve();
    return { title: `DPR ${e.number}`, data: { submittedById: ctx.user.id } };
  },
  async onApproved(tx, ctx, e) {
    await tx.siteDiary.update({ where: { id: e.id }, data: { approvedById: ctx.user.id, reviewedById: ctx.user.id, lockedAt: new Date() } });
  },
};

const equipmentLog: DocHandler = {
  docType: 'EQUIPMENT_LOG',
  area: 'equipment',
  model: 'equipmentLog',
  link: link('/equipment/logs'),
  async validateSubmit(_tx, _ctx, e) {
    await Promise.resolve();
    return { amount: String(e.amount), title: `Equipment log ${e.number}` };
  },
  async onApproved(tx, ctx, e) {
    await postLedger(tx, ctx.user.id, [
      { projectId: e.projectId, costCodeId: e.costCodeId as string, date: e.date as Date, kind: 'ACTUAL', amount: String(e.amount), sourceType: 'EQUIPMENT_LOG', sourceId: e.id, sourceNumber: e.number, description: 'Owned equipment usage' },
    ]);
  },
};

// ───────────── Measurements (certification step) ─────────────

function measurementHandler(docType: 'MB' | 'JMR'): DocHandler {
  return {
    docType,
    area: 'measurement',
    model: 'measurement',
    link: link('/measurements'),
    submittableStatuses: ['VERIFIED'],
    approvedStatus: 'CERTIFIED',
    cancelledStatus: 'VERIFIED',
    async validateSubmit(tx, _ctx, e) {
      if (e.verifiedQty === null || e.verifiedQty === undefined) throw businessRule('Measurement must be site-verified before certification');
      const boq = await tx.boqItem.findUnique({ where: { id: e.boqItemId as string } });
      const value = D(e.verifiedQty as string).times(D(boq?.revisedRate ?? boq?.unitRate ?? 0));
      return { status: 'PENDING_CERTIFICATION', amount: money(value), title: `${docType} ${e.number} — ${boq?.itemCode ?? ''} ${D(e.verifiedQty as string).toString()} ${e.unit}` };
    },
    async onApproved(tx, ctx, e) {
      await tx.measurement.update({ where: { id: e.id }, data: { certifiedById: ctx.user.id, certifiedAt: new Date() } });
      await tx.boqItem.update({ where: { id: e.boqItemId as string }, data: { certifiedQty: { increment: e.verifiedQty as never } } });
    },
    async onReturned(tx, _ctx, e) {
      await tx.boqItem.update({ where: { id: e.boqItemId as string }, data: { verifiedQty: { decrement: e.verifiedQty as never } } });
    },
    async onRejected(tx, _ctx, e) {
      await tx.boqItem.update({ where: { id: e.boqItemId as string }, data: { verifiedQty: { decrement: e.verifiedQty as never } } });
    },
  };
}

// ───────────── Procurement ─────────────

const mr: DocHandler = {
  docType: 'MR',
  area: 'procurement',
  model: 'materialRequisition',
  link: link('/procurement/mr'),
  async validateSubmit(tx, _ctx, e) {
    const n = await tx.materialRequisitionLine.count({ where: { mrId: e.id } });
    if (!n) throw validationError('Add at least one material');
    return { title: `MR ${e.number}` };
  },
};

const pr: DocHandler = {
  docType: 'PR',
  area: 'procurement',
  model: 'purchaseRequisition',
  link: link('/procurement/pr'),
  async validateSubmit(tx, ctx, e) {
    const lines = await tx.purchaseRequisitionLine.findMany({ where: { prId: e.id } });
    if (!lines.length) throw validationError('Add at least one item');
    const check = await checkBudget(tx, ctx, e.projectId, lines.map((l) => ({ costCodeId: l.costCodeId, amount: l.amount.toString() })));
    return { amount: String(e.estimatedTotal), title: `PR ${e.number}`, data: { budgetCheck: check as never } };
  },
};

const po: DocHandler = {
  docType: 'PO',
  area: 'procurement',
  model: 'purchaseOrder',
  link: link('/procurement/po'),
  async validateSubmit(tx, ctx, e) {
    const lines = await tx.purchaseOrderLine.findMany({ where: { poId: e.id } });
    if (!lines.length) throw validationError('Add at least one item');
    const check = await checkBudget(tx, ctx, e.projectId, lines.map((l) => ({ costCodeId: l.costCodeId, amount: l.amount.toString() })));
    return { amount: String(e.netAmount), title: `PO ${e.number}`, data: { budgetCheck: check as never } };
  },
  async onApproved(tx, ctx, e) {
    await tx.purchaseOrder.update({ where: { id: e.id }, data: { approvedAt: new Date() } });
    const lines = await tx.purchaseOrderLine.findMany({ where: { poId: e.id } });
    await postLedger(
      tx,
      ctx.user.id,
      lines.map((l) => ({ projectId: e.projectId, costCodeId: l.costCodeId, date: e.orderDate as Date, kind: 'COMMITMENT' as const, amount: l.amount.toString(), sourceType: 'PO', sourceId: e.id, sourceNumber: e.number, partyId: e.supplierId as string, description: l.description })),
    );
  },
};

/** Open (unreceived, uninvoiced) value of a PO line — the line's outstanding commitment. */
function openLineValue(l: { qty: unknown; rate: unknown; discountPct: unknown; receivedQty: unknown; invoicedQty: unknown }) {
  const consumed = max(l.receivedQty as string, l.invoicedQty as string);
  return D(l.qty as string).minus(consumed).times(D(l.rate as string)).times(D(1).minus(D(l.discountPct as string)));
}

const poAmendment: DocHandler = {
  docType: 'PO_AMENDMENT',
  area: 'procurement',
  model: 'poRevision',
  link: (e) => `/procurement/po/${e.poId}`,
  async validateSubmit(tx, _ctx, e) {
    const p = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: e.poId as string } });
    if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(p.status)) throw businessRule('Only approved, open POs can be amended');
    const proposed = e.proposed as any;
    return { amount: proposed.netAmount, title: `PO ${p.number} amendment ${e.revisionNo}` };
  },
  async onApproved(tx, ctx, e) {
    const p = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: e.poId as string }, include: { lines: true } });
    const proposed = e.proposed as any;
    const postings: LedgerPosting[] = [];
    for (const pl of proposed.lines as any[]) {
      const old = p.lines.find((l) => l.id === pl.id);
      if (old) {
        if (D(pl.qty).lt(max(old.receivedQty, old.invoicedQty))) throw businessRule(`Line ${old.lineNo}: quantity cannot be reduced below received/invoiced quantity`);
        const before = openLineValue(old);
        const updated = await tx.purchaseOrderLine.update({ where: { id: old.id }, data: { qty: pl.qty, rate: pl.rate, discountPct: pl.discountPct, taxRate: pl.taxRate, amount: pl.amount, taxAmount: pl.taxAmount, description: pl.description } });
        const delta = openLineValue(updated).minus(before);
        postings.push({ projectId: p.projectId, costCodeId: old.costCodeId, date: today(), kind: 'COMMITMENT', amount: money(delta), sourceType: 'PO', sourceId: p.id, sourceNumber: p.number, partyId: p.supplierId, description: `Amendment ${e.revisionNo}: line ${old.lineNo}` });
      } else {
        const created = await tx.purchaseOrderLine.create({ data: { poId: p.id, lineNo: Math.max(...p.lines.map((l) => l.lineNo), 0) + 1, materialId: pl.materialId ?? null, description: pl.description, qty: pl.qty, unit: pl.unit, rate: pl.rate, discountPct: pl.discountPct ?? '0', taxRate: pl.taxRate ?? '0', amount: pl.amount, taxAmount: pl.taxAmount, costCodeId: pl.costCodeId } });
        postings.push({ projectId: p.projectId, costCodeId: created.costCodeId, date: today(), kind: 'COMMITMENT', amount: created.amount.toString(), sourceType: 'PO', sourceId: p.id, sourceNumber: p.number, partyId: p.supplierId, description: `Amendment ${e.revisionNo}: new line` });
      }
    }
    await postLedger(tx, ctx.user.id, postings);
    await tx.purchaseOrder.update({
      where: { id: p.id },
      data: { revision: e.revisionNo as number, subtotal: proposed.subtotal, discount: proposed.discount, netAmount: proposed.netAmount, taxAmount: proposed.taxAmount, total: proposed.total, deliveryDate: proposed.deliveryDate ? new Date(proposed.deliveryDate) : p.deliveryDate },
    });
    await tx.poRevision.update({ where: { id: e.id }, data: { approvedAt: new Date() } });
  },
};

const grn: DocHandler = {
  docType: 'GRN',
  area: 'receiving',
  model: 'grn',
  link: link('/procurement/grn'),
  async validateSubmit(tx, ctx, e) {
    const lines = await tx.grnLine.findMany({ where: { grnId: e.id } });
    if (!lines.length) throw validationError('Add at least one received line');
    const settings = await getOrgSettings(tx, ctx.orgId);
    const p = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: e.poId as string }, include: { lines: true } });
    if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(p.status)) throw businessRule(`PO ${p.number} is ${p.status}`);
    const errors: string[] = [];
    for (const l of lines) {
      const pl = p.lines.find((x) => x.id === l.poLineId)!;
      errors.push(...validateGrnLine({ orderedQty: pl.qty, previouslyAcceptedQty: pl.receivedQty, receivedQty: l.receivedQty, acceptedQty: l.acceptedQty, rejectedQty: l.rejectedQty, tolerancePct: settings.overReceiptTolerancePct }).map((x) => `Line ${pl.lineNo}: ${x}`));
    }
    if (errors.length) throw validationError('GRN lines are invalid', { errors });
    return { amount: String(e.acceptedValue), title: `GRN ${e.number} against ${p.number}` };
  },
  async onApproved(tx, ctx, e) {
    const g = await tx.grn.findUniqueOrThrow({ where: { id: e.id }, include: { lines: true } });
    const p = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: g.poId }, include: { lines: true } });
    const postings: LedgerPosting[] = [];
    for (const l of g.lines) {
      const pl = p.lines.find((x) => x.id === l.poLineId)!;
      if (D(l.acceptedQty).gt(0) && pl.materialId) {
        await postStock(tx, { projectId: g.projectId, storeId: g.storeId, materialId: pl.materialId, date: g.receivedDate, type: 'RECEIPT', qty: l.acceptedQty.toString(), unitCost: D(pl.rate).times(D(1).minus(D(pl.discountPct))).toFixed(4), batchNo: l.batchNo, refType: 'GRN', refId: g.id, refNumber: g.number, costCodeId: pl.costCodeId, createdById: ctx.user.id });
      }
      await tx.purchaseOrderLine.update({ where: { id: pl.id }, data: { receivedQty: { increment: l.acceptedQty } } });
      // Commitment relief is capped at the value not already relieved by invoicing.
      const value = D(l.acceptedQty).times(D(pl.rate)).times(D(1).minus(D(pl.discountPct)));
      const reliefQty = D(l.acceptedQty).minus(max(D(pl.invoicedQty).minus(D(pl.receivedQty)), 0));
      const relief = max(reliefQty, 0).times(D(pl.rate)).times(D(1).minus(D(pl.discountPct)));
      postings.push({ projectId: g.projectId, costCodeId: pl.costCodeId, date: g.receivedDate, kind: 'ACCRUAL', amount: money(value), sourceType: 'GRN', sourceId: g.id, sourceNumber: g.number, partyId: g.supplierId, description: pl.description });
      postings.push({ projectId: g.projectId, costCodeId: pl.costCodeId, date: g.receivedDate, kind: 'COMMITMENT', amount: money(relief.neg()), sourceType: 'PO', sourceId: p.id, sourceNumber: p.number, partyId: g.supplierId, description: `Received on ${g.number}` });
    }
    await postLedger(tx, ctx.user.id, postings);
    const updated = await tx.purchaseOrderLine.findMany({ where: { poId: p.id } });
    const fully = updated.every((l) => D(l.receivedQty).gte(D(l.qty)));
    await tx.purchaseOrder.update({ where: { id: p.id }, data: { status: fully ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
    await tx.grn.update({ where: { id: g.id }, data: { verifiedById: ctx.user.id } });
  },
};

const mir: DocHandler = {
  docType: 'MIR',
  area: 'receiving',
  model: 'mir',
  link: link('/procurement/mir'),
  async validateSubmit(_tx, _ctx, e) {
    await Promise.resolve();
    if (e.result === 'PENDING') throw validationError('Record the inspection result before submitting');
    return { title: `MIR ${e.number}` };
  },
  async onApproved(tx, _ctx, e) {
    if (e.grnId) await tx.grn.update({ where: { id: e.grnId as string }, data: { inspectionStatus: e.result === 'REJECTED' ? 'FAILED' : 'PASSED' } });
  },
};

const materialIssue: DocHandler = {
  docType: 'MATERIAL_ISSUE',
  area: 'stock',
  model: 'materialIssue',
  link: link('/stock/issues'),
  async validateSubmit(tx, _ctx, e) {
    const n = await tx.materialIssueLine.count({ where: { issueId: e.id } });
    if (!n) throw validationError('Add at least one material');
    return { amount: String(e.totalValue), title: `${String(e.type).replace(/_/g, ' ')} ${e.number}` };
  },
  async onApproved(tx, ctx, e) {
    const issue = await tx.materialIssue.findUniqueOrThrow({ where: { id: e.id }, include: { lines: true } });
    let total = D(0);
    for (const l of issue.lines) {
      const base = { projectId: issue.projectId, materialId: l.materialId, date: issue.date, batchNo: l.batchNo, refType: 'MATERIAL_ISSUE', refId: issue.id, refNumber: issue.number, costCodeId: issue.costCodeId, activityId: issue.activityId, reason: issue.reason ?? issue.purpose, createdById: ctx.user.id };
      let posted;
      switch (issue.type) {
        case 'ISSUE':
          posted = await postStock(tx, { ...base, storeId: issue.storeId, type: 'ISSUE', qty: l.qty.toString() });
          break;
        case 'RETURN_TO_STORE':
          posted = await postStock(tx, { ...base, storeId: issue.storeId, type: 'RETURN_TO_STORE', qty: l.qty.toString() });
          break;
        case 'WASTAGE':
          posted = await postStock(tx, { ...base, storeId: issue.storeId, type: 'WASTAGE', qty: l.qty.toString() });
          break;
        case 'DAMAGE':
          posted = await postStock(tx, { ...base, storeId: issue.storeId, type: 'DAMAGE', qty: l.qty.toString() });
          break;
        case 'TRANSFER': {
          posted = await postStock(tx, { ...base, storeId: issue.storeId, type: 'TRANSFER_OUT', qty: l.qty.toString() });
          await postStock(tx, { ...base, storeId: issue.toStoreId!, type: 'TRANSFER_IN', qty: l.qty.toString(), unitCost: posted.unitCost.toString() });
          break;
        }
        default:
          posted = await postStock(tx, { ...base, storeId: issue.storeId, type: 'ADJUSTMENT', qty: l.qty.toString() });
      }
      const amt = D(posted.value).abs();
      total = total.plus(amt);
      await tx.materialIssueLine.update({ where: { id: l.id }, data: { unitCost: posted.unitCost, amount: money(amt) } });
    }
    await tx.materialIssue.update({ where: { id: issue.id }, data: { totalValue: money(total), postedAt: new Date() } });
  },
};

// ───────────── Finance ─────────────

const expense: DocHandler = {
  docType: 'EXPENSE',
  area: 'expense',
  model: 'expense',
  link: link('/expenses'),
  async validateSubmit(_tx, _ctx, e) {
    await Promise.resolve();
    return { amount: String(e.total), title: `Expense ${e.number}` };
  },
  async onApproved(tx, ctx, e) {
    await tx.expense.update({ where: { id: e.id }, data: { approvedAt: new Date() } });
    if (e.invoiceId) return; // the linked invoice posts the cost
    const amount = D(e.amountBeforeTax as string).plus(await taxPart(tx, ctx, e.taxAmount));
    await postLedger(tx, ctx.user.id, [{ projectId: e.projectId, costCodeId: e.costCodeId as string, date: e.date as Date, kind: 'ACTUAL', amount: money(amount), sourceType: 'EXPENSE', sourceId: e.id, sourceNumber: e.number, partyId: (e.payeeId as string) ?? null, description: String(e.description) }]);
  },
};

const supplierInvoice: DocHandler = {
  docType: 'SUPPLIER_INVOICE',
  area: 'payable',
  model: 'supplierInvoice',
  link: link('/payables/invoices'),
  submittableStatuses: ['DRAFT', 'RETURNED'],
  async validateSubmit(tx, ctx, e) {
    const lines = await tx.supplierInvoiceLine.findMany({ where: { invoiceId: e.id } });
    if (!lines.length) throw validationError('Add at least one invoice line');
    let status = 'SUBMITTED';
    let matchResult: unknown = null;
    if (e.poId) {
      const settings = await getOrgSettings(tx, ctx.orgId);
      const poLines = await tx.purchaseOrderLine.findMany({ where: { poId: e.poId as string } });
      const missing = lines.filter((l) => !l.poLineId);
      const result = threeWayMatch(
        lines
          .filter((l) => l.poLineId)
          .map((l) => {
            const pl = poLines.find((x) => x.id === l.poLineId)!;
            return { lineRef: `PO line ${pl.lineNo}`, invoicedQty: l.qty, invoicedRate: l.rate, poRate: pl.rate, orderedQty: pl.qty, acceptedQty: pl.receivedQty, previouslyInvoicedQty: pl.invoicedQty };
          }),
        settings.priceTolerancePct,
      );
      matchResult = { ...result, unlinkedLines: missing.length };
      if (!result.matched || missing.length) status = 'EXCEPTION';
    }
    return { amount: String(e.total), status, title: `Invoice ${e.invoiceNo} (${e.number})`, data: { matchResult: matchResult as never } };
  },
  async onApproved(tx, ctx, e) {
    const inv = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: e.id }, include: { lines: true } });
    const settings = await getOrgSettings(tx, ctx.orgId);
    const postings: LedgerPosting[] = [];
    for (const l of inv.lines) {
      const actual = D(l.amount).plus(settings.taxIsCost ? D(l.taxAmount) : D(0));
      postings.push({ projectId: inv.projectId, costCodeId: l.costCodeId, date: inv.invoiceDate, kind: 'ACTUAL', amount: money(actual), sourceType: 'SUPPLIER_INVOICE', sourceId: inv.id, sourceNumber: inv.number, partyId: inv.supplierId, description: l.description });
      if (!l.poLineId) continue;
      const pl = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: l.poLineId }, include: { po: { select: { id: true, number: true } } } });
      // Reverse GRN accruals FIFO for the invoiced quantity.
      let remaining = D(l.qty);
      const grnLines = await tx.grnLine.findMany({ where: { poLineId: pl.id, grn: { status: 'APPROVED' } }, include: { grn: { select: { id: true, number: true, createdAt: true } } }, orderBy: { grn: { createdAt: 'asc' } } });
      for (const gl of grnLines) {
        if (remaining.lte(0)) break;
        const open = D(gl.acceptedQty).minus(D(gl.invoicedQty));
        if (open.lte(0)) continue;
        const take = remaining.lt(open) ? remaining : open;
        await tx.grnLine.update({ where: { id: gl.id }, data: { invoicedQty: { increment: take.toFixed(4) } } });
        postings.push({ projectId: inv.projectId, costCodeId: pl.costCodeId, date: inv.invoiceDate, kind: 'ACCRUAL', amount: money(take.times(D(gl.rate)).times(D(1).minus(D(pl.discountPct))).neg()), sourceType: 'GRN', sourceId: gl.grn.id, sourceNumber: gl.grn.number, partyId: inv.supplierId, description: `Invoiced on ${inv.number}` });
        remaining = remaining.minus(take);
      }
      // Quantity invoiced ahead of receipt relieves the open commitment instead.
      if (remaining.gt(0)) {
        const openQty = max(D(pl.qty).minus(max(pl.receivedQty, pl.invoicedQty)), 0);
        const reliefQty = remaining.lt(openQty) ? remaining : openQty;
        postings.push({ projectId: inv.projectId, costCodeId: pl.costCodeId, date: inv.invoiceDate, kind: 'COMMITMENT', amount: money(reliefQty.times(D(pl.rate)).times(D(1).minus(D(pl.discountPct))).neg()), sourceType: 'PO', sourceId: pl.po.id, sourceNumber: pl.po.number, partyId: inv.supplierId, description: `Invoiced ahead of receipt on ${inv.number}` });
      }
      await tx.purchaseOrderLine.update({ where: { id: pl.id }, data: { invoicedQty: { increment: l.qty } } });
    }
    await postLedger(tx, ctx.user.id, postings);
    await tx.supplierInvoice.update({ where: { id: inv.id }, data: { approvedAt: new Date() } });
  },
};

async function outstandingFor(tx: Tx, a: any) {
  if (a.supplierInvoiceId) {
    const x = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: a.supplierInvoiceId } });
    if (!['APPROVED', 'PARTIALLY_PAID'].includes(x.status)) throw businessRule(`Invoice ${x.number} is not approved for payment`);
    return { label: x.number, outstanding: D(x.total).minus(D(x.paidAmount)) };
  }
  if (a.contractorBillId) {
    const x = await tx.contractorBill.findUniqueOrThrow({ where: { id: a.contractorBillId } });
    if (a.retentionRelease) {
      if (!['CERTIFIED', 'PARTIALLY_PAID', 'PAID'].includes(x.status)) throw businessRule(`Bill ${x.number} is not certified`);
      const released = await tx.paymentAllocation.aggregate({ where: { contractorBillId: x.id, retentionRelease: true, payment: { status: 'APPROVED' } }, _sum: { amount: true } });
      return { label: `${x.number} retention`, outstanding: D(x.retention).minus(D(released._sum.amount ?? 0)) };
    }
    if (!['CERTIFIED', 'PARTIALLY_PAID'].includes(x.status)) throw businessRule(`Bill ${x.number} is not certified for payment`);
    return { label: x.number, outstanding: D(x.netPayable).minus(D(x.paidAmount)) };
  }
  if (a.clientBillId) {
    const x = await tx.clientBill.findUniqueOrThrow({ where: { id: a.clientBillId } });
    if (!['CERTIFIED', 'PARTIALLY_PAID'].includes(x.status)) throw businessRule(`Client bill ${x.number} has not been certified by the client`);
    return { label: x.number, outstanding: D(x.certifiedAmount ?? x.netAmount).minus(D(x.receivedAmount)) };
  }
  const x = await tx.expense.findUniqueOrThrow({ where: { id: a.expenseId } });
  if (x.status !== 'APPROVED') throw businessRule(`Expense ${x.number} is not approved`);
  const paid = await tx.paymentAllocation.aggregate({ where: { expenseId: x.id, payment: { status: 'APPROVED' } }, _sum: { amount: true } });
  return { label: x.number, outstanding: D(x.total).minus(D(paid._sum.amount ?? 0)) };
}

const payment: DocHandler = {
  docType: 'PAYMENT',
  area: 'payable',
  model: 'payment',
  link: link('/payables/payments'),
  async validateSubmit(tx, _ctx, e) {
    const allocs = await tx.paymentAllocation.findMany({ where: { paymentId: e.id } });
    if (!allocs.length) throw validationError('Allocate the payment to at least one document');
    for (const a of allocs) {
      const o = await outstandingFor(tx, a);
      if (D(a.amount).gt(o.outstanding)) throw businessRule(`Allocation ${D(a.amount).toFixed(2)} exceeds the outstanding ${o.outstanding.toFixed(2)} on ${o.label}`);
    }
    return { amount: String(e.amount), title: `${e.direction === 'IN' ? 'Receipt' : 'Payment'} ${e.number}` };
  },
  async onApproved(tx, _ctx, e) {
    const allocs = await tx.paymentAllocation.findMany({ where: { paymentId: e.id } });
    for (const a of allocs) {
      const o = await outstandingFor(tx, a);
      if (D(a.amount).gt(o.outstanding)) throw businessRule(`Allocation exceeds the outstanding amount on ${o.label}`);
      if (a.supplierInvoiceId) {
        const x = await tx.supplierInvoice.update({ where: { id: a.supplierInvoiceId }, data: { paidAmount: { increment: a.amount } } });
        await tx.supplierInvoice.update({ where: { id: x.id }, data: { status: D(x.paidAmount).gte(D(x.total)) ? 'PAID' : 'PARTIALLY_PAID' } });
      } else if (a.contractorBillId && !a.retentionRelease) {
        const x = await tx.contractorBill.update({ where: { id: a.contractorBillId }, data: { paidAmount: { increment: a.amount } } });
        await tx.contractorBill.update({ where: { id: x.id }, data: { status: D(x.paidAmount).gte(D(x.netPayable)) ? 'PAID' : 'PARTIALLY_PAID' } });
      } else if (a.clientBillId) {
        const x = await tx.clientBill.update({ where: { id: a.clientBillId }, data: { receivedAmount: { increment: a.amount } } });
        await tx.clientBill.update({ where: { id: x.id }, data: { status: D(x.receivedAmount).gte(D(x.certifiedAmount ?? x.netAmount)) ? 'PAID' : 'PARTIALLY_PAID' } });
      } else if (a.expenseId) {
        const x = await tx.expense.findUniqueOrThrow({ where: { id: a.expenseId } });
        const paid = await tx.paymentAllocation.aggregate({ where: { expenseId: x.id, OR: [{ payment: { status: 'APPROVED' } }, { paymentId: e.id }] }, _sum: { amount: true } });
        await tx.expense.update({ where: { id: x.id }, data: { paymentStatus: D(paid._sum.amount ?? 0).gte(D(x.total)) ? 'PAID' : 'PARTIALLY_PAID' } });
      }
    }
    await tx.payment.update({ where: { id: e.id }, data: { approvedAt: new Date() } });
  },
};

const budgetRevision: DocHandler = {
  docType: 'BUDGET_REVISION',
  area: 'budget',
  model: 'budgetRevision',
  link: link('/budget/revisions'),
  async validateSubmit(tx, _ctx, e) {
    const lines = await tx.budgetRevisionLine.findMany({ where: { revisionId: e.id } });
    if (!lines.length) throw validationError('Add at least one cost code change');
    if (e.type === 'TRANSFER' && !sum(lines.map((l) => l.delta)).isZero()) throw validationError('Transfer lines must net to zero');
    const magnitude = e.type === 'TRANSFER' ? sum(lines.filter((l) => D(l.delta).gt(0)).map((l) => l.delta)) : D(e.totalDelta as string).abs();
    return { amount: money(magnitude), title: `${e.type === 'TRANSFER' ? 'Budget transfer' : 'Budget revision'} ${e.number}` };
  },
  async onApproved(tx, _ctx, e) {
    await tx.budgetRevision.update({ where: { id: e.id }, data: { approvedAt: new Date() } });
  },
};

// ───────────── Commercial ─────────────

const variation: DocHandler = {
  docType: 'VARIATION',
  area: 'variation',
  model: 'variation',
  link: link('/variations'),
  async validateSubmit(tx, _ctx, e) {
    const n = await tx.variationLine.count({ where: { variationId: e.id } });
    if (!n) throw validationError('Add at least one line describing the quantity/rate impact');
    const amount = max(D(e.revenueImpact as string).abs(), D(e.costImpact as string).abs());
    return { amount: money(amount), title: `VO ${e.number} — ${e.title}` };
  },
  async onApproved(tx, ctx, e) {
    await tx.variation.update({ where: { id: e.id }, data: { approvedAt: new Date(), approvedValue: e.revenueImpact as never } });
    const settings = await getOrgSettings(tx, ctx.orgId);
    if (settings.autoBudgetRevisionFromVariation && e.costCodeId && !D(e.costImpact as string).isZero()) {
      const number = await nextNumber(tx, { orgId: ctx.orgId, projectId: e.projectId, docType: 'BUDGET_REVISION' });
      const br = await tx.budgetRevision.create({
        data: {
          projectId: e.projectId,
          number,
          type: 'REVISION',
          title: `Budget revision for approved ${e.number}`,
          reason: `Cost impact of approved variation ${e.number}: ${e.title}`,
          variationId: e.id,
          totalDelta: e.costImpact as never,
          createdById: ctx.user.id,
          lines: { create: [{ costCodeId: e.costCodeId as string, delta: e.costImpact as never, remarks: `From ${e.number}` }] },
        },
      });
      await upsertRegister(tx, { orgId: ctx.orgId, projectId: e.projectId, docType: 'BUDGET_REVISION', number, entityType: 'budgetRevision', entityId: br.id, title: br.title, status: 'DRAFT', amount: br.totalDelta.toString() });
    }
  },
};

const subcontract: DocHandler = {
  docType: 'SUBCONTRACT',
  area: 'subcontract',
  model: 'subcontract',
  link: link('/subcontractors/contracts'),
  async validateSubmit(tx, ctx, e) {
    const n = await tx.subcontractItem.count({ where: { subcontractId: e.id } });
    if (!n) throw validationError('Add the rate schedule');
    await checkBudget(tx, ctx, e.projectId, [{ costCodeId: e.costCodeId as string, amount: String(e.contractValue) }]);
    return { amount: String(e.contractValue), title: `Work order ${e.number} — ${e.title}` };
  },
  async onApproved(tx, ctx, e) {
    await tx.subcontract.update({ where: { id: e.id }, data: { approvedAt: new Date() } });
    const date = await postingDate(tx, e.projectId, e.startDate as Date | null);
    await postLedger(tx, ctx.user.id, [{ projectId: e.projectId, costCodeId: e.costCodeId as string, date, kind: 'COMMITMENT', amount: String(e.contractValue), sourceType: 'SUBCONTRACT', sourceId: e.id, sourceNumber: e.number, partyId: e.contractorId as string, description: String(e.title) }]);
  },
};

const contractorBill: DocHandler = {
  docType: 'CONTRACTOR_BILL',
  area: 'subbill',
  model: 'contractorBill',
  link: link('/subcontractor-bills'),
  approvedStatus: 'CERTIFIED',
  async validateSubmit(tx, _ctx, e) {
    const n = await tx.contractorBillLine.count({ where: { billId: e.id } });
    if (!n && D(e.variationValue as string).isZero()) throw validationError('The bill has no certified work');
    return { amount: String(e.netPayable), title: `RA bill ${e.number}` };
  },
  async onApproved(tx, ctx, e) {
    const sc = await tx.subcontract.findUniqueOrThrow({ where: { id: e.subcontractId as string } });
    const current = D(e.currentWorkValue as string);
    const open = await sourceBalance(tx, { projectId: e.projectId, kind: 'COMMITMENT', sourceType: 'SUBCONTRACT', sourceId: sc.id });
    const relief = current.gt(open) ? max(open, 0) : current;
    const date = await postingDate(tx, e.projectId, e.periodTo as Date);
    await postLedger(tx, ctx.user.id, [
      { projectId: e.projectId, costCodeId: sc.costCodeId, date, kind: 'ACTUAL', amount: money(current), sourceType: 'CONTRACTOR_BILL', sourceId: e.id, sourceNumber: e.number, partyId: sc.contractorId, description: `Certified work value ${e.number}` },
      { projectId: e.projectId, costCodeId: sc.costCodeId, date, kind: 'COMMITMENT', amount: money(relief.neg()), sourceType: 'SUBCONTRACT', sourceId: sc.id, sourceNumber: sc.number, partyId: sc.contractorId, description: `Relieved by ${e.number}` },
    ]);
    await tx.contractorBill.update({ where: { id: e.id }, data: { certifiedById: ctx.user.id, certifiedAt: new Date(), dueDate: addDays(today(), sc.paymentTermsDays) } });
  },
  async onRejected(tx, _ctx, e) {
    await tx.measurement.updateMany({ where: { contractorBillId: e.id }, data: { contractorBillId: null } });
  },
};

const clientBill: DocHandler = {
  docType: 'CLIENT_BILL',
  area: 'clientbill',
  model: 'clientBill',
  link: link('/client-billing/bills'),
  async validateSubmit(_tx, _ctx, e) {
    await Promise.resolve();
    if (D(e.grossToDate as string).isZero()) throw validationError('The bill has no work value');
    return { amount: String(e.netAmount), title: `Client bill ${e.number}` };
  },
  async onRejected(tx, _ctx, e) {
    await tx.measurement.updateMany({ where: { clientBillId: e.id }, data: { clientBillId: null } });
  },
};

// ───────────── Documents, periods, closeout ─────────────

const documentRevision: DocHandler = {
  docType: 'DOCUMENT_REVISION',
  area: 'document',
  model: 'documentRevision',
  link: (e) => `/documents/${e.documentId}`,
  submittableStatuses: ['WIP', 'FOR_REVIEW', 'RETURNED'],
  async validateSubmit(tx, _ctx, e) {
    const d = await tx.document.findUniqueOrThrow({ where: { id: e.documentId as string } });
    if (!e.fileId) throw validationError('Attach the revision file before submitting');
    return { title: `${d.number} rev ${e.revision}` };
  },
  async onApproved(tx, ctx, e) {
    const d = await tx.document.findUniqueOrThrow({ where: { id: e.documentId as string } });
    if (d.currentRevisionId && d.currentRevisionId !== e.id) await tx.documentRevision.update({ where: { id: d.currentRevisionId }, data: { status: 'SUPERSEDED' } });
    await tx.document.update({ where: { id: d.id }, data: { currentRevisionId: e.id } });
    await tx.documentRevision.update({ where: { id: e.id }, data: { approvedById: ctx.user.id, approvedAt: new Date() } });
    const members = await tx.projectMember.findMany({ where: { projectId: d.projectId, isActive: true }, select: { userId: true } });
    await notify(tx, { userIds: members.map((m) => m.userId), type: 'DRAWING_REVISION', title: `New approved revision: ${d.number} rev ${e.revision}`, body: d.title, link: `/documents/${d.id}`, projectId: d.projectId, entityType: 'document', entityId: d.id, dedupeKey: `docrev:${e.id}` });
  },
};

const periodClose: DocHandler = {
  docType: 'PERIOD_CLOSE',
  area: 'period',
  model: 'reportingPeriod',
  link: (e) => `/month-end/${e.id}`,
  submittableStatuses: ['OPEN'],
  approvedStatus: 'CLOSED',
  returnedStatus: 'OPEN',
  rejectedStatus: 'OPEN',
  cancelledStatus: 'OPEN',
  async validateSubmit(tx, _ctx, e) {
    const items = await refreshChecklist(tx, e.projectId, e.id);
    const open = items.filter((i) => i.status === 'PENDING');
    if (open.length) throw businessRule(`Complete or waive all checklist items first (${open.length} pending)`, { pending: open.map((i) => i.label) });
    const waivedNoNote = items.filter((i) => i.status === 'WAIVED' && !i.note);
    if (waivedNoNote.length) throw businessRule('Waived checklist items need an explanatory note');
    return { status: 'CLOSING', title: `Month-end close ${e.code}` };
  },
  async onApproved(tx, ctx, e) {
    await tx.reportingPeriod.update({ where: { id: e.id }, data: { closedById: ctx.user.id, closedAt: new Date(), reviewerId: ctx.user.id, reviewedAt: new Date() } });
  },
};

const closeout: DocHandler = {
  docType: 'CLOSEOUT',
  area: 'closeout',
  model: 'closeout',
  link: () => `/closeout`,
  submittableStatuses: ['IN_PROGRESS', 'RETURNED'],
  rejectedStatus: 'IN_PROGRESS',
  cancelledStatus: 'IN_PROGRESS',
  async validateSubmit(tx, _ctx, e) {
    const items = await tx.closeoutItem.findMany({ where: { closeoutId: e.id } });
    const open = items.filter((i) => i.status === 'PENDING');
    if (open.length) throw businessRule(`Complete all closeout items first (${open.length} pending)`, { pending: open.map((i) => i.label) });
    const positions = await projectCostPositions(tx, e.projectId);
    return { title: 'Project closeout', amount: positions.total.eac, data: { finalSnapshot: JSON.parse(JSON.stringify(positions)) } };
  },
  async onApproved(tx, _ctx, e) {
    await tx.closeout.update({ where: { id: e.id }, data: { approvedAt: new Date() } });
    await tx.project.update({ where: { id: e.projectId }, data: { status: 'CLOSED', closeoutStatus: 'APPROVED', actualCompletionDate: today() } });
  },
};

export function registerAllHandlers() {
  for (const h of [mpr, dpr, equipmentLog, measurementHandler('MB'), measurementHandler('JMR'), mr, pr, po, poAmendment, grn, mir, materialIssue, expense, supplierInvoice, payment, budgetRevision, variation, subcontract, contractorBill, clientBill, documentRevision, periodClose, closeout]) {
    registerHandler(h);
  }
}
