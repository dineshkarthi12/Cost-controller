/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, approvedPo, PASSWORD, prisma, setupWorld, type World } from './helpers.js';

let w: World;
let qs: ReturnType<typeof request.agent>;
let steel: any;
let sand: any;
beforeAll(async () => {
  w = await setupWorld();
  qs = request.agent(app);
  await qs.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.qs.email, password: PASSWORD });
  steel = await w.c.admin.ok.post('/org/r/materials', { code: `STL12-${w.tag}`, name: 'TMT Bar Fe500D 12 mm', category: 'Steel', unit: 'MT', standardRate: '62000' });
  sand = await w.c.admin.ok.post('/org/r/materials', { code: `MSAND-${w.tag}`, name: 'M-Sand (for concrete)', category: 'Aggregates & Sand', unit: 'CUM' });
});

/** Estimator BOM: one item with cement (bags), steel in Kg (master is per MT), sand (no rate yet), an unknown item, and labour. */
async function workbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Civil-BOM');
  const header = ['S.No', 'Description', 'Qty', '% wstg', 'T. Qty', 'Unit', 'Cost (INR)', 'Amount (INR)', 'Remarks'];
  const rows: unknown[][] = [
    ['CIVIL BOM'],
    [],
    [1, 'SUBSTRUCTURE'],
    [1.01, 'RCC footing'],
    [null, 'BOQ Qty : 10 cum', null, null, null, null, 'Taking Qty :', 10, 'Cum'],
    header,
    ['A', 'Material'],
    [1, 'Cement', 80, 0, 80, 'Bag', null, null, null],
    [2, 'TMT steel 12mm', 1000, 0, 1000, 'Kg', null, null, null],
    [3, 'M-Sand for concrete', 5, 0, 5, 'Cum', null, null, null],
    [4, 'Cover blocks special', 100, 0, 100, 'Nos', 6, null, null],
    ['B', 'Man Power'],
    [1, 'Mason', 4, 0, 4, 'Day'],
    ['Total amount'],
  ];
  rows.forEach((v, i) => (ws.getRow(i + 1).values = v as ExcelJS.CellValue[]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const lineOf = (bom: any, desc: string) => bom.items.flatMap((i: any) => i.lines).find((l: any) => l.description === desc);

describe('material purchase rates from approved POs', () => {
  it('sets last and average purchase rates and moves the standard rate (setting on by default)', async () => {
    const before = await prisma.material.findUniqueOrThrow({ where: { id: w.cement.id } });
    expect(before.standardRate?.toString()).toBe('400');
    expect(before.lastPurchaseRate).toBeNull();

    await approvedPo(w, { qty: '100', rate: '420' });
    let m = await prisma.material.findUniqueOrThrow({ where: { id: w.cement.id } });
    expect(m.lastPurchaseRate?.toString()).toBe('420');
    expect(m.avgPurchaseRate?.toString()).toBe('420');
    expect(m.standardRate?.toString()).toBe('420');
    expect(m.lastPurchaseRef).toMatch(/PO-/);

    await approvedPo(w, { qty: '300', rate: '440' });
    m = await prisma.material.findUniqueOrThrow({ where: { id: w.cement.id } });
    expect(m.lastPurchaseRate?.toString()).toBe('440');
    expect(m.avgPurchaseRate?.toString()).toBe('435'); // (100×420 + 300×440) / 400
    expect(m.standardRate?.toString()).toBe('440');
  });

  it('keeps the standard rate when the setting is off', async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: w.org.id } });
    await prisma.organisation.update({ where: { id: w.org.id }, data: { settings: { ...(org.settings as object), updateStandardRateFromPo: false } } });
    await approvedPo(w, { qty: '100', rate: '460' });
    const m = await prisma.material.findUniqueOrThrow({ where: { id: w.cement.id } });
    expect(m.lastPurchaseRate?.toString()).toBe('460');
    expect(m.standardRate?.toString()).toBe('440');
    await prisma.organisation.update({ where: { id: w.org.id }, data: { settings: org.settings as object } });
  });
});

