/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, PASSWORD, prisma, setupWorld, type World } from './helpers.js';

let w: World;
let qs: ReturnType<typeof request.agent>;
let boq: any;
beforeAll(async () => {
  w = await setupWorld();
  qs = request.agent(app);
  await qs.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.qs.email, password: PASSWORD });
  boq = await w.c.qs.ok.post(`${w.P}/r/boqItems`, { itemCode: '2.05', description: 'Spot light points', section: 'Electrical', unit: 'Nos', contractQty: '39', estimatedQty: '39', unitRate: '2500', costCodeId: w.cc.material.id });
});

/** Same structure as TOPROCK's PUKO BOM: summary sheet, package sheets, section → item heading → Taking Qty → header → Material / Man Power lines. */
async function bomWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('BOM-Summary').getRow(4).values = ['S.No', 'Section', 'Sheet', 'BOM Amount (INR)'];
  const ws = wb.addWorksheet('Electrical-BOM');
  const header = ['S.No', 'Description', 'Qty', '% wstg', 'T. Qty', 'Unit', 'Cost (INR)', 'Amount (INR)', 'Remarks'];
  const rows: unknown[][] = [
    ['PUKO - ELECTRICAL BOM'],
    [],
    [10, 'ELECTRICAL & LIGHTING'],
    [10.01, 'Spot light points - seating area'],
    [null, 'BOQ Qty : 39 nos (2.05)', null, null, null, null, 'Taking Qty :', 39, 'Nos'],
    header,
    ['A', 'Material', null, null, null, null, null, '(INR)'],
    [1, 'Spot light (supply)', 39, 0, { formula: 'C8*(1+D8)', result: 39 }, 'Nos', null, null, 'Spec by consultant'],
    [2, 'Phase wire 1C x 2.5 sqmm', 138.1, 0.1, { formula: 'C9*(1+D9)', result: 151.91 }, 'Mtr', null, null, 'Route + 10%'],
    ['B', 'Man Power'],
    [1, 'Electrician', { formula: 'ROUNDUP(39*2.5,0)', result: 98 }, 0, { formula: 'C11*(1+D11)', result: 98 }, 'Hr'],
    ['Total amount', null, null, null, null, null, null, { formula: 'SUM(H8:H11)', result: 0 }],
    [],
    ['10.01b', 'Spot light points - first floor'],
    [null, 'BOQ Qty : 12 nos (9.99)', null, null, null, null, 'Taking Qty :', 12, 'Nos'],
    header,
    ['A', 'Material'],
    [1, 'Spot light (supply)', 12, 0, 12, 'Nos', 1800, null, null],
    [2, 'Phase wire 1C x 2.5 sqmm', 40, 0, 40, 'Mtr'],
    ['Total amount'],
    [],
    ['PACKAGE SUBTOTALS'],
    [null, 'Electrical & Lighting', null, null, null, null, null, 0],
  ];
  rows.forEach((v, i) => (ws.getRow(i + 1).values = v as ExcelJS.CellValue[]));
  wb.addWorksheet('Norms').getRow(3).values = ['S.No', 'Norm', 'Value', 'Unit'];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const preview = async (agent = qs) => agent.post(`/api${w.P}/bom/import/preview`).set('X-Requested-With', 'toprock').attach('file', await bomWorkbook(), { filename: 'BOM.xlsx' });

