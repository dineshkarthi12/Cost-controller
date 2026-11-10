/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS } from '@toprock/shared';
import { prisma, setupWorld, type World } from './helpers.js';
import { DEFAULT_UOMS } from '../src/services/bootstrap.js';

let w: World;
beforeAll(async () => {
  w = await setupWorld();
});

describe('material preset list', () => {
  it('only uses units every organisation starts with, and codes are unique', () => {
    const units = new Set(DEFAULT_UOMS.map(([c]) => c));
    expect(MATERIAL_PRESETS.filter((m) => !units.has(m.unit))).toEqual([]);
    expect(new Set(MATERIAL_PRESETS.map((m) => m.code)).size).toBe(MATERIAL_PRESETS.length);
    expect(new Set(MATERIAL_PRESETS.map((m) => m.name.toLowerCase())).size).toBe(MATERIAL_PRESETS.length);
  });

  it('lists presets and marks the ones already added by name', async () => {
    await w.c.admin.ok.post('/org/r/materials', { code: `MY-${w.tag}`, name: 'cement opc 53 grade', category: 'Cement', unit: 'BAG' });
    const rows = await w.c.se.ok.get('/material-presets');
    expect(rows).toHaveLength(MATERIAL_PRESETS.length);
    expect(rows.find((r: any) => r.code === 'CEM-OPC53').exists).toBe(true);
    expect(rows.find((r: any) => r.code === 'STL-TMT12').exists).toBe(false);
  });

  it('adds the chosen presets with an optional rate, skips ones already there, and audits', async () => {
    const r = await w.c.admin.ok.post('/material-presets', { items: [{ code: 'STL-TMT12', standardRate: '62000' }, { code: 'AGG-MSAND' }, { code: 'CEM-OPC53' }] });
    expect(r.created).toEqual(['STL-TMT12', 'AGG-MSAND']);
    expect(r.skipped).toEqual([{ code: 'CEM-OPC53', reason: 'Already in the material list' }]);
    const steel = await prisma.material.findUniqueOrThrow({ where: { orgId_code: { orgId: w.org.id, code: 'STL-TMT12' } } });
    expect({ name: steel.name, category: steel.category, unit: steel.unit, rate: steel.standardRate?.toString() }).toEqual({ name: 'TMT Bar Fe500D 12 mm', category: 'Steel', unit: 'MT', rate: '62000' });
    const sand = await prisma.material.findUniqueOrThrow({ where: { orgId_code: { orgId: w.org.id, code: 'AGG-MSAND' } } });
    expect(sand.standardRate).toBeNull();
    expect(await prisma.auditEvent.count({ where: { orgId: w.org.id, entityType: 'material', summary: { contains: 'preset list' } } })).toBe(1);

    const again = await w.c.admin.ok.post('/material-presets', { items: [{ code: 'STL-TMT12' }] });
    expect(again.created).toEqual([]);
  });

  it('adds the whole list at once ("Select all"), skipping only the ones already there', async () => {
    const before = await prisma.material.count({ where: { orgId: w.org.id } });
    const r = await w.c.admin.ok.post('/material-presets', { items: MATERIAL_PRESETS.map((m) => ({ code: m.code })) });
    expect(r.created.length + r.skipped.length).toBe(MATERIAL_PRESETS.length);
    expect(r.skipped.map((s: any) => s.code).sort()).toEqual(['AGG-MSAND', 'CEM-OPC53', 'STL-TMT12']);
    expect(await prisma.material.count({ where: { orgId: w.org.id } })).toBe(before + r.created.length);
    const rows = await w.c.admin.ok.get('/material-presets');
    expect(rows.every((x: any) => x.exists)).toBe(true);
  });

  it('refuses codes that are not presets, bad rates, and users without material.manage', async () => {
    expect((await w.c.admin.post('/material-presets', { items: [{ code: 'NOT-A-PRESET' }] })).status).toBe(422);
    expect((await w.c.admin.post('/material-presets', { items: [{ code: 'AGG-20MM', standardRate: 'abc' }] })).status).toBe(422);
    expect((await w.c.admin.post('/material-presets', { items: [] })).status).toBe(422);
    expect((await w.c.se.post('/material-presets', { items: [{ code: 'AGG-20MM' }] })).status).toBe(403);
  });
});
