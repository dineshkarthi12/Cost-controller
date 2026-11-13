import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, setupWorld, type World } from './helpers.js';
import { reportReminders } from '../src/services/reportReminders.js';

/** Evening reminders for missing daily reports (site engineers and the QS team). */
let w: World;
let date: string; // a recent Monday–Saturday (the test project's working days)
const at = (hhmmUtc: string) => new Date(`${date}T${hhmmUtc}:00Z`); // org time zone is Asia/Kolkata (UTC+5:30)
const reminders = (userId: string) => prisma.notification.findMany({ where: { userId, type: 'REPORT_REMINDER' } });
const mine = (r: Awaited<ReturnType<typeof reportReminders>>) => r.find((x) => x.org === w.tag);

beforeAll(async () => {
  w = await setupWorld();
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1); // not a Sunday
  date = d.toISOString().slice(0, 10);
});

describe('missing report reminders', () => {
  it('waits for the reminder time (18:00 local by default)', async () => {
    const r = await reportReminders(at('10:00')); // 15:30 in India
    expect(mine(r)).toBeUndefined();
    expect(await reminders(w.users.se.id)).toHaveLength(0);
  });

  it('reminds site engineers once about the missing DPR and MPR, and the QS team about the work report', async () => {
    const r = await reportReminders(at('13:00')); // 18:30 in India
    expect(mine(r)).toMatchObject({ date, projects: 1, siteReminders: 1 });
    const se = await reminders(w.users.se.id);
    expect(se).toHaveLength(1);
    expect(se[0].title).toContain('site diary (DPR), manpower report (MPR)');
    expect(se[0].title).not.toContain('labour report'); // this project does not use the daily labour report
    const qs = await reminders(w.users.qs.id);
    expect(qs.map((n) => n.title)).toEqual([`Your daily work report for ${date} is not submitted yet`]);
    expect(await reminders(w.users.fin.id)).toHaveLength(0); // finance writes no daily work report here

    await reportReminders(at('13:30'));
    expect(await reminders(w.users.se.id)).toHaveLength(1); // once a day
  });

  it('has nothing to say once the reports are in', async () => {
    const day = new Date(`${date}T00:00:00Z`);
    await prisma.siteDiary.create({ data: { projectId: w.project.id, number: `DPR-T-${w.tag}`, date: day, createdById: w.users.se.id } });
    await prisma.manpowerReport.create({ data: { projectId: w.project.id, number: `MPR-T-${w.tag}`, date: day, contractorKey: 'OWN', createdById: w.users.se.id } });
    expect(mine(await reportReminders(at('14:00')))).toMatchObject({ projects: 1, siteReminders: 0 });
  });

  it('skips project holidays, and stays quiet when switched off', async () => {
    const next = new Date(`${date}T00:00:00Z`);
    await prisma.projectHoliday.create({ data: { projectId: w.project.id, date: next, name: 'Festival' } });
    expect(mine(await reportReminders(at('14:00')))).toMatchObject({ projects: 0 });
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: w.org.id } });
    await prisma.organisation.update({ where: { id: w.org.id }, data: { settings: { ...(org.settings as object), reportReminders: false } } });
    expect(mine(await reportReminders(at('14:00')))).toBeUndefined();
  });
});
