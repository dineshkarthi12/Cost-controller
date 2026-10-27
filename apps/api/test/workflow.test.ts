/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { approveAll, day, ledger, prisma, setupWorld, type World } from './helpers.js';

let w: World;
beforeAll(async () => {
  w = await setupWorld();
});

const expense = (amount: string, by = w.c.cc) =>
  by.ok.post(`${w.P}/r/expenses`, { date: day(0), category: 'SITE_OVERHEAD', costCodeId: w.cc.other.id, payeeName: 'Local vendor', description: 'Site sundries', amountBeforeTax: amount, taxRate: '0' });

describe('approval workflow', () => {
  it('the submitter cannot approve their own document at any step (separation of duties)', async () => {
    // Cost control lead raises an expense above the threshold where they are also the step-2 approver.
    const e = await expense('60000', w.c.cc);
    await w.c.cc.ok.post(`${w.P}/r/expenses/${e.id}/submit`);
    await approveAll(w, e.id, ['pm']);
    const inbox: any[] = await w.c.cc.ok.get('/approvals/inbox');
    expect(inbox.find((x) => x.entityId === e.id)).toBeUndefined();
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: e.id, status: 'PENDING' } });
    const r = await w.c.cc.post(`/approvals/${req.id}/approve`, { comment: 'self' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/separation of duties/i);
    expect((await w.c.cc.ok.get(`${w.P}/r/expenses/${e.id}`)).status).toBe('SUBMITTED');
  });

  it('returned documents can be corrected and resubmitted; the history is kept', async () => {
    const e = await expense('1000', w.c.ap);
    await w.c.ap.ok.post(`${w.P}/r/expenses/${e.id}/submit`);
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: e.id, status: 'PENDING' } });
    await w.c.pm.ok.post(`/approvals/${req.id}/return`, { comment: 'Attach the bill' });
    expect((await w.c.ap.ok.get(`${w.P}/r/expenses/${e.id}`)).status).toBe('RETURNED');
    await w.c.ap.ok.patch(`${w.P}/r/expenses/${e.id}`, { description: 'Site sundries (bill attached)' });
    await w.c.ap.ok.post(`${w.P}/r/expenses/${e.id}/submit`);
    await approveAll(w, e.id, ['pm']);
    expect((await w.c.ap.ok.get(`${w.P}/r/expenses/${e.id}`)).status).toBe('APPROVED');
    expect(await prisma.approvalRequest.count({ where: { entityId: e.id } })).toBe(2);
    const actions = (await prisma.auditEvent.findMany({ where: { entityId: e.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['RETURN', 'APPROVE']));
  });

  it('rejected documents post no cost', async () => {
    const before = await ledger(w.project.id, w.cc.other.id);
    const e = await expense('2500', w.c.ap);
    await w.c.ap.ok.post(`${w.P}/r/expenses/${e.id}/submit`);
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: e.id, status: 'PENDING' } });
    await w.c.pm.ok.post(`/approvals/${req.id}/reject`, { comment: 'Not project related' });
    expect((await w.c.ap.ok.get(`${w.P}/r/expenses/${e.id}`)).status).toBe('REJECTED');
    expect(await ledger(w.project.id, w.cc.other.id)).toEqual(before);
  });

  it('an approved expense posts actual cost exactly once', async () => {
    const before = await ledger(w.project.id, w.cc.other.id);
    const e = await expense('3000', w.c.ap);
    await w.c.ap.ok.post(`${w.P}/r/expenses/${e.id}/submit`);
    await approveAll(w, e.id, ['pm']);
    const after = await ledger(w.project.id, w.cc.other.id);
    expect(Number(after.ACTUAL) - Number(before.ACTUAL)).toBe(3000);
  });

  it('the final approver must have sufficient approval limit', async () => {
    await w.c.admin.ok.post(`${w.P}/members`, { userId: w.users.pm.id, approvalLimit: '10000' });
    const e = await expense('20000', w.c.ap);
    await w.c.ap.ok.post(`${w.P}/r/expenses/${e.id}/submit`);
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: e.id, status: 'PENDING' } });
    const r = await w.c.pm.post(`/approvals/${req.id}/approve`, { comment: 'ok' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/approval limit/i);
    expect((await w.c.ap.ok.get(`${w.P}/r/expenses/${e.id}`)).status).toBe('SUBMITTED');
    await w.c.admin.ok.post(`${w.P}/members`, { userId: w.users.pm.id, approvalLimit: '50000' });
    await w.c.pm.ok.post(`/approvals/${req.id}/approve`, { comment: 'ok' });
    expect((await w.c.ap.ok.get(`${w.P}/r/expenses/${e.id}`)).status).toBe('APPROVED');
  });

  it('larger amounts route through additional steps', async () => {
    const e = await expense('60000', w.c.ap);
    await w.c.ap.ok.post(`${w.P}/r/expenses/${e.id}/submit`);
    const req = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: e.id, status: 'PENDING' } });
    expect((req.steps as any[]).length).toBe(2);
    await approveAll(w, e.id, ['pm', 'cc']);
    expect((await w.c.ap.ok.get(`${w.P}/r/expenses/${e.id}`)).status).toBe('APPROVED');
  });

  it('approved documents cannot be edited', async () => {
    const e = await expense('100', w.c.ap);
    await w.c.ap.ok.post(`${w.P}/r/expenses/${e.id}/submit`);
    await approveAll(w, e.id, ['pm']);
    const r = await w.c.ap.patch(`${w.P}/r/expenses/${e.id}`, { description: 'changed' });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe('document numbering', () => {
  it('is unique and gap-free under concurrent creation', async () => {
    const make = () => w.c.se.ok.post(`${w.P}/r/mrs`, { department: 'Site', requiredBy: day(5), priority: 'LOW', costCodeId: w.cc.material.id, lines: [{ materialId: w.cement.id, qty: '1', unit: 'BAG' }] });
    const made = await Promise.all(Array.from({ length: 12 }, make));
    const numbers = made.map((m) => m.number);
    expect(new Set(numbers).size).toBe(12);
    const seqs = numbers.map((n: string) => Number(n.split('-').pop())).sort((a, b) => a - b);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i] - seqs[i - 1]).toBe(1);
  });
});

