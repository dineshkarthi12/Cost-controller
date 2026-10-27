import { D, type DecInput, money, round2, min, max, sum, qty } from '../money.js';

export interface BillLineInput {
  previousQty: DecInput;
  currentQty: DecInput;
  rate: DecInput;
}

export interface BillTermsInput {
  contractValue: DecInput;
  retentionPct: DecInput; // fraction, e.g. 0.05
  retentionCapPct?: DecInput | null; // fraction of contract value; null = no cap
  advanceRecoveryPct: DecInput; // fraction
  advanceOutstanding: DecInput; // advance paid − recovered so far
  taxRate: DecInput; // fraction
  previousGross: DecInput; // grossToDate of last certified bill
  previousRetention: DecInput; // cumulative retention already deducted
  approvedVariationsToDate?: DecInput;
  otherDeductions?: DecInput;
}

export interface BillLineResult {
  previousQty: string;
  currentQty: string;
  cumulativeQty: string;
  rate: string;
  previousAmount: string;
  currentAmount: string;
  cumulativeAmount: string;
}

export interface BillResult {
  lines: BillLineResult[];
  grossToDate: string;
  previousGross: string;
  currentWorkValue: string;
  variationValue: string;
  retention: string;
  advanceRecovery: string;
  taxAmount: string;
  otherDeductions: string;
  netPayable: string;
}

/** RA bill calculation per BUSINESS_RULES.md §5 (shared by subcontractor and client bills). */
export function computeBill(lines: BillLineInput[], terms: BillTermsInput): BillResult {
  const lineResults: BillLineResult[] = lines.map((l) => {
    const prev = D(l.previousQty);
    const cur = D(l.currentQty);
    const cum = prev.plus(cur);
    const cumAmt = round2(cum.times(D(l.rate)));
    const prevAmt = round2(prev.times(D(l.rate)));
    return {
      previousQty: qty(prev),
      currentQty: qty(cur),
      cumulativeQty: qty(cum),
      rate: D(l.rate).toFixed(4),
      previousAmount: money(prevAmt),
      currentAmount: money(cumAmt.minus(prevAmt)),
      cumulativeAmount: money(cumAmt),
    };
  });
  const variations = D(terms.approvedVariationsToDate);
  const grossToDate = sum(lineResults.map((l) => l.cumulativeAmount)).plus(variations);
  const previousGross = D(terms.previousGross);
  const current = grossToDate.minus(previousGross);

  let retention = round2(current.times(D(terms.retentionPct)));
  if (terms.retentionCapPct !== null && terms.retentionCapPct !== undefined && terms.retentionCapPct !== '') {
    const cap = round2(D(terms.contractValue).times(D(terms.retentionCapPct)));
    const room = max(cap.minus(D(terms.previousRetention)), 0);
    retention = min(retention, room);
  }
  if (retention.isNeg()) retention = D(0);
  let advanceRecovery = min(round2(current.times(D(terms.advanceRecoveryPct))), max(terms.advanceOutstanding, 0));
  if (advanceRecovery.isNeg()) advanceRecovery = D(0);
  const tax = round2(current.times(D(terms.taxRate)));
  const other = D(terms.otherDeductions);
  const net = current.plus(tax).minus(retention).minus(advanceRecovery).minus(other);
  return {
    lines: lineResults,
    grossToDate: money(grossToDate),
    previousGross: money(previousGross),
    currentWorkValue: money(current),
    variationValue: money(variations),
    retention: money(retention),
    advanceRecovery: money(advanceRecovery),
    taxAmount: money(tax),
    otherDeductions: money(other),
    netPayable: money(net),
  };
}
