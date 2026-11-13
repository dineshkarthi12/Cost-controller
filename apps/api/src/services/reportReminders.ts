/**
 * Evening reminders for daily reports that are still missing.
 *
 * Once the organisation's reminder time has passed (Settings, default 18:00 local time), on a working day
 * of the project (its work week and holidays):
 *  - site engineers of each active project get one reminder listing what is still missing today:
 *    the site diary (DPR), the manpower report (MPR) and, on projects that use it, the evening
 *    measurement of the daily labour report;
 *  - every office team member who writes daily work reports (QS / estimation) and has not submitted
 *    today's gets a personal reminder (Sundays excluded).
 * Each reminder is sent at most once per person and day (notification dedupe key).
 */
import { prisma } from '../lib/prisma.js';
import { toDateOnly } from '../lib/dates.js';
import { usersWithRole } from './access.js';
import { notify } from './notifications.js';
import { getOrgSettings } from './settings.js';

/** Local date (YYYY-MM-DD), time (HH:MM) and weekday (0 = Monday) in a time zone. */
export function localNow(tz: string, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday };
}

/** Days before today in which a project counts as using the daily labour report. */
const LABOUR_REPORT_IN_USE_DAYS = 14;

export async function reportReminders(now = new Date()) {
  const out: Array<{ org: string; date: string; projects: number; siteReminders: number; workReportReminders: number }> = [];
  for (const org of await prisma.organisation.findMany({ select: { id: true, code: true, timezone: true } })) {
    const s = await getOrgSettings(prisma, org.id);
    if (!s.reportReminders) continue;
    const { date, time, weekday } = localNow(org.timezone, now);
    if (time < s.reportReminderTime) continue;
    const day = toDateOnly(date)!;
    let siteReminders = 0;
    let projectsChecked = 0;

    const projects = await prisma.project.findMany({ where: { orgId: org.id, status: 'ACTIVE' }, select: { id: true, code: true, name: true, workWeek: true } });
    for (const p of projects) {
      if (p.workWeek[weekday] === '0') continue;
      if (await prisma.projectHoliday.count({ where: { projectId: p.id, date: day } })) continue;
      projectsChecked++;
      const since = new Date(day.getTime() - LABOUR_REPORT_IN_USE_DAYS * 86_400_000);
      const [diary, mpr, labourToday, labourInUse] = await Promise.all([
        prisma.siteDiary.count({ where: { projectId: p.id, date: day } }),
        prisma.manpowerReport.count({ where: { projectId: p.id, date: day } }),
        prisma.dailyLabourReport.findFirst({ where: { projectId: p.id, date: day }, select: { status: true } }),
        prisma.dailyLabourReport.count({ where: { projectId: p.id, date: { gte: since, lt: day } } }),
      ]);
      const missing: Array<{ what: string; link: string }> = [];
      if (!diary) missing.push({ what: 'site diary (DPR)', link: '/site-diary/new' });
      if (!mpr) missing.push({ what: 'manpower report (MPR)', link: '/manpower/new' });
      if (labourInUse && (!labourToday || labourToday.status === 'PLANNED')) missing.push({ what: labourToday ? 'evening measurement of the daily labour report' : 'daily labour report', link: '/manpower/daily' });
      if (!missing.length) continue;
      const engineers = await usersWithRole(prisma, org.id, p.id, 'SITE_ENGINEER');
      if (!engineers.length) continue;
      await notify(prisma, {
        userIds: engineers,
        type: 'REPORT_REMINDER',
        title: `${p.code}: today's ${missing.map((m) => m.what).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in yet`,
        body: `${p.name} · ${date}. Please enter ${missing.length === 1 ? 'it' : 'them'} before you leave site.`,
        link: missing[0].link,
        projectId: p.id,
        dedupeKey: `report-reminder:${p.id}:${date}`,
      });
      siteReminders++;
    }

    let workReportReminders = 0;
    if (weekday !== 6) {
      const writers = await prisma.user.findMany({
        where: { orgId: org.id, status: 'ACTIVE', roles: { some: { projectId: null, role: { code: { not: 'SUPER_ADMIN' }, permissions: { some: { permissionCode: 'workreport.submit' } } } } } },
        select: { id: true },
      });
      const done = new Set(
        (await prisma.workReport.findMany({ where: { orgId: org.id, date: day, status: { in: ['SUBMITTED', 'REVIEWED'] }, userId: { in: writers.map((w) => w.id) } }, select: { userId: true } })).map((r) => r.userId),
      );
      for (const w of writers.filter((x) => !done.has(x.id))) {
        await notify(prisma, { userIds: [w.id], type: 'REPORT_REMINDER', title: `Your daily work report for ${date} is not submitted yet`, body: 'Add what you did today and tomorrow’s plan, then submit.', link: '/work-reports', dedupeKey: `wr-reminder:${w.id}:${date}` });
        workReportReminders++;
      }
    }
    out.push({ org: org.code, date, projects: projectsChecked, siteReminders, workReportReminders });
  }
  return out;
}