describe('BOM linked to the material list', () => {
  it('import links material lines by name and prices empty rates from the material, converting units', async () => {
    const p = await qs.post(`/api${w.P}/bom/import/preview`).set('X-Requested-With', 'toprock').attach('file', await workbook(), { filename: 'BOM.xlsx' });
    expect(p.status).toBe(201);
    expect(p.body.summary.materialMatched).toBe(3);
    const c = await qs.post(`/api${w.P}/bom/import/${p.body.id}/commit`).set('X-Requested-With', 'toprock').send({});
    expect(c.body).toMatchObject({ items: 1, linked: 3, pricedFromMaterial: 2 });
    const bom = await w.c.qs.ok.get(`${w.P}/bom`);
    const cement = await prisma.material.findUniqueOrThrow({ where: { id: w.cement.id } });
    expect(lineOf(bom, 'Cement')).toMatchObject({ materialId: w.cement.id, rate: cement.standardRate!.toString(), rateSource: 'MATERIAL' });
    expect(lineOf(bom, 'TMT steel 12mm')).toMatchObject({ materialId: steel.id, rate: '62', amount: '62000', rateSource: 'MATERIAL' }); // ₹62,000 / MT = ₹62 / Kg
    expect(lineOf(bom, 'M-Sand for concrete')).toMatchObject({ materialId: sand.id, rate: null });
    expect(lineOf(bom, 'Cover blocks special')).toMatchObject({ materialId: null, rate: '6', rateSource: 'FILE' });
    expect(lineOf(bom, 'Mason').materialId).toBeNull();
    expect(bom.totals.links).toEqual({ materialLines: 4, linked: 3 });
  });

  it('links a line by hand (taking the rate when empty); a typed rate is kept by refresh unless asked', async () => {
    let bom = await w.c.qs.ok.get(`${w.P}/bom`);
    const cover = lineOf(bom, 'Cover blocks special');
    const coverMat = await w.c.admin.ok.post('/org/r/materials', { code: `CB-${w.tag}`, name: 'Concrete Cover Block', category: 'Formwork', unit: 'NOS', standardRate: '7' });
    const u = await w.c.qs.ok.patch(`${w.P}/bom/lines/${cover.id}`, { materialId: coverMat.id });
    expect(u).toMatchObject({ materialId: coverMat.id, rate: '6', rateSource: 'FILE' }); // existing rate kept
    await w.c.qs.ok.patch(`${w.P}/bom/lines/${lineOf(bom, 'TMT steel 12mm').id}`, { rate: '60' });
    await w.c.admin.ok.patch(`/org/r/materials/${sand.id}`, { standardRate: '1500' });
    await w.c.admin.ok.patch(`/org/r/materials/${steel.id}`, { standardRate: '65000' });

    // Setting the sand rate priced its linked, unpriced line at once; refresh re-prices the cover block (file rate) and keeps the typed steel rate.
    const r = await w.c.qs.ok.post(`${w.P}/bom/refresh-rates`, {});
    expect(r).toMatchObject({ updated: 1, keptManual: 1 });
    bom = await w.c.qs.ok.get(`${w.P}/bom`);
    expect(lineOf(bom, 'M-Sand for concrete')).toMatchObject({ rate: '1500', amount: '7500' });
    expect(lineOf(bom, 'Cover blocks special')).toMatchObject({ rate: '7', rateSource: 'MATERIAL' });
    expect(lineOf(bom, 'TMT steel 12mm')).toMatchObject({ rate: '60', rateSource: 'MANUAL' });

    const all = await w.c.qs.ok.post(`${w.P}/bom/refresh-rates`, { includeManual: true });
    expect(all.updated).toBe(1);
    bom = await w.c.qs.ok.get(`${w.P}/bom`);
    expect(lineOf(bom, 'TMT steel 12mm')).toMatchObject({ rate: '65', amount: '65000', rateSource: 'MATERIAL' });
    expect(await prisma.auditEvent.count({ where: { projectId: w.project.id, summary: { startsWith: 'BOM rates refreshed' } } })).toBe(2);
  });

  it('auto-links lines added to the master later; refuses materials of another organisation; viewers cannot change', async () => {
    let bom = await w.c.qs.ok.get(`${w.P}/bom`);
    await w.c.qs.ok.patch(`${w.P}/bom/lines/${lineOf(bom, 'M-Sand for concrete').id}`, { materialId: null });
    const r = await w.c.qs.ok.post(`${w.P}/bom/link-materials`, {});
    expect(r).toMatchObject({ checked: 1, linked: 1 });
    bom = await w.c.qs.ok.get(`${w.P}/bom`);
    expect(lineOf(bom, 'M-Sand for concrete').materialId).toBe(sand.id);
    const other = await setupWorld();
    expect((await w.c.qs.patch(`${w.P}/bom/lines/${lineOf(bom, 'Cement').id}`, { materialId: other.cement.id })).status).toBe(422);
    expect((await w.c.auditor.post(`${w.P}/bom/refresh-rates`, {})).status).toBe(403);
  });
});

