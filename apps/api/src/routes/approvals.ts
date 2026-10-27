import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { pageParams, param, parseBody } from '../lib/http.js';
import { notFound, validationError } from '../lib/errors.js';
import { toDateOnly } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { accessibleProjectIds, assertProjectAccess } from '../services/access.js';
import { decide, eligibility, getHandler, loadEntity, requestHistory, withdraw } from '../services/workflow.js';
import { audit } from '../services/audit.js';

export const approvalsRouter = Router();

async function enrich(rows: Awaited<ReturnType<typeof prisma.approvalRequest.findMany>>) {
  const userIds = [...new Set(rows.map((r) => r.submittedById))];
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const [users, projects] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, code: true, name: true } }),
  ]);
  const u = new Map(users.map((x) => [x.id, x.name]));
  const p = new Map(projects.map((x) => [x.id, x]));
  return rows.map((r) => {
    let link: string | null = null;
    try {
      link = getHandler(r.docType).link({ id: r.entityId, projectId: r.projectId, status: '' } as never);
    } catch {
      link = null;
    }
    const step = (r.steps as Array<{ stepNo: number; name: string; slaHours: number }>).find((s) => s.stepNo === r.currentStepNo);
    const dueAt = step ? new Date(r.stepStartedAt.getTime() + step.slaHours * 3600_000) : null;
    return { ...r, submittedByName: u.get(r.submittedById) ?? null, project: p.get(r.projectId) ?? null, currentStepName: step?.name ?? null, dueAt, overdue: r.status === 'PENDING' && dueAt ? dueAt < new Date() : false, link };
  });
}

/** Pending requests the current user can act on (directly or by delegation). */
approvalsRouter.get('/inbox', async (req, res) => {
  const ctx = ctxOf(req);
  const ids = await accessibleProjectIds(prisma, ctx);
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  const pending = await prisma.approvalRequest.findMany({ where: { orgId: ctx.orgId, status: 'PENDING', projectId: projectId ? { in: ids.includes(projectId) ? [projectId] : [] } : { in: ids } }, orderBy: { submittedAt: 'asc' } });
  const mine = [];
  for (const r of pending) {
    const e = await eligibility(prisma, ctx, r);
    if (!e.ok) continue;
    // Separation of duties: your own submissions are not yours to approve unless the workflow allows it.
    if (r.submittedById === ctx.user.id) {
      const def = await prisma.workflowDefinition.findUnique({ where: { id: r.definitionId }, select: { allowSelfApproval: true } });
      if (!def?.allowSelfApproval) continue;
    }
    const already = await prisma.approvalAction.findFirst({ where: { requestId: r.id, stepNo: r.currentStepNo, actorId: ctx.user.id, action: 'APPROVE' } });
    if (!already) mine.push({ ...r, onBehalfOf: e.onBehalfOf ?? null, selfSubmitted: r.submittedById === ctx.user.id });
  }
  res.json(await enrich(mine as never));
});

approvalsRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  const ids = await accessibleProjectIds(prisma, ctx);
  const { skip, take, page, pageSize } = pageParams(req);
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  const where = {
    orgId: ctx.orgId,
    projectId: { in: projectId ? ids.filter((i) => i === projectId) : ids },
    ...(typeof req.query.status === 'string' ? { status: req.query.status as never } : {}),
    ...(typeof req.query.docType === 'string' ? { docType: req.query.docType } : {}),
    ...(req.query.mine === 'true' ? { submittedById: ctx.user.id } : {}),
  };
  const [rows, total] = await Promise.all([prisma.approvalRequest.findMany({ where, orderBy: { submittedAt: 'desc' }, skip, take }), prisma.approvalRequest.count({ where })]);
  res.json({ items: await enrich(rows), total, page, pageSize });
});

approvalsRouter.get('/history', async (req, res) => {
  const ctx = ctxOf(req);
  const docType = String(req.query.docType ?? '');
  const entityId = String(req.query.entityId ?? '');
  if (!docType || !entityId) throw validationError('docType and entityId are required');
  const h = getHandler(docType);
  const e = await loadEntity(prisma, h, entityId);
  await assertProjectAccess(prisma, ctx, e.projectId);
  res.json(await requestHistory(prisma, docType, entityId));
});

approvalsRouter.get('/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const r = await prisma.approvalRequest.findUnique({ where: { id: param(req, 'id') } });
  if (!r || r.orgId !== ctx.orgId) throw notFound('Approval request');
  await assertProjectAccess(prisma, ctx, r.projectId);
  const [row] = await enrich([r]);
  const elig = r.status === 'PENDING' ? await eligibility(prisma, ctx, r) : { ok: false };
  res.json({ ...row, canAct: elig.ok, history: await requestHistory(prisma, r.docType, r.entityId) });
});

const decisionSchema = z.object({ comment: z.string().max(2000).optional() });

approvalsRouter.post('/:id/approve', async (req, res) => res.json(await decide(ctxOf(req), param(req, 'id'), 'APPROVE', parseBody(decisionSchema, req.body).comment)));
approvalsRouter.post('/:id/reject', async (req, res) => res.json(await decide(ctxOf(req), param(req, 'id'), 'REJECT', parseBody(decisionSchema, req.body).comment)));
approvalsRouter.post('/:id/return', async (req, res) => res.json(await decide(ctxOf(req), param(req, 'id'), 'RETURN', parseBody(decisionSchema, req.body).comment)));
approvalsRouter.post('/:id/withdraw', async (req, res) => res.json(await withdraw(ctxOf(req), param(req, 'id'), parseBody(decisionSchema, req.body).comment)));

// ── Delegations ──
approvalsRouter.get('/delegations/mine', async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await prisma.delegation.findMany({ where: { orgId: ctx.orgId, OR: [{ fromUserId: ctx.user.id }, { toUserId: ctx.user.id }] }, orderBy: { createdAt: 'desc' } });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.fromUserId, r.toUserId]) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  res.json(rows.map((r) => ({ ...r, fromName: users.get(r.fromUserId), toName: users.get(r.toUserId) })));
});

approvalsRouter.post('/delegations', async (req, res) => {
  const ctx = ctxOf(req);
  const data = parseBody(z.object({ toUserId: z.string(), startDate: z.string(), endDate: z.string(), docTypes: z.array(z.string()).default([]), reason: z.string().max(500).optional() }), req.body);
  if (data.toUserId === ctx.user.id) throw validationError('You cannot delegate to yourself');
  const to = await prisma.user.findFirst({ where: { id: data.toUserId, orgId: ctx.orgId, status: 'ACTIVE' } });
  if (!to) throw notFound('User');
  const start = toDateOnly(data.startDate)!;
  const end = toDateOnly(data.endDate)!;
  if (end < start) throw validationError('End date must be after start date');
  const d = await prisma.delegation.create({ data: { orgId: ctx.orgId, fromUserId: ctx.user.id, toUserId: data.toUserId, startDate: start, endDate: end, docTypes: data.docTypes, reason: data.reason ?? null } });
  await audit(prisma, ctx, { action: 'DELEGATION_CREATED', entityType: 'delegation', entityId: d.id, summary: `Approvals delegated to ${to.name}`, after: data });
  res.status(201).json(d);
});

approvalsRouter.delete('/delegations/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const d = await prisma.delegation.findFirst({ where: { id: param(req, 'id'), fromUserId: ctx.user.id } });
  if (!d) throw notFound('Delegation');
  await prisma.delegation.update({ where: { id: d.id }, data: { isActive: false } });
  await audit(prisma, ctx, { action: 'DELEGATION_REVOKED', entityType: 'delegation', entityId: d.id });
  res.json({ ok: true });
});
