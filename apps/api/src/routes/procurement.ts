import { Router } from 'express';
import { z } from 'zod';
import { D, formatMoney, money, priceDocument, sum, zDate, zDecimal, RESOURCES, humanize } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { businessRule, conflict, notFound, validationError } from '../lib/errors.js';
import { isoDate, toDateOnly, today } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { nextNumber } from '../services/numbering.js';
import { upsertRegister } from '../services/register.js';
import { postLedger, sourceBalance } from '../services/ledger.js';
import { submitDocument, requestHistory } from '../services/workflow.js';
import { createResource } from '../resources/router.js';
import { renderPdf } from '../services/pdf.js';
import { assertRefsInScope } from '../services/lookups.js';

export const procurementRouter = Router({ mergeParams: true });

procurementRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

const scopeOf = (req: Parameters<typeof ctxOf>[0]) => ({ orgId: ctxOf(req).orgId, projectId: param(req, 'projectId') });

/** Creates a draft PR from an approved MR. */
procurementRouter.post('/pr-from-mr/:mrId', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  const mr = await prisma.materialRequisition.findFirst({ where: { id: param(req, 'mrId'), projectId }, include: { lines: true } });
  if (!mr) throw notFound('MR');
  if (mr.status !== 'APPROVED') throw businessRule('Only approved MRs can be converted to a PR');
  const costCodeId = (req.body?.costCodeId as string | undefined) ?? mr.costCodeId;
  if (!costCodeId) throw validationError('Select the cost code to charge');
  const mats = await prisma.material.findMany({ where: { id: { in: mr.lines.map((l) => l.materialId) } } });
  const pr = await createResource(ctx, RESOURCES.prs, scopeOf(req), {
    mrId: mr.id,
    requiredBy: isoDate(mr.requiredBy),
    costCodeId,
    justification: mr.justification ?? `From ${mr.number}`,
    lines: mr.lines.map((l) => ({ materialId: l.materialId, description: l.specification ?? undefined, qty: l.qty.toString(), unit: l.unit, estimatedRate: (mats.find((m) => m.id === l.materialId)?.standardRate ?? D(0)).toString(), costCodeId })),
  });
  res.status(201).json(pr);
});

/** Creates a draft PO from an approved PR for a chosen supplier. */
procurementRouter.post('/po-from-pr/:prId', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  const { supplierId } = parseBody(z.object({ supplierId: z.string() }), req.body);
  const pr = await prisma.purchaseRequisition.findFirst({ where: { id: param(req, 'prId'), projectId }, include: { lines: true } });
  if (!pr) throw notFound('PR');
  if (pr.status !== 'APPROVED') throw businessRule('Only approved PRs can be converted to a PO');
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const mats = await prisma.material.findMany({ where: { id: { in: pr.lines.map((l) => l.materialId) } } });
  const po = await createResource(ctx, RESOURCES.purchaseOrders, scopeOf(req), {
    supplierId,
    prId: pr.id,
    orderDate: isoDate(today()),
    deliveryDate: isoDate(pr.requiredBy),
    currency: project.currency,
    lines: pr.lines.map((l) => ({ materialId: l.materialId, prLineId: l.id, description: l.description ?? mats.find((m) => m.id === l.materialId)?.name ?? 'Material', qty: l.qty.toString(), unit: l.unit, rate: l.estimatedRate.toString(), discountPct: '0', taxRate: project.taxRate.toString(), costCodeId: l.costCodeId })),
  });
  res.status(201).json(po);
});

// ───────────── RFQ & quotation comparison ─────────────

procurementRouter.get('/rfqs', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'procurement.view', projectId);
  const rows = await prisma.rfq.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, include: { quotations: { select: { id: true, total: true, supplierId: true } } } });
  const prs = new Map((await prisma.purchaseRequisition.findMany({ where: { id: { in: rows.map((r) => r.prId) } }, select: { id: true, number: true } })).map((p) => [p.id, p.number]));
  res.json(rows.map((r) => ({ ...r, prNumber: prs.get(r.prId) ?? null, quotationCount: r.quotations.length })));
});

