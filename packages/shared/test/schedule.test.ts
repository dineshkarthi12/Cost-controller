import { describe, expect, it } from 'vitest';
import { computeCpm, fromDayNumber, ScheduleCycleError, toDayNumber, type CpmActivity, type CpmDependency } from '../src/index.js';

const D0 = toDayNumber('2026-01-01');
const act = (id: string, start: number, dur: number, extra: Partial<CpmActivity> = {}): CpmActivity => ({ id, code: id, plannedStart: D0 + start, plannedFinish: D0 + start + dur - 1, ...extra });
const fs = (p: string, s: string, lag = 0): CpmDependency => ({ predecessorId: p, successorId: s, type: 'FS', lagDays: lag });
const byId = (out: ReturnType<typeof computeCpm>) => Object.fromEntries(out.activities.map((a) => [a.id, a]));

describe('critical path (CPM)', () => {
  // A(3) → B(5) → D(2);  A → C(2) → D.  Critical: A-B-D (10 days); C has 3 days float.
  const acts = [act('A', 0, 3), act('B', 0, 5), act('C', 0, 2), act('D', 0, 2)];
  const deps = [fs('A', 'B'), fs('A', 'C'), fs('B', 'D'), fs('C', 'D')];

  it('computes early/late dates, float and the critical path', () => {
    const out = computeCpm(acts, deps, D0);
    const r = byId(out);
    expect(fromDayNumber(r.A.earlyStart)).toBe('2026-01-01');
    expect(fromDayNumber(r.B.earlyStart)).toBe('2026-01-04');
    expect(fromDayNumber(r.D.earlyFinish)).toBe('2026-01-10');
    expect(r.C.totalFloat).toBe(3);
    expect(r.C.freeFloat).toBe(3);
    expect(r.C.critical).toBe(false);
    expect([r.A, r.B, r.D].every((x) => x.critical && x.totalFloat === 0)).toBe(true);
    expect(out.criticalPath).toEqual(['A', 'B', 'D']);
    expect(fromDayNumber(out.projectFinish)).toBe('2026-01-10');
  });

  it('applies lags and SS / FF / SF relationships', () => {
    const r1 = byId(computeCpm([act('A', 0, 10), act('B', 0, 4)], [{ predecessorId: 'A', successorId: 'B', type: 'SS', lagDays: 2 }], D0));
    expect(r1.B.earlyStart - D0).toBe(2);
    const r2 = byId(computeCpm([act('A', 0, 10), act('B', 0, 4)], [{ predecessorId: 'A', successorId: 'B', type: 'FF', lagDays: 1 }], D0));
    expect(r2.B.earlyFinish - D0).toBe(10); // finishes 1 day after A (day 9)
    const r3 = byId(computeCpm([act('A', 0, 10), act('B', 0, 3)], [fs('A', 'B', 5)], D0));
    expect(r3.B.earlyStart - D0).toBe(15);
    const r4 = byId(computeCpm([act('A', 5, 3), act('B', 0, 4)], [{ predecessorId: 'A', successorId: 'B', type: 'SF', lagDays: 0 }], D0));
    expect(r4.B.earlyStart - D0).toBe(1); // must finish no earlier than A starts (day 5): days 1–4
  });

  it('forecasts from progress: completed fixed, in-progress remaining from data date, late starts slip', () => {
    const dataDate = D0 + 6;
    const out = computeCpm(
      [act('A', 0, 3, { actualStart: D0, actualFinish: D0 + 3 }), act('B', 0, 5, { actualStart: D0 + 4, percentComplete: 40 }), act('C', 0, 2), act('D', 0, 2)],
      deps,
      dataDate,
    );
    const r = byId(out);
    expect(r.A.status).toBe('COMPLETED');
    expect(r.A.critical).toBe(false);
    expect(r.B.earlyFinish - D0).toBe(8); // 3 of 5 days remain from day 6 → days 6–8
    expect(r.C.earlyStart).toBe(dataDate); // not started, could have started day 4 → slips to data date
    expect(r.D.earlyStart - D0).toBe(9);
  });

  it('treats milestones as zero-duration', () => {
    const r = byId(computeCpm([act('A', 0, 4), { id: 'M', code: 'M', plannedStart: D0, plannedFinish: D0, isMilestone: true }], [fs('A', 'M')], D0));
    expect(r.M.duration).toBe(0);
    expect(r.M.earlyStart - D0).toBe(4);
    expect(r.M.earlyFinish).toBe(r.M.earlyStart);
  });

  it('rejects circular logic with the loop named', () => {
    expect(() => computeCpm([act('A', 0, 1), act('B', 0, 1), act('C', 0, 1)], [fs('A', 'B'), fs('B', 'C'), fs('C', 'A')], D0)).toThrow(ScheduleCycleError);
    try {
      computeCpm([act('A', 0, 1), act('B', 0, 1)], [fs('A', 'B'), fs('B', 'A')], D0);
    } catch (e) {
      expect((e as ScheduleCycleError).codes.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('skips activities without planned dates instead of failing', () => {
    const out = computeCpm([act('A', 0, 2), { id: 'X', code: 'X', plannedStart: null, plannedFinish: null }], [], D0);
    expect(out.skipped).toEqual(['X']);
    expect(out.activities).toHaveLength(1);
  });
});
