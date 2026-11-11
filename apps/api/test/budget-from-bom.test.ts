/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, PASSWORD, setupWorld, type World } from './helpers.js';

let w: World;
let ccMat: any;
let ccLab: any;
beforeAll(async () => {
  w = await setupWorld();
  const A = w.c.admin.ok;
  const wbs = await A.post(`${w.P}/r/wbsNodes`, { code: 'STR', name: 'Structure' });
  ccMat = await A.post(`${w.P}/r/costCodes`, { code: 'STR-M', name: 'Structure materials', category: 'MATERIAL', wbsNodeId: wbs.id });
  ccLab = await A.post(`${w.P}/r/costCodes`, { code: 'STR-L', name: 'Structure labour', category: 'LABOUR', wbsNodeId: wbs.id });
  await A.post(`${w.P}/r/boqItems`, { itemCode: '1.01', description: 'RCC footing', unit: 'Cum', contractQty: '10', unitRate: '9000', costCodeId: ccMat.id });
  await A.post(`${w.P}/r/boqItems`, { itemCode: '1.02', description: 'Plinth beam', unit: 'Cum', contractQty: '5', unitRate: '10000', costCodeId: ccMat.id });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Civil-BOM');
  const header = ['S.No', 'Description', 'Qty', '% wstg', 'T. Qty', 'Unit', 'Cost (INR)', 'Amount (INR)', 'Remarks'];
  const rows: unknown[][] = [
    ['CIVIL BOM'], [], [1, 'SUBSTRUCTURE'],
    [1.01, 'RCC footing'], [null, 'BOQ Qty : 10 cum (1.01)', null, null, null, null, 'Taking Qty :', 10, 'Cum'], header,
    ['A', 'Material'], [1, 'Cement', 80, 0, 80, 'Bag', 400], [2, 'Sand', 5, 0, 5, 'Cum'],
    ['B', 'Man Power'], [1, 'Mason', 10, 0, 10, 'Day', 1300], ['Total amount'], [],
    [1.09, 'Site cleaning'], header, ['A', 'Material'], [1, 'Gunny bags', 50, 0, 50, 'Nos', 20], ['Total amount'],
  ];
  rows.forEach((v, i) => (ws.getRow(i + 1).values = v as ExcelJS.CellValue[]));
  const qs = request.agent(app);
  await qs.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.qs.email, password: PASSWORD });
  const p = await qs.post(`/api${w.P}/bom/import/preview`).set('X-Requested-With', 'toprock').attach('file', Buffer.from(await wb.xlsx.writeBuffer()), { filename: 'BOM.xlsx' });
  await qs.post(`/api${w.P}/bom/import/${p.body.id}/commit`).set('X-Requested-With', 'toprock').send({});
});

describe('budget from the BOM', () => {
  it('splits BOM amounts by cost code: material to the BOQ cost code, labour to the labour code of the same WBS', async () => {
    const r = await w.c.cc.ok.get(`${w.P}/budget/from-bom`);
    const row = (id: string) => r.rows.find((x: any) => x.costCodeId === id);
    expect(row(ccMat.id)).toMatchObject({ bomAmount: '32000.00', lines: 2, unpricedLines: 1, byKind: { MATERIAL: '32000.00' } }); // 80 × 400; sand unpriced
    expect(row(ccLab.id)).toMatchObject({ bomAmount: '13000.00', lines: 1, byKind: { LABOUR: '13000.00' } }); // 10 × 1,300
    expect(r.unassigned).toMatchObject({ bomAmount: '1000.00', lines: 1, items: ['1.09'] }); // BOM item without a BOQ link
    expect(r.totals).toMatchObject({ bomAmount: '46000.00', unpricedLines: 1, bomLines: 4, boqValue: '140000.00' });
    expect(r.baselined).toBe(true); // the test project's budget is already baselined
  });

  it('the budget page shows the BOQ value for the expected margin; viewers without budget access are refused', async () => {
    const b = await w.c.cc.ok.get(`${w.P}/budget`);
    expect(b.boqValue).toBe('140000.00');
    expect((await w.c.se.get(`${w.P}/budget/from-bom`)).status).toBe(403);
  });
});
