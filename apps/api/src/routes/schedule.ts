import { Router } from 'express';
import { z } from 'zod';
import { computeCpm, fromDayNumber, ScheduleCycleError, toDayNumber, topologicalOrder, type CpmDependency } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { isoDate, today } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess } from '../services/access.js';
import { audit } from '../services/audit.js';

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
