/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, PASSWORD, setupWorld, type World } from './helpers.js';

let w: World;
let agent: ReturnType<typeof request.agent>;
const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));

beforeAll(async () => {
  w = await setupWorld();
  agent = request.agent(app);
  await agent.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.se.email, password: PASSWORD });
});

const preview = (name: string, buf: Buffer) => agent.post(`/api${w.P}/schedule/import/preview`).set('X-Requested-With', 'toprock').attach('file', buf, { filename: name });
const commit = (id: string, body: object = {}) => agent.post(`/api${w.P}/schedule/import/${id}/commit`).set('X-Requested-With', 'toprock').send(body);

describe('MS Project XML import', () => {
  let jobId: string;
  it('previews work activities only, with dates, progress, milestones and links', async () => {
    const r = await preview('tower-c.xml', fixture('tower-c.xml'));
    expect(r.status).toBe(201);
    jobId = r.body.id;
    expect(r.body.summary).toMatchObject({ format: 'MS_PROJECT_XML', projectName: 'Tower C', activities: 4, newActivities: 4, dependencies: 4 });
    expect(r.body.summary.warnings.join(' ')).toMatch(/summary task/);
    const a = Object.fromEntries(r.body.activities.map((x: any) => [x.code, x]));
    expect(a['1.1']).toMatchObject({ name: 'Excavation', plannedStart: '2026-11-02', plannedFinish: '2026-11-11', actualFinish: '2026-11-11', percentComplete: 100 });
    expect(a['1.4']).toMatchObject({ isMilestone: true, plannedStart: '2026-12-15', plannedFinish: '2026-12-15' });
    // nothing written yet
    expect((await w.c.se.ok.get(`${w.P}/r/activities`)).total).toBe(0);
  });

  it('commits activities and dependencies (SS lag in days, FF type)', async () => {
    const r = await commit(jobId);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ created: 4, updated: 0, dependencies: 4 });
    const deps = await w.c.se.ok.get(`${w.P}/schedule/dependencies`);
    const d = Object.fromEntries(deps.map((x: any) => [`${x.predecessor.code}>${x.successor.code}`, x]));
    expect(d['1.2>1.3']).toMatchObject({ type: 'SS', lagDays: 3 });
    expect(d['1.3>1.4']).toMatchObject({ type: 'FF', lagDays: 0 });
    const acts = (await w.c.se.ok.get(`${w.P}/r/activities?pageSize=50`)).items;
    const raft = acts.find((x: any) => x.code === '1.2');
    expect(raft.status).toBe('IN_PROGRESS');
    expect(Number(raft.percentComplete)).toBe(40);
    const cpm = await w.c.se.ok.get(`${w.P}/schedule/cpm`);
    expect(cpm.dependencies).toBe(4);
  });

  it('cannot be committed twice; re-importing updates activities instead of duplicating', async () => {
    expect((await commit(jobId)).status).toBe(409);
    const r = await preview('tower-c.xml', fixture('tower-c.xml'));
    expect(r.body.summary).toMatchObject({ newActivities: 0, updatedActivities: 4 });
    const c = await commit(r.body.id, { includeProgress: false });
    expect(c.body).toEqual({ created: 0, updated: 4, dependencies: 4 });
    expect((await w.c.se.ok.get(`${w.P}/r/activities`)).total).toBe(4);
    expect((await w.c.se.ok.get(`${w.P}/schedule/dependencies`)).length).toBe(4);
  });
});

describe('Primavera P6 XER import', () => {
  it('imports tasks and milestones, skips level-of-effort, converts lag hours to days', async () => {
    const r = await preview('tower-d.xer', fixture('tower-d.xer'));
    expect(r.status).toBe(201);
    expect(r.body.summary).toMatchObject({ format: 'PRIMAVERA_XER', projectName: 'TWR-D', activities: 4, dependencies: 3 });
    expect(r.body.summary.warnings.join(' ')).toMatch(/level-of-effort/);
    const c = await commit(r.body.id);
    expect(c.body).toEqual({ created: 4, updated: 0, dependencies: 3 });
    const deps = await w.c.se.ok.get(`${w.P}/schedule/dependencies`);
    expect(deps.find((x: any) => x.predecessor.code === 'A1010' && x.successor.code === 'A1020')).toMatchObject({ type: 'SS', lagDays: 5 });
    const acts = (await w.c.se.ok.get(`${w.P}/r/activities?pageSize=50`)).items;
    expect(acts.find((x: any) => x.code === 'A1000')).toMatchObject({ status: 'COMPLETED' });
    expect(acts.find((x: any) => x.code === 'M1000')).toMatchObject({ isMilestone: true });
  });
});

describe('validation', () => {
  it('rejects files that are not schedules', async () => {
    const r = await preview('notes.xml', Buffer.from('<hello/>'));
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/Microsoft Project/);
    expect((await preview('x.xer', Buffer.from('not a xer'))).status).toBe(422);
  });

  it('rejects logic loops on commit and leaves the schedule unchanged', async () => {
    const loop = fixture('tower-c.xml').toString().replace('<UID>2</UID><ID>2</ID><Name>Excavation</Name>', '<UID>2</UID><ID>2</ID><Name>Excavation</Name><PredecessorLink><PredecessorUID>5</PredecessorUID><Type>1</Type></PredecessorLink>');
    const p = await preview('loop.xml', Buffer.from(loop));
    const before = (await w.c.se.ok.get(`${w.P}/schedule/dependencies`)).length;
    const c = await commit(p.body.id);
    expect(c.status).toBe(422);
    expect(c.body.error.message).toMatch(/loop/);
    expect((await w.c.se.ok.get(`${w.P}/schedule/dependencies`)).length).toBe(before);
  });

  it('requires schedule edit permission', async () => {
    const aud = request.agent(app);
    await aud.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.auditor.email, password: PASSWORD });
    const r = await aud.post(`/api${w.P}/schedule/import/preview`).set('X-Requested-With', 'toprock').attach('file', fixture('tower-c.xml'), { filename: 'tower-c.xml' });
    expect(r.status).toBe(403);
  });
});