describe('contract clause validation', () => {
  it('survives unrelated edits but is cleared when the interpretation changes', async () => {
    const con = await w.c.pm.ok.post(`${w.P}/r/contracts`, { title: 'Main contract', type: 'MAIN', counterpartyId: w.client.id, value: '20000000', clauses: [{ clauseRef: '14.3', category: 'PAYMENT', sourceText: 'Payment within 30 days of certification.', interpretation: 'Client pays 30 days after IPC.' }] });
    const clause = (await w.c.pm.ok.get(`${w.P}/r/contracts/${con.id}`)).clauses[0];
    await w.c.pm.ok.post(`${w.P}/contract-clauses/${clause.id}/validate`);
    const keep = await w.c.pm.ok.get(`${w.P}/r/contracts/${con.id}`);
    const body = { title: 'Main contract (signed)', clauses: keep.clauses.map((c: any) => ({ clauseRef: c.clauseRef, category: c.category, sourceText: c.sourceText, interpretation: c.interpretation })) };
    await w.c.pm.ok.patch(`${w.P}/r/contracts/${con.id}`, body);
    expect((await w.c.pm.ok.get(`${w.P}/r/contracts/${con.id}`)).clauses[0].validatedAt).not.toBeNull();
    body.clauses[0].interpretation = 'Client pays 45 days after IPC.';
    await w.c.pm.ok.patch(`${w.P}/r/contracts/${con.id}`, body);
    expect((await w.c.pm.ok.get(`${w.P}/r/contracts/${con.id}`)).clauses[0].validatedAt).toBeNull();
  });
});