describe('bill of materials', () => {
  it('previews the estimator workbook without saving: items, lines by type and BOQ references', async () => {
    const r = await preview();
    expect(r.status).toBe(201);
    expect(r.body.summary).toMatchObject({ sheets: ['Electrical-BOM'], items: 2, lines: 5, material: 4, labour: 1, priced: 1, boqRefs: 2, boqMatched: 1, unmatchedRefs: ['9.99'], existingItems: 0 });
    expect(r.body.sample[0]).toMatchObject({ refCode: '10.01', section: '10 ELECTRICAL & LIGHTING', boqRef: '2.05', takingQty: 39, takingUnit: 'Nos' });
    expect(r.body.sample[0].lines[1]).toMatchObject({ description: 'Phase wire 1C x 2.5 sqmm', qty: 138.1, wastagePct: 0.1, totalQty: 151.91, unit: 'Mtr', kind: 'MATERIAL' });
    expect(r.body.sample[1].refCode).toBe('10.01b');
    expect(await prisma.bomItem.count({ where: { projectId: w.project.id } })).toBe(0);
  });

  it('imports, links BOQ items by reference, and adds the same material up across items', async () => {
    const p = await preview();
    const c = await qs.post(`/api${w.P}/bom/import/${p.body.id}/commit`).set('X-Requested-With', 'toprock').send({});
    expect(c.body).toMatchObject({ items: 2, lines: 5, replaced: 0 });
    const bom = await w.c.qs.ok.get(`${w.P}/bom`);
    expect(bom.items[0].boqItem.itemCode).toBe('2.05');
    expect(bom.items[1].boqItem).toBeNull();
    const wire = bom.summary.find((s: any) => s.description.startsWith('Phase wire'));
    expect(wire).toMatchObject({ kind: 'MATERIAL', unit: 'Mtr', totalQty: '191.91', usedIn: ['10.01', '10.01b'] });
    const light = bom.summary.find((s: any) => s.description === 'Spot light (supply)');
    expect(light).toMatchObject({ totalQty: '51', amount: '21600.00', lines: 2 }); // only the 12 priced at 1,800 have an amount
    expect(bom.totals).toMatchObject({ items: 2, lines: 5, priced: 1, amount: '21600.00' });
  });

  it('replaces an existing BOM only when confirmed', async () => {
    const p = await preview();
    expect(p.body.summary.existingItems).toBe(2);
    expect((await qs.post(`/api${w.P}/bom/import/${p.body.id}/commit`).set('X-Requested-With', 'toprock').send({})).status).toBe(409);
    const ok = await qs.post(`/api${w.P}/bom/import/${p.body.id}/commit`).set('X-Requested-With', 'toprock').send({ replace: true });
    expect(ok.body).toMatchObject({ items: 2, replaced: 2 });
    expect(await prisma.bomItem.count({ where: { projectId: w.project.id } })).toBe(2);
  });

  it('a rate entered later gives the amount on the total quantity (with wastage); BOQ links can be set by hand', async () => {
    const bom = await w.c.qs.ok.get(`${w.P}/bom`);
    const wire = bom.items[0].lines.find((l: any) => l.description.startsWith('Phase wire'));
    const u = await w.c.qs.ok.patch(`${w.P}/bom/lines/${wire.id}`, { rate: '42.5' });
    expect(u.amount).toBe('6456.18'); // 151.91 × 42.5
    const u2 = await w.c.qs.ok.patch(`${w.P}/bom/lines/${wire.id}`, { wastagePct: '0.05' });
    expect(Number(u2.totalQty)).toBe(145.005);
    expect(u2.amount).toBe('6162.71');
    const linked = await w.c.qs.ok.patch(`${w.P}/bom/items/${bom.items[1].id}`, { boqItemId: boq.id });
    expect(linked.boqItem.itemCode).toBe('2.05');
  });

  it('exports the BOM and the material summary to Excel', async () => {
    const r = await qs.get(`/api${w.P}/bom/export`).set('X-Requested-With', 'toprock').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body as any);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['BOM', 'Material summary']);
    const sm = wb.getWorksheet('Material summary')!;
    expect(sm.getRow(1).getCell(2).value).toBe('Description');
    expect(sm.rowCount).toBe(4); // header + electrician, light, wire
  });

  it('read-only users can view but not import or change rates', async () => {
    const aud = request.agent(app);
    await aud.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.auditor.email, password: PASSWORD });
    expect((await preview(aud)).status).toBe(403);
    expect((await w.c.auditor.get(`${w.P}/bom`)).status).toBe(200);
    const bom = await w.c.qs.ok.get(`${w.P}/bom`);
    expect((await w.c.auditor.patch(`${w.P}/bom/lines/${bom.items[0].lines[0].id}`, { rate: '1' })).status).toBe(403);
  });
});
