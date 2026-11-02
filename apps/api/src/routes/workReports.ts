import { Router } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { WORK_CATEGORIES, WORK_ITEM_STATUSES, planCompletion, type WorkCategory } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { conflict, forbidden, notFound, validationError } from '../lib/errors.js';
import { addDays, isoDate, toDateOnly, today } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { can, type AccessContext } from '../services/access.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notifications.js';

/** Daily work report for the office QS / estimation team: today's work with hours, tomorrow's plan, review. */
export const workReportsRouter = Router();

const CATEGORY_KEYS = Object.keys(WORK_CATEGORIES) as [WorkCategory, ...WorkCategory[]];
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const itemSchema = z.object({
  kind: z.enum(['DONE', 'PLAN']),
  category: z.enum(CATEGORY_KEYS),
  projectId: z.string().nullable().optional(),
  description: z.string().trim().min(1, 'Describe the work').max(500),
  output: z.string().trim().max(300).nullable().optional(),
  status: z.enum(WORK_ITEM_STATUSES).default('DONE'),
  hours: z.coerce.number().min(0).max(24).nullable().optional(),
  targetDate: ymd.nullable().optional(),
  carriedFromId: z.string().nullable().optional(),
});
const saveSchema = z.object({ date: ymd, summary: z.string().trim().max(2000).nullable().optional(), items: z.array(itemSchema).max(60), submit: z.boolean().default(false), expectedUpdatedAt: z.string().optional() });

const include = { items: { orderBy: [{ kind: 'asc' as const }, { lineNo: 'asc' as const }], include: { project: { select: { id: true, code: true, name: true } } } }, user: { select: { id: true, name: true, designation: true, email: true } }, reviewer: { select: { id: true, name: true } } };

/** Users whose reports the viewer may read: their own, direct reports, everyone for reviewers. */
async function visibleUserIds(ctx: AccessContext): Promise<Set<string> | 'ALL'> {
  if (can(ctx, 'workreport.review')) return 'ALL';
  const direct = await prisma.user.findMany({ where: { orgId: ctx.orgId, reportingManagerId: ctx.user.id }, select: { id: true } });
  return new Set([ctx.user.id, ...direct.map((u) => u.id)]);
}
const mayView = (v: Set<string> | 'ALL', userId: string) => v === 'ALL' || v.has(userId);
const isReviewer = async (ctx: AccessContext, authorId: string) => can(ctx, 'workreport.review') || !!(await prisma.user.count({ where: { id: authorId, orgId: ctx.orgId, reportingManagerId: ctx.user.id } }));

/** Team members expected to write reports: active users holding workreport.submit through an organisation role (Super Admin, which holds every permission, does not count). */
async function teamMembers(orgId: string) {
  return prisma.user.findMany({
    where: { orgId, status: 'ACTIVE', roles: { some: { projectId: null, role: { code: { not: 'SUPER_ADMIN' }, permissions: { some: { permissionCode: 'workreport.submit' } } } } } },
    select: { id: true, name: true, designation: true, reportingManagerId: true },
    orderBy: { name: 'asc' },
  });
}

/** Offset of the organisation's time zone from UTC on a date, in minutes (e.g. +330 for India). */
function tzOffsetMinutes(tz: string, at: Date) {
  const local = new Date(at.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local.getTime() - utc.getTime()) / 60000);
}

