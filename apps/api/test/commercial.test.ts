/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { approveAll, approvedPo, day, ledger, prisma, setupWorld, type World } from './helpers.js';

let w: World;
let boq: any;
beforeAll(async () => {
  w = await setupWorld();
  boq = await w.c.qs.ok.post(`${w.P}/r/boqItems`, { itemCode: 'C-1', description: 'Brickwork 230 mm', section: 'Masonry', unit: 'CUM', contractQty: '1000', estimatedQty: '1000', unitRate: '9000', costCodeId: w.cc.subcon.id });
  // A certified measurement of 100 CUM: 100 × 9,000 = 9,00,000 of work value.
  const m = await w.c.qs.ok.post(`${w.P}/r/measurements`, { type: 'MB', boqItemId: boq.id, measuredOn: day(-5), location: 'Block A', nos: '1', length: '100' });
  await w.c.qs.ok.post(`${w.P}/measurements/${m.id}/submit-for-verification`);
  await w.c.se.ok.post(`${w.P}/measurements/${m.id}/verify`, { verifiedQty: '100' });
  await w.c.qs.ok.post(`${w.P}/r/measurements/${m.id}/submit`);
  await approveAll(w, m.id, ['pm']);
});

const bills = () => `${w.P}/billing/client-bills`;
const budgetRow = async (costCodeId: string) => (await w.c.cc.ok.get(`${w.P}/budget`)).rows.find((r: any) => r.costCodeId === costCodeId).position;

async function receipt(clientBillId: string, amount: string) {
  return w.c.ap.ok.post(`${w.P}/r/payments`, { direction: 'IN', partyId: w.client.id, date: day(0), method: 'BANK_TRANSFER', reference: `UTR-${amount}`, allocations: [{ clientBillId, amount }] });
}

describe('client billing and receivables', () => {
  let bill: any;

  it('computes the client bill on the server from certified quantities', async () => {
    bill = await w.c.bill.ok.post(bills(), { periodFrom: day(-30), periodTo: day(0) });
    expect(Number(bill.currentWorkValue)).toBe(900000);
    expect(Number(bill.retention)).toBe(45000); // 5 % of this bill's work value
    expect(Number(bill.taxAmount)).toBe(162000); // 18 %
    expect(Number(bill.netAmount)).toBe(1017000); // 9,00,000 + 1,62,000 − 45,000
    expect((await w.c.bill.post(bills(), { periodFrom: day(-30), periodTo: day(0) })).status).toBe(422); // one open bill at a time
  });

  it('client certification needs internal approval first and cannot exceed the claim', async () => {
    const cert = { certifiedAmount: '1000000', invoiceNo: 'TAX-001', invoiceDate: day(-70), dueDate: day(-40) };
    expect((await w.c.bill.post(`${bills()}/${bill.id}/client-certification`, cert)).status).toBe(422);
    await w.c.bill.ok.post(`${bills()}/${bill.id}/submit`);
    await approveAll(w, bill.id, ['pm', 'cc']);
    expect((await w.c.bill.post(`${bills()}/${bill.id}/client-certification`, { ...cert, certifiedAmount: '1017000.01' })).status).toBe(422);
    const c = await w.c.bill.ok.post(`${bills()}/${bill.id}/client-certification`, cert);
    expect(c.status).toBe('CERTIFIED');
    expect(Number(c.certifiedAmount)).toBe(1000000);
  });

  it('ages the certified amount from the due date and shows retention receivable', async () => {
    const aging = await w.c.fin.ok.get(`${w.P}/billing/receivables-aging`);
    const row = aging.rows.find((r: any) => r.id === bill.id);
    expect(Number(row.outstanding)).toBe(1000000);
    expect(row.daysOverdue).toBe(40);
    expect(row.bucket).toBe('d60');
    expect(Number(aging.buckets.d60)).toBe(1000000);
    expect(Number(aging.retentionReceivable)).toBe(45000);
  });

  it('receipts reduce the outstanding amount; over-allocation and wrong directions are refused', async () => {
    const wrong = await w.c.ap.post(`${w.P}/r/payments`, { direction: 'OUT', partyId: w.client.id, date: day(0), allocations: [{ clientBillId: bill.id, amount: '100' }] });
    expect(wrong.status).toBe(422);
    const r1 = await receipt(bill.id, '400000');
    expect(Number(r1.amount)).toBe(400000);
    await w.c.ap.ok.post(`${w.P}/r/payments/${r1.id}/submit`);
    expect((await w.c.ap.ok.get('/approvals/inbox')).some((x: any) => x.entityId === r1.id)).toBe(false); // no self-approval
    await approveAll(w, r1.id, ['fin']);
    let b = await w.c.fin.ok.get(`${bills()}/${bill.id}`);
    expect(b.status).toBe('PARTIALLY_PAID');
    expect(Number(b.receivedAmount)).toBe(400000);
    expect(b.receipts).toHaveLength(1);
    const over = await receipt(bill.id, '600000.01');
    const sub = await w.c.ap.post(`${w.P}/r/payments/${over.id}/submit`);
    expect(sub.status).toBe(422);
    expect(sub.body.error.message).toMatch(/exceeds the outstanding 600000\.00/);
    const r2 = await receipt(bill.id, '600000');
    await w.c.ap.ok.post(`${w.P}/r/payments/${r2.id}/submit`);
    await approveAll(w, r2.id, ['fin']);
    b = await w.c.fin.ok.get(`${bills()}/${bill.id}`);
    expect(b.status).toBe('PAID');
    const aging = await w.c.fin.ok.get(`${w.P}/billing/receivables-aging`);
    expect(aging.rows.find((r: any) => r.id === bill.id)).toBeUndefined();
    expect(Number(aging.retentionReceivable)).toBe(45000); // retention stays receivable until released
  });

  it('client billing and receipts never touch the cost ledger', async () => {
    expect(await ledger(w.project.id)).toEqual({ COMMITMENT: '0.00', ACCRUAL: '0.00', ACTUAL: '0.00' });
  });
});