procurementRouter.post('/rfqs', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'procurement.manage', projectId);
  const data = parseBody(z.object({ prId: z.string(), title: z.string().min(3).max(200), dueDate: zDate, supplierIds: z.array(z.string()).min(1) }), req.body);
  const rfq = await transaction(async (tx) => {
    const pr = await tx.purchaseRequisition.findFirst({ where: { id: data.prId, projectId } });
    if (!pr || pr.status !== 'APPROVED') throw businessRule('RFQs are raised against approved PRs');
    await assertRefsInScope(tx, 'suppliers', ctx.orgId, null, data.supplierIds, 'Suppliers');
    const number = await nextNumber(tx, { orgId: ctx.orgId, projectId, docType: 'RFQ' });
    const r = await tx.rfq.create({ data: { projectId, number, prId: pr.id, title: data.title, dueDate: toDateOnly(data.dueDate)!, supplierIds: data.supplierIds, createdById: ctx.user.id } });
    await upsertRegister(tx, { orgId: ctx.orgId, projectId, docType: 'RFQ', number, entityType: 'rfq', entityId: r.id, title: r.title, status: r.status, ownerId: ctx.user.id });
    await audit(tx, ctx, { action: 'CREATE', entityType: 'rfq', entityId: r.id, projectId, summary: `RFQ ${number} issued to ${data.supplierIds.length} suppliers` });
    return r;
  });
  res.status(201).json(rfq);
});

