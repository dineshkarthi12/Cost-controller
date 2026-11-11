/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, PASSWORD, prisma, setupWorld, type World } from './helpers.js';
import { readDate, readPredecessors } from '../src/services/scheduleExcel.js';

let w: World;
let pm: ReturnType<typeof request.agent>;
beforeAll(async () => {
  w = await setupWorld();
  await w.c.admin.ok.post(`${w.P}/r/wbsNodes`, { code: 'TWR-A', name: 'Tower A' });
  pm = request.agent(app);
  await pm.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.pm.email, password: PASSWORD });
});

async function sheet(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Programme');
  ws.addRow(['TOPROCK — Kadara Residency programme']);
  ws.addRow([]);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const upload = (buf: Buffer, name = 'programme.xlsx') => pm.post(`/api${w.P}/schedule/import/preview`).set('X-Requested-With', 'toprock').attach('file', buf, { filename: name });

describe('reading schedule cells', () => {
  it('reads Indian date formats day first', () => {
    expect(readDate('15-01-2027')).toBe('2027-01-15');
    expect(readDate('5/1/27')).toBe('2027-01-05');
    expect(readDate('15.01.2027')).toBe('2027-01-15');
    expect(readDate('15-Jan-27')).toBe('2027-01-15');
    expect(readDate('15 January 2027')).toBe('2027-01-15');
    expect(readDate(new Date('2027-01-15T00:00:00Z'))).toBe('2027-01-15');
    expect(readDate(46402)).toBe('2027-01-15'); // Excel serial
    expect(readDate('31-02-2027')).toBeNull();
    expect(readDate('next week')).toBeNull();
  });
  it('reads predecessors with link types and lags', () => {
    expect(readPredecessors('A-100, A-110FS+2; 7SS, A-120 FF -1d')).toEqual([
      { ref: 'A-100', type: 'FS', lagDays: 0 },
      { ref: 'A-110', type: 'FS', lagDays: 2 },
      { ref: '7', type: 'SS', lagDays: 0 },
      { ref: 'A-120', type: 'FF', lagDays: -1 },
    ]);
  });
});

describe('schedule import from Excel', () => {
  it('previews a site Excel programme: headings as WBS, durations, predecessors by code or S.No, dates from predecessors', async () => {
    const r = await upload(
      await sheet([
        ['S.No', 'Activity ID', 'Description of work', 'Start date', 'Finish date', 'Duration', 'Predecessors', 'Unit', 'Qty', 'Weightage', '% Complete'],
        [null, null, 'Tower A'],
        [1, 'EX-01', 'Excavation', '04-01-2027', '13-01-2027', null, null, 'Cum', 1200, 2, 100],
        [2, 'PCC-01', 'PCC below raft', null, null, 3, 'EX-01', 'Cum', 60, 1, 0],
        [3, null, 'Raft concrete', null, null, '12 days', '2 FS+1', 'Cum', 450, 4],
        [4, 'MS-RAFT', 'Raft complete', null, null, 0, 'A-0010'],
        [5, 'COL-GF', 'Columns GF', '30-Jan-27', null, 8, 'X-999'],
      ]),
    );
    expect(r.status).toBe(201);
    expect(r.body.summary).toMatchObject({ format: 'EXCEL', activities: 5, newActivities: 5, dependencies: 3 });
    const a = Object.fromEntries(r.body.activities.map((x: any) => [x.code, x]));
    expect(a['EX-01']).toMatchObject({ name: 'Excavation', wbs: 'Tower A', plannedStart: '2027-01-04', plannedFinish: '2027-01-13', percentComplete: 100, unit: 'Cum', plannedQty: '1200', weight: '2' });
    expect(a['PCC-01']).toMatchObject({ plannedStart: '2027-01-14', plannedFinish: '2027-01-16' }); // day after EX-01, 3 days
    expect(a['A-0010']).toMatchObject({ name: 'Raft concrete', plannedStart: '2027-01-18', plannedFinish: '2027-01-29' }); // S.No 2 + 1 day lag, 12 days
    expect(a['MS-RAFT']).toMatchObject({ isMilestone: true, plannedStart: '2027-01-29', plannedFinish: '2027-01-29' });
    expect(a['COL-GF']).toMatchObject({ plannedStart: '2027-01-30', plannedFinish: '2027-02-06' });
    expect(r.body.summary.warnings.join(' ')).toContain('X-999');
  });

  it('imports: creates activities with qty, weight and WBS link, the links, and a baseline', async () => {
    const p = await upload(
      await sheet([
        ['Activity ID', 'Activity', 'WBS', 'Start', 'Finish', 'Predecessors', 'Unit', 'Qty'],
        ['EX-01', 'Excavation', 'TWR-A', '04-01-2027', '13-01-2027', null, 'Cum', 1200],
        ['PCC-01', 'PCC below raft', 'Tower A', '14-01-2027', '16-01-2027', 'EX-01', 'Cum', 60],
      ]),
    );
    const c = await pm.post(`/api${w.P}/schedule/import/${p.body.id}/commit`).set('X-Requested-With', 'toprock').send({});
    expect(c.body).toEqual({ created: 2, updated: 0, dependencies: 1 });
    const ex = await prisma.activity.findFirstOrThrow({ where: { projectId: w.project.id, code: 'EX-01' }, include: { wbsNode: true } });
    expect({ wbs: ex.wbsNode?.code, unit: ex.unit, qty: ex.plannedQty?.toString(), bs: ex.baselineStart?.toISOString().slice(0, 10) }).toEqual({ wbs: 'TWR-A', unit: 'Cum', qty: '1200', bs: '2027-01-04' });
  });

  it('the downloadable template imports as it is', async () => {
    const t = await pm.get(`/api${w.P}/schedule/import/template`).set('X-Requested-With', 'toprock').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (x: Buffer) => chunks.push(x));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(t.status).toBe(200);
    const r = await upload(t.body as Buffer, 'schedule-template.xlsx');
    expect(r.status).toBe(201);
    expect(r.body.summary).toMatchObject({ activities: 5, dependencies: 4 });
    expect(r.body.activities.every((a: any) => a.plannedStart && a.plannedFinish)).toBe(true);
  });

  it('explains files it cannot read', async () => {
    expect((await upload(Buffer.from('not a workbook'), 'old.xls')).body.error.message).toMatch(/save it as \.xlsx/i);
    const r = await upload(await sheet([['Name', 'Remarks'], ['Something', 'x']]));
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/No schedule found/);
  });
});

