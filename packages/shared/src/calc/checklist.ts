/**
 * Inspection checklist (ITP) rules.
 *
 * Point types:
 *   HOLD     work must not proceed past this point until it is released (passed or marked N/A)
 *            by someone with quality approval rights; later items cannot be recorded before that
 *   WITNESS  the inspector should be invited to witness; work may proceed if they do not attend
 *   REVIEW   document or record review
 */
export const CHECKLIST_POINT_TYPES = ['HOLD', 'WITNESS', 'REVIEW'] as const;
export const CHECKLIST_RESULTS = ['PENDING', 'PASS', 'FAIL', 'NA'] as const;
export type ChecklistPointType = (typeof CHECKLIST_POINT_TYPES)[number];
export type ChecklistResult = (typeof CHECKLIST_RESULTS)[number];

export interface ChecklistItem {
  id: string;
  lineNo: number;
  stage: string | null;
  description: string;
  acceptanceCriteria: string | null;
  reference: string | null;
  pointType: ChecklistPointType;
  result: ChecklistResult;
  remarks: string | null;
  checkedById: string | null;
  checkedAt: string | null;
  /** NCR raised from this item when it failed. */
  ncrId: string | null;
}

export interface ChecklistSummary {
  total: number;
  pending: number;
  passed: number;
  failed: number;
  notApplicable: number;
  /** FAIL if any item failed, PENDING while items remain, otherwise PASS. */
  outcome: 'PENDING' | 'PASS' | 'FAIL';
}

export function checklistSummary(items: Pick<ChecklistItem, 'result'>[]): ChecklistSummary {
  const count = (r: ChecklistResult) => items.filter((i) => i.result === r).length;
  const s = { total: items.length, pending: count('PENDING'), passed: count('PASS'), failed: count('FAIL'), notApplicable: count('NA') };
  return { ...s, outcome: s.failed ? 'FAIL' : s.pending ? 'PENDING' : 'PASS' };
}

const released = (i: Pick<ChecklistItem, 'result'>) => i.result === 'PASS' || i.result === 'NA';

/** The first unreleased hold point before `lineNo`, which blocks recording that item. */
export function blockingHoldPoint<T extends Pick<ChecklistItem, 'lineNo' | 'pointType' | 'result'>>(items: T[], lineNo: number): T | null {
  return [...items].sort((a, b) => a.lineNo - b.lineNo).find((i) => i.lineNo < lineNo && i.pointType === 'HOLD' && !released(i)) ?? null;
}

/**
 * Overall results a user may set on an inspection that has a checklist:
 * a failed item forces FAIL, open items force PENDING, and a fully passed checklist may be PASS or CONDITIONAL.
 */
export function allowedInspectionResults(items: Pick<ChecklistItem, 'result'>[]): string[] {
  if (!items.length) return ['PENDING', 'PASS', 'FAIL', 'CONDITIONAL'];
  const { outcome } = checklistSummary(items);
  return outcome === 'PASS' ? ['PASS', 'CONDITIONAL'] : [outcome];
}
