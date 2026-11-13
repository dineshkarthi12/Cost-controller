/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, approveAll, day, PASSWORD, prisma, setupWorld, type World } from './helpers.js';

/**
 * Purchase match check (ENFORCE, the production default): MR / PR / PO lines are compared with the BOM,
 * the source MR / PR, the awarded quotation and the budget before approval.
 */
let w: World;
let steel: any;
let pmUpload: ReturnType<typeof request.agent>;

async function setMode(mode: 'ENFORCE' | 'WARN') {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: w.org.id } });
  await prisma.organisation.update({ where: { id: w.org.id }, data: { settings: { ...(org.settings as object), purchaseMatchCheck: mode } } });
}

/** BOM item with cement: 1000 bags at ₹400. */
async function cementBom(qty = '1000', rate: string | null = '400') {
  await prisma.bomItem.create({
    data: {
      projectId: w.project.id,
      lineNo: 1,
      refCode: '1.01',
      title: 'RCC footing',
      createdById: w.users.qs.id,
      lines: { create: [{ lineNo: 1, kind: 'MATERIAL', description: 'Cement', qty, wastagePct: '0', totalQty: qty, unit: 'BAG', rate, amount: rate === null ? null : String(Number(qty) * Number(rate)), materialId: w.cement.id, rateSource: 'MANUAL' }] },
    },
  });
}

async function mr(materialId: string, qty: string, unit = 'BAG') {
  const m = await w.c.se.ok.post(`${w.P}/r/mrs`, { department: 'Site', requiredBy: day(10), priority: 'MEDIUM', costCodeId: w.cc.material.id, justification: 'Test', lines: [{ materialId, qty, unit }] });
  await w.c.se.ok.post(`${w.P}/r/mrs/${m.id}/submit`);
  return m;
}

async function inboxRow(entityId: string) {
  const inbox: any[] = await w.c.pm.ok.get('/approvals/inbox');
  return inbox.find((x) => x.entityId === entityId);
}

async function attachPdf(entityType: string, entityId: string) {
  const r = await pmUpload.post(`/api${w.P}/attachments`).set('X-Requested-With', 'toprock').field('entityType', entityType).field('entityId', entityId).attach('files', Buffer.from('%PDF-1.4\n% supplier letter\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n'), { filename: 'supplier-letter.pdf', contentType: 'application/pdf' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}

beforeAll(async () => {
  w = await setupWorld({ matchCheck: 'ENFORCE' });
  steel = await w.c.admin.ok.post('/org/r/materials', { code: `STL-${w.tag}`, name: 'TMT steel', category: 'Steel', unit: 'MT', standardRate: '60000' });
  pmUpload = request.agent(app);
  await pmUpload.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.pm.email, password: PASSWORD });
});

