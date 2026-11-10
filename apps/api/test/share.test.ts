/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, describe, expect, it } from 'vitest';
import { day, prisma, setupWorld, type World } from './helpers.js';

let w: World;
beforeAll(async () => {
  w = await setupWorld();
});

describe('WhatsApp contacts', () => {
  it('are kept in the organisation settings and given to every user for one-click sharing', async () => {
    await w.c.admin.ok.put('/admin/settings', { settings: { whatsappContacts: [{ name: 'Gowtham', role: 'Executive Director', phone: '+91 89407 42959' }] } });
    const me = await w.c.se.ok.get('/auth/me');
    expect(me.whatsappContacts).toMatchObject([{ name: 'Gowtham', role: 'Executive Director', phone: '+91 89407 42959', dailyPack: true }]);
    expect((await w.c.admin.put('/admin/settings', { settings: { whatsappContacts: [{ name: 'X', role: '', phone: 'call me' }] } })).status).toBe(422);
    expect((await w.c.se.put('/admin/settings', { settings: { whatsappContacts: [] } })).status).toBe(403);
  });
});

describe('daily progress report for WhatsApp', () => {
  it("brings the day's site diary, labour, app activity and pending approvals into one message", async () => {
    const d = day(0);
    await w.c.admin.ok.post(`${w.P}/r/siteDiaries`, { date: d, shift: 'DAY', weather: 'CLEAR', activitiesPerformed: 'Gypsum partition at reception 106 sqft', delays: 'Board delivery late by 2 hours', nextDayPlan: 'Wallpaper in space room' });
    await w.c.se.ok.post(`${w.P}/labour-reports`, { date: d, gangs: [{ work: 'Wall putty 2nd coat', workers: ['A'], masons: 1, helpers: 0, doneQty: '300', progress: 'DONE' }] });
    const mr = await w.c.se.ok.post(`${w.P}/r/mrs`, { requiredBy: day(5), lines: [{ materialId: w.cement.id, qty: '50', unit: 'BAG' }] });
    await w.c.se.ok.post(`${w.P}/r/mrs/${mr.id}/submit`, {});
    const r = await w.c.pm.ok.get(`${w.P}/daily-digest?date=${d}`);
    const t: string = r.text;
    expect(t).toMatch(/^\*Daily progress report – Project /);
    expect(t).toContain('Work done: Gypsum partition at reception 106 sqft');
    expect(t).toContain('Delays: Board delivery late by 2 hours');
    expect(t).toContain('Tomorrow: Wallpaper in space room');
    expect(t).toMatch(/\*Labour\*\n1 masons · 0 helpers · cost ₹1,\d00/);
    expect(t).toMatch(/Output 120\.0% of norm · profit/);
    expect(t).toContain('• Wall putty 2nd coat: 300 Sq.ft (120%)');
    expect(t).toMatch(/Material requisitions \(MR\) created: 1/);
    expect(t).toMatch(/\*Waiting for approval\*: \d+/);
  });

  it('says so when nothing was recorded, and shares are kept in the audit trail', async () => {
    const r = await w.c.pm.ok.get(`${w.P}/daily-digest?date=${day(-40)}`);
    expect(r.text).toContain('Nothing was recorded in the app for this day.');
    await w.c.pm.ok.post(`${w.P}/daily-digest/shared`, { what: 'Daily progress report', to: 'Gowtham (Executive Director)' });
    const a = await prisma.auditEvent.findFirst({ where: { projectId: w.project.id, action: 'SHARED_WHATSAPP' } });
    expect(a?.summary).toBe('Daily progress report shared on WhatsApp with Gowtham (Executive Director)');
  });

  it('is only for people on the project', async () => {
    expect((await w.c.outsider.get(`${w.P}/daily-digest`)).status).toBe(404);
  });
});
