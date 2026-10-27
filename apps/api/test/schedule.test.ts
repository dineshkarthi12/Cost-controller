/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { day, setupWorld, type World } from './helpers.js';

let w: World;
let other: World;
const ids: Record<string, string> = {};
beforeAll(async () => {
  w = await setupWorld();
  other = await setupWorld();
  // A(10) → B(20) → D(5);  A → C(5) → D   ⇒ critical A-B-D, C has 15 days float
  const defs: Array<[string, number, number]> = [['A', 10, 10], ['B', 20, 20], ['C', 20, 5], ['D', 40, 5]];
  for (const [code, start, dur] of defs) {
    const a = await w.c.se.ok.post(`${w.P}/r/activities`, { code, name: `Activity ${code}`, plannedStart: day(start), plannedFinish: day(start + dur - 1), weight: '1' });
    ids[code] = a.id;
  }
});

const link = (pred: string, succ: string, type = 'FS', lagDays = 0, c = () => w.c.se) => c().post(`${w.P}/schedule/dependencies`, { predecessorId: ids[pred], successorId: ids[succ], type, lagDays });

describe('schedule dependencies and critical path', () => {
  it('adds dependencies and rejects loops, duplicates, self-links and other projects', async () => {
    for (const [p, s] of [['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D']]) expect((await link(p, s)).status).toBe(201);
    const loop = await link('D', 'A');
    expect(loop.status).toBe(422);
    expect(loop.body.error.message).toMatch(/loop/i);
    expect((await link('A', 'B')).status).toBe(409);
    expect((await w.c.se.post(`${w.P}/schedule/dependencies`, { predecessorId: ids.A, successorId: ids.A })).status).toBe(422);
    const foreign = await other.c.se.ok.post(`${other.P}/r/activities`, { code: 'X', name: 'Other project', plannedStart: day(0), plannedFinish: day(3) });
    expect((await w.c.se.post(`${w.P}/schedule/dependencies`, { predecessorId: foreign.id, successorId: ids.A })).status).toBe(422);
  });

  it('read-only roles cannot change logic', async () => {
    expect((await w.c.auditor.post(`${w.P}/schedule/dependencies`, { predecessorId: ids.C, successorId: ids.B })).status).toBe(403);
  });

  it('computes forecast dates, float and the critical path', async () => {
    const cpm = await w.c.pm.ok.get(`${w.P}/schedule/cpm`);
    expect(cpm.dependencies).toBe(4);
    const r = Object.fromEntries(cpm.activities.map((a: any) => [a.code, a]));
    expect(cpm.criticalPath).toEqual(['A', 'B', 'D']);
    expect(r.B.earlyStart).toBe(day(20));
    expect(r.D.earlyStart).toBe(day(40));
    expect(r.C.totalFloat).toBe(15);
    expect(r.C.critical).toBe(false);
    expect(cpm.forecastFinish).toBe(day(44));
    expect(cpm.slipDays).toBe(0);
  });

  it('pushes successors when a predecessor is delayed, and reports the slip', async () => {
    const b = await w.c.se.ok.get(`${w.P}/r/activities/${ids.B}`);
    await w.c.se.ok.patch(`${w.P}/r/activities/${ids.B}`, { plannedFinish: day(39 + 7), expectedUpdatedAt: b.updatedAt });
    const cpm = await w.c.pm.ok.get(`${w.P}/schedule/cpm`);
    const r = Object.fromEntries(cpm.activities.map((a: any) => [a.code, a]));
    expect(r.D.earlyStart).toBe(day(47));
    expect(r.D.finishVarianceDays).toBe(7);
    expect(cpm.slipDays).toBe(5); // planned finish itself moved to day 46 (B), forecast is day 51
  });

  it('removing a dependency is audited', async () => {
    const deps = await w.c.se.ok.get(`${w.P}/schedule/dependencies`);
    const cd = deps.find((d: any) => d.predecessor.code === 'C' && d.successor.code === 'D');
    expect((await w.c.se.del(`${w.P}/schedule/dependencies/${cd.id}`)).status).toBe(200);
    expect((await w.c.se.ok.get(`${w.P}/schedule/dependencies`)).length).toBe(3);
  });
});