procurementRouter.get('/rfqs/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'procurement.view', projectId);
  const rfq = await prisma.rfq.findFirst({ where: { id: param(req, 'id'), projectId }, include: { quotations: { include: { lines: true } } } });
  if (!rfq) throw notFound('RFQ');
  const pr = await prisma.purchaseRequisition.findUniqueOrThrow({ where: { id: rfq.prId }, include: { lines: true } });
  const parties = new Map((await prisma.party.findMany({ where: { id: { in: [...rfq.supplierIds, ...rfq.quotations.map((q) => q.supplierId)] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const mats = new Map((await prisma.material.findMany({ where: { id: { in: pr.lines.map((l) => l.materialId) } }, select: { id: true, name: true, code: true } })).map((m) => [m.id, m]));
  const valid = rfq.quotations.filter((q) => q.technicallyAccepted);
  const lowest = valid.length ? valid.reduce((a, b) => (D(a.total).lte(D(b.total)) ? a : b)) : null;
  res.json({
    ...rfq,
    pr: { id: pr.id, number: pr.number, lines: pr.lines.map((l) => ({ ...l, materialName: mats.get(l.materialId)?.name, materialCode: mats.get(l.materialId)?.code })) },
    suppliers: rfq.supplierIds.map((id) => ({ id, name: parties.get(id) ?? id, quoted: rfq.quotations.some((q) => q.supplierId === id) })),
    quotations: rfq.quotations.map((q) => ({ ...q, supplierName: parties.get(q.supplierId) ?? q.supplierId, isLowest: lowest?.id === q.id })),
    lowestQuotationId: lowest?.id ?? null,
  });
});

const quotationSchema = z.object({
  supplierId: z.string(),
  quoteRef: z.string().max(100).optional(),
  quotedAt: zDate,
  deliveryDays: z.coerce.number().int().min(0).max(1000).optional(),
  paymentTerms: z.string().max(200).optional(),
  validityDays: z.coerce.number().int().min(0).max(1000).optional(),
  taxRate: zDecimal(6).default('0'),
  technicalScore: zDecimal(2).optional(),
  technicallyAccepted: z.boolean().default(true),
  remarks: z.string().max(2000).optional(),
  lines: z.array(z.object({ prLineId: z.string(), rate: zDecimal(4) })).min(1),
});

procurementRouter.post('/rfqs/:id/quotations', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'procurement.manage', projectId);
  const data = parseBody(quotationSchema, req.body);
  const q = await transaction(async (tx) => {
    const rfq = await tx.rfq.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!rfq) throw notFound('RFQ');
    if (!['OPEN', 'EVALUATION'].includes(rfq.status)) throw conflict('This RFQ is closed');
    if (!rfq.supplierIds.includes(data.supplierId)) throw validationError('Supplier was not invited to this RFQ');
    const prLines = await tx.purchaseRequisitionLine.findMany({ where: { prId: rfq.prId } });
    const lines = data.lines.map((l) => {
      const pl = prLines.find((p) => p.id === l.prLineId);
      if (!pl) throw validationError('Quotation line does not belong to the PR');
      return { prLineId: pl.id, materialId: pl.materialId, qty: pl.qty.toString(), rate: l.rate, amount: money(D(pl.qty).times(D(l.rate))) };
    });
    const priced = priceDocument(lines.map((l) => ({ quantity: l.qty, rate: l.rate, taxRate: data.taxRate })));
    const { lines: _ignored, ...head } = data;
    void _ignored;
    const quote = await tx.quotation.upsert({
      where: { rfqId_supplierId: { rfqId: rfq.id, supplierId: data.supplierId } },
      create: { ...head, rfqId: rfq.id, quotedAt: toDateOnly(data.quotedAt)!, subtotal: priced.netAmount, taxAmount: priced.taxAmount, total: priced.total, lines: { create: lines } },
      update: { ...head, quotedAt: toDateOnly(data.quotedAt)!, subtotal: priced.netAmount, taxAmount: priced.taxAmount, total: priced.total, lines: { deleteMany: {}, create: lines } },
    });
    await tx.rfq.update({ where: { id: rfq.id }, data: { status: 'EVALUATION' } });
    await audit(tx, ctx, { action: 'QUOTATION_RECORDED', entityType: 'rfq', entityId: rfq.id, projectId, summary: `Quotation recorded for ${rfq.number}: ${priced.total}` });
    return quote;
  });
  res.status(201).json(q);
});

/** Awards the RFQ: records the justification and creates a draft PO from the selected quotation. */
procurementRouter.post('/rfqs/:id/award', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'procurement.manage', projectId);
  const { quotationId, justification } = parseBody(z.object({ quotationId: z.string(), justification: z.string().trim().min(5).max(2000) }), req.body);
  const rfq = await prisma.rfq.findFirst({ where: { id: param(req, 'id'), projectId }, include: { quotations: { include: { lines: true } } } });
  if (!rfq) throw notFound('RFQ');
  const q = rfq.quotations.find((x) => x.id === quotationId);
  if (!q) throw notFound('Quotation');
  if (!q.technicallyAccepted) throw businessRule('A technically rejected quotation cannot be awarded');
  const pr = await prisma.purchaseRequisition.findUniqueOrThrow({ where: { id: rfq.prId }, include: { lines: true } });
  const mats = await prisma.material.findMany({ where: { id: { in: pr.lines.map((l) => l.materialId) } } });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const po = await transaction(async (tx) => {
    const created = await createResource(
      ctx,
      RESOURCES.purchaseOrders,
      scopeOf(req),
      {
        supplierId: q.supplierId,
        prId: pr.id,
        orderDate: isoDate(today()),
        deliveryDate: isoDate(pr.requiredBy),
        paymentTerms: q.paymentTerms ?? undefined,
        currency: project.currency,
        terms: `Awarded under ${rfq.number}. ${justification}`,
        lines: q.lines.map((l) => {
          const pl = pr.lines.find((x) => x.id === l.prLineId)!;
          return { materialId: l.materialId, prLineId: pl.id, description: pl.description ?? mats.find((m) => m.id === l.materialId)?.name ?? 'Material', qty: l.qty.toString(), unit: pl.unit, rate: l.rate.toString(), discountPct: '0', taxRate: q.taxRate.toString(), costCodeId: pl.costCodeId };
        }),
      },
      tx,
    );
    await tx.purchaseOrder.update({ where: { id: created.id }, data: { rfqId: rfq.id, quotationId: q.id } });
    await tx.rfq.update({ where: { id: rfq.id }, data: { status: 'AWARDED', selectedQuotationId: q.id, selectionJustification: justification } });
    await audit(tx, ctx, { action: 'AWARD', entityType: 'rfq', entityId: rfq.id, projectId, summary: `${rfq.number} awarded; draft PO ${created.number} created`, reason: justification });
    return created;
  });
  res.status(201).json(po);
});