const ACTIVITY: Record<string, { label: string; category: WorkCategory }> = {
  boqItem: { label: 'BOQ items', category: 'BOQ' },
  bom: { label: 'BOM', category: 'BOM' },
  bomItem: { label: 'BOM items', category: 'BOM' },
  bomLine: { label: 'BOM lines (rates)', category: 'BOM' },
  measurement: { label: 'Measurements', category: 'MEASUREMENT' },
  quantityTakeoff: { label: 'Quantity take-offs', category: 'QUANTITY_TAKEOFF' },
  contractorBill: { label: 'Contractor RA bills', category: 'BILLING' },
  clientBill: { label: 'Client bills', category: 'BILLING' },
  rfq: { label: 'RFQs', category: 'VENDOR_COMPARISON' },
  quotation: { label: 'Quotations', category: 'VENDOR_COMPARISON' },
  variation: { label: 'Variations', category: 'ESTIMATION' },
  budgetRevision: { label: 'Budget revisions', category: 'COST_REPORT' },
  costForecast: { label: 'Cost forecasts', category: 'COST_REPORT' },
  expense: { label: 'Expenses', category: 'COST_REPORT' },
  subcontract: { label: 'Subcontracts', category: 'ESTIMATION' },
  purchaseRequisition: { label: 'Purchase requisitions', category: 'OTHER' },
  importJob: { label: 'Excel imports', category: 'OTHER' },
  document: { label: 'Documents', category: 'DOCUMENTATION' },
  rfi: { label: 'RFIs', category: 'DOCUMENTATION' },
};
const ACTION_WORD: Record<string, string> = { CREATE: 'created', UPDATE: 'updated', SUBMIT: 'submitted', APPROVE: 'approved', IMPORT_COMMITTED: 'imported', EXPORT: 'exported', DELETE: 'deleted' };

