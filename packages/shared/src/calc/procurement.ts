import { D, type DecInput, money, round2, sum, qty } from '../money.js';

export interface PricedLineInput {
  quantity: DecInput;
  rate: DecInput;
  discountPct?: DecInput; // fraction
  taxRate?: DecInput; // fraction
}

export interface PricedLine {
  gross: string;
  discount: string;
  amount: string; // net of discount, excl. tax
  taxAmount: string;
  total: string;
}

export function priceLine(l: PricedLineInput): PricedLine {
  const gross = round2(D(l.quantity).times(D(l.rate)));
  const discount = round2(gross.times(D(l.discountPct)));
  const amount = gross.minus(discount);
  const tax = round2(amount.times(D(l.taxRate)));
  return { gross: money(gross), discount: money(discount), amount: money(amount), taxAmount: money(tax), total: money(amount.plus(tax)) };
}

export function priceDocument(lines: PricedLineInput[]) {
  const priced = lines.map(priceLine);
  return {
    lines: priced,
    subtotal: money(sum(priced.map((p) => p.gross))),
    discount: money(sum(priced.map((p) => p.discount))),
    netAmount: money(sum(priced.map((p) => p.amount))),
    taxAmount: money(sum(priced.map((p) => p.taxAmount))),
    total: money(sum(priced.map((p) => p.total))),
  };
}

export interface MatchLineInput {
  lineRef: string;
  invoicedQty: DecInput;
  invoicedRate: DecInput;
  poRate: DecInput;
  orderedQty: DecInput;
  acceptedQty: DecInput; // cumulative accepted on GRNs
  previouslyInvoicedQty: DecInput;
}

export interface MatchLineResult {
  lineRef: string;
  ok: boolean;
  invoiceableQty: string;
  qtyVariance: string;
  rateVariancePct: string | null;
  issues: string[];
}

/**
 * Three-way match (PO ↔ GRN ↔ invoice) per BUSINESS_RULES.md §6.
 * Invoiced qty must not exceed accepted − previously invoiced; rate within tolerance.
 */
export function threeWayMatch(lines: MatchLineInput[], priceTolerancePct: DecInput = '0.02') {
  const results: MatchLineResult[] = lines.map((l) => {
    const issues: string[] = [];
    const invoiceable = D(l.acceptedQty).minus(D(l.previouslyInvoicedQty));
    const qv = D(l.invoicedQty).minus(invoiceable);
    if (qv.gt(0)) issues.push(`Invoiced qty exceeds received-and-accepted qty by ${qty(qv)}`);
    if (D(l.invoicedQty).plus(D(l.previouslyInvoicedQty)).gt(D(l.orderedQty))) issues.push('Cumulative invoiced qty exceeds ordered qty');
    let rvp: string | null = null;
    if (!D(l.poRate).isZero()) {
      const r = D(l.invoicedRate).minus(D(l.poRate)).div(D(l.poRate));
      rvp = r.toFixed(4);
      if (r.abs().gt(D(priceTolerancePct))) issues.push(`Rate differs from PO by ${r.times(100).toFixed(2)}% (tolerance ${D(priceTolerancePct).times(100).toFixed(2)}%)`);
    }
    return { lineRef: l.lineRef, ok: issues.length === 0, invoiceableQty: qty(invoiceable), qtyVariance: qty(qv), rateVariancePct: rvp, issues };
  });
  return { matched: results.every((r) => r.ok), lines: results };
}

/** GRN validation: accepted + rejected = received and over-receipt tolerance. */
export function validateGrnLine(input: {
  orderedQty: DecInput;
  previouslyAcceptedQty: DecInput;
  receivedQty: DecInput;
  acceptedQty: DecInput;
  rejectedQty: DecInput;
  tolerancePct?: DecInput;
}): string[] {
  const errs: string[] = [];
  const rec = D(input.receivedQty);
  if (rec.lte(0)) errs.push('Received qty must be greater than zero');
  if (D(input.acceptedQty).isNeg() || D(input.rejectedQty).isNeg()) errs.push('Quantities cannot be negative');
  if (!D(input.acceptedQty).plus(D(input.rejectedQty)).eq(rec)) errs.push('Accepted + rejected must equal received');
  const limit = D(input.orderedQty).times(D(1).plus(D(input.tolerancePct)));
  if (D(input.previouslyAcceptedQty).plus(D(input.acceptedQty)).gt(limit)) errs.push('Cumulative accepted qty exceeds ordered qty (beyond tolerance)');
  return errs;
}
