/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { approveAll, ledger, prisma, setupWorld, type World } from './helpers.js';

let w: World;
let period: any;
const lastMonth = (() => {
  const t = new Date();
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 15));
  return { code: d.toISOString().slice(0, 7), date: d.toISOString().slice(0, 10) };
})();

beforeAll(async () => {
  w = await setupWorld();
});

describe('month-end close', () => {
  it('cannot be submitted while checklist items are pending', async () => {
    period = await w.c.cc.ok.post(`${w.P}/periods`, { code: lastMonth.code });
    const r = await w.c.cc.post(`${w.P}/periods/${period.id}/close`);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it('closes after every item is done or waived with a note and the reviewer signs off', async () => {
    const p = await w.c.cc.ok.get(`${w.P}/periods/${period.id}`);
    for (const item of p.checklist) await w.c.cc.ok.post(`${w.P}/periods/${period.id}/checklist/${item.key}`, item.key.includes('stock') ? { status: 'WAIVED', note: 'No stores in this period' } : { status: 'DONE' });
    expect((await w.c.cc.post(`${w.P}/periods/${period.id}/checklist/${p.checklist[0].key}`, { status: 'WAIVED' })).status).toBe(422);
    await w.c.cc.ok.post(`${w.P}/periods/${period.id}/close`);
    await approveAll(w, period.id, ['pd']);
    expect((await w.c.cc.ok.get(`${w.P}/periods/${period.id}`)).status).toBe('CLOSED');
  });

  it('rejects cost postings dated in a closed period', async () => {
    const before = await ledger(w.project.id);
    const e = await w.c.ap.ok.post(`${w.P}/r/expenses`, { date: lastMonth.date, category: 'SITE_OVERHEAD', costCodeId: w.cc.other.id, payeeName: 'Vendor', description: 'Late bill', amountBeforeTax: '500', taxRate: '0' });
    await w.c.ap.ok.post(`${w.P}/r/expenses/${e.id}/submit`);
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: e.id, status: 'PENDING' } });
    const r = await w.c.pm.post(`/approvals/${req.id}/approve`, { comment: 'ok' });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/closed/i);
    expect(await ledger(w.project.id)).toEqual(before);
    expect((await w.c.ap.ok.get(`${w.P}/r/expenses/${e.id}`)).status).toBe('SUBMITTED');
  });

  it('only an authorised user can reopen, and a reason is mandatory and audited', async () => {
    expect((await w.c.cc.post(`${w.P}/periods/${period.id}/reopen`, { reason: 'Late supplier bill to be booked' })).status).toBe(403);
    expect((await w.c.pd.post(`${w.P}/periods/${period.id}/reopen`, { reason: 'late' })).status).toBe(422);
    await w.c.pd.ok.post(`${w.P}/periods/${period.id}/reopen`, { reason: 'Late supplier bill to be booked' });
    const ev = await prisma.auditEvent.findFirst({ where: { entityId: period.id, action: 'PERIOD_REOPENED' } });
    expect(ev?.reason).toBe('Late supplier bill to be booked');
  });
});
