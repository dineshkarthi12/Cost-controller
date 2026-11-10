/* eslint-disable @typescript-eslint/no-explicit-any */
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
