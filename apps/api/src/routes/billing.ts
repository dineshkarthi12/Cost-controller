import { Router } from 'express';
import { z } from 'zod';
import { D, formatMoney, humanize, money, sum, zDate, zDecimal } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { pageParams, param, parseBody } from '../lib/http.js';
import { businessRule, conflict, notFound, validationError } from '../lib/errors.js';
import { isoDate, toDateOnly } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess, can } from '../services/access.js';
import { audit } from '../services/audit.js';
import { createClientBill, createContractorBill } from '../services/billing.js';
import { submitDocument, requestHistory } from '../services/workflow.js';
import { renderPdf } from '../services/pdf.js';

export const billingRouter = Router({ mergeParams: true });

billingRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

// ───────── Subcontractor RA bills ─────────

billingRouter.get('/contractor-bills', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'subbill.view', projectId);
  const { skip, take, page, pageSize } = pageParams(req);
  const where = { projectId, ...(typeof req.query.status === 'string' ? { status: req.query.status } : {}), ...(typeof req.query.contractorId === 'string' ? { contractorId: req.query.contractorId } : {}) };
  const [items, total] = await Promise.all([
    prisma.contractorBill.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { contractor: { select: { name: true } }, subcontract: { select: { number: true, title: true } } } }),
    prisma.contractorBill.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
});

billingRouter.post('/contractor-bills', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'subbill.manage', projectId);
  const data = parseBody(z.object({ subcontractId: z.string(), periodFrom: zDate, periodTo: zDate, otherDeductions: zDecimal(2).optional(), deductionNotes: z.string().max(1000).optional(), contractorInvoiceNo: z.string().max(100).optional() }), req.body);
  if (toDateOnly(data.periodTo)! < toDateOnly(data.periodFrom)!) throw validationError('Period end must be after start');
  const bill = await transaction((tx) => createContractorBill(tx, ctx, projectId, data));
  res.status(201).json(bill);
});

billingRouter.get('/contractor-bills/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'subbill.view', projectId);
  const bill = await prisma.contractorBill.findFirst({ where: { id: param(req, 'id'), projectId }, include: { lines: true, contractor: { select: { id: true, name: true } }, subcontract: true } });
  if (!bill) throw notFound('Bill');
  const payments = await prisma.paymentAllocation.findMany({ where: { contractorBillId: bill.id }, include: { payment: { select: { number: true, date: true, status: true } } } });
  res.json({ ...bill, payments, _permissions: { canSubmit: can(ctx, 'subbill.manage', projectId) && ['DRAFT', 'RETURNED'].includes(bill.status), canCancel: can(ctx, 'subbill.manage', projectId) && ['DRAFT', 'RETURNED'].includes(bill.status) } });
});

billingRouter.post('/contractor-bills/:id/submit', async (req, res) => {
  const bill = await prisma.contractorBill.findFirst({ where: { id: param(req, 'id'), projectId: param(req, 'projectId') } });
  if (!bill) throw notFound('Bill');
  res.json(await submitDocument(ctxOf(req), 'CONTRACTOR_BILL', bill.id, req.body?.comment));
});

billingRouter.post('/contractor-bills/:id/cancel', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'subbill.manage', projectId);
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(3) }), req.body);
  const out = await transaction(async (tx) => {
    const b = await tx.contractorBill.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!b) throw notFound('Bill');
    if (!['DRAFT', 'RETURNED'].includes(b.status)) throw conflict('Only draft or returned bills can be cancelled');
    await tx.measurement.updateMany({ where: { contractorBillId: b.id }, data: { contractorBillId: null } });
    const u = await tx.contractorBill.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
    await tx.registerEntry.updateMany({ where: { entityType: 'contractorBill', entityId: b.id }, data: { status: 'CANCELLED' } });
    await audit(tx, ctx, { action: 'CANCEL', entityType: 'contractorBill', entityId: b.id, projectId, reason });
    return u;
  });
  res.json(out);
});

