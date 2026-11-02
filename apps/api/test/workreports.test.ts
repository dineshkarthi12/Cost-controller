/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, day, PASSWORD, prisma, setupWorld, type World } from './helpers.js';

let w: World;
let yesterday: any;
beforeAll(async () => {
  w = await setupWorld();
});

const item = (kind: 'DONE' | 'PLAN', description: string, extra: Record<string, unknown> = {}) => ({ kind, category: 'BOQ', description, ...extra });

describe('daily work report (office QS / estimation team)', () => {
  it('is only for the office team: site staff are refused', async () => {
    expect((await w.c.se.get('/work-reports/me')).status).toBe(403);
    expect((await w.c.qs.get('/work-reports/me')).status).toBe(200);
  });

  it('checks hours before submitting', async () => {
    const base = { date: day(-1), summary: 'Waiting for MEP drawings' };
    expect((await w.c.qs.put('/work-reports/me', { ...base, submit: true, items: [item('DONE', 'BOQ for tower B')] })).status).toBe(422); // no hours
    expect((await w.c.qs.put('/work-reports/me', { ...base, submit: true, items: [item('DONE', 'A', { hours: 20 }), item('DONE', 'B', { hours: 6 })] })).status).toBe(422); // > 24 h
    expect((await w.c.qs.put('/work-reports/me', { ...base, items: [item('DONE', 'Draft without hours')] })).status).toBe(200); // a draft may be incomplete
  });

  it('submits today’s work with hours and the next day’s plan, and tells the reviewers', async () => {
    yesterday = await w.c.qs.ok.put('/work-reports/me', {
      date: day(-1),
      submit: true,
      items: [
        item('DONE', 'Finishing BOQ for Ponram', { projectId: w.project.id, output: '120 items', hours: 5, status: 'DONE' }),
        item('DONE', 'Aluminium frame BOM', { category: 'BOM', hours: 3, status: 'IN_PROGRESS', output: '70 %' }),
        item('PLAN', 'Complete aluminium BOM', { category: 'BOM' }),
        item('PLAN', 'Rate analysis for glue filling', { category: 'RATE_ANALYSIS' }),
      ],
    });
    expect(yesterday).toMatchObject({ status: 'SUBMITTED', totalHours: '8' });
    expect(yesterday.items).toHaveLength(4);
    const n = await prisma.notification.findMany({ where: { type: 'WORK_REPORT_SUBMITTED', entityId: yesterday.id } });
    const to = new Set(n.map((x) => x.userId));
    expect(to.has(w.users.pd.id)).toBe(true); // Project Director reviews
    expect(to.has(w.users.cc.id)).toBe(true); // Cost Control Lead reviews
    expect(to.has(w.users.qs.id)).toBe(false);
  });

  it('the next day starts from yesterday’s plan and lists what was recorded in the app', async () => {
    await w.c.qs.ok.post(`${w.P}/r/boqItems`, { itemCode: 'WR-1', description: 'Ceiling paint', unit: 'Sqft', contractQty: '100', estimatedQty: '100', unitRate: '40', costCodeId: w.cc.material.id });
    const me = await w.c.qs.ok.get(`/work-reports/me?date=${day(0)}`);
    expect(me.report).toBeNull();
    expect(me.previous.plan.map((p: any) => p.description)).toEqual(['Complete aluminium BOM', 'Rate analysis for glue filling']);
    expect(me.activity).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'BOQ items created', category: 'BOQ', count: 1, projectId: w.project.id })]));
    const plan = me.previous.plan;
    await w.c.qs.ok.put('/work-reports/me', {
      date: day(0),
      submit: true,
      items: [item('DONE', plan[0].description, { category: 'BOM', hours: 6, status: 'DONE', carriedFromId: plan[0].id }), item('DONE', plan[1].description, { category: 'RATE_ANALYSIS', hours: 2, status: 'IN_PROGRESS', carriedFromId: plan[1].id })],
    });
  });

  it('reviewers see the whole team, who has not reported, and plan completion', async () => {
    const t = await w.c.pd.ok.get(`/work-reports/team?date=${day(0)}`);
    const qs = t.rows.find((r: any) => r.user.id === w.users.qs.id);
    expect(qs).toMatchObject({ planned: 2, doneFromPlan: 1, planCompletion: 0.5 });
    expect(qs.report.status).toBe('SUBMITTED');
    const missing = t.rows.find((r: any) => r.user.id === w.users.bill.id); // billing engineer also writes reports
    expect(missing.report).toBeNull();
    expect(t.rows.some((r: any) => r.user.id === w.users.se.id)).toBe(false); // site staff are not expected to
    expect((await w.c.se.get(`/work-reports/team?date=${day(0)}`)).status).toBe(403);
    expect((await w.c.se.get(`/work-reports/${yesterday.id}`)).status).toBe(404);
  });

  it('review: comment and lock; the author is told and cannot change it; nobody reviews their own', async () => {
    expect((await w.c.qs.post(`/work-reports/${yesterday.id}/review`, { comment: 'ok' })).status).toBe(403);
    const r = await w.c.pd.ok.post(`/work-reports/${yesterday.id}/review`, { comment: 'Finish the BOM first; BOQ can wait', markReviewed: true });
    expect(r).toMatchObject({ status: 'REVIEWED', reviewComment: 'Finish the BOM first; BOQ can wait' });
    expect(await prisma.notification.count({ where: { userId: w.users.qs.id, type: 'WORK_REPORT_REVIEWED' } })).toBe(1);
    expect((await w.c.qs.put('/work-reports/me', { date: day(-1), items: [item('DONE', 'x', { hours: 1 })] })).status).toBe(409);
  });

  it('a manager sees and can review their direct reports without the reviewer permission', async () => {
    await prisma.user.update({ where: { id: w.users.bill.id }, data: { reportingManagerId: w.users.se2.id } });
    const rep = await w.c.bill.ok.put('/work-reports/me', { date: day(0), submit: true, items: [item('DONE', 'RA bill 3 checking', { category: 'BILLING', hours: 7 })] });
    const t = await w.c.se2.ok.get(`/work-reports/team?date=${day(0)}`);
    expect(t.rows.map((r: any) => r.user.id)).toEqual([w.users.bill.id]);
    expect((await w.c.se2.post(`/work-reports/${rep.id}/review`, { comment: 'Good' })).status).toBe(200);
  });

  it('summary and Excel export of hours by person, type of work and project', async () => {
    const s = await w.c.pd.ok.get(`/work-reports/summary?from=${day(-1)}&to=${day(0)}`);
    const qs = s.users.find((u: any) => u.user.id === w.users.qs.id);
    expect(qs).toMatchObject({ days: 2, hours: 16, byCategory: { BOQ: 5, BOM: 9, RATE_ANALYSIS: 2 } });
    expect(qs.byProject[w.project.name]).toBe(5);
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.pd.email, password: PASSWORD });
    const x = await agent.get(`/api/work-reports/export?from=${day(-1)}&to=${day(0)}`).set('X-Requested-With', 'toprock').buffer(true).parse((res, cb) => {
      const c: Buffer[] = [];
      res.on('data', (d: Buffer) => c.push(d));
      res.on('end', () => cb(null, Buffer.concat(c)));
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as any);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Summary', 'Work done', 'Next day plan']);
    expect(wb.getWorksheet('Work done')!.rowCount).toBe(1 + 5); // 2 + 2 (qs) + 1 (billing)
  });
});
