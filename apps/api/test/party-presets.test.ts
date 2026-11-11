/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { PARTY_PRESETS, SUPPLY_OPTIONS, MATERIAL_CATEGORIES } from '@toprock/shared';
import { app, PASSWORD, prisma, setupWorld, type World } from './helpers.js';

let w: World;
beforeAll(async () => {
  w = await setupWorld();
});

describe('supplier presets and supplies / trade', () => {
  it('brand list: unique codes and names, every supply value is offered in the list', () => {
    expect(new Set(PARTY_PRESETS.map((p) => p.code)).size).toBe(PARTY_PRESETS.length);
    expect(new Set(PARTY_PRESETS.map((p) => p.name.toLowerCase())).size).toBe(PARTY_PRESETS.length);
    expect(PARTY_PRESETS.flatMap((p) => p.supplies).filter((s) => !SUPPLY_OPTIONS.includes(s))).toEqual([]);
    for (const c of MATERIAL_CATEGORIES) expect(SUPPLY_OPTIONS).toContain(c);
    expect(PARTY_PRESETS.length).toBeGreaterThan(150);
  });

  it('stores supplies (preset values and typed ones) and filters the list by them', async () => {
    const A = w.c.admin.ok;
    await A.post('/org/r/parties', { code: `BR-ULT-${w.tag}`, name: 'UltraTech Cement', kinds: ['SUPPLIER'], supplies: ['Cement'] });
    await A.post('/org/r/parties', { code: `DLR-${w.tag}`, name: 'Sri Murugan Traders', kinds: ['SUPPLIER'], supplies: ['Cement', 'Steel', 'Local hardware'] });
    await A.post('/org/r/parties', { code: `SC-${w.tag}`, name: 'Ganesh Shuttering Works', kinds: ['SUBCONTRACTOR'], supplies: ['Shuttering / Formwork'] });
    const steel = await A.get('/org/r/parties?supplies=Steel&pageSize=100');
    expect(steel.items.map((x: any) => x.name)).toEqual(['Sri Murugan Traders']);
    const cement = await A.get('/org/r/parties?supplies=Cement&pageSize=100');
    expect(cement.items.map((x: any) => x.name).sort()).toEqual(['Sri Murugan Traders', 'UltraTech Cement']);
    const none = await A.post('/org/r/parties', { code: `NS-${w.tag}`, name: 'No supplies party', kinds: ['CLIENT'] });
    expect(none.supplies).toEqual([]);
  });

  it('supplier import reads a "Supplies" column', async () => {
    const adm = request.agent(app);
    await adm.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.admin.email, password: PASSWORD });
    const csv = `Code,Name,Roles,Supplies\nIMP-${w.tag},Kumar Enterprises,SUPPLIER,"Cement, Aggregates & Sand"\n`;
    const pre = await adm.post('/api/imports/preview').set('X-Requested-With', 'toprock').field('kind', 'SUPPLIERS').attach('file', Buffer.from(csv), { filename: 's.csv', contentType: 'text/csv' });
    expect(pre.status).toBe(201);
    const c = await adm.post(`/api/imports/${pre.body.id}/commit`).set('X-Requested-With', 'toprock').send({});
    expect(c.status, JSON.stringify([c.body, pre.body.rows])).toBeLessThan(300);
    const p = await prisma.party.findUniqueOrThrow({ where: { orgId_code: { orgId: w.org.id, code: `IMP-${w.tag}` } } });
    expect(p.supplies).toEqual(['Cement', 'Aggregates & Sand']);
  });
});

