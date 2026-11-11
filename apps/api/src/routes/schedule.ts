import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { computeCpmOnCalendar, D, fromDayNumber, isValidWorkWeek, ScheduleCycleError, toDayNumber, topologicalOrder, WorkCalendar, type CpmDependency } from '@toprock/shared';
import type { Db } from '../lib/prisma.js';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { isoDate, today } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';
import { scheduleTemplate } from '../services/scheduleExcel.js';
import { parseScheduleFile, type ImportedActivity, type ImportedDependency, type ParsedSchedule } from '../services/scheduleImport.js';

export const scheduleRouter = Router({ mergeParams: true });

scheduleRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

const day = (d: Date | null) => (d ? toDayNumber(d) : null);

scheduleRouter.get('/dependencies', async (req, res) => {
  const projectId = param(req, 'projectId');
  assertCan(ctxOf(req), 'progress.view', projectId);
  const deps = await prisma.activityDependency.findMany({
    where: { successor: { projectId } },
    include: { predecessor: { select: { id: true, code: true, name: true } }, successor: { select: { id: true, code: true, name: true } } },
  });
  res.json(deps);
});

const depSchema = z.object({ predecessorId: z.string(), successorId: z.string(), type: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'), lagDays: z.coerce.number().int().min(-365).max(365).default(0) });

scheduleRouter.post('/dependencies', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'progress.manage', projectId);
  const data = parseBody(depSchema, req.body);
  if (data.predecessorId === data.successorId) throw validationError('An activity cannot depend on itself');
  const out = await transaction(async (tx) => {
    const acts = await tx.activity.findMany({ where: { projectId }, select: { id: true, code: true } });
    const codes = new Map(acts.map((a) => [a.id, a.code]));
    if (!codes.has(data.predecessorId) || !codes.has(data.successorId)) throw validationError('Both activities must belong to this project');
    const existing = await tx.activityDependency.findMany({ where: { successor: { projectId } } });
    if (existing.some((d) => d.predecessorId === data.predecessorId && d.successorId === data.successorId)) throw conflict('This dependency already exists');
    try {
      topologicalOrder([...codes.keys()], [...existing, data] as CpmDependency[], (id) => codes.get(id)!);
    } catch (e) {
      if (e instanceof ScheduleCycleError) throw validationError(`This would create a loop: ${e.codes.join(' → ')}`);
      throw e;
    }
    const dep = await tx.activityDependency.create({ data });
    await audit(tx, ctx, { action: 'DEPENDENCY_ADDED', entityType: 'activity', entityId: data.successorId, projectId, summary: `${codes.get(data.predecessorId)} → ${codes.get(data.successorId)} (${data.type}${data.lagDays ? ` ${data.lagDays > 0 ? '+' : ''}${data.lagDays}d` : ''})` });
    return dep;
  });
  res.status(201).json(out);
});

scheduleRouter.delete('/dependencies/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'progress.manage', projectId);
  const dep = await prisma.activityDependency.findFirst({ where: { id: param(req, 'id'), successor: { projectId } }, include: { predecessor: { select: { code: true } }, successor: { select: { code: true } } } });
  if (!dep) throw notFound('Dependency');
  await prisma.activityDependency.delete({ where: { id: dep.id } });
  await audit(prisma, ctx, { action: 'DEPENDENCY_REMOVED', entityType: 'activity', entityId: dep.successorId, projectId, summary: `${dep.predecessor.code} → ${dep.successor.code} removed` });
  res.json({ ok: true });
});

/** The project's working calendar (work week and holidays). */
export async function projectCalendar(db: Db, projectId: string) {
  const [p, hols] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: projectId }, select: { workWeek: true } }),
    db.projectHoliday.findMany({ where: { projectId }, orderBy: { date: 'asc' }, select: { date: true, name: true } }),
  ]);
  return { workWeek: p.workWeek, holidays: hols.map((h) => ({ date: isoDate(h.date)!, name: h.name })), calendar: new WorkCalendar(p.workWeek, hols.map((h) => h.date)) };
}

scheduleRouter.get('/calendar', async (req, res) => {
  const projectId = param(req, 'projectId');
  assertCan(ctxOf(req), 'progress.view', projectId);
  const { workWeek, holidays } = await projectCalendar(prisma, projectId);
  res.json({ workWeek, holidays });
});

const calendarSchema = z.object({
  workWeek: z.string().refine(isValidWorkWeek, 'Choose at least one working day'),
  holidays: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(1, 'Name the holiday').max(80) })).max(400),
});

