import { describe, expect, it } from 'vitest';
import { allowedInspectionResults, blockingHoldPoint, checklistSummary, type ChecklistResult, type ChecklistPointType } from '../src/index.js';

const items = (spec: Array<[ChecklistPointType, ChecklistResult]>) => spec.map(([pointType, result], i) => ({ lineNo: i + 1, pointType, result }));

describe('inspection checklist rules', () => {
  it('summarises results: any failure fails, open items keep it pending', () => {
    expect(checklistSummary(items([['REVIEW', 'PASS'], ['HOLD', 'NA'], ['WITNESS', 'PASS']])).outcome).toBe('PASS');
    expect(checklistSummary(items([['REVIEW', 'PASS'], ['HOLD', 'PENDING']])).outcome).toBe('PENDING');
    const s = checklistSummary(items([['REVIEW', 'FAIL'], ['HOLD', 'PENDING'], ['REVIEW', 'NA']]));
    expect(s).toEqual({ total: 3, pending: 1, passed: 0, failed: 1, notApplicable: 1, outcome: 'FAIL' });
  });

  it('finds the first unreleased hold point before an item', () => {
    const list = items([['REVIEW', 'PENDING'], ['HOLD', 'PENDING'], ['REVIEW', 'PENDING'], ['HOLD', 'FAIL'], ['REVIEW', 'PENDING']]);
    expect(blockingHoldPoint(list, 2)).toBeNull(); // the hold point itself can be recorded
    expect(blockingHoldPoint(list, 3)?.lineNo).toBe(2);
    list[1].result = 'PASS';
    expect(blockingHoldPoint(list, 3)).toBeNull();
    expect(blockingHoldPoint(list, 5)?.lineNo).toBe(4); // a failed hold point is not released
    list[3].result = 'NA';
    expect(blockingHoldPoint(list, 5)).toBeNull();
  });

  it('limits the overall result to what the checklist supports', () => {
    expect(allowedInspectionResults([])).toEqual(['PENDING', 'PASS', 'FAIL', 'CONDITIONAL']);
    expect(allowedInspectionResults(items([['REVIEW', 'PASS']]))).toEqual(['PASS', 'CONDITIONAL']);
    expect(allowedInspectionResults(items([['REVIEW', 'PASS'], ['REVIEW', 'PENDING']]))).toEqual(['PENDING']);
    expect(allowedInspectionResults(items([['REVIEW', 'FAIL'], ['REVIEW', 'PENDING']]))).toEqual(['FAIL']);
  });
});
