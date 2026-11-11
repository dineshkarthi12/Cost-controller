import { computeCpm, fromDayNumber, toDayNumber, type CpmActivity, type CpmDependency, type CpmOutput } from './schedule.js';

/**
 * A project's working calendar: which weekdays are worked and which dates are holidays.
 * `workWeek` is seven characters for Monday … Sunday, "1" = worked ("1111110" = Sunday off).
 *
 * Working days are numbered consecutively (index), so durations, lags and floats can be counted in
 * working days by running the calendar-day CPM engine on working-day indexes and converting back.
 */
export const DEFAULT_WORK_WEEK = '1111110';
export const SEVEN_DAY_WEEK = '1111111';
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function isValidWorkWeek(w: string) {
  return /^[01]{7}$/.test(w) && w.includes('1');
}

export class WorkCalendar {
  private readonly days: boolean[]; // index 0 = Monday
  private readonly perWeek: number;
  /** Holidays that fall on otherwise worked weekdays, as sorted day numbers. */
  private readonly holidays: number[];
  private readonly holidaySet: Set<number>;

  constructor(workWeek: string = SEVEN_DAY_WEEK, holidays: Array<string | Date> = []) {
    const w = isValidWorkWeek(workWeek) ? workWeek : SEVEN_DAY_WEEK;
    this.days = [...w].map((c) => c === '1');
    this.perWeek = this.days.filter(Boolean).length;
    const hs = [...new Set(holidays.map((h) => toDayNumber(h)))].filter((d) => this.weekdayWorked(d)).sort((a, b) => a - b);
    this.holidays = hs;
    this.holidaySet = new Set(hs);
  }

  /** True when every day is worked and there are no holidays: working days equal calendar days. */
  get isSevenDay() {
    return this.perWeek === 7 && this.holidays.length === 0;
  }

  /** Day number 0 (1970-01-01) was a Thursday, so Monday-based weekday = (d + 3) mod 7. */
  private weekdayWorked(d: number) {
    return this.days[(((d + 3) % 7) + 7) % 7];
  }

  isWorking(d: number) {
    return this.weekdayWorked(d) && !this.holidaySet.has(d);
  }

  /** Number of working days before day d (counted from 1970-01-05, a Monday). Any two days compare correctly. */
  toWork(d: number): number {
    const base = 4; // 1970-01-05, Monday
    const rel = d - base;
    const weeks = Math.floor(rel / 7);
    let n = weeks * this.perWeek;
    const rest = rel - weeks * 7;
    for (let i = 0; i < rest; i++) if (this.days[i]) n++;
    // Holidays before d (binary search).
    let lo = 0;
    let hi = this.holidays.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.holidays[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    return n - lo;
  }

  /** The working day with this index. */
  fromWork(idx: number): number {
    // Smallest d with toWork(d + 1) > idx.
    let lo = Math.floor((idx * 7) / this.perWeek) - 14 - this.holidays.length;
    let hi = Math.ceil((idx * 7) / this.perWeek) + 14 + this.holidays.length * 2;
    while (this.toWork(lo + 1) > idx) lo -= 30;
    while (this.toWork(hi + 1) <= idx) hi += 30;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.toWork(mid + 1) > idx) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** Index of the first working day on or after d. */
  startIndex(d: number) {
    return this.toWork(d);
  }

  /** Index of the last working day on or before d. */
  finishIndex(d: number) {
    return this.toWork(d + 1) - 1;
  }

  /** Working days from start to finish, both included (at least 1). */
  workingDaysBetween(start: number, finish: number) {
    return Math.max(1, this.finishIndex(finish) - this.startIndex(start) + 1);
  }

  /** ISO date: the start moved to a working day, then n − 1 more working days (the finish of an n-day activity). */
  finishAfter(startIso: string, workingDays: number): string {
    const s = this.startIndex(toDayNumber(startIso));
    return fromDayNumber(this.fromWork(s + Math.max(1, workingDays) - 1));
  }

  /** ISO date of the working day `n` working days after the given one (n may be negative); the date is first moved to a working day. */
  shift(iso: string, n: number): string {
    return fromDayNumber(this.fromWork(this.startIndex(toDayNumber(iso)) + n));
  }

  /** ISO date moved forward to a working day. */
  nextWorking(iso: string): string {
    return this.shift(iso, 0);
  }
}

/**
 * CPM in working days: durations, lags and floats count only working days, and every date the
 * forecast produces is a working day. With a seven-day calendar this is exactly `computeCpm`.
 */
export function computeCpmOnCalendar(input: CpmActivity[], deps: CpmDependency[], dataDate: number, cal: WorkCalendar): CpmOutput {
  if (cal.isSevenDay) return computeCpm(input, deps, dataDate);
  const s = (d: number | null | undefined) => (d === null || d === undefined ? (d as null | undefined) : cal.startIndex(d));
  const f = (d: number | null | undefined) => (d === null || d === undefined ? (d as null | undefined) : cal.finishIndex(d));
  const mapped: CpmActivity[] = input.map((a) => {
    const ps = s(a.plannedStart) ?? null;
    let pf = f(a.plannedFinish) ?? null;
    if (ps !== null && pf !== null && pf < ps) pf = ps; // an activity placed only on non-working days keeps one working day
    if (a.isMilestone && ps !== null) pf = ps;
    const as = s(a.actualStart);
    let af = f(a.actualFinish);
    if (as !== null && as !== undefined && af !== null && af !== undefined && af < as) af = as;
    return { ...a, plannedStart: ps, plannedFinish: pf, actualStart: as, actualFinish: af };
  });
  const out = computeCpm(mapped, deps, cal.startIndex(dataDate));
  const back = (i: number) => cal.fromWork(i);
  return {
    ...out,
    projectStart: back(out.projectStart),
    projectFinish: back(out.projectFinish),
    activities: out.activities.map((r) => ({ ...r, earlyStart: back(r.earlyStart), earlyFinish: back(r.earlyFinish), lateStart: back(r.lateStart), lateFinish: back(r.lateFinish) })),
  };
}