// ───────────── PO amendments, closure, PDF, reconciliation ─────────────

const amendSchema = z.object({
  reason: z.string().trim().min(5).max(2000),
  deliveryDate: zDate.optional(),
  lines: z
    .array(
      z.object({
        id: z.string().optional(),
        materialId: z.string().nullish(),
        description: z.string().min(1).max(300),
        qty: zDecimal(4),
        unit: z.string().min(1).max(20),
        rate: zDecimal(4),
        discountPct: zDecimal(6).default('0'),
        taxRate: zDecimal(6).default('0'),
        costCodeId: z.string(),
      }),
    )
    .min(1),
});

procurementRouter.post('/po/:id/amend', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'procurement.manage', projectId);
  const data = parseBody(amendSchema, req.body);
  const rev = await transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { id: param(req, 'id'), projectId }, include: { lines: true } });
    if (!po) throw notFound('PO');
    if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) throw businessRule('Only approved, open POs can be amended');
    const pending = await tx.poRevision.count({ where: { poId: po.id, status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED'] } } });
    if (pending) throw conflict('An amendment is already in progress for this PO');
    await assertRefsInScope(tx, 'costCodes', ctx.orgId, projectId, data.lines.map((l) => l.costCodeId), 'Cost code');
    for (const l of data.lines) if (l.id && !po.lines.some((x) => x.id === l.id)) throw validationError('Amended line does not belong to this PO');
    const priced = priceDocument(data.lines.map((l) => ({ quantity: l.qty, rate: l.rate, discountPct: l.discountPct, taxRate: l.taxRate })));
    const proposed = { ...priced, deliveryDate: data.deliveryDate ?? isoDate(po.deliveryDate), lines: data.lines.map((l, i) => ({ ...l, amount: priced.lines[i].amount, taxAmount: priced.lines[i].taxAmount })) };
    const removed = po.lines.filter((l) => !data.lines.some((x) => x.id === l.id));
    if (removed.length) throw validationError('Lines cannot be removed by amendment; set their quantity to the received quantity instead');
    const revisionNo = po.revision + 1;
    const number = await nextNumber(tx, { orgId: ctx.orgId, projectId, docType: 'PO_AMENDMENT' });
    const r = await tx.poRevision.create({ data: { poId: po.id, projectId, number, revisionNo, reason: data.reason, before: JSON.parse(JSON.stringify(po)), proposed: proposed as never, createdById: ctx.user.id } });
    await upsertRegister(tx, { orgId: ctx.orgId, projectId, docType: 'PO_AMENDMENT', number, entityType: 'poRevision', entityId: r.id, title: `${po.number} rev ${revisionNo}`, status: 'DRAFT', ownerId: ctx.user.id, amount: priced.netAmount });
    await audit(tx, ctx, { action: 'CREATE', entityType: 'poRevision', entityId: r.id, projectId, summary: `Amendment ${revisionNo} drafted for ${po.number}`, reason: data.reason });
    return r;
  });
  res.status(201).json(rev);
});