describe('schedule baseline', () => {
  it('saves planned dates as the baseline, keeps existing baselines unless replacing, and reports changes', async () => {
    const A = w.c.pm.ok;
    await A.post(`${w.P}/r/activities`, { code: 'M-01', name: 'Manual activity', plannedStart: '2027-02-01', plannedFinish: '2027-02-10', weight: '1' });
    await A.post(`${w.P}/r/activities`, { code: 'M-02', name: 'No dates yet', weight: '1' });
    let s = await A.get(`${w.P}/schedule/baseline`);
    expect(s).toMatchObject({ total: 4, dated: 3, withBaseline: 2, changedSinceBaseline: 0 });
    let r = await A.post(`${w.P}/schedule/baseline`, {});
    expect(r).toEqual({ saved: 1, kept: 2, undated: 1, total: 4 });
    const m1 = await prisma.activity.findFirstOrThrow({ where: { projectId: w.project.id, code: 'M-01' } });
    expect(m1.baselineFinish?.toISOString().slice(0, 10)).toBe('2027-02-10');

    await w.c.pm.ok.patch(`${w.P}/r/activities/${m1.id}`, { plannedFinish: '2027-02-15' });
    s = await A.get(`${w.P}/schedule/baseline`);
    expect(s.changedSinceBaseline).toBe(1);
    r = await A.post(`${w.P}/schedule/baseline`, {});
    expect(r.saved).toBe(0); // kept: the plan moved, but the baseline is only replaced on request
    r = await A.post(`${w.P}/schedule/baseline`, { replace: true });
    expect(r.saved).toBe(3);
    expect((await A.get(`${w.P}/schedule/baseline`)).changedSinceBaseline).toBe(0);
    expect(await prisma.auditEvent.count({ where: { projectId: w.project.id, action: 'SCHEDULE_BASELINED' } })).toBe(2);
    expect((await w.c.auditor.post(`${w.P}/schedule/baseline`, {})).status).toBe(403);
  });
});
