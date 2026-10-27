/**
 * Critical path method (CPM) on a calendar-day basis (7-day weeks, no holiday calendar).
 *
 * Day numbers are whole days since 1970-01-01 (UTC). An activity occupies days
 * [start, finish] inclusive, so duration = finish − start + 1 (milestones have duration 0 and
 * start = finish). Internally the engine works with an exclusive end: end = start + duration.
 *
 * Relationship types with lag L (days):
 *   FS  successor starts after predecessor finishes:  succ.start ≥ pred.end + L
 *   SS  successor starts after predecessor starts:    succ.start ≥ pred.start + L
 *   FF  successor finishes after predecessor finishes: succ.end ≥ pred.end + L
 *   SF  successor finishes after predecessor starts:  succ.end ≥ pred.start + L
 *
 * Progress (forecast schedule, as of `dataDate`):
 *   completed   → fixed at actual start/finish, not critical
 *   in progress → starts at actual start; remaining duration runs from the data date
 *   not started → starts no earlier than its planned start or the data date (whichever is later)
 */
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface CpmActivity {
  id: string;
  code: string;
  plannedStart: number | null;
  plannedFinish: number | null;
  actualStart?: number | null;
  actualFinish?: number | null;
  /** 0–100 */
  percentComplete?: number;
  isMilestone?: boolean;
}

export interface CpmDependency {
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
}

export interface CpmResult {
  id: string;
  code: string;
  duration: number;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  /** Days the activity can slip without delaying the project finish. Null when completed. */
  totalFloat: number | null;
  /** Days it can slip without delaying any successor. Null when completed. */
  freeFloat: number | null;
  critical: boolean;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED';
}

export interface CpmOutput {
  activities: CpmResult[];
  projectStart: number;
  projectFinish: number;
  /** Activity ids on the critical path, in order. */
  criticalPath: string[];
  /** Activities left out because they have no planned dates. */
  skipped: string[];
}

export class ScheduleCycleError extends Error {
  constructor(public codes: string[]) {
    super(`Circular dependency between activities: ${codes.join(' → ')}`);
  }
}

export const toDayNumber = (d: Date | string) => Math.floor(new Date(typeof d === 'string' ? `${d.slice(0, 10)}T00:00:00Z` : d).getTime() / 86_400_000);
export const fromDayNumber = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** Throws ScheduleCycleError when adding these dependencies creates a loop. Returns a topological order. */
export function topologicalOrder(ids: string[], deps: CpmDependency[], codeOf: (id: string) => string = (x) => x): string[] {
  const succ = new Map<string, string[]>(ids.map((i) => [i, []]));
  const indeg = new Map<string, number>(ids.map((i) => [i, 0]));
  for (const d of deps) {
    if (!succ.has(d.predecessorId) || !succ.has(d.successorId)) continue;
    succ.get(d.predecessorId)!.push(d.successorId);
    indeg.set(d.successorId, indeg.get(d.successorId)! + 1);
  }
  const queue = ids.filter((i) => indeg.get(i) === 0);
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const s of succ.get(n)!) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  if (order.length !== ids.length) {
    // Report one loop for the user.
    const left = new Set(ids.filter((i) => !order.includes(i)));
    const start = [...left][0];
    const path: string[] = [start];
    const seen = new Set([start]);
    let cur = start;
    for (;;) {
      const next = succ.get(cur)!.find((s) => left.has(s))!;
      if (seen.has(next)) {
        path.push(next);
        break;
      }
      path.push(next);
      seen.add(next);
      cur = next;
    }
    const from = path.indexOf(path[path.length - 1]);
    throw new ScheduleCycleError(path.slice(from).map(codeOf));
  }
  return order;
}