/** What the user did in the app that day, grouped, as suggestions for the report. */
async function appActivity(orgId: string, userId: string, date: string) {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true } });
  const start = toDateOnly(date)!;
  const offset = tzOffsetMinutes(org.timezone, start);
  const from = new Date(start.getTime() - offset * 60000);
  const to = new Date(from.getTime() + 86_400_000);
  const events = await prisma.auditEvent.findMany({ where: { orgId, actorId: userId, createdAt: { gte: from, lt: to } }, select: { action: true, entityType: true, projectId: true, summary: true } });
  const projects = new Map((await prisma.project.findMany({ where: { orgId, id: { in: [...new Set(events.map((e) => e.projectId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const groups = new Map<string, { label: string; category: WorkCategory; projectId: string | null; projectName: string | null; count: number; examples: string[] }>();
  for (const e of events) {
    const meta = ACTIVITY[e.entityType];
    const word = ACTION_WORD[e.action];
    if (!meta || !word) continue;
    const key = `${e.entityType}|${e.action}|${e.projectId ?? ''}`;
    const g = groups.get(key) ?? { label: `${meta.label} ${word}`, category: meta.category, projectId: e.projectId, projectName: e.projectId ? (projects.get(e.projectId) ?? null) : null, count: 0, examples: [] };
    g.count++;
    if (e.summary && g.examples.length < 3) g.examples.push(e.summary.slice(0, 120));
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => ({ key, ...g }));
}

workReportsRouter.get('/categories', (_req, res) => res.json(WORK_CATEGORIES));

/** My report for a date, or a new one pre-filled with the previous report's plan. */
workReportsRouter.get('/me', async (req, res) => {
  const ctx = ctxOf(req);
  if (!can(ctx, 'workreport.submit')) throw forbidden('Daily work reports are for the office QS / estimation team');
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : isoDate(today())!;
  const report = await prisma.workReport.findUnique({ where: { userId_date: { userId: ctx.user.id, date: toDateOnly(date)! } }, include });
  const previous = await prisma.workReport.findFirst({ where: { userId: ctx.user.id, date: { lt: toDateOnly(date)! } }, orderBy: { date: 'desc' }, include });
  const plan = previous?.items.filter((i) => i.kind === 'PLAN') ?? [];
  res.json({ date, report, previous: previous ? { id: previous.id, date: isoDate(previous.date), plan, reviewComment: previous.reviewComment, reviewer: previous.reviewer } : null, activity: await appActivity(ctx.orgId, ctx.user.id, date) });
});

/** Saves my report (draft or submitted). A reviewed report is locked. */
workReportsRouter.put('/me', async (req, res) => {
  const ctx = ctxOf(req);
  if (!can(ctx, 'workreport.submit')) throw forbidden('Daily work reports are for the office QS / estimation team');
  const body = parseBody(saveSchema, req.body);
  const date = toDateOnly(body.date)!;
  if (date > addDays(today(), 1)) throw validationError('A work report cannot be written for a future date');
  const done = body.items.filter((i) => i.kind === 'DONE');
  const total = done.reduce((a, i) => a + (i.hours ?? 0), 0);
  if (total > 24) throw validationError(`Hours add up to ${total}, more than 24 in a day`);
  if (body.submit) {
    if (!done.length) throw validationError('Add at least one piece of work done today before submitting');
    const noHours = done.findIndex((i) => !i.hours);
    if (noHours >= 0) throw validationError(`Enter the hours for “${done[noHours].description.slice(0, 40)}”`);
  }
  const projectIds = [...new Set(body.items.map((i) => i.projectId).filter((x): x is string => !!x))];
  if (projectIds.length && (await prisma.project.count({ where: { orgId: ctx.orgId, id: { in: projectIds } } })) !== projectIds.length) throw validationError('Project not found');
  const saved = await transaction(async (tx) => {
    const existing = await tx.workReport.findUnique({ where: { userId_date: { userId: ctx.user.id, date } } });
    if (existing?.status === 'REVIEWED') throw conflict('This report has been reviewed and can no longer be changed');
    if (existing && body.expectedUpdatedAt && new Date(body.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) throw conflict('This report was changed elsewhere. Reload to see the latest version.');
    const items = body.items.map((i, n) => ({
      kind: i.kind,
      lineNo: n + 1,
      category: i.category,
      projectId: i.projectId ?? null,
      description: i.description,
      output: i.output || null,
      status: i.kind === 'PLAN' ? 'NOT_STARTED' : i.status,
      hours: i.kind === 'DONE' && i.hours ? String(i.hours) : null,
      targetDate: i.kind === 'PLAN' && i.targetDate ? toDateOnly(i.targetDate) : null,
      carriedFromId: i.carriedFromId ?? null,
    }));
    const status = body.submit ? 'SUBMITTED' : (existing?.status ?? 'DRAFT');
    const data = { summary: body.summary ?? null, totalHours: String(total), status, submittedAt: body.submit ? new Date() : (existing?.submittedAt ?? null) };
    const r = existing
      ? await tx.workReport.update({ where: { id: existing.id }, data: { ...data, items: { deleteMany: {}, create: items } } })
      : await tx.workReport.create({ data: { ...data, orgId: ctx.orgId, userId: ctx.user.id, date, items: { create: items } } });
    await audit(tx, ctx, { action: body.submit ? 'SUBMIT' : existing ? 'UPDATE' : 'CREATE', entityType: 'workReport', entityId: r.id, summary: `Daily work report ${body.date} ${body.submit ? 'submitted' : 'saved'} (${done.length} items, ${total} h)` });
    if (body.submit && existing?.status !== 'SUBMITTED') {
      const me = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { reportingManagerId: true, name: true } });
      const reviewers = await tx.user.findMany({ where: { orgId: ctx.orgId, status: 'ACTIVE', id: { not: ctx.user.id }, roles: { some: { projectId: null, role: { permissions: { some: { permissionCode: 'workreport.review' } } } } } }, select: { id: true } });
      await notify(tx, { userIds: [...reviewers.map((u) => u.id), me.reportingManagerId ?? ''], type: 'WORK_REPORT_SUBMITTED', title: `${me.name}: daily work report ${body.date}`, body: `${done.length} item(s), ${total} h. Plan for next day: ${items.filter((i) => i.kind === 'PLAN').length} item(s).`, link: `/work-reports/team?date=${body.date}&report=${r.id}`, entityType: 'workReport', entityId: r.id, dedupeKey: `wr-submit-${r.id}` });
    }
    return r;
  });
  res.json(await prisma.workReport.findUniqueOrThrow({ where: { id: saved.id }, include }));
});

/** Who has reported for a day (reviewers see everyone, managers their team). */
workReportsRouter.get('/team', async (req, res) => {
  const ctx = ctxOf(req);
  const vis = await visibleUserIds(ctx);
  if (vis !== 'ALL' && vis.size <= 1 && !can(ctx, 'workreport.review')) throw forbidden('Only reviewers and managers can see team reports');
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : isoDate(today())!;
  const members = (await teamMembers(ctx.orgId)).filter((u) => mayView(vis, u.id) && u.id !== (vis === 'ALL' ? '' : ctx.user.id));
  const reports = await prisma.workReport.findMany({ where: { orgId: ctx.orgId, date: toDateOnly(date)!, userId: { in: members.map((m) => m.id) } }, include });
  const previous = await prisma.workReport.findMany({ where: { orgId: ctx.orgId, userId: { in: members.map((m) => m.id) }, date: { lt: toDateOnly(date)! } }, orderBy: { date: 'desc' }, include: { items: { where: { kind: 'PLAN' }, select: { id: true } } } });
  const lastPlan = new Map<string, string[]>();
  for (const p of previous) if (!lastPlan.has(p.userId)) lastPlan.set(p.userId, p.items.map((i) => i.id));
  const rows = members.map((m) => {
    const r = reports.find((x) => x.userId === m.id) ?? null;
    const planIds = lastPlan.get(m.id) ?? [];
    const doneFromPlan = r ? r.items.filter((i) => i.kind === 'DONE' && i.status === 'DONE' && i.carriedFromId && planIds.includes(i.carriedFromId)).length : 0;
    return { user: m, report: r, planned: planIds.length, doneFromPlan, planCompletion: r ? planCompletion(planIds.length, doneFromPlan) : null };
  });
  res.json({ date, rows, canReview: can(ctx, 'workreport.review') });
});

workReportsRouter.get('/summary', async (req, res) => {
  const ctx = ctxOf(req);
  const vis = await visibleUserIds(ctx);
  const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : isoDate(addDays(today(), -6))!;
  const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : isoDate(today())!;
  const reports = await prisma.workReport.findMany({ where: { orgId: ctx.orgId, date: { gte: toDateOnly(from)!, lte: toDateOnly(to)! }, status: { in: ['SUBMITTED', 'REVIEWED'] } }, include, orderBy: [{ date: 'asc' }] });
  const visible = reports.filter((r) => mayView(vis, r.userId));
  const byUser = new Map<string, { user: (typeof visible)[number]['user']; days: number; hours: number; byCategory: Record<string, number>; byProject: Record<string, number>; items: number }>();
  for (const r of visible) {
    const u = byUser.get(r.userId) ?? { user: r.user, days: 0, hours: 0, byCategory: {}, byProject: {}, items: 0 };
    u.days++;
    for (const i of r.items.filter((x) => x.kind === 'DONE')) {
      const h = Number(i.hours ?? 0);
      u.hours += h;
      u.items++;
      u.byCategory[i.category] = (u.byCategory[i.category] ?? 0) + h;
      const pn = i.project?.name ?? 'Office / general';
      u.byProject[pn] = (u.byProject[pn] ?? 0) + h;
    }
    byUser.set(r.userId, u);
  }
  res.json({ from, to, users: [...byUser.values()].sort((a, b) => a.user.name.localeCompare(b.user.name)) });
});

workReportsRouter.get('/export', async (req, res) => {
  const ctx = ctxOf(req);
  const vis = await visibleUserIds(ctx);
  const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : isoDate(today())!;
  const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : from;
  const reports = (await prisma.workReport.findMany({ where: { orgId: ctx.orgId, date: { gte: toDateOnly(from)!, lte: toDateOnly(to)! } }, include, orderBy: [{ date: 'asc' }] })).filter((r) => mayView(vis, r.userId));
  const wb = new ExcelJS.Workbook();
  const head = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ header: 'Date', width: 12 }, { header: 'Name', width: 24 }, { header: 'Designation', width: 22 }, { header: 'Status', width: 12 }, { header: 'Hours', width: 8 }, { header: 'Work items', width: 10 }, { header: 'Plan items (next day)', width: 12 }, { header: 'Summary', width: 50 }, { header: 'Reviewer comment', width: 40 }];
  head(sum);
  for (const r of reports) sum.addRow([r.date, r.user.name, r.user.designation, r.status, Number(r.totalHours), r.items.filter((i) => i.kind === 'DONE').length, r.items.filter((i) => i.kind === 'PLAN').length, r.summary, r.reviewComment]).getCell(1).numFmt = 'dd-mmm-yyyy';
  const det = wb.addWorksheet('Work done');
  det.columns = [{ header: 'Date', width: 12 }, { header: 'Name', width: 22 }, { header: 'Type of work', width: 24 }, { header: 'Project', width: 24 }, { header: 'Work', width: 60 }, { header: 'Output', width: 24 }, { header: 'Status', width: 12 }, { header: 'Hours', width: 8 }];
  head(det);
  const plan = wb.addWorksheet('Next day plan');
  plan.columns = [{ header: 'Report date', width: 12 }, { header: 'Name', width: 22 }, { header: 'Type of work', width: 24 }, { header: 'Project', width: 24 }, { header: 'Planned work', width: 60 }, { header: 'Target', width: 24 }, { header: 'Due', width: 12 }];
  head(plan);
  for (const r of reports)
    for (const i of r.items) {
      const cat = WORK_CATEGORIES[i.category as WorkCategory] ?? i.category;
      if (i.kind === 'DONE') det.addRow([r.date, r.user.name, cat, i.project?.name ?? 'Office / general', i.description, i.output, i.status.replace('_', ' ').toLowerCase(), i.hours === null ? null : Number(i.hours)]).getCell(1).numFmt = 'dd-mmm-yyyy';
      else plan.addRow([r.date, r.user.name, cat, i.project?.name ?? 'Office / general', i.description, i.output, i.targetDate]).getCell(1).numFmt = 'dd-mmm-yyyy';
    }
  await audit(prisma, ctx, { action: 'EXPORT', entityType: 'workReport', entityId: null, summary: `Daily work reports exported (${from}${from === to ? '' : ` to ${to}`})` });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Daily_Work_Report_${from}${from === to ? '' : `_to_${to}`}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

workReportsRouter.get('/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const r = await prisma.workReport.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId }, include });
  if (!r || !mayView(await visibleUserIds(ctx), r.userId)) throw notFound('Work report');
  res.json({ ...r, canReview: r.userId !== ctx.user.id && (await isReviewer(ctx, r.userId)) });
});

/** A reviewer or the author's manager comments and/or marks the report reviewed. */
workReportsRouter.post('/:id/review', async (req, res) => {
  const ctx = ctxOf(req);
  const { comment, markReviewed } = parseBody(z.object({ comment: z.string().trim().max(2000).optional(), markReviewed: z.boolean().default(true) }), req.body);
  const r = await prisma.workReport.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId } });
  if (!r) throw notFound('Work report');
  if (r.userId === ctx.user.id) throw forbidden('You cannot review your own report');
  if (!(await isReviewer(ctx, r.userId))) throw forbidden('Only reviewers or the author’s manager can review this report');
  if (r.status === 'DRAFT') throw conflict('The report has not been submitted yet');
  if (!comment && !markReviewed) throw validationError('Write a comment or mark the report reviewed');
  const u = await transaction(async (tx) => {
    const out = await tx.workReport.update({ where: { id: r.id }, data: { reviewComment: comment ?? r.reviewComment, ...(markReviewed ? { status: 'REVIEWED', reviewedById: ctx.user.id, reviewedAt: new Date() } : {}) }, include });
    await audit(tx, ctx, { action: 'REVIEW', entityType: 'workReport', entityId: r.id, summary: `Daily work report ${isoDate(r.date)} of ${out.user.name} ${markReviewed ? 'reviewed' : 'commented'}`, reason: comment ?? null });
    await notify(tx, { userIds: [r.userId], type: 'WORK_REPORT_REVIEWED', title: `Your work report for ${isoDate(r.date)} was ${markReviewed ? 'reviewed' : 'commented on'}`, body: comment ?? undefined, link: `/work-reports?date=${isoDate(r.date)}`, entityType: 'workReport', entityId: r.id });
    return out;
  });
  res.json(u);
});
