import { Router } from 'express';
import { z } from 'zod';
import { RESOURCES } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { businessRule, conflict, notFound, validationError } from '../lib/errors.js';
import { addDays, today } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { accessibleProjectIds, assertCan, assertProjectAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notifications.js';
import { createResource } from '../resources/router.js';
import { assertRefsInScope } from '../services/lookups.js';

export const myTasksRouter = Router();
export const projectTasksRouter = Router({ mergeParams: true });

/** Tasks owned by / contributed to / reviewed by the current user across accessible projects. */
myTasksRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  const ids = await accessibleProjectIds(prisma, ctx);
  const open = req.query.includeDone === 'true' ? {} : { status: { notIn: ['COMPLETED', 'CANCELLED'] } };
  const tasks = await prisma.task.findMany({
    where: { projectId: { in: ids }, ...open, OR: [{ ownerId: ctx.user.id }, { reviewerId: ctx.user.id }, { approverId: ctx.user.id }, { contributors: { some: { userId: ctx.user.id } } }] },
    orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
    include: { project: { select: { code: true, name: true } }, owner: { select: { name: true } } },
    take: 300,
  });
  res.json(tasks.map((t) => ({ ...t, role: t.ownerId === ctx.user.id ? 'OWNER' : t.reviewerId === ctx.user.id ? 'REVIEWER' : t.approverId === ctx.user.id ? 'APPROVER' : 'CONTRIBUTOR', overdue: !!t.dueDate && t.dueDate < today() && !['COMPLETED', 'CANCELLED'].includes(t.status) })));
});

projectTasksRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

projectTasksRouter.get('/board', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'task.view', projectId);
  const tasks = await prisma.task.findMany({
    where: { projectId, ...(typeof req.query.ownerId === 'string' ? { ownerId: req.query.ownerId } : {}), ...(req.query.includeDone === 'true' ? {} : { OR: [{ status: { notIn: ['COMPLETED', 'CANCELLED'] } }, { completedAt: { gte: addDays(today(), -14) } }] }) },
    include: { owner: { select: { id: true, name: true } }, contributors: true, dependencies: { include: { dependsOn: { select: { id: true, number: true, status: true } } } } },
    orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
    take: 500,
  });
  res.json(tasks.map((t) => ({ ...t, overdue: !!t.dueDate && t.dueDate < today() && !['COMPLETED', 'CANCELLED'].includes(t.status), blockedBy: t.dependencies.filter((d) => !['COMPLETED', 'CANCELLED'].includes(d.dependsOn.status)).map((d) => d.dependsOn.number) })));
});

projectTasksRouter.post('/:id/contributors', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'task.manage', projectId);
  const { userIds } = parseBody(z.object({ userIds: z.array(z.string()).max(20) }), req.body);
  await transaction(async (tx) => {
    const t = await tx.task.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!t) throw notFound('Task');
    await assertRefsInScope(tx, 'users', ctx.orgId, null, userIds, 'Contributor');
    await tx.taskContributor.deleteMany({ where: { taskId: t.id } });
    if (userIds.length) await tx.taskContributor.createMany({ data: userIds.map((userId) => ({ taskId: t.id, userId })) });
    await audit(tx, ctx, { action: 'TASK_CONTRIBUTORS', entityType: 'task', entityId: t.id, projectId, after: { userIds } });
  });
  res.json({ ok: true });
});

projectTasksRouter.post('/:id/dependencies', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'task.manage', projectId);
  const { dependsOnIds } = parseBody(z.object({ dependsOnIds: z.array(z.string()).max(20) }), req.body);
  await transaction(async (tx) => {
    const t = await tx.task.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!t) throw notFound('Task');
    if (dependsOnIds.includes(t.id)) throw validationError('A task cannot depend on itself');
    const deps = await tx.task.findMany({ where: { id: { in: dependsOnIds }, projectId } });
    if (deps.length !== dependsOnIds.length) throw validationError('Dependency not found in this project');
    // prevent simple cycles
    const reverse = await tx.taskDependency.findFirst({ where: { taskId: { in: dependsOnIds }, dependsOnId: t.id } });
    if (reverse) throw businessRule('This would create a circular dependency');
    await tx.taskDependency.deleteMany({ where: { taskId: t.id } });
    if (dependsOnIds.length) await tx.taskDependency.createMany({ data: dependsOnIds.map((d) => ({ taskId: t.id, dependsOnId: d })) });
    await audit(tx, ctx, { action: 'TASK_DEPENDENCIES', entityType: 'task', entityId: t.id, projectId, after: { dependsOnIds } });
  });
  res.json({ ok: true });
});

/** Hands a task over to another owner with notes (history kept). */
projectTasksRouter.post('/:id/handover', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'task.manage', projectId);
  const { toUserId, notes } = parseBody(z.object({ toUserId: z.string(), notes: z.string().trim().min(3).max(2000) }), req.body);
  const out = await transaction(async (tx) => {
    const t = await tx.task.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!t) throw notFound('Task');
    if (t.ownerId === toUserId) throw conflict('Task already belongs to this user');
    await assertRefsInScope(tx, 'users', ctx.orgId, null, [toUserId], 'New owner');
    await tx.taskHandover.create({ data: { taskId: t.id, fromUserId: t.ownerId, toUserId, notes, createdById: ctx.user.id } });
    const u = await tx.task.update({ where: { id: t.id }, data: { ownerId: toUserId, handoverNotes: notes, status: t.status === 'BACKLOG' ? 'ASSIGNED' : t.status } });
    await audit(tx, ctx, { action: 'TASK_HANDOVER', entityType: 'task', entityId: t.id, projectId, summary: `${t.number} handed over`, reason: notes });
    await notify(tx, { userIds: [toUserId], type: 'TASK_ASSIGNED', title: `Task handed over to you: ${t.title}`, body: notes, link: `/tasks/${t.id}`, projectId, entityType: 'task', entityId: t.id });
    return u;
  });
  res.json(out);
});

