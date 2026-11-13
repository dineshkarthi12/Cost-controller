/**
 * Supplier rating (0–100, grade A–D) from what the project already records.
 *
 *  delivery  35 %  share of goods receipts on or before the PO delivery date
 *  quality   35 %  accepted / received quantity on goods receipts; where material inspections exist,
 *                  70 % of it is that share and 30 % the share of inspections not rejected
 *  invoices  15 %  share of supplier invoices that passed the three-way match
 *  price     15 %  the supplier's PO rates against the average rate of all suppliers for the same
 *                  materials: at or below average = 100, every 1 % above costs 2 points
 *
 * A part without data is left out and the others share its weight. With fewer than 2 goods receipts
 * and fewer than 2 invoices the supplier is "not enough data" (no grade).
 */
export const SUPPLIER_RATING_WEIGHTS = { delivery: 35, quality: 35, invoices: 15, price: 15 } as const;
export type RatingPart = keyof typeof SUPPLIER_RATING_WEIGHTS;

export interface SupplierFacts {
  /** Goods receipts with a PO delivery date, and how many arrived on time. */
  deliveries: { total: number; onTime: number };
  /** Goods receipt quantities, in any units (only the ratio is used). */
  receipts: { count: number; received: number; accepted: number };
  inspections: { total: number; rejected: number };
  invoices: { total: number; exceptions: number };
  /** Supplier's PO rate ÷ average rate of all suppliers, one entry per material, weighted by order value. */
  priceIndex: Array<{ index: number; weight: number }>;
}

export interface SupplierRating {
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | null;
  parts: Record<RatingPart, number | null>;
  /** Average price index (1 = average, 1.05 = 5 % above). */
  priceIndex: number | null;
  enoughData: boolean;
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
const r1 = (v: number) => Math.round(v * 10) / 10;

export function rateSupplier(f: SupplierFacts): SupplierRating {
  const delivery = pct(f.deliveries.onTime, f.deliveries.total);
  const accepted = pct(f.receipts.accepted, f.receipts.received);
  const passed = pct(f.inspections.total - f.inspections.rejected, f.inspections.total);
  const quality = accepted === null ? passed : passed === null ? accepted : 0.7 * accepted + 0.3 * passed;
  const invoices = pct(f.invoices.total - f.invoices.exceptions, f.invoices.total);
  const w = f.priceIndex.reduce((a, p) => a + p.weight, 0);
  const priceIndex = w > 0 ? f.priceIndex.reduce((a, p) => a + p.index * p.weight, 0) / w : null;
  const price = priceIndex === null ? null : Math.max(0, Math.min(100, 100 - Math.max(0, priceIndex - 1) * 200));
  const parts: Record<RatingPart, number | null> = { delivery, quality, invoices, price };
  const enoughData = f.receipts.count >= 2 || f.invoices.total >= 2;
  let sum = 0;
  let weight = 0;
  for (const k of Object.keys(SUPPLIER_RATING_WEIGHTS) as RatingPart[]) {
    if (parts[k] === null) continue;
    sum += parts[k]! * SUPPLIER_RATING_WEIGHTS[k];
    weight += SUPPLIER_RATING_WEIGHTS[k];
  }
  const score = enoughData && weight ? r1(sum / weight) : null;
  const grade = score === null ? null : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  return {
    score,
    grade,
    parts: { delivery: delivery === null ? null : r1(delivery), quality: quality === null ? null : r1(quality), invoices: invoices === null ? null : r1(invoices), price: price === null ? null : r1(price) },
    priceIndex: priceIndex === null ? null : Math.round(priceIndex * 1000) / 1000,
    enoughData,
  };
}