procurementRouter.post('/po-amendments/:revId/submit', async (req, res) => {
  const ctx = ctxOf(req);
  const rev = await prisma.poRevision.findFirst({ where: { id: param(req, 'revId'), projectId: param(req, 'projectId') } });
  if (!rev) throw notFound('Amendment');
  res.json(await submitDocument(ctx, 'PO_AMENDMENT', rev.id, req.body?.comment));
});

/** Short-closes or cancels an approved PO, releasing its remaining open commitment. */
procurementRouter.post('/po/:id/close', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'procurement.approve', projectId);
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(5).max(1000) }), req.body);
  const po = await transaction(async (tx) => {
    const p = await tx.purchaseOrder.findFirst({ where: { id: param(req, 'id'), projectId }, include: { lines: true } });
    if (!p) throw notFound('PO');
    if (!['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(p.status)) throw businessRule(`A PO in status ${p.status} cannot be closed`);
    const untouched = p.lines.every((l) => D(l.receivedQty).isZero() && D(l.invoicedQty).isZero());
    const byCode = await tx.costLedgerEntry.groupBy({ by: ['costCodeId'], where: { projectId, kind: 'COMMITMENT', sourceType: 'PO', sourceId: p.id }, _sum: { amount: true } });
    await postLedger(
      tx,
      ctx.user.id,
      byCode.filter((r) => D(r._sum.amount ?? 0).gt(0)).map((r) => ({ projectId, costCodeId: r.costCodeId, date: today(), kind: 'COMMITMENT' as const, amount: money(D(r._sum.amount ?? 0).neg()), sourceType: 'PO', sourceId: p.id, sourceNumber: p.number, partyId: p.supplierId, description: `Commitment released: ${reason}` })),
    );
    const status = untouched ? 'CANCELLED' : 'CLOSED';
    const u = await tx.purchaseOrder.update({ where: { id: p.id }, data: { status, closedReason: reason } });
    await tx.registerEntry.updateMany({ where: { entityType: 'purchaseOrder', entityId: p.id }, data: { status } });
    await audit(tx, ctx, { action: status === 'CANCELLED' ? 'CANCEL_APPROVED' : 'SHORT_CLOSE', entityType: 'purchaseOrder', entityId: p.id, projectId, summary: `${p.number} ${status.toLowerCase()}`, reason });
    return u;
  });
  res.json(po);
});