/** Saves the work week and the holiday list (replacing the list). Forecast dates and floats then count working days only. */
scheduleRouter.put('/calendar', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'progress.manage', projectId);
  const body = parseBody(calendarSchema, req.body);
  const dates = body.holidays.map((h) => h.date);
  if (new Set(dates).size !== dates.length) throw validationError('The same date is listed twice');
  await transaction(async (tx) => {
    const before = await projectCalendar(tx, projectId);
    await tx.project.update({ where: { id: projectId }, data: { workWeek: body.workWeek } });
    await tx.projectHoliday.deleteMany({ where: { projectId } });
    if (body.holidays.length) await tx.projectHoliday.createMany({ data: body.holidays.map((h) => ({ projectId, date: new Date(`${h.date}T00:00:00Z`), name: h.name })) });
    await audit(tx, ctx, { action: 'UPDATE', entityType: 'project', entityId: projectId, projectId, summary: `Schedule calendar: work week ${body.workWeek}, ${body.holidays.length} holiday(s)`, before: { workWeek: before.workWeek, holidays: before.holidays }, after: body });
  });
  res.json(body);
});

/** Critical path forecast as of today (or ?asOf=YYYY-MM-DD). */
scheduleRouter.get('/cpm', async (req, res) => {
  const projectId = param(req, 'projectId');
  assertCan(ctxOf(req), 'progress.view', projectId);
  const asOf = typeof req.query.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? toDayNumber(req.query.asOf) : toDayNumber(today());
  const [acts, deps] = await Promise.all([
    prisma.activity.findMany({ where: { projectId }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
    prisma.activityDependency.findMany({ where: { successor: { projectId } } }),
  ]);
  if (!acts.length) return res.json({ asOf: fromDayNumber(asOf), activities: [], criticalPath: [], dependencies: 0, skipped: [] });
  const { workWeek, holidays, calendar } = await projectCalendar(prisma, projectId);
  const out = computeCpmOnCalendar(
    acts.map((a) => ({ id: a.id, code: a.code, plannedStart: day(a.plannedStart), plannedFinish: day(a.plannedFinish), actualStart: day(a.actualStart), actualFinish: day(a.actualFinish), percentComplete: Number(a.percentComplete), isMilestone: a.isMilestone })),
    deps.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId, type: d.type as CpmDependency['type'], lagDays: d.lagDays })),
    asOf,
    calendar,
  );
  const meta = new Map(acts.map((a) => [a.id, a]));
  const plannedFinish = Math.max(...acts.filter((a) => a.plannedFinish).map((a) => toDayNumber(a.plannedFinish!)));
  const baselineFinish = Math.max(...acts.filter((a) => a.baselineFinish).map((a) => toDayNumber(a.baselineFinish!)));
  res.json({
    asOf: fromDayNumber(asOf),
    dependencies: deps.length,
    calendar: { workWeek, holidays: holidays.length, unit: calendar.isSevenDay ? 'calendar days' : 'working days' },
    baselineFinish: Number.isFinite(baselineFinish) ? fromDayNumber(baselineFinish) : null,
    /** Calendar days the forecast finish is after (+) or before (−) the baseline finish. */
    slipVsBaselineDays: Number.isFinite(baselineFinish) ? out.projectFinish - baselineFinish : null,
    projectStart: fromDayNumber(out.projectStart),
    forecastFinish: fromDayNumber(out.projectFinish),
    plannedFinish: Number.isFinite(plannedFinish) ? fromDayNumber(plannedFinish) : null,
    slipDays: Number.isFinite(plannedFinish) ? out.projectFinish - plannedFinish : null,
    criticalPath: out.criticalPath.map((id) => meta.get(id)!.code),
    skipped: out.skipped.map((id) => meta.get(id)!.code),
    activities: out.activities.map((r) => {
      const a = meta.get(r.id)!;
      return {
        id: r.id,
        code: r.code,
        name: a.name,
        status: r.status,
        isMilestone: a.isMilestone,
        duration: r.duration,
        plannedStart: isoDate(a.plannedStart),
        plannedFinish: isoDate(a.plannedFinish),
        earlyStart: fromDayNumber(r.earlyStart),
        earlyFinish: fromDayNumber(r.earlyFinish),
        lateStart: fromDayNumber(r.lateStart),
        lateFinish: fromDayNumber(r.lateFinish),
        totalFloat: r.totalFloat,
        freeFloat: r.freeFloat,
        critical: r.critical,
        finishVarianceDays: a.plannedFinish ? r.earlyFinish - toDayNumber(a.plannedFinish) : null,
        baselineStart: isoDate(a.baselineStart),
        baselineFinish: isoDate(a.baselineFinish),
        baselineVarianceDays: a.baselineFinish ? r.earlyFinish - toDayNumber(a.baselineFinish) : null,
      };
    }),
  });
});