describe('variation → budget revision → BAC', () => {
  let vo: any;

  it('a submitted variation is shown as exposure, not as budget', async () => {
    vo = await w.c.qs.ok.post(`${w.P}/r/variations`, { title: 'Additional parapet wall', origin: 'CLIENT', reason: 'Client instruction CI-07', costCodeId: w.cc.other.id, lines: [{ description: 'Parapet brickwork', unit: 'CUM', qty: '10', rate: '5000', costRate: '3000' }] });
    expect(Number(vo.revenueImpact)).toBe(50000);
    expect(Number(vo.costImpact)).toBe(30000);
    await w.c.qs.ok.post(`${w.P}/r/variations/${vo.id}/submit`);
    const pos = await budgetRow(w.cc.other.id);
    expect(Number(pos.approvedBudget)).toBe(500000);
    expect(Number(pos.pendingVariationExposure)).toBe(30000);
  });

  it('approval sets the approved value and drafts a budget revision for the cost impact', async () => {
    await approveAll(w, vo.id, ['pm', 'cc']);
    const v = await w.c.qs.ok.get(`${w.P}/r/variations/${vo.id}`);
    expect(v.status).toBe('APPROVED');
    expect(Number(v.approvedValue)).toBe(50000);
    const br = await prisma.budgetRevision.findFirstOrThrow({ where: { variationId: vo.id }, include: { lines: true } });
    expect(br.status).toBe('DRAFT');
    expect(Number(br.totalDelta.toFixed(2))).toBe(30000);
    expect(br.lines.map((l) => [l.costCodeId, l.delta.toFixed(2)])).toEqual([[w.cc.other.id, '30000.00']]);
    // The budget does not move until the revision itself is approved.
    const pos = await budgetRow(w.cc.other.id);
    expect(Number(pos.approvedBudget)).toBe(500000);
    expect(Number(pos.pendingVariationExposure)).toBe(0);
  });

  it('the approved revision raises BAC by the cost impact', async () => {
    const br = await prisma.budgetRevision.findFirstOrThrow({ where: { variationId: vo.id } });
    await w.c.cc.ok.post(`${w.P}/r/budgetRevisions/${br.id}/submit`);
    await approveAll(w, br.id, ['pm', 'pd']);
    const pos = await budgetRow(w.cc.other.id);
    expect(Number(pos.originalBudget)).toBe(500000);
    expect(Number(pos.approvedBudget)).toBe(530000);
  });

  it('the approved variation value is billed to the client on the next bill', async () => {
    const b2 = await w.c.bill.ok.post(bills(), { periodFrom: day(-1), periodTo: day(0) });
    expect(Number(b2.variationValue)).toBe(50000);
    expect(Number(b2.previousGross)).toBe(900000);
    expect(Number(b2.currentWorkValue)).toBe(50000);
    expect(Number(b2.retention)).toBe(2500);
  });
});