projectTasksRouter.get('/workload', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'team.view', projectId);
  const members = await prisma.projectMember.findMany({ where: { projectId, isActive: true }, include: { user: { select: { id: true, name: true, designation: true, backupUserId: true } } } });
  const d = today();
  const rows = await Promise.all(
    members.map(async (m) => {
      const base = { projectId, ownerId: m.userId };
      const [open, overdue, inReview, blocked, completed30, est] = await Promise.all([
        prisma.task.count({ where: { ...base, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
        prisma.task.count({ where: { ...base, status: { notIn: ['COMPLETED', 'CANCELLED'] }, dueDate: { lt: d } } }),
        prisma.task.count({ where: { projectId, reviewerId: m.userId, status: 'IN_REVIEW' } }),
        prisma.task.count({ where: { ...base, status: 'BLOCKED' } }),
        prisma.task.count({ where: { ...base, status: 'COMPLETED', completedAt: { gte: addDays(d, -30) } } }),
        prisma.task.aggregate({ where: { ...base, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, _sum: { estimatedHours: true } }),
      ]);
      return { userId: m.userId, name: m.user.name, designation: m.user.designation, projectRole: m.projectRole, open, overdue, reviewBacklog: inReview, blocked, completedLast30: completed30, openEffortHours: est._sum.estimatedHours ?? '0' };
    }),
  );
  res.json(rows);
});

/** Generates the next occurrence of recurring tasks that were completed. */
export async function generateRecurringTasks() {
  const done = await prisma.task.findMany({ where: { recurrence: { not: null }, status: 'COMPLETED' } });
  let created = 0;
  for (const t of done) {
    const exists = await prisma.task.count({ where: { recurrenceParentId: t.id } });
    if (exists) continue;
    const step = t.recurrence === 'DAILY' ? 1 : t.recurrence === 'WEEKLY' ? 7 : 30;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: t.projectId } });
    const creator = await prisma.user.findUnique({ where: { id: t.createdById } });
    if (!creator) continue;
    const ctx = { user: { id: creator.id, name: creator.name, email: creator.email, orgId: project.orgId }, orgId: project.orgId, orgPermissions: new Set(['task.manage']), projectPermissions: new Map(), projectRoleCodes: new Map(), orgRoleCodes: [], memberProjectIds: new Set([t.projectId]), allProjects: false, sessionId: 'system' };
    const next = await createResource(ctx, RESOURCES.tasks, { orgId: project.orgId, projectId: t.projectId }, {
      title: t.title,
      description: t.description ?? undefined,
      category: t.category,
      ownerId: t.ownerId ?? undefined,
      reviewerId: t.reviewerId ?? undefined,
      approverId: t.approverId ?? undefined,
      priority: t.priority,
      dueDate: t.dueDate ? addDays(t.dueDate, step).toISOString().slice(0, 10) : undefined,
      startDate: t.startDate ? addDays(t.startDate, step).toISOString().slice(0, 10) : undefined,
      recurrence: t.recurrence ?? undefined,
      estimatedHours: t.estimatedHours?.toString(),
      slaHours: t.slaHours ?? undefined,
    });
    await prisma.task.update({ where: { id: next.id }, data: { recurrenceParentId: t.id } });
    created++;
  }
  return created;
}

/** Notifies owners of overdue / due-soon tasks (one alert per task per day). */
export async function taskAlerts() {
  const d = today();
  const tasks = await prisma.task.findMany({ where: { status: { notIn: ['COMPLETED', 'CANCELLED'] }, ownerId: { not: null }, dueDate: { lte: addDays(d, 1) } } });
  for (const t of tasks) {
    const overdue = t.dueDate! < d;
    await notify(prisma, { userIds: [t.ownerId!], type: overdue ? 'TASK_OVERDUE' : 'TASK_DUE_SOON', title: `${overdue ? 'Overdue' : 'Due soon'}: ${t.title}`, link: `/tasks/${t.id}`, projectId: t.projectId, entityType: 'task', entityId: t.id, dedupeKey: `task:${t.id}:${overdue ? 'overdue' : 'due'}:${d.toISOString().slice(0, 10)}` });
    // Escalate to the reporting manager after the SLA (or 2 days overdue).
    if (overdue && (!t.overdueNotifiedAt || t.overdueNotifiedAt < addDays(d, -7))) {
      const owner = await prisma.user.findUnique({ where: { id: t.ownerId! } });
      if (owner?.reportingManagerId && d.getTime() - t.dueDate!.getTime() >= 2 * 86_400_000) {
        await notify(prisma, { userIds: [owner.reportingManagerId], type: 'TASK_ESCALATED', title: `Escalation: ${owner.name}'s task is overdue — ${t.title}`, link: `/tasks/${t.id}`, projectId: t.projectId, dedupeKey: `task-esc:${t.id}:${d.toISOString().slice(0, 10)}` });
        await prisma.task.update({ where: { id: t.id }, data: { overdueNotifiedAt: new Date() } });
      }
    }
  }
}