// ───────── Import from MS Project XML / Primavera XER ─────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

/** Excel template for schedules kept in Excel. */
scheduleRouter.get('/import/template', async (req, res) => {
  assertCan(ctxOf(req), 'progress.view', param(req, 'projectId'));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="schedule-template.xlsx"');
  res.send(await scheduleTemplate());
});

/** Step 1: parse the file and show what would change. Nothing is written to activities. */
scheduleRouter.post('/import/preview', upload.single('file'), async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'progress.manage', projectId);
  if (!req.file) throw validationError('Choose an Excel (.xlsx), MS Project (.xml) or Primavera (.xer) file');
  let parsed: ParsedSchedule;
  try {
    parsed = await parseScheduleFile(req.file.originalname, req.file.buffer, (await projectCalendar(prisma, projectId)).calendar);
  } catch (e) {
    throw validationError((e as Error).message);
  }
  if (!parsed.activities.length) throw validationError('No activities found in the file');
  const existing = new Set((await prisma.activity.findMany({ where: { projectId }, select: { code: true } })).map((a) => a.code));
  const rows = parsed.activities.map((a) => ({ ...a, exists: existing.has(a.code) }));
  const summary = { format: parsed.format, projectName: parsed.projectName, activities: rows.length, newActivities: rows.filter((r) => !r.exists).length, updatedActivities: rows.filter((r) => r.exists).length, dependencies: parsed.dependencies.length, warnings: parsed.warnings };
  const job = await prisma.importJob.create({ data: { orgId: ctx.orgId, projectId, kind: 'SCHEDULE', fileName: req.file.originalname.slice(0, 200), rows: { activities: rows, dependencies: parsed.dependencies } as never, summary, createdById: ctx.user.id } });
  res.status(201).json({ id: job.id, summary, activities: rows.slice(0, 500), dependencies: parsed.dependencies.length });
});

/** Step 2: create or update activities by code and replace the links between imported activities. */
scheduleRouter.post('/import/:id/commit', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'progress.manage', projectId);
  const { includeProgress } = parseBody(z.object({ includeProgress: z.boolean().default(true) }), req.body);
  const job = await prisma.importJob.findFirst({ where: { id: param(req, 'id'), projectId, kind: 'SCHEDULE' } });
  if (!job) throw notFound('Import');
  if (job.status !== 'PREVIEW') throw conflict('This import has already been processed');
  const data = job.rows as unknown as { activities: Array<ImportedActivity & { exists: boolean }>; dependencies: ImportedDependency[] };
  const d = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null);
  const out = await transaction(async (tx) => {
    const current = new Map((await tx.activity.findMany({ where: { projectId }, select: { id: true, code: true, baselineStart: true } })).map((a) => [a.code, a]));
    // WBS given in the file (MS Project WBS, P6 WBS, Excel WBS / section) is linked when it matches a WBS code or name of the project.
    const wbs = new Map<string, string>();
    for (const n of await tx.wbsNode.findMany({ where: { projectId }, select: { id: true, code: true, name: true } })) {
      wbs.set(n.name.toLowerCase(), n.id);
      wbs.set(n.code.toLowerCase(), n.id);
    }
    const idByKey = new Map<string, string>();
    let created = 0;
    let updated = 0;
    for (const [i, a] of data.activities.entries()) {
      const progress = includeProgress
        ? { actualStart: d(a.actualStart), actualFinish: d(a.actualFinish), percentComplete: String(a.percentComplete), status: a.actualFinish ? 'COMPLETED' : a.actualStart ? 'IN_PROGRESS' : 'NOT_STARTED' }
        : {};
      const wbsNodeId = a.wbs ? (wbs.get(a.wbs.toLowerCase()) ?? null) : null;
      const plan = {
        name: a.name,
        plannedStart: d(a.plannedStart),
        plannedFinish: d(a.plannedFinish),
        isMilestone: a.isMilestone,
        sortOrder: i + 1,
        ...(wbsNodeId ? { wbsNodeId } : {}),
        ...(a.unit ? { unit: a.unit } : {}),
        ...(a.plannedQty ? { plannedQty: a.plannedQty } : {}),
        ...(a.weight ? { weight: a.weight } : {}),
      };
      const found = current.get(a.code);
      if (found) {
        await tx.activity.update({ where: { id: found.id }, data: { ...plan, ...progress, ...(found.baselineStart ? {} : { baselineStart: plan.plannedStart, baselineFinish: plan.plannedFinish }) } });
        idByKey.set(a.key, found.id);
        updated++;
      } else {
        const act = await tx.activity.create({ data: { projectId, code: a.code, ...plan, baselineStart: plan.plannedStart, baselineFinish: plan.plannedFinish, ...progress } });
        idByKey.set(a.key, act.id);
        created++;
      }
    }
    const importedIds = [...idByKey.values()];
    await tx.activityDependency.deleteMany({ where: { predecessorId: { in: importedIds }, successorId: { in: importedIds } } });
    const links = new Map<string, { predecessorId: string; successorId: string; type: string; lagDays: number }>();
    for (const l of data.dependencies) {
      const p = idByKey.get(l.predecessorKey);
      const s = idByKey.get(l.successorKey);
      if (p && s && p !== s) links.set(`${p}>${s}`, { predecessorId: p, successorId: s, type: l.type, lagDays: l.lagDays });
    }
    if (links.size) await tx.activityDependency.createMany({ data: [...links.values()] });
    // The combined logic (imported + existing links) must still be loop-free.
    const all = await tx.activity.findMany({ where: { projectId }, select: { id: true, code: true } });
    const codes = new Map(all.map((a) => [a.id, a.code]));
    const deps = await tx.activityDependency.findMany({ where: { successor: { projectId } } });
    try {
      topologicalOrder([...codes.keys()], deps as CpmDependency[], (id) => codes.get(id)!);
    } catch (e) {
      if (e instanceof ScheduleCycleError) throw validationError(`The imported logic creates a loop: ${e.codes.join(' → ')}`);
      throw e;
    }
    await tx.importJob.update({ where: { id: job.id }, data: { status: 'COMMITTED', committedAt: new Date(), summary: { ...(job.summary as object), created, updated, linked: links.size, includeProgress } } });
    await audit(tx, ctx, { action: 'SCHEDULE_IMPORTED', entityType: 'importJob', entityId: job.id, projectId, summary: `${job.fileName}: ${created} activities created, ${updated} updated, ${links.size} dependencies${includeProgress ? ' (with progress)' : ''}` });
    return { created, updated, dependencies: links.size };
  });
  res.json(out);
});

