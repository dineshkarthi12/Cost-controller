import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { computeCpm, fromDayNumber, ScheduleCycleError, toDayNumber, topologicalOrder, type CpmDependency } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { isoDate, today } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';
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
  const out = computeCpm(
    acts.map((a) => ({ id: a.id, code: a.code, plannedStart: day(a.plannedStart), plannedFinish: day(a.plannedFinish), actualStart: day(a.actualStart), actualFinish: day(a.actualFinish), percentComplete: Number(a.percentComplete), isMilestone: a.isMilestone })),
    deps.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId, type: d.type as CpmDependency['type'], lagDays: d.lagDays })),
    asOf,
  );
  const meta = new Map(acts.map((a) => [a.id, a]));
  const plannedFinish = Math.max(...acts.filter((a) => a.plannedFinish).map((a) => toDayNumber(a.plannedFinish!)));
  res.json({
    asOf: fromDayNumber(asOf),
    dependencies: deps.length,
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
      };
    }),
  });
});

// ───────── Import from MS Project XML / Primavera XER ─────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

/** Step 1: parse the file and show what would change. Nothing is written to activities. */
scheduleRouter.post('/import/preview', upload.single('file'), async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'progress.manage', projectId);
  if (!req.file) throw validationError('Choose a .xml (MS Project) or .xer (Primavera) file');
  let parsed: ParsedSchedule;
  try {
    parsed = parseScheduleFile(req.file.originalname, req.file.buffer);
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
    const idByKey = new Map<string, string>();
    let created = 0;
    let updated = 0;
    for (const [i, a] of data.activities.entries()) {
      const progress = includeProgress
        ? { actualStart: d(a.actualStart), actualFinish: d(a.actualFinish), percentComplete: String(a.percentComplete), status: a.actualFinish ? 'COMPLETED' : a.actualStart ? 'IN_PROGRESS' : 'NOT_STARTED' }
        : {};
      const plan = { name: a.name, plannedStart: d(a.plannedStart), plannedFinish: d(a.plannedFinish), isMilestone: a.isMilestone, sortOrder: i + 1 };
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