describe('PO amendment and short-close', () => {
  let po: any;

  it('an amendment changes the commitment by the difference in open value', async () => {
    po = await approvedPo(w, { qty: '100', rate: '400' }); // 40,000 + tax
    const g = await w.c.proc.ok.post(`${w.P}/r/grns`, { poId: po.id, storeId: w.store.id, receivedDate: day(0), deliveryNoteNo: 'DN-AM-1', inspectionStatus: 'PASSED', lines: [{ poLineId: po.lines[0].id, receivedQty: '30', acceptedQty: '30', rejectedQty: '0' }] });
    await w.c.proc.ok.post(`${w.P}/r/grns/${g.id}/submit`);
    await approveAll(w, g.id, ['se']);
    expect(await ledger(w.project.id, w.cc.material.id)).toEqual({ COMMITMENT: '28000.00', ACCRUAL: '12000.00', ACTUAL: '0.00' });

    const line = po.lines[0];
    const amended = { id: line.id, materialId: line.materialId, description: line.description, qty: '150', unit: line.unit, rate: '400', discountPct: '0', taxRate: '0.18', costCodeId: line.costCodeId };
    expect((await w.c.proc.post(`${w.P}/procurement/po/${po.id}/amend`, { reason: 'Drop line', lines: [] })).status).toBe(422);
    const rev = await w.c.proc.ok.post(`${w.P}/procurement/po/${po.id}/amend`, { reason: 'Additional floors released', lines: [amended] });
    expect((await w.c.proc.post(`${w.P}/procurement/po/${po.id}/amend`, { reason: 'Second change', lines: [amended] })).status).toBe(409);
    await w.c.proc.ok.post(`${w.P}/procurement/po-amendments/${rev.id}/submit`);
    // Nothing moves until approval.
    expect((await ledger(w.project.id, w.cc.material.id)).COMMITMENT).toBe('28000.00');
    await approveAll(w, rev.id, ['pm', 'cc']);
    // Open value was 70 × 400 = 28,000; now 120 × 400 = 48,000 → +20,000.
    expect(await ledger(w.project.id, w.cc.material.id)).toEqual({ COMMITMENT: '48000.00', ACCRUAL: '12000.00', ACTUAL: '0.00' });
    const p = await w.c.proc.ok.get(`${w.P}/r/purchaseOrders/${po.id}`);
    expect(p.revision).toBe(1);
    expect(Number(p.netAmount)).toBe(60000);
    expect(Number(p.lines[0].qty)).toBe(150);
  });

  it('short-close releases the remaining commitment and keeps what was received', async () => {
    expect((await w.c.proc.post(`${w.P}/procurement/po/${po.id}/close`, { reason: 'Balance not required' })).status).toBe(403);
    expect((await w.c.pm.post(`${w.P}/procurement/po/${po.id}/close`, { reason: 'no' })).status).toBe(422);
    const closed = await w.c.pm.ok.post(`${w.P}/procurement/po/${po.id}/close`, { reason: 'Balance not required — design change' });
    expect(closed.status).toBe('CLOSED');
    expect(await ledger(w.project.id, w.cc.material.id)).toEqual({ COMMITMENT: '0.00', ACCRUAL: '12000.00', ACTUAL: '0.00' });
    expect((await w.c.proc.post(`${w.P}/procurement/po/${po.id}/amend`, { reason: 'Too late', lines: [] })).status).toBe(422);
    expect((await w.c.pm.post(`${w.P}/procurement/po/${po.id}/close`, { reason: 'Closing again' })).status).toBe(422);
  });
});

describe('supplier payments', () => {
  let po: any;
  let inv: any;

  it('only approved invoices can be paid, and payments mark them partly or fully paid', async () => {
    po = await approvedPo(w, { qty: '10', rate: '500' });
    inv = await w.c.ap.ok.post(`${w.P}/r/supplierInvoices`, { supplierId: w.supplier.id, invoiceNo: 'SINV-9', invoiceDate: day(0), dueDate: day(30), poId: po.id, lines: [{ poLineId: po.lines[0].id, description: po.lines[0].description, qty: '10', rate: '500', taxRate: '0.18', costCodeId: w.cc.material.id }] });
    expect(Number(inv.total)).toBe(5900);
    const pay = (amount: string, invoiceId = inv.id) => w.c.ap.ok.post(`${w.P}/r/payments`, { direction: 'OUT', partyId: w.supplier.id, date: day(0), allocations: [{ supplierInvoiceId: invoiceId, amount }] });
    const early = await pay('1000');
    const r = await w.c.ap.post(`${w.P}/r/payments/${early.id}/submit`);
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/not approved for payment/);

    await w.c.ap.ok.post(`${w.P}/r/supplierInvoices/${inv.id}/submit`);
    await approveAll(w, inv.id, ['cc', 'fin']);
    const before = await ledger(w.project.id);

    const p1 = await pay('2000');
    await w.c.ap.ok.post(`${w.P}/r/payments/${p1.id}/submit`);
    await approveAll(w, p1.id, ['fin']);
    let i = await w.c.ap.ok.get(`${w.P}/r/supplierInvoices/${inv.id}`);
    expect(i.status).toBe('PARTIALLY_PAID');
    expect(Number(i.paidAmount)).toBe(2000);

    const tooMuch = await pay('3900.01');
    expect((await w.c.ap.post(`${w.P}/r/payments/${tooMuch.id}/submit`)).status).toBe(422);
    const p2 = await pay('3900');
    await w.c.ap.ok.post(`${w.P}/r/payments/${p2.id}/submit`);
    await approveAll(w, p2.id, ['fin']);
    i = await w.c.ap.ok.get(`${w.P}/r/supplierInvoices/${inv.id}`);
    expect(i.status).toBe('PAID');
    // Paying an invoice settles a liability; the cost was already recognised when the invoice was approved.
    expect(await ledger(w.project.id)).toEqual(before);
  });

  it('a payment cannot be allocated to another supplier’s invoice', async () => {
    const other = await w.c.admin.ok.post('/org/r/parties', { code: `SUP2-${w.tag}`, name: 'Other supplier', kinds: ['SUPPLIER'], isApproved: true });
    const r = await w.c.ap.post(`${w.P}/r/payments`, { direction: 'OUT', partyId: other.id, date: day(0), allocations: [{ supplierInvoiceId: inv.id, amount: '1' }] });
    expect(r.status).toBe(422);
  });
});
