import { beforeAll, describe, expect, it } from 'vitest';
import { day, setupWorld, type World } from './helpers.js';

let w: World;
let other: World;
beforeAll(async () => {
  w = await setupWorld();
  other = await setupWorld();
});

describe('role-based access control (enforced by the API)', () => {
  it('a user without project membership cannot read the project or its data', async () => {
    expect((await w.c.outsider.get(w.P)).status).toBe(404);
    expect((await w.c.outsider.get(`${w.P}/r/costCodes`)).status).toBeGreaterThanOrEqual(403);
    expect((await w.c.outsider.get(`${w.P}/budget`)).status).toBeGreaterThanOrEqual(403);
  });

  it('a site engineer can raise material requisitions but not budgets, PRs or POs', async () => {
    expect((await w.c.se.put(`${w.P}/budget/lines`, { lines: [{ costCodeId: w.cc.other.id, originalAmount: '1' }] })).status).toBe(403);
    expect((await w.c.se.post(`${w.P}/r/purchaseOrders`, { supplierId: w.supplier.id, orderDate: day(0), lines: [{ description: 'x', qty: '1', unit: 'NOS', rate: '1', costCodeId: w.cc.material.id }] })).status).toBe(403);
    expect((await w.c.se.post(`${w.P}/r/prs`, { requiredBy: day(5), lines: [] })).status).toBe(403);
    expect((await w.c.se.post(`${w.P}/r/mrs`, { department: 'Site', requiredBy: day(5), priority: 'LOW', costCodeId: w.cc.material.id, lines: [{ materialId: w.cement.id, qty: '1', unit: 'BAG' }] })).status).toBe(201);
  });

  it('the auditor is read-only', async () => {
    const auditor = w.c.auditor;
    expect((await auditor.get(`${w.P}/r/costCodes`)).status).toBe(200);
    expect((await auditor.post(`${w.P}/r/costCodes`, { code: 'X-1', name: 'x', category: 'OTHER' })).status).toBe(403);
    expect((await auditor.get('/admin/audit')).status).toBe(200);
  });

  it('only administrators can manage users, roles and settings', async () => {
    expect((await w.c.cc.get('/admin/integrations')).status).toBe(403);
    expect((await w.c.cc.post('/admin/users/invite', { name: 'X Y', email: 'x@y.test', roleCodes: [] })).status).toBe(403);
    expect((await w.c.pm.put('/admin/settings', { settings: { taxIsCost: true } })).status).toBe(403);
  });
});

describe('data separation', () => {
  it("cannot read another organisation's project even by id", async () => {
    expect((await w.c.admin.get(other.P)).status).toBe(404);
    expect((await w.c.admin.get(`${other.P}/r/costCodes`)).status).toBeGreaterThanOrEqual(403);
  });

  it("cannot reference another project's cost code in a document", async () => {
    const r = await w.c.se.post(`${w.P}/r/mrs`, { department: 'Site', requiredBy: day(5), priority: 'LOW', costCodeId: other.cc.material.id, lines: [{ materialId: w.cement.id, qty: '1', unit: 'BAG' }] });
    expect(r.status).toBe(422);
  });

  it("cannot reference another organisation's supplier", async () => {
    const r = await w.c.proc.post(`${w.P}/r/purchaseOrders`, { supplierId: other.supplier.id, orderDate: day(0), lines: [{ description: 'x', qty: '1', unit: 'NOS', rate: '1', costCodeId: w.cc.material.id }] });
    expect(r.status).toBe(422);
  });
});
