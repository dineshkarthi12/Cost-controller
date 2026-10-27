/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { approveAll, day, ledger, setupWorld, type World } from './helpers.js';

let w: World;
let boq: any;
let sc: any;
beforeAll(async () => {
  w = await setupWorld();
  boq = await w.c.qs.ok.post(`${w.P}/r/boqItems`, { itemCode: 'B-1', description: 'RCC M30', section: 'Structure', unit: 'CUM', contractQty: '1000', estimatedQty: '1000', unitRate: '9000', costCodeId: w.cc.subcon.id });
  sc = await w.c.bill.ok.post(`${w.P}/r/subcontracts`, { contractorId: w.sub.id, title: 'RCC labour', costCodeId: w.cc.subcon.id, startDate: day(-30), endDate: day(200), retentionPct: '0.05', advanceAmount: '0', advanceRecoveryPct: '0', taxRate: '0.18', paymentTermsDays: 30, items: [{ boqItemId: boq.id, description: 'RCC labour', unit: 'CUM', qty: '1000', rate: '2000' }] });
  await w.c.bill.ok.post(`${w.P}/r/subcontracts/${sc.id}/submit`);
  await approveAll(w, sc.id, ['pm', 'cc']);
});

async function measurement(qty: string) {
  return w.c.qs.ok.post(`${w.P}/r/measurements`, { type: 'MB', boqItemId: boq.id, contractorId: w.sub.id, subcontractId: sc.id, measuredOn: day(-2), location: `Level ${Math.random().toString(36).slice(2, 6)}`, nos: '1', length: qty });
}

describe('subcontract commitment', () => {
  it('an approved subcontract commits its value', async () => {
    expect(await ledger(w.project.id, w.cc.subcon.id)).toEqual({ COMMITMENT: '2000000.00', ACCRUAL: '0.00', ACTUAL: '0.00' });
  });
});

describe('measurement verification and certification', () => {
  let m: any;
  it('the recorder cannot verify their own measurement', async () => {
    m = await measurement('100');
    expect(Number(m.calculatedQty)).toBe(100);
    await w.c.qs.ok.post(`${w.P}/measurements/${m.id}/submit-for-verification`);
    const r = await w.c.qs.post(`${w.P}/measurements/${m.id}/verify`, { verifiedQty: '100' });
    expect(r.status).toBe(403);
  });

  it('site verification records the variance and certification makes it billable', async () => {
    await w.c.se.ok.post(`${w.P}/measurements/${m.id}/verify`, { verifiedQty: '95', note: 'Overlap at grid line' });
    const v = await w.c.qs.ok.get(`${w.P}/r/measurements/${m.id}`);
    expect(v.status).toBe('VERIFIED');
    expect(Number(v.variance)).toBe(-5);
    await w.c.qs.ok.post(`${w.P}/r/measurements/${m.id}/submit`);
    await approveAll(w, m.id, ['pm']);
    expect((await w.c.qs.ok.get(`${w.P}/r/measurements/${m.id}`)).status).toBe('CERTIFIED');
  });

  it('reported progress alone never creates a billable quantity', async () => {
    const r = await w.c.bill.post(`${w.P}/billing/contractor-bills`, { subcontractId: sc.id, periodFrom: day(-60), periodTo: day(-40) });
    expect(r.status).toBe(422);
  });
});

describe('RA bill', () => {
  let bill: any;
  it('is computed on the server from certified quantities with retention and tax', async () => {
    bill = await w.c.bill.ok.post(`${w.P}/billing/contractor-bills`, { subcontractId: sc.id, periodFrom: day(-30), periodTo: day(0), contractorInvoiceNo: 'KC-1' });
    expect(Number(bill.currentWorkValue)).toBe(190000); // 95 × 2000
    expect(Number(bill.retention)).toBe(9500); // 5 %
    expect(Number(bill.taxAmount)).toBe(34200); // 18 % of work value
    expect(Number(bill.netPayable)).toBe(190000 - 9500 + 34200);
  });

  it('the same certified quantity cannot be billed twice', async () => {
    const r = await w.c.bill.post(`${w.P}/billing/contractor-bills`, { subcontractId: sc.id, periodFrom: day(-30), periodTo: day(0) });
    expect(r.status).toBe(422);
  });

  it('certification posts actual cost and relieves the subcontract commitment by the same amount', async () => {
    await w.c.bill.ok.post(`${w.P}/billing/contractor-bills/${bill.id}/submit`);
    await approveAll(w, bill.id, ['pm', 'cc']);
    expect(await ledger(w.project.id, w.cc.subcon.id)).toEqual({ COMMITMENT: '1810000.00', ACCRUAL: '0.00', ACTUAL: '190000.00' });
  });

  it('cost position reflects incurred + committed without double counting', async () => {
    const b = await w.c.cc.ok.get(`${w.P}/budget`);
    const row = b.rows.find((r: any) => r.costCodeId === w.cc.subcon.id);
    expect(Number(row.position.incurred)).toBe(190000);
    expect(Number(row.position.openCommitments)).toBe(1810000);
    // Remaining = BAC − incurred − commitments
    expect(Number(row.position.remainingBudget)).toBe(3000000 - 190000 - 1810000);
    expect(Number(row.position.eac)).toBe(Number(row.position.incurred) + Number(row.position.etc));
  });
});
