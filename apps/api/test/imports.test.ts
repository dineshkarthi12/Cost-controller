/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, PASSWORD, prisma, setupWorld, type World } from './helpers.js';

let w: World;
let agent: ReturnType<typeof request.agent>;
beforeAll(async () => {
  w = await setupWorld();
  agent = request.agent(app);
  await agent.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.cc.email, password: PASSWORD });
});

const csv = ['Item code,Description,Unit,Qty,Rate,Cost code', 'C-1,Excavation,CUM,100,450,SUB-01', 'C-2,PCC,CUM,abc,6200,SUB-01', 'C-1,Duplicate row,CUM,1,1,SUB-01', 'C-3,Unknown code,CUM,10,10,NOPE-9', 'C-4,=HYPERLINK("http://x"),CUM,5,100,'].join('\n');

describe('BOQ import', () => {
  let preview: any;
  it('previews and validates every row without writing anything', async () => {
    const r = await agent.post('/api/imports/preview').set('X-Requested-With', 'toprock').field('kind', 'BOQ').field('projectId', w.project.id).attach('file', Buffer.from(csv), { filename: 'boq.csv', contentType: 'text/csv' });
    expect(r.status).toBe(201);
    preview = r.body;
    expect(preview.summary).toMatchObject({ total: 5, valid: 2, invalid: 3 });
    const errs = Object.fromEntries(preview.rows.map((x: any) => [x.row, x.errors.join('; ')]));
    expect(errs[3]).toMatch(/must be a number/);
    expect(errs[4]).toMatch(/Duplicate/);
    expect(errs[5]).toMatch(/Unknown cost code/);
    expect(await prisma.boqItem.count({ where: { projectId: w.project.id } })).toBe(0);
  });

  it('refuses to commit with errors unless the user confirms skipping them', async () => {
    const r = await agent.post(`/api/imports/${preview.id}/commit`).set('X-Requested-With', 'toprock').send({});
    expect(r.status).toBe(422);
    const ok = await agent.post(`/api/imports/${preview.id}/commit`).set('X-Requested-With', 'toprock').send({ skipInvalid: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ imported: 2, skipped: 3 });
    expect(await prisma.boqItem.count({ where: { projectId: w.project.id } })).toBe(2);
  });

  it('cannot be committed twice', async () => {
    const r = await agent.post(`/api/imports/${preview.id}/commit`).set('X-Requested-With', 'toprock').send({ skipInvalid: true });
    expect(r.status).toBe(409);
  });

  it('error reports neutralise spreadsheet formulas', async () => {
    const r = await agent.get(`/api/imports/${preview.id}/errors.csv`).set('X-Requested-With', 'toprock');
    expect(r.status).toBe(200);
    expect(r.text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('requires import permission', async () => {
    const se = request.agent(app);
    await se.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.se.email, password: PASSWORD });
    const r = await se.post('/api/imports/preview').set('X-Requested-With', 'toprock').field('kind', 'BOQ').field('projectId', w.project.id).attach('file', Buffer.from(csv), { filename: 'boq.csv', contentType: 'text/csv' });
    expect(r.status).toBe(403);
  });
});

describe('BOQ import from an estimator-style workbook', () => {
  /** Same structure as TOPROCK's LOF Mega Mall BOQ: Summary sheet first, header on row 2, sections, item headings, a/b lines, section totals. */
  async function estimatorBoq() {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Summary').getCell('A1').value = 'PROJECT: TEST MALL';
    const ws = wb.addWorksheet('BOQ');
    ws.getCell('A1').value = 'PROJECT: TEST MALL';
    ws.getRow(2).values = ['SL, NO', 'DESCRIPTION OF WORKS', 'QTY', 'UNIT', 'RATE (INR)', 'TOTAL (INR)'];
    const rows: unknown[][] = [
      [1, 'PRELIMINARIES'],
      [{ formula: 'A3+0.01', result: 1.01 }, 'Site Mobilisation & Protection:- \nAllow cost for site mobilisation'],
      ['a', 'Whole unit', 1, 'Item', 90000, { formula: 'C5*E5', result: 90000 }],
      [null, 'TOTAL AMOUNT (PRELIMINARIES)', null, null, null, { formula: 'SUM(F4:F5)', result: 90000 }],
      [2, 'FLOORING WORKS'],
      [{ formula: 'A7+0.01', result: 2.01 }, 'Floor Finish - Vinyl Tile (FL-01):- \nSupply and install vinyl tile'],
      ['a', 'Location: Space Station', 746.2, 'Sqft', 165, { formula: 'C9*E9', result: 123123 }, '69.32 sqm'],
      ['b', 'Location: AI Lab', 356.9, 'Sqft', 165, { formula: 'C10*E10', result: 58888.5 }, '33.16 sqm'],
      [{ formula: 'A8+0.01', result: 2.0199999999999996 }, 'Metal Skirting:- \nSupply and install'],
      ['a', 'Location: All rooms', 546.2, 'Rft', 350, { formula: 'C12*E12', result: 191170 }],
      [null, 'TOTAL AMOUNT (FLOORING WORKS)', null, null, null, { formula: 'SUM(F8:F12)', result: 373181.5 }],
    ];
    rows.forEach((v, i) => (ws.getRow(3 + i).values = v as ExcelJS.CellValue[]));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('flattens sections, headings and a/b lines, keeps notes, and checks the file total', async () => {
    const p2 = await w.c.admin.ok.post('/projects', { code: 'BOQX', name: 'BOQ test', template: 'NONE', clientId: w.client.id, contractValue: '1', contractType: 'ITEM_RATE', currency: 'INR', taxRate: '0.18', retentionPct: '0.05', startDate: '2026-10-01', plannedCompletionDate: '2027-10-01', status: 'ACTIVE' });
    const adm = request.agent(app);
    await adm.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.admin.email, password: PASSWORD });
    const r = await adm.post('/api/imports/preview').set('X-Requested-With', 'toprock').field('kind', 'BOQ').field('projectId', p2.id).attach('file', await estimatorBoq(), { filename: 'LOF-BOQ.xlsx' });
    expect(r.status).toBe(201);
    expect(r.body.summary).toMatchObject({ total: 4, valid: 4, invalid: 0, fileTotal: 463181.5, importedTotal: 463181.5 });
    expect(r.body.summary.notes[0]).toMatch(/2 sections, 4 priced items/);
    expect(r.body.summary.notes[1]).toMatch(/matches the section totals/);
    expect(r.body.rows.map((x: any) => x.values.itemCode)).toEqual(['1.01.a', '2.01.a', '2.01.b', '2.02.a']);
    const vinyl = r.body.rows[1].values;
    expect(vinyl).toMatchObject({ description: 'Floor Finish - Vinyl Tile (FL-01) – Location: Space Station', unit: 'Sqft', contractQty: '746.2', unitRate: '165', section: 'FLOORING WORKS', remarks: '69.32 sqm' });
    expect(vinyl.specification).toMatch(/Supply and install vinyl tile/);
    const c = await adm.post(`/api/imports/${r.body.id}/commit`).set('X-Requested-With', 'toprock').send({});
    expect(c.body).toEqual({ imported: 4, skipped: 0 });
    const item = await prisma.boqItem.findFirstOrThrow({ where: { projectId: p2.id, itemCode: '2.01.a' } });
    expect(item.specification).toMatch(/vinyl tile/);
    expect(item.remarks).toBe('69.32 sqm');
  });
});
