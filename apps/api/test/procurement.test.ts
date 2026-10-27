/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { approveAll, approvedPo, day, ledger, setupWorld, type World } from './helpers.js';

let w: World;
beforeAll(async () => {
  w = await setupWorld();
});

async function grn(po: any, accepted: string, extra: Record<string, unknown> = {}) {
  const g = await w.c.proc.ok.post(`${w.P}/r/grns`, { poId: po.id, storeId: w.store.id, receivedDate: day(0), deliveryNoteNo: `DN-${Math.random().toString(36).slice(2, 8)}`, inspectionStatus: 'PASSED', lines: [{ poLineId: po.lines[0].id, receivedQty: accepted, acceptedQty: accepted, rejectedQty: '0', ...extra }] });
  return g;
}
async function invoice(po: any, qty: string, rate: string, invoiceNo: string) {
  return w.c.ap.ok.post(`${w.P}/r/supplierInvoices`, { supplierId: w.supplier.id, invoiceNo, invoiceDate: day(0), dueDate: day(30), poId: po.id, lines: [{ poLineId: po.lines[0].id, description: po.lines[0].description, qty, rate, taxRate: '0.18', costCodeId: w.cc.material.id }] });
}
async function balance(materialId: string) {
  const rows: any[] = await w.c.proc.ok.get(`${w.P}/stock/balances`);
  return rows.filter((r) => r.materialId === materialId).reduce((a, r) => a + Number(r.qty), 0);
}

