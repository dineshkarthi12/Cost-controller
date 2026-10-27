import { D, type DecInput, round4, money } from '../money.js';

/** Weighted average cost after a receipt. */
export function weightedAverageAfterReceipt(balanceQty: DecInput, balanceValue: DecInput, receiptQty: DecInput, receiptUnitCost: DecInput) {
  const q = D(balanceQty).plus(D(receiptQty));
  const v = D(balanceValue).plus(D(receiptQty).times(D(receiptUnitCost)));
  return { qty: q.toString(), value: money(v), unitCost: q.isZero() ? '0.0000' : round4(v.div(q)).toFixed(4) };
}

/** Value of an issue at the current weighted average. Throws when stock is insufficient. */
export function valueIssue(balanceQty: DecInput, balanceValue: DecInput, issueQty: DecInput) {
  const bq = D(balanceQty);
  if (D(issueQty).gt(bq)) throw new Error(`Insufficient stock: available ${bq.toString()}, requested ${D(issueQty).toString()}`);
  const unit = bq.isZero() ? D(0) : D(balanceValue).div(bq);
  return { unitCost: round4(unit).toFixed(4), value: money(unit.times(D(issueQty))) };
}

/** Theoretical vs actual consumption variance. */
export function consumptionVariance(executedQty: DecInput, coefficient: DecInput, actualIssued: DecInput) {
  const theoretical = D(executedQty).times(D(coefficient));
  const variance = D(actualIssued).minus(theoretical);
  return { theoretical: theoretical.toFixed(3), variance: variance.toFixed(3), variancePct: theoretical.isZero() ? null : variance.div(theoretical).toFixed(4) };
}