describe('material-wise cost of the project', () => {
  it('adds BOM need (in the material unit), approved orders, rates and projected cost per material', async () => {
    const r = await w.c.qs.ok.get(`${w.P}/bom/material-cost`);
    const row = (id: string) => r.rows.find((x: any) => x.materialId === id);
    // Cement: BOM 80 bags; ordered 100 + 300 + 100 bags at 420 / 440 / 460.
    // Projection covers only the BOM quantity (80 bags at this project's PO rate 440); 420 bags were ordered beyond the BOM.
    expect(row(w.cement.id)).toMatchObject({ unit: 'BAG', requiredQty: '80', orderedQty: '500', orderedValue: '220000.00', toOrderQty: '0', beyondBomQty: '420', projectPoRate: '440', projectedCost: '35200.00', lastPurchaseRate: '460', avgPurchaseRate: '440' });
    // Steel: 1,000 Kg in the BOM is 1 MT; nothing ordered yet, so the projection uses the current rate.
    expect(row(steel.id)).toMatchObject({ unit: 'MT', requiredQty: '1', orderedQty: '0', toOrderQty: '1', bomAmount: '65000.00', bomRate: '65000', projectedCost: '65000.00', variance: '0.00' });
    expect(row(sand.id)).toMatchObject({ requiredQty: '5', bomAmount: '7500.00', projectedCost: '7500.00', usedIn: ['1.01'] });
    expect(r.unlinkedBom).toEqual({ lines: 0, amount: '0.00' });
    expect(r.totals.materials).toBe(r.rows.length);
    expect((await w.c.outsider.get(`${w.P}/bom/material-cost`)).status).toBe(404); // not a project member: the project is not visible
  });
});

describe('material rates in one place; BOMs follow automatically', () => {
  it('lists every material with its rates and where it is used in BOMs', async () => {
    const rows = await w.c.qs.ok.get('/material-rates');
    const cement = rows.find((r: any) => r.id === w.cement.id);
    expect(cement).toMatchObject({ unit: 'BAG', bomLines: 1, bomLinesFollowing: 1, projects: [w.project.code] });
    expect(rows.find((r: any) => r.id === steel.id)).toMatchObject({ bomLines: 1, bomLinesFollowing: 1 });
  });

  it('changing a rate re-prices BOM lines that take the material rate, not typed ones, and audits it', async () => {
    let bom = await w.c.qs.ok.get(`${w.P}/bom`);
    await w.c.qs.ok.patch(`${w.P}/bom/lines/${lineOf(bom, 'TMT steel 12mm').id}`, { rate: '64' });
    const sandUpd = await w.c.admin.ok.put(`/material-rates/${sand.id}`, { standardRate: '1600' });
    expect(sandUpd.repriced).toEqual({ lines: 1, projects: 1 });
    const steelUpd = await w.c.admin.ok.put(`/material-rates/${steel.id}`, { standardRate: '70000' });
    expect(steelUpd.repriced).toEqual({ lines: 0, projects: 0 });
    bom = await w.c.qs.ok.get(`${w.P}/bom`);
    expect(lineOf(bom, 'M-Sand for concrete')).toMatchObject({ rate: '1600', amount: '8000' });
    expect(lineOf(bom, 'TMT steel 12mm')).toMatchObject({ rate: '64', rateSource: 'MANUAL' });
    expect(await prisma.auditEvent.count({ where: { projectId: w.project.id, summary: { startsWith: 'BOM re-priced automatically' } } })).toBeGreaterThanOrEqual(1);
    expect((await w.c.se.put(`/material-rates/${sand.id}`, { standardRate: '1' })).status).toBe(403);
  });

  it('editing the material on the Materials page, or an approved PO, moves the BOM too', async () => {
    await w.c.admin.ok.patch(`/org/r/materials/${sand.id}`, { standardRate: '1700' });
    let bom = await w.c.qs.ok.get(`${w.P}/bom`);
    expect(lineOf(bom, 'M-Sand for concrete').rate).toBe('1700');
    await approvedPo(w, { qty: '10', rate: '480' });
    bom = await w.c.qs.ok.get(`${w.P}/bom`);
    expect(lineOf(bom, 'Cement')).toMatchObject({ rate: '480', rateSource: 'MATERIAL', amount: '38400' });
  });
});