describe('procure-to-pay cost postings', () => {
  let po: any;

  it('approving a PO posts its net value (tax excluded) as a commitment', async () => {
    po = await approvedPo(w, { qty: '100', rate: '400' });
    expect(po.status).toBe('APPROVED');
    expect(po.number).toMatch(/-PO-\d{4}$/);
    expect(Number(po.netAmount)).toBe(40000);
    expect(Number(po.total)).toBe(47200);
    expect(await ledger(w.project.id, w.cc.material.id)).toEqual({ COMMITMENT: '40000.00', ACCRUAL: '0.00', ACTUAL: '0.00' });
  });

  it('an approved GRN moves value from commitment to accrual and receives stock', async () => {
    const g = await grn(po, '60');
    await w.c.proc.ok.post(`${w.P}/r/grns/${g.id}/submit`);
    await approveAll(w, g.id, ['se']);
    expect(await ledger(w.project.id, w.cc.material.id)).toEqual({ COMMITMENT: '16000.00', ACCRUAL: '24000.00', ACTUAL: '0.00' });
    expect(await balance(w.cement.id)).toBe(60);
    const after = await w.c.proc.ok.get(`${w.P}/r/purchaseOrders/${po.id}`);
    expect(after.status).toBe('PARTIALLY_RECEIVED');
  });

  it('rejects a GRN that would receive more than ordered (no over-receipt tolerance)', async () => {
    const r = await w.c.proc.post(`${w.P}/r/grns`, { poId: po.id, storeId: w.store.id, receivedDate: day(0), deliveryNoteNo: 'DN-OVER', inspectionStatus: 'PASSED', lines: [{ poLineId: po.lines[0].id, receivedQty: '50', acceptedQty: '50', rejectedQty: '0' }] });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toMatch(/exceeds ordered/i);
  });

  it('a matched invoice reverses the accrual and posts actual cost — never both', async () => {
    const inv = await invoice(po, '60', '400', 'INV-A-1');
    const sub = await w.c.ap.ok.post(`${w.P}/r/supplierInvoices/${inv.id}/submit`);
    expect(sub.status ?? sub.request?.status).not.toBe('EXCEPTION');
    await approveAll(w, inv.id, ['cc', 'fin']);
    const l = await ledger(w.project.id, w.cc.material.id);
    expect(l).toEqual({ COMMITMENT: '16000.00', ACCRUAL: '0.00', ACTUAL: '24000.00' });
    // Incurred cost equals what was received, once.
    expect(Number(l.ACCRUAL) + Number(l.ACTUAL)).toBe(24000);
  });

  it('a duplicate supplier invoice number for the same supplier is refused', async () => {
    const r = await w.c.ap.post(`${w.P}/r/supplierInvoices`, { supplierId: w.supplier.id, invoiceNo: 'INV-A-1', invoiceDate: day(0), dueDate: day(30), poId: po.id, lines: [{ poLineId: po.lines[0].id, description: 'dup', qty: '1', rate: '400', taxRate: '0.18', costCodeId: w.cc.material.id }] });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it('an invoice priced above PO rate beyond tolerance is flagged as a three-way-match exception', async () => {
    const inv = await invoice(po, '10', '450', 'INV-A-2');
    await w.c.ap.ok.post(`${w.P}/r/supplierInvoices/${inv.id}/submit`);
    const got = await w.c.ap.ok.get(`${w.P}/r/supplierInvoices/${inv.id}`);
    expect(got.status).toBe('EXCEPTION');
    expect(got.matchResult.matched).toBe(false);
  });
});

describe('invoice received before goods (no double counting)', () => {
  it('posts actual once; the later GRN neither accrues nor relieves the invoiced quantity again', async () => {
    const before = await ledger(w.project.id, w.cc.material.id);
    const po = await approvedPo(w, { qty: '50', rate: '400' });
    const inv = await invoice(po, '50', '400', 'INV-B-1');
    await w.c.ap.ok.post(`${w.P}/r/supplierInvoices/${inv.id}/submit`);
    await approveAll(w, inv.id, ['cc', 'fin']);
    const g = await grn(po, '50');
    await w.c.proc.ok.post(`${w.P}/r/grns/${g.id}/submit`);
    await approveAll(w, g.id, ['se']);
    const after = await ledger(w.project.id, w.cc.material.id);
    const delta = (k: string) => Number(after[k]) - Number(before[k]);
    expect(delta('ACTUAL')).toBe(20000);
    expect(delta('ACCRUAL')).toBe(0);
    expect(delta('COMMITMENT')).toBe(0); // +20000 on PO approval, −20000 on invoice
  });
});

describe('stock ledger', () => {
  it('refuses to issue more than the store holds', async () => {
    const have = await balance(w.cement.id);
    const iss = await w.c.proc.ok.post(`${w.P}/r/materialIssues`, { type: 'ISSUE', storeId: w.store.id, date: day(0), costCodeId: w.cc.material.id, purpose: 'Test', lines: [{ materialId: w.cement.id, qty: String(have + 1) }] });
    await w.c.proc.ok.post(`${w.P}/r/materialIssues/${iss.id}/submit`);
    const inbox: any[] = await w.c.se.ok.get('/approvals/inbox');
    const req = inbox.find((x) => x.entityId === iss.id);
    const r = await w.c.se.post(`/approvals/${req.id}/approve`, { comment: 'ok' });
    expect(r.status).toBe(422);
    expect(await balance(w.cement.id)).toBe(have);
  });

  it('an approved issue reduces stock at weighted average cost without posting cost twice', async () => {
    const have = await balance(w.cement.id);
    const before = await ledger(w.project.id);
    const iss = await w.c.proc.ok.post(`${w.P}/r/materialIssues`, { type: 'ISSUE', storeId: w.store.id, date: day(0), costCodeId: w.cc.material.id, purpose: 'Test', lines: [{ materialId: w.cement.id, qty: '10' }] });
    await w.c.proc.ok.post(`${w.P}/r/materialIssues/${iss.id}/submit`);
    await approveAll(w, iss.id, ['se']);
    expect(await balance(w.cement.id)).toBe(have - 10);
    const got = await w.c.proc.ok.get(`${w.P}/r/materialIssues/${iss.id}`);
    expect(Number(got.totalValue)).toBe(4000);
    // Material cost was recognised on receipt; issuing it is a stock movement, not a new cost.
    expect(await ledger(w.project.id)).toEqual(before);
  });
});

describe('append-only ledgers (database-enforced)', () => {
  it('rejects updates and deletes on the cost ledger, stock ledger and audit trail', async () => {
    const { prisma } = await import('./helpers.js');
    const entry = await prisma.costLedgerEntry.findFirstOrThrow({ where: { projectId: w.project.id } });
    await expect(prisma.costLedgerEntry.update({ where: { id: entry.id }, data: { amount: '1' } })).rejects.toThrow(/append-only/);
    await expect(prisma.costLedgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    const stock = await prisma.stockTransaction.findFirstOrThrow({ where: { projectId: w.project.id } });
    await expect(prisma.stockTransaction.update({ where: { id: stock.id }, data: { qty: '0' } })).rejects.toThrow(/append-only/);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { projectId: w.project.id } });
    await expect(prisma.auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
  });
});
