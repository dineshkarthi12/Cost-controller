import { describe, expect, it } from 'vitest';
import { WorkCalendar, computeCpmOnCalendar } from '../src/calc/calendar';
import { computeCpm, fromDayNumber, toDayNumber } from '../src/calc/schedule';

const d = toDayNumber;
const iso = fromDayNumber;

describe('working calendar', () => {
  // 2027-01-04 is a Monday; 2027-01-10 a Sunday; 2027-01-26 Republic Day (Tuesday).
  const cal = new WorkCalendar('1111110', ['2027-01-26']);

  it('knows weekdays and holidays', () => {
    expect(cal.isWorking(d('2027-01-04'))).toBe(true);
    expect(cal.isWorking(d('2027-01-10'))).toBe(false);
    expect(cal.isWorking(d('2027-01-26'))).toBe(false);
    expect(cal.isWorking(d('2027-01-27'))).toBe(true);
  });

  it('round-trips working day indexes for every day over two years', () => {
    for (let x = d('2026-01-01'); x < d('2028-01-01'); x++) {
      if (cal.isWorking(x)) expect(cal.fromWork(cal.toWork(x))).toBe(x);
      expect(cal.toWork(x + 1) - cal.toWork(x)).toBe(cal.isWorking(x) ? 1 : 0);
    }
  });

  it('counts durations in working days, skipping Sundays and holidays', () => {
    expect(cal.finishAfter('2027-01-04', 6)).toBe('2027-01-09'); // Mon–Sat
    expect(cal.finishAfter('2027-01-04', 7)).toBe('2027-01-11'); // Sunday skipped
    expect(cal.finishAfter('2027-01-10', 1)).toBe('2027-01-11'); // a Sunday start moves to Monday
    expect(cal.finishAfter('2027-01-25', 2)).toBe('2027-01-27'); // Republic Day skipped
    expect(cal.workingDaysBetween(d('2027-01-04'), d('2027-01-16'))).toBe(12); // 13 days, one Sunday
    expect(cal.shift('2027-01-09', 1)).toBe('2027-01-11');
  });

  it('a seven-day calendar gives exactly the calendar-day CPM', () => {
    const acts = [
      { id: 'a', code: 'A', plannedStart: d('2027-01-04'), plannedFinish: d('2027-01-13') },
      { id: 'b', code: 'B', plannedStart: d('2027-01-14'), plannedFinish: d('2027-01-20') },
    ];
    const deps = [{ predecessorId: 'a', successorId: 'b', type: 'FS' as const, lagDays: 0 }];
    expect(computeCpmOnCalendar(acts, deps, d('2027-01-01'), new WorkCalendar('1111111'))).toEqual(computeCpm(acts, deps, d('2027-01-01')));
  });

  it('CPM on a Sunday-off calendar: durations, links and floats in working days, dates on working days', () => {
    const acts = [
      { id: 'a', code: 'A', plannedStart: d('2027-01-04'), plannedFinish: d('2027-01-09') }, // 6 working days
      { id: 'b', code: 'B', plannedStart: d('2027-01-11'), plannedFinish: d('2027-01-13') }, // 3 working days
      { id: 'c', code: 'C', plannedStart: d('2027-01-11'), plannedFinish: d('2027-01-11') }, // 1 working day, 2 days float
    ];
    const deps = [
      { predecessorId: 'a', successorId: 'b', type: 'FS' as const, lagDays: 0 },
      { predecessorId: 'a', successorId: 'c', type: 'FS' as const, lagDays: 0 },
    ];
    const out = computeCpmOnCalendar(acts, deps, d('2027-01-01'), cal);
    const r = Object.fromEntries(out.activities.map((x) => [x.code, x]));
    expect(iso(r.B.earlyStart)).toBe('2027-01-11'); // after Saturday's finish, Sunday skipped
    expect(iso(r.B.earlyFinish)).toBe('2027-01-13');
    expect(r.C.totalFloat).toBe(2);
    expect(iso(out.projectFinish)).toBe('2027-01-13');
    expect(r.A.critical && r.B.critical && !r.C.critical).toBe(true);
  });

  it('a data date on a holiday starts remaining work on the next working day', () => {
    const acts = [{ id: 'a', code: 'A', plannedStart: d('2027-01-20'), plannedFinish: d('2027-01-21') }];
    const out = computeCpmOnCalendar(acts, [], d('2027-01-26'), cal);
    expect(iso(out.activities[0].earlyStart)).toBe('2027-01-27');
    expect(iso(out.activities[0].earlyFinish)).toBe('2027-01-28');
  });
});
