import { describe, expect, it } from 'vitest';
import { rateSupplier, type SupplierFacts } from '../src/index.js';

const base: SupplierFacts = { deliveries: { total: 4, onTime: 3 }, receipts: { count: 4, received: 1000, accepted: 980 }, inspections: { total: 2, rejected: 0 }, invoices: { total: 4, exceptions: 1 }, priceIndex: [{ index: 1.05, weight: 1 }] };

describe('supplier rating', () => {
  it('weights delivery, quality, invoices and price', () => {
    const r = rateSupplier(base);
    // delivery 75, quality 0.7×98 + 0.3×100 = 98.6, invoices 75, price 100 − 5×2 = 90
    expect(r.parts).toEqual({ delivery: 75, quality: 98.6, invoices: 75, price: 90 });
    expect(r.score).toBe(Math.round(((75 * 35 + 98.6 * 35 + 75 * 15 + 90 * 15) / 100) * 10) / 10); // 85.0
    expect(r.grade).toBe('A');
    expect(r.priceIndex).toBe(1.05);
  });

  it('spreads the weight of a part without data over the others', () => {
    const r = rateSupplier({ ...base, invoices: { total: 0, exceptions: 0 }, priceIndex: [] });
    expect(r.parts.invoices).toBeNull();
    expect(r.score).toBe(86.8); // (75 + 98.6) / 2
  });

  it('cheaper than average is 100 on price; late and rejected deliveries pull the grade down', () => {
    const r = rateSupplier({ deliveries: { total: 4, onTime: 1 }, receipts: { count: 4, received: 100, accepted: 70 }, inspections: { total: 2, rejected: 1 }, invoices: { total: 2, exceptions: 1 }, priceIndex: [{ index: 0.9, weight: 1 }] });
    expect(r.parts.price).toBe(100);
    expect(r.grade).toBe('D');
  });

  it('gives no grade with too little history', () => {
    const r = rateSupplier({ deliveries: { total: 1, onTime: 1 }, receipts: { count: 1, received: 10, accepted: 10 }, inspections: { total: 0, rejected: 0 }, invoices: { total: 1, exceptions: 0 }, priceIndex: [] });
    expect(r).toMatchObject({ enoughData: false, score: null, grade: null });
  });
});