billingRouter.get('/contractor-bills/:id/pdf', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'subbill.view', projectId);
  const b = await prisma.contractorBill.findFirst({ where: { id: param(req, 'id'), projectId }, include: { lines: true, contractor: true, subcontract: true } });
  if (!b) throw notFound('Bill');
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const cur = project.currency;
  const history = await requestHistory(prisma, 'CONTRACTOR_BILL', b.id);
  const pdf = await renderPdf({
    title: `RA Bill ${b.number}`,
    subtitle: `${project.code} — ${project.name}`,
    landscape: true,
    meta: [
      ['Contractor', b.contractor.name],
      ['Work order', `${b.subcontract.number} — ${b.subcontract.title}`],
      ['Bill period', `${isoDate(b.periodFrom)} to ${isoDate(b.periodTo)}`],
      ['Status', humanize(b.status)],
    ],
    columns: [
      { key: 'd', label: 'Description', width: 30 },
      { key: 'u', label: 'Unit', width: 6 },
      { key: 'r', label: 'Rate', width: 10, align: 'right' },
      { key: 'pq', label: 'Prev qty', width: 9, align: 'right' },
      { key: 'cq', label: 'This bill', width: 9, align: 'right' },
      { key: 'tq', label: 'Cumulative', width: 9, align: 'right' },
      { key: 'ca', label: 'This bill amt', width: 13, align: 'right' },
      { key: 'ta', label: 'Cumulative amt', width: 14, align: 'right' },
    ],
    rows: b.lines.map((l) => ({ d: l.description, u: l.unit, r: D(l.rate).toFixed(2), pq: D(l.previousQty).toString(), cq: D(l.currentQty).toString(), tq: D(l.cumulativeQty).toString(), ca: formatMoney(l.currentAmount, cur), ta: formatMoney(l.cumulativeAmount, cur) })),
    totals: [
      ['Gross value to date', formatMoney(b.grossToDate, cur)],
      ['Less previous certified', formatMoney(b.previousGross, cur)],
      ['Current work value', formatMoney(b.currentWorkValue, cur)],
      ['Add tax', formatMoney(b.taxAmount, cur)],
      ['Less retention', formatMoney(b.retention, cur)],
      ['Less advance recovery', formatMoney(b.advanceRecovery, cur)],
      ['Less other deductions', formatMoney(b.otherDeductions, cur)],
      ['Net payable', formatMoney(b.netPayable, cur)],
    ],
    approvals: history.flatMap((h) => h.actions.map((a) => ({ step: `Step ${a.stepNo}`, by: a.actorName, action: a.action, at: a.createdAt.toISOString().slice(0, 16).replace('T', ' '), comment: a.comment ?? undefined }))),
    footerNotes: b.status === 'CERTIFIED' || b.status === 'PAID' || b.status === 'PARTIALLY_PAID' ? [] : ['NOT CERTIFIED — submission does not constitute certification.'],
  });
  await audit(prisma, ctx, { action: 'EXPORT_PDF', entityType: 'contractorBill', entityId: b.id, projectId });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${b.number}.pdf"`);
  res.send(pdf);
});