describe('supplier lists as sites keep them', () => {
  it('finds the header under a title, reads common column names, generates codes, and takes roles from heading rows', async () => {
    const adm = request.agent(app);
    await adm.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.admin.email, password: PASSWORD });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('List');
    ws.addRow(['LOF 4TH FLOOR – SUPPLIERS & CONTRACTORS LIST']);
    ws.addRow([]);
    ws.addRow(['S.No', 'Name of Supplier / Contractor', 'Scope of Work', 'Contact Person', 'Mobile No', 'Email ID', 'GST No', 'Address', 'Credit Days']);
    ws.addRow([null, 'SUPPLIERS']);
    ws.addRow([1, 'Sri Balaji Suppliers', 'Cement, Steel', 'Balaji', 9840012345, 'balaji@gmail.com / accounts@balaji.in', '33ABCDE1234F1Z5', 'Chennai', '30 days']);
    ws.addRow([2, 'Kajaria Ceramics Dealer', 'Tiles', 'Ravi', '98400 11111', '', '', 'Chennai', '']);
    ws.addRow([null, 'SUB-CONTRACTORS']);
    ws.addRow([3, 'Ganesh Interiors', 'Carpentry & Interiors', 'Ganesh', '9840022222', '', '', 'Chennai', 15]);
    ws.addRow([4, 'Arun Electricals', 'Electrical', 'Arun', '9840033333', '', '', '', '']);
    ws.addRow(['', 'Total']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const pre = await adm.post('/api/imports/preview').set('X-Requested-With', 'toprock').field('kind', 'SUPPLIERS').attach('file', buf, { filename: 'LOF-4th-Floor-Suppliers-Contractors-List.xlsx', contentType: 'application/octet-stream' });
    expect(pre.status, JSON.stringify(pre.body)).toBe(201);
    expect(pre.body.summary).toMatchObject({ total: 4, valid: 4, invalid: 0 });
    expect(pre.body.summary.notes.join(' ')).toMatch(/row 3/);
    const by = Object.fromEntries(pre.body.rows.map((r: any) => [r.values.name, r]));
    expect(by['Sri Balaji Suppliers']).toMatchObject({ row: 5, values: { kinds: 'SUPPLIER', phone: '9840012345', email: 'balaji@gmail.com', taxId: '33ABCDE1234F1Z5', paymentTermsDays: '30', supplies: 'Cement, Steel', contactName: 'Balaji' } });
    expect(by['Ganesh Interiors'].values.kinds).toBe('SUBCONTRACTOR');
    expect(by['Sri Balaji Suppliers'].values.code).toMatch(/^SUP-\d{4}$/);
    expect(by['Ganesh Interiors'].values.code).toMatch(/^SUB-\d{4}$/);
    const c = await adm.post(`/api/imports/${pre.body.id}/commit`).set('X-Requested-With', 'toprock').send({});
    expect(c.body).toMatchObject({ imported: 4 });
    const g = await prisma.party.findFirstOrThrow({ where: { orgId: w.org.id, name: 'Ganesh Interiors' } });
    expect({ kinds: g.kinds, supplies: g.supplies, terms: g.paymentTermsDays }).toEqual({ kinds: ['SUBCONTRACTOR'], supplies: ['Carpentry & Interiors'], terms: 15 });
  });

  it('a role column with everyday words works; unknown words are reported', async () => {
    const adm = request.agent(app);
    await adm.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.admin.email, password: PASSWORD });
    const csv = `Vendor Name,Type,Phone\nAlpha Traders,Vendor,1\nBeta Builders,Labour contractor,2\nGamma & Co,Supplier & Contractor,3\nDelta,Friend,4\n`;
    const pre = await adm.post('/api/imports/preview').set('X-Requested-With', 'toprock').field('kind', 'SUPPLIERS').attach('file', Buffer.from(csv), { filename: 'v.csv', contentType: 'text/csv' });
    const kinds = Object.fromEntries(pre.body.rows.map((r: any) => [r.values.name, r.values.kinds]));
    expect(kinds).toMatchObject({ 'Alpha Traders': 'SUPPLIER', 'Beta Builders': 'SUBCONTRACTOR', 'Gamma & Co': 'SUBCONTRACTOR,SUPPLIER' });
    expect(pre.body.rows.find((r: any) => r.values.name === 'Delta').errors.join(' ')).toMatch(/not understood/);
  });
});