export function computeCpm(input: CpmActivity[], deps: CpmDependency[], dataDate: number): CpmOutput {
  const skipped = input.filter((a) => a.plannedStart === null || a.plannedFinish === null).map((a) => a.id);
  const acts = input.filter((a) => a.plannedStart !== null && a.plannedFinish !== null);
  const byId = new Map(acts.map((a) => [a.id, a]));
  const links = deps.filter((d) => byId.has(d.predecessorId) && byId.has(d.successorId) && d.predecessorId !== d.successorId);
  const order = topologicalOrder(acts.map((a) => a.id), links, (id) => byId.get(id)!.code);
  const preds = new Map<string, CpmDependency[]>(acts.map((a) => [a.id, []]));
  const succs = new Map<string, CpmDependency[]>(acts.map((a) => [a.id, []]));
  for (const d of links) {
    preds.get(d.successorId)!.push(d);
    succs.get(d.predecessorId)!.push(d);
  }

  const dur = new Map<string, number>();
  const status = new Map<string, CpmResult['status']>();
  const es = new Map<string, number>();
  const ee = new Map<string, number>(); // exclusive early end

  for (const id of order) {
    const a = byId.get(id)!;
    const d = a.isMilestone ? 0 : Math.max(1, a.plannedFinish! - a.plannedStart! + 1);
    dur.set(id, d);
    if (a.actualFinish != null) {
      const s = a.actualStart ?? a.actualFinish;
      status.set(id, 'COMPLETED');
      es.set(id, s);
      ee.set(id, a.isMilestone ? a.actualFinish : a.actualFinish + 1);
      continue;
    }
    if (a.actualStart != null) {
      status.set(id, 'IN_PROGRESS');
      const remaining = Math.ceil(d * (1 - Math.min(100, Math.max(0, a.percentComplete ?? 0)) / 100));
      es.set(id, a.actualStart);
      ee.set(id, Math.max(a.actualStart + (a.isMilestone ? 0 : 1), dataDate + remaining));
      continue;
    }
    status.set(id, 'NOT_STARTED');
    let start = Math.max(a.plannedStart!, dataDate);
    for (const p of preds.get(id)!) {
      const ps = es.get(p.predecessorId)!;
      const pe = ee.get(p.predecessorId)!;
      if (p.type === 'FS') start = Math.max(start, pe + p.lagDays);
      else if (p.type === 'SS') start = Math.max(start, ps + p.lagDays);
      else if (p.type === 'FF') start = Math.max(start, pe + p.lagDays - d);
      else start = Math.max(start, ps + p.lagDays - d);
    }
    es.set(id, start);
    ee.set(id, start + d);
  }

  const projectStart = Math.min(...acts.map((a) => es.get(a.id)!));
  const projectEnd = Math.max(...acts.map((a) => ee.get(a.id)!));
  const le = new Map<string, number>(); // exclusive late end
  for (const id of [...order].reverse()) {
    const d = dur.get(id)!;
    let end = projectEnd;
    for (const s of succs.get(id)!) {
      const sls = le.get(s.successorId)! - dur.get(s.successorId)!;
      const sle = le.get(s.successorId)!;
      if (s.type === 'FS') end = Math.min(end, sls - s.lagDays);
      else if (s.type === 'SS') end = Math.min(end, sls - s.lagDays + d);
      else if (s.type === 'FF') end = Math.min(end, sle - s.lagDays);
      else end = Math.min(end, sle - s.lagDays + d);
    }
    le.set(id, end);
  }

  const results: CpmResult[] = acts.map((a) => {
    const id = a.id;
    const d = dur.get(id)!;
    const done = status.get(id) === 'COMPLETED';
    const earlyStart = es.get(id)!;
    const earlyEnd = ee.get(id)!;
    const lateEnd = le.get(id)!;
    const tf = done ? null : lateEnd - earlyEnd;
    let ff: number | null = null;
    if (!done) {
      ff = projectEnd - earlyEnd;
      for (const s of succs.get(id)!) {
        const ses = es.get(s.successorId)!;
        const see = ee.get(s.successorId)!;
        const slack = s.type === 'FS' ? ses - (earlyEnd + s.lagDays) : s.type === 'SS' ? ses - (earlyStart + s.lagDays) : s.type === 'FF' ? see - (earlyEnd + s.lagDays) : see - (earlyStart + s.lagDays);
        ff = Math.min(ff, slack);
      }
      ff = Math.max(0, ff);
    }
    const last = (end: number) => (d === 0 ? end : end - 1);
    return {
      id,
      code: a.code,
      duration: d,
      earlyStart,
      earlyFinish: last(earlyEnd),
      lateStart: lateEnd - d,
      lateFinish: last(lateEnd),
      totalFloat: tf,
      freeFloat: ff,
      critical: !done && tf !== null && tf <= 0,
      status: status.get(id)!,
    };
  });

  // Walk the driving path backwards from the latest-finishing critical activity.
  const res = new Map(results.map((r) => [r.id, r]));
  const criticalPath: string[] = [];
  let cur = results.filter((r) => r.critical).sort((x, y) => ee.get(y.id)! - ee.get(x.id)!)[0];
  const visited = new Set<string>();
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    criticalPath.unshift(cur.id);
    cur = preds
      .get(cur.id)!
      .map((p) => res.get(p.predecessorId)!)
      .filter((p) => p.critical)
      .sort((x, y) => ee.get(y.id)! - ee.get(x.id)!)[0];
  }

  return { activities: results, projectStart, projectFinish: Math.max(...results.map((r) => r.earlyFinish)), criticalPath, skipped };
}