// ───────── Baseline ─────────

/**
 * Saves the current plan as the baseline: planned start / finish are copied to baseline start / finish.
 * Activities that already have a baseline keep it unless the user asks to replace it (re-baselining).
 */
scheduleRouter.post('/baseline', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'progress.manage', projectId);
  const { replace } = parseBody(z.object({ replace: z.boolean().default(false) }), req.body ?? {});
  const out = await transaction(async (tx) => {
    const acts = await tx.activity.findMany({ where: { projectId }, select: { id: true, plannedStart: true, plannedFinish: true, baselineStart: true, baselineFinish: true } });
    let saved = 0;
    let kept = 0;
    let undated = 0;
    for (const a of acts) {
      if (!a.plannedStart || !a.plannedFinish) {
        undated++;
        continue;
      }
      if ((a.baselineStart || a.baselineFinish) && !replace) {
        kept++;
        continue;
      }
      await tx.activity.update({ where: { id: a.id }, data: { baselineStart: a.plannedStart, baselineFinish: a.plannedFinish } });
      saved++;
    }
    if (saved) await audit(tx, ctx, { action: 'SCHEDULE_BASELINED', entityType: 'project', entityId: projectId, projectId, summary: `Schedule baseline saved for ${saved} activit${saved === 1 ? 'y' : 'ies'}${replace ? ' (existing baselines replaced)' : ''}${kept ? `, ${kept} kept their baseline` : ''}` });
    return { saved, kept, undated, total: acts.length };
  });
  res.json(out);
});

/** How many activities have a baseline, and whether the plan has moved since. */
scheduleRouter.get('/baseline', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'progress.view', projectId);
  const acts = await prisma.activity.findMany({ where: { projectId }, select: { plannedStart: true, plannedFinish: true, baselineStart: true, baselineFinish: true } });
  const same = (x: Date | null, y: Date | null) => (x?.getTime() ?? null) === (y?.getTime() ?? null);
  const last = await prisma.auditEvent.findFirst({ where: { projectId, action: 'SCHEDULE_BASELINED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  res.json({
    total: acts.length,
    dated: acts.filter((a) => a.plannedStart && a.plannedFinish).length,
    withBaseline: acts.filter((a) => a.baselineStart || a.baselineFinish).length,
    changedSinceBaseline: acts.filter((a) => (a.baselineStart || a.baselineFinish) && (!same(a.plannedStart, a.baselineStart) || !same(a.plannedFinish, a.baselineFinish))).length,
    lastSavedAt: last?.createdAt ?? null,
  });
});