/** Reconciliation per subcontract: contract value, certified, invoiced, paid, retention. */
billingRouter.get('/subcontract-summary', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'subcontract.view', projectId);
  const subs = await prisma.subcontract.findMany({ where: { projectId }, include: { contractor: { select: { name: true } } }, orderBy: { number: 'asc' } });
  const bills = await prisma.contractorBill.findMany({ where: { projectId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID', 'PAID'] } } });
  const releases = await prisma.paymentAllocation.groupBy({ by: ['contractorBillId'], where: { retentionRelease: true, payment: { status: 'APPROVED', projectId } }, _sum: { amount: true } });
  res.json(
    subs.map((s) => {
      const b = bills.filter((x) => x.subcontractId === s.id);
      const retention = sum(b.map((x) => x.retention));
      const released = sum(releases.filter((r) => b.some((x) => x.id === r.contractorBillId)).map((r) => r._sum.amount ?? 0));
      const certified = b.length ? D(b.sort((a, c) => c.billSeq - a.billSeq)[0].grossToDate) : D(0);
      return {
        id: s.id,
        number: s.number,
        title: s.title,
        contractor: s.contractor.name,
        status: s.status,
        contractValue: money(s.contractValue),
        certifiedToDate: money(certified),
        percentCertified: D(s.contractValue).isZero() ? null : certified.div(D(s.contractValue)).toFixed(4),
        netPayableToDate: money(sum(b.map((x) => x.netPayable))),
        paidToDate: money(sum(b.map((x) => x.paidAmount))),
        retentionHeld: money(retention.minus(released)),
        advanceOutstanding: money(D(s.advanceAmount).minus(sum(b.map((x) => x.advanceRecovery)))),
      };
    }),
  );
});

/** Open documents a payment (OUT) or receipt (IN) can be allocated to, for a party. */
billingRouter.get('/outstanding', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'payable.view', projectId);
  const partyId = String(req.query.partyId ?? '');
  const direction = req.query.direction === 'IN' ? 'IN' : 'OUT';
  if (direction === 'IN') {
    const bills = await prisma.clientBill.findMany({ where: { projectId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID'] } }, orderBy: { billSeq: 'asc' } });
    return res.json(bills.map((b) => ({ kind: 'clientBillId', id: b.id, number: b.number, ref: b.invoiceNo, dueDate: b.dueDate, total: b.certifiedAmount ?? b.netAmount, outstanding: money(D(b.certifiedAmount ?? b.netAmount).minus(D(b.receivedAmount))) })));
  }
  const [inv, bills, exps] = await Promise.all([
    prisma.supplierInvoice.findMany({ where: { projectId, supplierId: partyId, status: { in: ['APPROVED', 'PARTIALLY_PAID'] } }, orderBy: { invoiceDate: 'asc' } }),
    prisma.contractorBill.findMany({ where: { projectId, contractorId: partyId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID'] } }, orderBy: { billSeq: 'asc' } }),
    prisma.expense.findMany({ where: { projectId, payeeId: partyId, status: 'APPROVED', paymentStatus: { not: 'PAID' } } }),
  ]);
  const paidExp = await prisma.paymentAllocation.groupBy({ by: ['expenseId'], where: { expenseId: { in: exps.map((e) => e.id) }, payment: { status: 'APPROVED' } }, _sum: { amount: true } });
  res.json([
    ...inv.map((i) => ({ kind: 'supplierInvoiceId', id: i.id, number: i.number, ref: i.invoiceNo, dueDate: i.dueDate, total: i.total, outstanding: money(D(i.total).minus(D(i.paidAmount))) })),
    ...bills.map((b) => ({ kind: 'contractorBillId', id: b.id, number: b.number, ref: b.contractorInvoiceNo, dueDate: b.dueDate, total: b.netPayable, outstanding: money(D(b.netPayable).minus(D(b.paidAmount))) })),
    ...exps.map((e) => ({ kind: 'expenseId', id: e.id, number: e.number, ref: e.externalRef, dueDate: null, total: e.total, outstanding: money(D(e.total).minus(D(paidExp.find((p) => p.expenseId === e.id)?._sum.amount ?? 0))) })),
  ]);
});

// ───────── Client billing ─────────

billingRouter.get('/client-bills', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'clientbill.view', projectId);
  const items = await prisma.clientBill.findMany({ where: { projectId }, orderBy: { billSeq: 'desc' } });
  res.json({ items, total: items.length, page: 1, pageSize: items.length });
});

billingRouter.post('/client-bills', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'clientbill.manage', projectId);
  const data = parseBody(z.object({ periodFrom: zDate, periodTo: zDate, type: z.enum(['RA', 'MILESTONE', 'FINAL']).default('RA'), milestoneId: z.string().optional(), otherDeductions: zDecimal(2).optional() }), req.body);
  const bill = await transaction((tx) => createClientBill(tx, ctx, projectId, data));
  res.status(201).json(bill);
});

billingRouter.get('/client-bills/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'clientbill.view', projectId);
  const bill = await prisma.clientBill.findFirst({ where: { id: param(req, 'id'), projectId }, include: { lines: true } });
  if (!bill) throw notFound('Bill');
  const receipts = await prisma.paymentAllocation.findMany({ where: { clientBillId: bill.id }, include: { payment: { select: { number: true, date: true, status: true } } } });
  const notes = await prisma.creditNote.findMany({ where: { clientBillId: bill.id } });
  const manage = can(ctx, 'clientbill.manage', projectId);
  res.json({ ...bill, receipts, notes, _permissions: { canSubmit: manage && ['DRAFT', 'RETURNED'].includes(bill.status), canCertify: manage && bill.status === 'APPROVED', canDispute: manage && ['APPROVED', 'CERTIFIED', 'PARTIALLY_PAID'].includes(bill.status) } });
});

