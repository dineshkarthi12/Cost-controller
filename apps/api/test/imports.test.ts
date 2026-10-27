/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, PASSWORD, prisma, setupWorld, type World } from './helpers.js';

let w: World;
let agent: ReturnType<typeof request.agent>;
beforeAll(async () => {
  w = await setupWorld();
  agent = request.agent(app);
  await agent.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.cc.email, password: PASSWORD });
});

const csv = ['Item code,Description,Unit,Qty,Rate,Cost code', 'C-1,Excavation,CUM,100,450,SUB-01', 'C-2,PCC,CUM,abc,6200,SUB-01', 'C-1,Duplicate row,CUM,1,1,SUB-01', 'C-3,Unknown code,CUM,10,10,NOPE-9', 'C-4,=HYPERLINK("http://x"),CUM,5,100,'].join('\n');

describe('BOQ import', () => {
  let preview: any;
  it('previews and validates every row without writing anything', async () => {
    const r = await agent.post('/api/imports/preview').set('X-Requested-With', 'toprock').field('kind', 'BOQ').field('projectId', w.project.id).attach('file', Buffer.from(csv), { filename: 'boq.csv', contentType: 'text/csv' });
    expect(r.status).toBe(201);
    preview = r.body;
    expect(preview.summary).toMatchObject({ total: 5, valid: 2, invalid: 3 });
    const errs = Object.fromEntries(preview.rows.map((x: any) => [x.row, x.errors.join('; ')]));
    expect(errs[3]).toMatch(/must be a number/);
    expect(errs[4]).toMatch(/Duplicate/);
    expect(errs[5]).toMatch(/Unknown cost code/);
    expect(await prisma.boqItem.count({ where: { projectId: w.project.id } })).toBe(0);
  });

  it('refuses to commit with errors unless the user confirms skipping them', async () => {
    const r = await agent.post(`/api/imports/${preview.id}/commit`).set('X-Requested-With', 'toprock').send({});
    expect(r.status).toBe(422);
    const ok = await agent.post(`/api/imports/${preview.id}/commit`).set('X-Requested-With', 'toprock').send({ skipInvalid: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ imported: 2, skipped: 3 });
    expect(await prisma.boqItem.count({ where: { projectId: w.project.id } })).toBe(2);
  });

  it('cannot be committed twice', async () => {
    const r = await agent.post(`/api/imports/${preview.id}/commit`).set('X-Requested-With', 'toprock').send({ skipInvalid: true });
    expect(r.status).toBe(409);
  });

  it('error reports neutralise spreadsheet formulas', async () => {
    const r = await agent.get(`/api/imports/${preview.id}/errors.csv`).set('X-Requested-With', 'toprock');
    expect(r.status).toBe(200);
    expect(r.text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('requires import permission', async () => {
    const se = request.agent(app);
    await se.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.se.email, password: PASSWORD });
    const r = await se.post('/api/imports/preview').set('X-Requested-With', 'toprock').field('kind', 'BOQ').field('projectId', w.project.id).attach('file', Buffer.from(csv), { filename: 'boq.csv', contentType: 'text/csv' });
    expect(r.status).toBe(403);
  });
});