describe('purchase match check', () => {
  it('blocks approval when the project has no BOM, and still allows rejecting', async () => {
    const m = await mr(w.cement.id, '100');
    const check = await w.c.pm.ok.get(`${w.P}/procurement/match-check/MR/${m.id}`);
    expect(check.status).toBe('BLOCKED');
    expect(check.approval.allowed).toBe(false);
    expect(check.lines[0].checks[0].note).toMatch(/no BOM yet/);

    const row = await inboxRow(m.id);
    expect(row.match.status).toBe('BLOCKED');
    const r = await w.c.pm.post(`/approvals/${row.id}/approve`, { comment: 'Urgent, approve anyway please' });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/outside the BOM cannot be approved/);
    expect((await prisma.materialRequisition.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('SUBMITTED');

    await w.c.pm.ok.post(`/approvals/${row.id}/reject`, { comment: 'Not in BOM' });
    expect((await prisma.materialRequisition.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('REJECTED');
  });

  it('blocks a material that is not in the BOM once the project has one', async () => {
    await cementBom();
    const m = await mr(steel.id, '2', 'MT');
    const check = await w.c.pm.ok.get(`${w.P}/procurement/match-check/MR/${m.id}`);
    expect(check.status).toBe('BLOCKED');
    expect(check.lines[0].checks[0].note).toMatch(/is not in this project's BOM/);
    await w.c.pm.ok.post(`/approvals/${(await inboxRow(m.id)).id}/reject`, { comment: 'Not in BOM' });
  });

  it('shows "everything matches" and approves without extra steps when the MR is within the BOM', async () => {
    const m = await mr(w.cement.id, '500');
    const check = await w.c.pm.ok.get(`${w.P}/procurement/match-check/MR/${m.id}`);
    expect(check.status).toBe('MATCH');
    expect(check.summary).toMatch(/^Everything matches/);
    const bomQty = check.lines[0].checks.find((c: any) => c.key === 'bomQty');
    expect(bomQty).toMatchObject({ status: 'ok', actual: '500', expected: '1000' });
    expect((await inboxRow(m.id)).match.status).toBe('MATCH');
    await approveAll(w, m.id, ['pm'], '');
    expect((await prisma.materialRequisition.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('APPROVED');
  });

  it('allows up to 5 % above the BOM quantity', async () => {
    const m = await mr(w.cement.id, '540'); // 500 + 540 = 1040 bags: 4 % above 1000
    const check = await w.c.pm.ok.get(`${w.P}/procurement/match-check/MR/${m.id}`);
    expect(check.status).toBe('MATCH');
    await w.c.pm.ok.post(`/approvals/${(await inboxRow(m.id)).id}/reject`, { comment: 'Keep the balance for the next test' });
  });

  it('needs a reason and a supporting document to approve a quantity beyond the BOM', async () => {
    const m = await mr(w.cement.id, '600'); // 500 + 600 = 1100 bags: 10 % above
    const check = await w.c.pm.ok.get(`${w.P}/procurement/match-check/MR/${m.id}`);
    expect(check.status).toBe('DIFF');
    const bomQty = check.lines[0].checks.find((c: any) => c.key === 'bomQty');
    expect(bomQty).toMatchObject({ status: 'diff', actual: '1100', expected: '1000', diffPct: '0.1' });
    expect(check.approval).toMatchObject({ allowed: true, needsReason: true, needsAttachment: true });

    const row = await inboxRow(m.id);
    let r = await w.c.pm.post(`/approvals/${row.id}/approve`, {});
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/a reason \(comment\) and a supporting document/);
    r = await w.c.pm.post(`/approvals/${row.id}/approve`, { comment: 'Extra footing added by the consultant' });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/supporting document attached/);
    expect(r.body.error.message).not.toMatch(/a reason/);

    await attachPdf('materialRequisition', m.id);
    r = await w.c.pm.post(`/approvals/${row.id}/approve`, { comment: 'Extra footing added by the consultant, letter attached' });
    expect(r.status).toBe(200);
    expect((await prisma.materialRequisition.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('APPROVED');
    const ev = await prisma.auditEvent.findFirst({ where: { entityId: m.id, action: 'MATCH_CHECK_OVERRIDE' } });
    expect(ev?.reason).toMatch(/letter attached/);
  });

  it('PR from an MR matches its MR; PO rate is compared with the BOM rate (2 %) and its PR quantity (5 %)', async () => {
    // New BOM line for a fresh material so earlier quantities do not interfere.
    const sand = await w.c.admin.ok.post('/org/r/materials', { code: `SND-${w.tag}`, name: 'M-Sand', category: 'Sand', unit: 'CUM', standardRate: '1500' });
    const item = await prisma.bomItem.findFirstOrThrow({ where: { projectId: w.project.id } });
    await prisma.bomLine.create({ data: { bomItemId: item.id, lineNo: 2, kind: 'MATERIAL', description: 'M-Sand', qty: '100', wastagePct: '0', totalQty: '100', unit: 'CUM', rate: '1500', amount: '150000', materialId: sand.id, rateSource: 'MANUAL' } });

    const m = await mr(sand.id, '40', 'CUM');
    await approveAll(w, m.id, ['pm'], '');
    const pr = await w.c.proc.ok.post(`${w.P}/procurement/pr-from-mr/${m.id}`, { costCodeId: w.cc.material.id });
    await w.c.proc.ok.post(`${w.P}/r/prs/${pr.id}/submit`);
    const prCheck = await w.c.pm.ok.get(`${w.P}/procurement/match-check/PR/${pr.id}`);
    expect(prCheck.status).toBe('MATCH');
    expect(prCheck.lines[0].checks.map((c: any) => c.key)).toEqual(['bom', 'bomQty', 'bomRate', 'sourceQty']);
    expect(prCheck.lines[0].checks.find((c: any) => c.key === 'bomQty').actual).toBe('40'); // its own MR is not counted twice
    expect(prCheck.documentChecks[0]).toMatchObject({ key: 'budget', status: 'ok' });
    await approveAll(w, pr.id, ['pm'], '');

    const po = await w.c.proc.ok.post(`${w.P}/procurement/po-from-pr/${pr.id}`, { supplierId: w.supplier.id });
    const full = await w.c.proc.ok.get(`${w.P}/r/purchaseOrders/${po.id}`);
    const setLine = (qty: string, rate: string) => w.c.proc.ok.patch(`${w.P}/r/purchaseOrders/${po.id}`, { orderDate: day(0), lines: full.lines.map((l: any) => ({ materialId: l.materialId, description: l.description, qty, unit: l.unit, rate, discountPct: '0', taxRate: '0.18', costCodeId: l.costCodeId, prLineId: l.prLineId })) });
    const check = () => w.c.proc.ok.get(`${w.P}/procurement/match-check/PO/${po.id}`);

    await setLine('40', '1525'); // 1.7 % above the BOM rate
    expect((await check()).status).toBe('MATCH');
    await setLine('40', '1400'); // cheaper: never a difference
    let c = await check();
    expect(c.status).toBe('MATCH');
    expect(c.lines[0].checks.find((x: any) => x.key === 'bomRate').note).toMatch(/Below the BOM rate/);
    await setLine('40', '1560'); // 4 % above
    c = await check();
    expect(c.status).toBe('DIFF');
    expect(c.lines[0].checks.find((x: any) => x.key === 'bomRate')).toMatchObject({ status: 'diff', expected: '1500' });
    await setLine('44', '1500'); // 10 % above the PR quantity
    c = await check();
    expect(c.lines[0].checks.find((x: any) => x.key === 'sourceQty')).toMatchObject({ status: 'diff', actual: '44', expected: '40' });

    await setLine('40', '1500');
    await w.c.proc.ok.post(`${w.P}/r/purchaseOrders/${po.id}/submit`);
    expect((await inboxRow(po.id)).match.status).toBe('MATCH');
    await approveAll(w, po.id, ['pm'], '');
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe('APPROVED');
  });

  it('compares a PO with the awarded quotation', async () => {
    const m = await mr(w.cement.id, '10', 'BAG'); // cement BOM is already over; use WARN to get it through MR and PR
    await setMode('WARN');
    await approveAll(w, m.id, ['pm'], '');
    const pr = await w.c.proc.ok.post(`${w.P}/procurement/pr-from-mr/${m.id}`, { costCodeId: w.cc.material.id });
    await w.c.proc.ok.post(`${w.P}/r/prs/${pr.id}/submit`);
    await approveAll(w, pr.id, ['pm'], '');
    const rfq = await w.c.proc.ok.post(`${w.P}/procurement/rfqs`, { prId: pr.id, title: 'Cement', dueDate: day(3), supplierIds: [w.supplier.id] });
    const prFull = await w.c.proc.ok.get(`${w.P}/r/prs/${pr.id}`);
    const qt = await w.c.proc.ok.post(`${w.P}/procurement/rfqs/${rfq.id}/quotations`, { supplierId: w.supplier.id, quotedAt: day(0), taxRate: '0.18', lines: prFull.lines.map((l: any) => ({ prLineId: l.id, rate: '390' })) });
    const po = await w.c.proc.ok.post(`${w.P}/procurement/rfqs/${rfq.id}/award`, { quotationId: qt.id, justification: 'Only supplier' });
    const full = await w.c.proc.ok.get(`${w.P}/r/purchaseOrders/${po.id}`);
    await w.c.proc.ok.patch(`${w.P}/r/purchaseOrders/${po.id}`, { orderDate: day(0), lines: full.lines.map((l: any) => ({ materialId: l.materialId, description: l.description, qty: l.qty, unit: l.unit, rate: '399', discountPct: '0', taxRate: '0.18', costCodeId: l.costCodeId, prLineId: l.prLineId })) });
    const c = await w.c.proc.ok.get(`${w.P}/procurement/match-check/PO/${po.id}`);
    expect(c.mode).toBe('WARN');
    expect(c.lines[0].checks.find((x: any) => x.key === 'quoteRate')).toMatchObject({ status: 'diff', actual: '399', expected: '390' });
    expect(c.approval.allowed).toBe(true);
    await setMode('ENFORCE');
  });

  it('in WARN mode shows the check but never blocks', async () => {
    await setMode('WARN');
    const m = await mr(steel.id, '1', 'MT');
    const row = await inboxRow(m.id);
    expect(row.match).toMatchObject({ status: 'BLOCKED', mode: 'WARN' });
    await w.c.pm.ok.post(`/approvals/${row.id}/approve`, {});
    expect((await prisma.materialRequisition.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('APPROVED');
    await setMode('ENFORCE');
  });

  it('only answers for this project and these document types', async () => {
    const m = await mr(w.cement.id, '1');
    expect((await w.c.pm.get(`${w.P}/procurement/match-check/GRN/${m.id}`)).status).toBe(422);
    expect((await w.c.pm.get(`${w.P}/procurement/match-check/PO/${m.id}`)).status).toBe(404);
    expect((await w.c.outsider.get(`${w.P}/procurement/match-check/MR/${m.id}`)).status).toBe(404); // non-members do not learn the project exists
  });
});