// ───────── Activities from BOQ items ─────────

/** BOQ items of the project with whether an activity already covers them. */
scheduleRouter.get('/from-boq', async (req, res) => {
  const projectId = param(req, 'projectId');
  assertCan(ctxOf(req), 'progress.view', projectId);
  const [items, linked] = await Promise.all([
    prisma.boqItem.findMany({ where: { projectId }, orderBy: { itemCode: 'asc' }, select: { id: true, itemCode: true, description: true, section: true, unit: true, contractQty: true, revisedQty: true, unitRate: true, revisedRate: true } }),
    prisma.activity.findMany({ where: { projectId, boqItemId: { not: null } }, select: { code: true, boqItemId: true } }),
  ]);
  const by = new Map<string, string[]>();
  for (const a of linked) by.set(a.boqItemId!, [...(by.get(a.boqItemId!) ?? []), a.code]);
  res.json(
    items.map((i) => {
      const qty = i.revisedQty ?? i.contractQty;
      const rate = i.revisedRate ?? i.unitRate;
      return { id: i.id, itemCode: i.itemCode, description: i.description, section: i.section, unit: i.unit, qty: qty.toString(), amount: D(qty).times(D(rate)).toFixed(2), activities: by.get(i.id) ?? [] };
    }),
  );
});

const fromBoqSchema = z.object({
  boqItemIds: z.array(z.string().min(1)).min(1, 'Choose at least one BOQ item').max(2000),
  /** AMOUNT: weight = BOQ amount in lakhs (physical progress follows value); EQUAL: weight 1 each. */
  weightBy: z.enum(['AMOUNT', 'EQUAL']).default('AMOUNT'),
});

/**
 * One activity per chosen BOQ item, linked to it, with its unit, quantity, cost code and WBS. Progress
 * entered on the activity then moves the BOQ executed quantity. Dates and links are added afterwards
 * (by hand or with the Excel import, matched by activity code).
 */
scheduleRouter.post('/from-boq', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'progress.manage', projectId);
  const { boqItemIds, weightBy } = parseBody(fromBoqSchema, req.body);
  const out = await transaction(async (tx) => {
    const items = await tx.boqItem.findMany({ where: { projectId, id: { in: boqItemIds } }, orderBy: { itemCode: 'asc' } });
    if (items.length !== new Set(boqItemIds).size) throw validationError('Some BOQ items are not in this project');
    const existing = await tx.activity.findMany({ where: { projectId }, select: { code: true, boqItemId: true, sortOrder: true } });
    const codes = new Set(existing.map((a) => a.code.toLowerCase()));
    const covered = new Set(existing.map((a) => a.boqItemId).filter(Boolean));
    let order = Math.max(0, ...existing.map((a) => a.sortOrder));
    const created: string[] = [];
    const skipped: string[] = [];
    for (const i of items) {
      if (covered.has(i.id)) {
        skipped.push(i.itemCode);
        continue;
      }
      // BOQ codes that are only numbers (3.01) get "B-" so activity IDs read clearly; codes with letters (B-402) are used as they are.
      const base = /^\d/.test(i.itemCode.trim()) ? `B-${i.itemCode.trim()}` : i.itemCode.trim();
      let code = base.replace(/\s+/g, '-').slice(0, 40);
      for (let n = 2; codes.has(code.toLowerCase()); n++) code = `${base}-${n}`.replace(/\s+/g, '-').slice(0, 40);
      codes.add(code.toLowerCase());
      const qty = i.revisedQty ?? i.contractQty;
      const amount = D(qty).times(D(i.revisedRate ?? i.unitRate));
      const weight = weightBy === 'AMOUNT' ? amount.div(100000).toDecimalPlaces(2) : D(1);
      await tx.activity.create({
        data: {
          projectId,
          code,
          name: i.description.replace(/\s+/g, ' ').trim().slice(0, 300),
          boqItemId: i.id,
          costCodeId: i.costCodeId,
          wbsNodeId: i.wbsNodeId,
          unit: i.unit,
          plannedQty: qty,
          weight: weight.lt(0.01) ? '0.01' : weight.toString(),
          sortOrder: ++order,
        },
      });
      created.push(code);
    }
    if (created.length) await audit(tx, ctx, { action: 'CREATE', entityType: 'activity', projectId, summary: `${created.length} activit${created.length === 1 ? 'y' : 'ies'} created from BOQ items (weight by ${weightBy === 'AMOUNT' ? 'BOQ amount' : 'equal'})` });
    return { created: created.length, codes: created, skipped };
  });
  res.status(201).json(out);
});
