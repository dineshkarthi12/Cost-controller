/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { approvedPo, day, prisma, setupWorld, type World } from './helpers.js';

/** Supplier rating across a world's projects: deliveries, quality, invoices, price. */
let w: World;
let second: any;
beforeAll(async () => {
  w = await setupWorld();
  second = await w.c.admin.ok.post('/org/r/parties', { code: `SUP2-${w.tag}`, name: 'Second Supplier', kinds: ['SUPPLIER'], isApproved: true });
  // Supplier 1: two POs at ₹400; supplier 2: one PO at ₹440 for the same material (market average weighted by quantity).
  const po1 = await approvedPo(w, { qty: '100', rate: '400' });
  const po2 = await approvedPo(w, { qty: '100', rate: '400' });
  const po3 = await approvedPo(w, { qty: '100', rate: '440' });
  await prisma.purchaseOrder.update({ where: { id: po3.id }, data: { supplierId: second.id } });
  // Goods receipts written directly: po1 on time, po2 late (with a rejection), po3 on time.
  const grn = async (po: any, supplierId: string, received: string, accepted: string, offset: number) => {
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { deliveryDate: new Date(`${day(-10)}T00:00:00Z`) } });
    return prisma.grn.create({ data: { projectId: w.project.id, number: `GRN-${po.number}`, poId: po.id, supplierId, storeId: w.store.id, receivedDate: new Date(`${day(offset)}T00:00:00Z`), status: 'APPROVED', receivedById: w.users.proc.id, lines: { create: [{ poLineId: po.lines[0].id, receivedQty: received, acceptedQty: accepted, rejectedQty: String(Number(received) - Number(accepted)) }] } } as any });
  };
  await grn(po1, w.supplier.id, '100', '100', -12);
  await grn(po2, w.supplier.id, '100', '90', -5);
  await grn(po3, second.id, '100', '100', -11);
});

describe('supplier ratings', () => {
  it('rates each supplier from receipts and prices', async () => {
    const r = await w.c.proc.ok.get('/supplier-ratings');
    const s1 = r.rows.find((x: any) => x.supplier.id === w.supplier.id);
    expect(s1.counts).toMatchObject({ receipts: 2, deliveries: 2, onTime: 1, pricedMaterials: 1 });
    expect(s1.parts.delivery).toBe(50);
    expect(s1.parts.quality).toBe(95); // 190 accepted of 200
    // market average (400×200 + 440×100) / 300 = 413.33; 400 is below it → 100 on price
    expect(s1.parts.price).toBe(100);
    expect(s1.grade).not.toBeNull();
    const s2 = r.rows.find((x: any) => x.supplier.id === second.id);
    expect(s2.counts.receipts).toBe(1);
    expect(s2).toMatchObject({ enoughData: false, grade: null }); // one receipt is not enough history
    expect(s2.priceIndex).toBeCloseTo(440 / (124000 / 300), 3); // ≈ 6.5 % above average
  });

  it('is limited to what the viewer may see', async () => {
    expect((await w.c.outsider.get('/supplier-ratings')).status).toBe(403);
    const r = await w.c.proc.ok.get(`/supplier-ratings?projectId=${w.project.id}`);
    expect(r.projects).toBe(1);
  });
});