billingRouter.post('/client-bills/:id/submit', async (req, res) => {
  const bill = await prisma.clientBill.findFirst({ where: { id: param(req, 'id'), projectId: param(req, 'projectId') } });
  if (!bill) throw notFound('Bill');
  res.json(await submitDocument(ctxOf(req), 'CLIENT_BILL', bill.id, req.body?.comment));
});

/** Records the client's certification and invoice. The certified amount may differ from the claim. */
billingRouter.post('/client-bills/:id/client-certification', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'clientbill.manage', projectId);
  const data = parseBody(z.object({ certifiedAmount: zDecimal(2), invoiceNo: z.string().min(1).max(100), invoiceDate: zDate, dueDate: zDate, notes: z.string().max(2000).optional() }), req.body);
  const out = await transaction(async (tx) => {
    const b = await tx.clientBill.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!b) throw notFound('Bill');
    if (b.status !== 'APPROVED') throw businessRule('Record client certification after internal approval');
    if (D(data.certifiedAmount).gt(D(b.netAmount))) throw validationError('Certified amount cannot exceed the amount claimed');
    const u = await tx.clientBill.update({ where: { id: b.id }, data: { status: 'CERTIFIED', certifiedAmount: data.certifiedAmount, invoiceNo: data.invoiceNo, invoiceDate: toDateOnly(data.invoiceDate), dueDate: toDateOnly(data.dueDate), certifiedAt: new Date(), disputeNotes: data.notes ?? b.disputeNotes } });
    await tx.registerEntry.updateMany({ where: { entityType: 'clientBill', entityId: b.id }, data: { status: 'CERTIFIED', amount: data.certifiedAmount } });
    await audit(tx, ctx, { action: 'CLIENT_CERTIFIED', entityType: 'clientBill', entityId: b.id, projectId, summary: `${b.number} certified by client at ${data.certifiedAmount} (claimed ${money(b.netAmount)})` });
    return u;
  });
  res.json(out);
});

billingRouter.post('/client-bills/:id/dispute', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'clientbill.manage', projectId);
  const { notes } = parseBody(z.object({ notes: z.string().trim().min(5).max(2000) }), req.body);
  const out = await transaction(async (tx) => {
    const b = await tx.clientBill.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!b) throw notFound('Bill');
    const u = await tx.clientBill.update({ where: { id: b.id }, data: { status: 'DISPUTED', disputeNotes: notes } });
    await audit(tx, ctx, { action: 'DISPUTE', entityType: 'clientBill', entityId: b.id, projectId, reason: notes });
    return u;
  });
  res.json(out);
});

billingRouter.get('/receivables-aging', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'clientbill.view', projectId);
  const bills = await prisma.clientBill.findMany({ where: { projectId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID', 'DISPUTED'] } } });
  const now = Date.now();
  const buckets = { current: D(0), d30: D(0), d60: D(0), d90: D(0), d90plus: D(0) };
  const rows = bills.map((b) => {
    const outstanding = D(b.certifiedAmount ?? b.netAmount).minus(D(b.receivedAmount));
    const days = b.dueDate ? Math.floor((now - b.dueDate.getTime()) / 86_400_000) : 0;
    const key = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'd90plus';
    buckets[key] = buckets[key].plus(outstanding);
    return { id: b.id, number: b.number, invoiceNo: b.invoiceNo, dueDate: b.dueDate, outstanding: money(outstanding), daysOverdue: Math.max(0, days), bucket: key, status: b.status };
  });
  const retention = sum((await prisma.clientBill.findMany({ where: { projectId, status: { in: ['CERTIFIED', 'PARTIALLY_PAID', 'PAID'] } }, select: { retention: true } })).map((b) => b.retention));
  res.json({ rows, buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, money(v)])), retentionReceivable: money(retention) });
});