procurementRouter.get('/po/:id/reconciliation', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'procurement.view', projectId);
  const po = await prisma.purchaseOrder.findFirst({ where: { id: param(req, 'id'), projectId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
  if (!po) throw notFound('PO');
  const [grns, invoices, openCommitment] = await Promise.all([
    prisma.grn.findMany({ where: { poId: po.id }, select: { id: true, number: true, status: true, receivedDate: true, acceptedValue: true } }),
    prisma.supplierInvoice.findMany({ where: { poId: po.id }, select: { id: true, number: true, invoiceNo: true, status: true, subtotal: true, total: true, paidAmount: true } }),
    sourceBalance(prisma, { projectId, kind: 'COMMITMENT', sourceType: 'PO', sourceId: po.id }),
  ]);
  const lines = po.lines.map((l) => ({
    lineNo: l.lineNo,
    description: l.description,
    unit: l.unit,
    orderedQty: l.qty,
    receivedQty: l.receivedQty,
    invoicedQty: l.invoicedQty,
    pendingDeliveryQty: D(l.qty).minus(D(l.receivedQty)).toFixed(4),
    uninvoicedReceivedQty: D(l.receivedQty).minus(D(l.invoicedQty)).toFixed(4),
    orderedValue: l.amount,
    receivedValue: money(D(l.receivedQty).times(D(l.rate)).times(D(1).minus(D(l.discountPct)))),
  }));
  res.json({
    po: { id: po.id, number: po.number, status: po.status, netAmount: po.netAmount },
    lines,
    grns,
    invoices,
    totals: {
      ordered: money(po.netAmount),
      received: money(sum(lines.map((l) => l.receivedValue))),
      invoiced: money(sum(invoices.filter((i) => !['DRAFT', 'REJECTED', 'CANCELLED'].includes(i.status)).map((i) => i.subtotal))),
      paid: money(sum(invoices.map((i) => i.paidAmount))),
      openCommitment: money(openCommitment),
    },
  });
});

procurementRouter.get('/po/:id/pdf', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'procurement.view', projectId);
  const po = await prisma.purchaseOrder.findFirst({ where: { id: param(req, 'id'), projectId }, include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true } });
  if (!po) throw notFound('PO');
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const history = await requestHistory(prisma, 'PO', po.id);
  const cur = po.currency;
  const pdf = await renderPdf({
    title: `Purchase Order ${po.number}${po.revision ? ` (Rev ${po.revision})` : ''}`,
    subtitle: `${project.code} — ${project.name}`,
    meta: [
      ['Supplier', po.supplier.name],
      ['Status', humanize(po.status)],
      ['Order date', isoDate(po.orderDate) ?? ''],
      ['Delivery date', isoDate(po.deliveryDate) ?? '—'],
      ['Delivery address', po.deliveryAddress ?? project.location ?? '—'],
      ['Payment terms', po.paymentTerms ?? '—'],
      ['Supplier GSTIN', po.supplier.taxId ?? '—'],
      ['Currency', cur],
    ],
    columns: [
      { key: 'no', label: '#', width: 4 },
      { key: 'description', label: 'Description', width: 34 },
      { key: 'qty', label: 'Qty', width: 9, align: 'right' },
      { key: 'unit', label: 'Unit', width: 7 },
      { key: 'rate', label: 'Rate', width: 12, align: 'right' },
      { key: 'disc', label: 'Disc %', width: 7, align: 'right' },
      { key: 'amount', label: 'Net', width: 14, align: 'right' },
      { key: 'tax', label: 'Tax', width: 12, align: 'right' },
    ],
    rows: po.lines.map((l) => ({ no: String(l.lineNo), description: l.description, qty: D(l.qty).toString(), unit: l.unit, rate: D(l.rate).toFixed(2), disc: D(l.discountPct).times(100).toFixed(2), amount: formatMoney(l.amount, cur), tax: formatMoney(l.taxAmount, cur) })),
    totals: [
      ['Subtotal', formatMoney(po.subtotal, cur)],
      ['Discount', formatMoney(po.discount, cur)],
      ['Net (excl. tax)', formatMoney(po.netAmount, cur)],
      ['Tax', formatMoney(po.taxAmount, cur)],
      ['Total', formatMoney(po.total, cur)],
    ],
    approvals: history.flatMap((h) => h.actions.map((a) => ({ step: `Step ${a.stepNo}`, by: a.actorName + (a.onBehalfOfName ? ` (for ${a.onBehalfOfName})` : ''), action: a.action, at: a.createdAt.toISOString().slice(0, 16).replace('T', ' '), comment: a.comment ?? undefined }))),
    footerNotes: [po.terms ?? '', po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED' || po.status === 'RECEIVED' ? '' : 'DRAFT — not valid as an order until approved.'].filter(Boolean),
  });
  await audit(prisma, ctx, { action: 'EXPORT_PDF', entityType: 'purchaseOrder', entityId: po.id, projectId });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${po.number}.pdf"`);
  res.send(pdf);
});

/** Open PO lines for building a GRN or invoice. */
procurementRouter.get('/po/:id/open-lines', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'procurement.view', projectId);
  const po = await prisma.purchaseOrder.findFirst({ where: { id: param(req, 'id'), projectId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
  if (!po) throw notFound('PO');
  res.json(
    po.lines.map((l) => ({
      ...l,
      pendingQty: D(l.qty).minus(D(l.receivedQty)).toFixed(4),
      invoiceableQty: D(l.receivedQty).minus(D(l.invoicedQty)).toFixed(4),
    })),
  );
});
