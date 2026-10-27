import { D, type DecInput, money, ratio, sum, max } from '../money.js';

/** Inputs for one cost code (or any roll-up). All values are decimal strings or numbers. */
export interface CostPositionInput {
  originalBudget: DecInput;
  approvedRevisions: DecInput; // Σ approved revision deltas (transfers net to zero)
  contingency?: DecInput;
  actual: DecInput; // ledger ACTUAL
  accrued: DecInput; // ledger ACCRUAL
  openCommitments: DecInput; // ledger COMMITMENT
  pending?: DecInput; // submitted but unapproved cost (display only)
  /** Uncommitted cost still to be spent. When null the default method applies. */
  uncommittedEtc?: DecInput | null;
  pendingVariationExposure?: DecInput;
}

export type ForecastMethod = 'MANUAL' | 'REMAINING_BUDGET';

export interface CostPosition {
  originalBudget: string;
  approvedBudget: string;
  contingency: string;
  actual: string;
  accrued: string;
  incurred: string;
  openCommitments: string;
  pending: string;
  remainingBudget: string;
  uncommittedEtc: string;
  etc: string;
  eac: string;
  costVariance: string;
  costVariancePct: string | null;
  forecastMethod: ForecastMethod;
  pendingVariationExposure: string;
  alert: 'OK' | 'WARNING' | 'CRITICAL';
}

/**
 * Computes the cost position per BUSINESS_RULES.md §3.
 *  BAC = OB + approved revisions
 *  Incurred = Actual + Accrued
 *  Remaining = BAC − Incurred − Open commitments
 *  ETC = Open commitments + uncommitted ETC (default max(Remaining, 0))
 *  EAC = Incurred + ETC
 *  CV = BAC − EAC
 */
export function computeCostPosition(input: CostPositionInput, warnPct: DecInput = '0.95'): CostPosition {
  const ob = D(input.originalBudget);
  const bac = ob.plus(D(input.approvedRevisions));
  const actual = D(input.actual);
  const accrued = D(input.accrued);
  const incurred = actual.plus(accrued);
  const commitments = D(input.openCommitments);
  const remaining = bac.minus(incurred).minus(commitments);
  const manual = input.uncommittedEtc !== null && input.uncommittedEtc !== undefined && input.uncommittedEtc !== '';
  const uncommitted = manual ? D(input.uncommittedEtc) : max(remaining, 0);
  const etc = commitments.plus(uncommitted);
  const eac = incurred.plus(etc);
  const cv = bac.minus(eac);
  const cvPct = ratio(cv, bac);
  let alert: CostPosition['alert'] = 'OK';
  if (eac.gt(bac) || remaining.isNeg()) alert = 'CRITICAL';
  // Warning = budget consumption threshold (incurred + committed), independent of forecast method.
  else if (!bac.isZero() && incurred.plus(commitments).gte(bac.times(D(warnPct)))) alert = 'WARNING';
  return {
    originalBudget: money(ob),
    approvedBudget: money(bac),
    contingency: money(input.contingency),
    actual: money(actual),
    accrued: money(accrued),
    incurred: money(incurred),
    openCommitments: money(commitments),
    pending: money(input.pending),
    remainingBudget: money(remaining),
    uncommittedEtc: money(uncommitted),
    etc: money(etc),
    eac: money(eac),
    costVariance: money(cv),
    costVariancePct: cvPct === null ? null : cvPct.toFixed(4),
    forecastMethod: manual ? 'MANUAL' : 'REMAINING_BUDGET',
    pendingVariationExposure: money(input.pendingVariationExposure),
    alert,
  };
}

/** Rolls several positions up. Alert is recomputed from the totals. */
export function rollupPositions(items: CostPosition[], warnPct: DecInput = '0.95'): CostPosition {
  const s = (k: keyof CostPosition) => sum(items.map((i) => i[k] as string));
  const anyManual = items.some((i) => i.forecastMethod === 'MANUAL');
  const pos = computeCostPosition(
    {
      originalBudget: s('originalBudget'),
      approvedRevisions: s('approvedBudget').minus(s('originalBudget')),
      contingency: s('contingency'),
      actual: s('actual'),
      accrued: s('accrued'),
      openCommitments: s('openCommitments'),
      pending: s('pending'),
      uncommittedEtc: s('uncommittedEtc'),
      pendingVariationExposure: s('pendingVariationExposure'),
    },
    warnPct,
  );
  pos.forecastMethod = anyManual ? 'MANUAL' : 'REMAINING_BUDGET';
  return pos;
}

/** Budget availability check used on PR/PO submission. */
export function budgetAvailability(remainingBudget: DecInput, documentValue: DecInput) {
  const after = D(remainingBudget).minus(D(documentValue));
  return { available: money(remainingBudget), requested: money(documentValue), after: money(after), exceeded: after.isNeg() };
}
