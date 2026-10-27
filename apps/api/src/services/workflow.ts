import type { ApprovalRequest, WorkflowStep } from '@prisma/client';
import { D, DEFAULT_DOC_TYPES } from '@toprock/shared';
import { prisma, transaction, type Tx, type Db } from '../lib/prisma.js';
import { businessRule, forbidden, notFound, validationError, conflict } from '../lib/errors.js';
import { can, assertProjectAccess, usersWithRole, type AccessContext } from './access.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { setRegisterStatus } from './register.js';
import type { DocHandler, WorkflowEntity } from './handlers/types.js';

const handlers = new Map<string, DocHandler>();

export function registerHandler(h: DocHandler) {
  handlers.set(h.docType, h);
}

export function getHandler(docType: string): DocHandler {
  const h = handlers.get(docType);
  if (!h) throw validationError(`No workflow handler for ${docType}`);
  return h;
}

export function allHandlers() {
  return [...handlers.values()];
}

interface ResolvedStep {
  stepNo: number;
  name: string;
  approverRoleCode: string | null;
  approverUserId: string | null;
  requiredApprovals: number;
  slaHours: number;
  escalateToRoleCode: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const delegate = (db: Db, model: string) => (db as any)[model];

export async function loadEntity(db: Db, h: DocHandler, id: string): Promise<WorkflowEntity> {
  const e = await delegate(db, h.model).findUnique({ where: { id } });
  if (!e) throw notFound('Document');
  return e as WorkflowEntity;
}

async function setStatus(tx: Tx, h: DocHandler, e: WorkflowEntity, status: string, data: Record<string, unknown> = {}) {
  await delegate(tx, h.model).update({ where: { id: e.id }, data: { status, ...data } });
  await setRegisterStatus(tx, h.model, e.id, status);
}

function applicableSteps(steps: WorkflowStep[], amount: string | null | undefined): ResolvedStep[] {
  const amt = amount === null || amount === undefined ? null : D(amount);
  return steps
    .filter((s) => {
      if (amt === null) return s.minAmount === null || D(s.minAmount).lte(0);
      if (s.minAmount !== null && amt.lt(D(s.minAmount))) return false;
      if (s.maxAmount !== null && amt.gt(D(s.maxAmount))) return false;
      return true;
    })
    .sort((a, b) => a.stepNo - b.stepNo)
    .map((s) => ({
      stepNo: s.stepNo,
      name: s.name,
      approverRoleCode: s.approverRoleCode,
      approverUserId: s.approverUserId,
      requiredApprovals: s.requiredApprovals,
      slaHours: s.slaHours,
      escalateToRoleCode: s.escalateToRoleCode,
    }));
}

async function findDefinition(db: Db, orgId: string, projectId: string, docType: string) {
  return (
    (await db.workflowDefinition.findFirst({ where: { orgId, projectId, docType, isActive: true }, include: { steps: true } })) ??
    (await db.workflowDefinition.findFirst({ where: { orgId, projectId: null, docType, isActive: true }, include: { steps: true } }))
  );
}

/** User ids eligible to act on a step (role holders with project access, or the named user). */
export async function stepApprovers(db: Db, orgId: string, projectId: string, step: ResolvedStep): Promise<string[]> {
  if (step.approverUserId) return [step.approverUserId];
  if (!step.approverRoleCode) return [];
  return usersWithRole(db, orgId, projectId, step.approverRoleCode);
}

function stepsOf(req: ApprovalRequest): ResolvedStep[] {
  return req.steps as unknown as ResolvedStep[];
}

function currentStep(req: ApprovalRequest): ResolvedStep {
  const s = stepsOf(req).find((x) => x.stepNo === req.currentStepNo);
  if (!s) throw conflict('Approval request is in an inconsistent state');
  return s;
}

/** Determines whether ctx.user may act on the current step, directly or by delegation. */
export async function eligibility(db: Db, ctx: AccessContext, req: ApprovalRequest): Promise<{ ok: boolean; onBehalfOf?: string; reason?: string }> {
  const h = getHandler(req.docType);
  const step = currentStep(req);
  const approvers = await stepApprovers(db, ctx.orgId, req.projectId, step);
  const hasPerm = can(ctx, `${h.area}.approve`, req.projectId);
  if (approvers.includes(ctx.user.id)) {
    if (!hasPerm) return { ok: false, reason: `Missing permission ${h.area}.approve` };
    return { ok: true };
  }
  const today = new Date();
  const delegations = await db.delegation.findMany({
    where: { orgId: ctx.orgId, toUserId: ctx.user.id, isActive: true, startDate: { lte: today }, endDate: { gte: new Date(today.toISOString().slice(0, 10)) }, fromUserId: { in: approvers } },
  });
  const d = delegations.find((x) => x.docTypes.length === 0 || x.docTypes.includes(req.docType));
  if (d) {
    if (!hasPerm) return { ok: false, reason: `Delegate lacks permission ${h.area}.approve` };
    return { ok: true, onBehalfOf: d.fromUserId };
  }
  return { ok: false, reason: 'You are not an approver for the current step' };
}

async function assertSeparationOfDuties(db: Db, ctx: AccessContext, req: ApprovalRequest) {
  const def = await db.workflowDefinition.findUnique({ where: { id: req.definitionId } });
  if (!def?.allowSelfApproval && req.submittedById === ctx.user.id) throw forbidden('Separation of duties: you cannot approve a document you submitted');
}

async function assertApprovalLimit(db: Db, ctx: AccessContext, req: ApprovalRequest, actingFor?: string) {
  const dt = DEFAULT_DOC_TYPES.find((d) => d.code === req.docType);
  if (!dt?.financial || req.amount === null) return;
  const userId = ctx.user.id;
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: req.projectId, userId } } });
  const user = await db.user.findUnique({ where: { id: userId }, select: { approvalLimit: true } });
  const limit = member?.approvalLimit ?? user?.approvalLimit ?? null;
  if (limit !== null && D(req.amount).gt(D(limit))) {
    throw forbidden(`Amount ${D(req.amount).toFixed(2)} exceeds your approval limit of ${D(limit).toFixed(2)}${actingFor ? ' (delegated approval)' : ''}`);
  }
}

export async function submitDocument(ctx: AccessContext, docType: string, entityId: string, comment?: string) {
  const h = getHandler(docType);
  return transaction(async (tx) => {
    const e = await loadEntity(tx, h, entityId);
    await assertProjectAccess(tx, ctx, e.projectId);
    if (!can(ctx, `${h.area}.manage`, e.projectId)) throw forbidden(`Missing permission ${h.area}.manage`);
    const allowed = h.submittableStatuses ?? ['DRAFT', 'RETURNED'];
    if (!allowed.includes(e.status)) throw conflict(`Cannot submit a document in status ${e.status}`);
    const info = h.validateSubmit ? await h.validateSubmit(tx, ctx, e) : {};
    const def = await findDefinition(tx, ctx.orgId, e.projectId, docType);
    if (!def) throw businessRule(`No active approval workflow is configured for ${docType}. Configure one in Settings → Workflows.`);
    const steps = applicableSteps(def.steps, info.amount);
    if (steps.length === 0) throw businessRule(`The ${docType} workflow has no step that applies to this amount`);
    const title = info.title ?? `${docType} ${e.number ?? ''}`.trim();
    const req = await tx.approvalRequest.create({
      data: {
        orgId: ctx.orgId,
        projectId: e.projectId,
        docType,
        entityId,
        entityNumber: (e.number as string) ?? null,
        title,
        amount: info.amount ?? null,
        definitionId: def.id,
        steps: steps as never,
        currentStepNo: steps[0].stepNo,
        submittedById: ctx.user.id,
        activeKey: `${docType}:${entityId}`,
        actions: { create: { stepNo: 0, actorId: ctx.user.id, action: e.status === 'RETURNED' ? 'RESUBMIT' : 'SUBMIT', comment: comment ?? null } },
      },
    });
    await setStatus(tx, h, e, info.status ?? 'SUBMITTED', info.data ?? {});
    await audit(tx, ctx, { action: 'SUBMIT', entityType: h.model, entityId, projectId: e.projectId, summary: `${title} submitted for approval` });
    const approvers = await stepApprovers(tx, ctx.orgId, e.projectId, steps[0]);
    await notify(tx, {
      userIds: approvers.filter((u) => u !== ctx.user.id || def.allowSelfApproval),
      type: 'APPROVAL_PENDING',
      title: `Approval pending: ${title}`,
      body: `${steps[0].name} — submitted by ${ctx.user.name}`,
      link: h.link(e),
      projectId: e.projectId,
      entityType: h.model,
      entityId,
      dedupeKey: `approval:${req.id}:${steps[0].stepNo}`,
    });
    return req;
  });
}

type Decision = 'APPROVE' | 'REJECT' | 'RETURN';

export async function decide(ctx: AccessContext, requestId: string, decision: Decision, comment?: string) {
  if ((decision === 'REJECT' || decision === 'RETURN') && !comment?.trim()) throw validationError('A comment is required when rejecting or returning');
  return transaction(async (tx) => {
    // Lock the request row so concurrent decisions serialise.
    await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${requestId} FOR UPDATE`;
    const req = await tx.approvalRequest.findUnique({ where: { id: requestId } });
    if (!req || req.orgId !== ctx.orgId) throw notFound('Approval request');
    await assertProjectAccess(tx, ctx, req.projectId);
    if (req.status !== 'PENDING') throw conflict(`This request is already ${req.status.toLowerCase()}`);
    const h = getHandler(req.docType);
    const elig = await eligibility(tx, ctx, req);
    if (!elig.ok) throw forbidden(elig.reason);
    await assertSeparationOfDuties(tx, ctx, req);
    const step = currentStep(req);
    const already = await tx.approvalAction.findFirst({ where: { requestId, stepNo: step.stepNo, actorId: ctx.user.id, action: 'APPROVE' } });
    if (already) throw conflict('You have already approved this step');
    const e = await loadEntity(tx, h, req.entityId);
    await tx.approvalAction.create({ data: { requestId, stepNo: step.stepNo, actorId: ctx.user.id, onBehalfOfId: elig.onBehalfOf ?? null, action: decision, comment: comment ?? null } });

    if (decision === 'APPROVE') {
      const approvals = await tx.approvalAction.count({ where: { requestId, stepNo: step.stepNo, action: 'APPROVE' } });
      if (approvals < step.requiredApprovals) {
        await audit(tx, ctx, { action: 'APPROVE_PARTIAL', entityType: h.model, entityId: e.id, projectId: e.projectId, summary: `${req.title}: ${approvals}/${step.requiredApprovals} approvals at ${step.name}` });
        return { status: 'PENDING', step: step.stepNo };
      }
      const steps = stepsOf(req);
      const next = steps.find((s) => s.stepNo > step.stepNo);
      if (next) {
        await tx.approvalRequest.update({ where: { id: requestId }, data: { currentStepNo: next.stepNo, stepStartedAt: new Date(), escalatedAt: null } });
        await audit(tx, ctx, { action: 'APPROVE_STEP', entityType: h.model, entityId: e.id, projectId: e.projectId, summary: `${req.title}: ${step.name} approved` });
        const approvers = await stepApprovers(tx, ctx.orgId, req.projectId, next);
        await notify(tx, { userIds: approvers, type: 'APPROVAL_PENDING', title: `Approval pending: ${req.title}`, body: next.name, link: h.link(e), projectId: req.projectId, entityType: h.model, entityId: e.id, dedupeKey: `approval:${req.id}:${next.stepNo}` });
        return { status: 'PENDING', step: next.stepNo };
      }
      // Final authorisation: the approver completing the last step must hold sufficient authority.
      await assertApprovalLimit(tx, ctx, req, elig.onBehalfOf);
      const done = await tx.approvalRequest.update({ where: { id: requestId }, data: { status: 'APPROVED', completedAt: new Date(), activeKey: null } });
      await setStatus(tx, h, e, h.approvedStatus ?? 'APPROVED');
      if (h.onApproved) await h.onApproved(tx, ctx, { ...e, status: h.approvedStatus ?? 'APPROVED' }, done);
      await audit(tx, ctx, { action: 'APPROVE', entityType: h.model, entityId: e.id, projectId: e.projectId, summary: `${req.title} approved`, reason: comment });
      await notify(tx, { userIds: [req.submittedById], type: 'APPROVAL_APPROVED', title: `Approved: ${req.title}`, body: comment, link: h.link(e), projectId: req.projectId, entityType: h.model, entityId: e.id });
      return { status: 'APPROVED' };
    }

    if (decision === 'REJECT') {
      const done = await tx.approvalRequest.update({ where: { id: requestId }, data: { status: 'REJECTED', completedAt: new Date(), activeKey: null } });
      await setStatus(tx, h, e, h.rejectedStatus ?? 'REJECTED');
      if (h.onRejected) await h.onRejected(tx, ctx, e, done);
      await audit(tx, ctx, { action: 'REJECT', entityType: h.model, entityId: e.id, projectId: e.projectId, summary: `${req.title} rejected`, reason: comment });
      await notify(tx, { userIds: [req.submittedById], type: 'APPROVAL_REJECTED', title: `Rejected: ${req.title}`, body: comment, link: h.link(e), projectId: req.projectId, entityType: h.model, entityId: e.id });
      return { status: 'REJECTED' };
    }

    const done = await tx.approvalRequest.update({ where: { id: requestId }, data: { status: 'RETURNED', completedAt: new Date(), activeKey: null } });
    await setStatus(tx, h, e, h.returnedStatus ?? 'RETURNED');
    if (h.onReturned) await h.onReturned(tx, ctx, e, done);
    await audit(tx, ctx, { action: 'RETURN', entityType: h.model, entityId: e.id, projectId: e.projectId, summary: `${req.title} returned for correction`, reason: comment });
    await notify(tx, { userIds: [req.submittedById], type: 'CHANGES_REQUESTED', title: `Returned for correction: ${req.title}`, body: comment, link: h.link(e), projectId: req.projectId, entityType: h.model, entityId: e.id });
    return { status: 'RETURNED' };
  });
}

/** Submitter withdraws a pending request; the document goes back to draft. */
export async function withdraw(ctx: AccessContext, requestId: string, comment?: string) {
  return transaction(async (tx) => {
    const req = await tx.approvalRequest.findUnique({ where: { id: requestId } });
    if (!req || req.orgId !== ctx.orgId) throw notFound('Approval request');
    if (req.status !== 'PENDING') throw conflict('Only pending requests can be withdrawn');
    if (req.submittedById !== ctx.user.id) throw forbidden('Only the submitter can withdraw a request');
    const h = getHandler(req.docType);
    const e = await loadEntity(tx, h, req.entityId);
    await tx.approvalRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED', completedAt: new Date(), activeKey: null } });
    await tx.approvalAction.create({ data: { requestId, stepNo: req.currentStepNo, actorId: ctx.user.id, action: 'CANCEL', comment: comment ?? null } });
    await setStatus(tx, h, e, h.cancelledStatus ?? 'DRAFT');
    await audit(tx, ctx, { action: 'WITHDRAW', entityType: h.model, entityId: e.id, projectId: e.projectId, summary: `${req.title} withdrawn` });
    return { status: 'CANCELLED' };
  });
}

/** Escalates requests whose current step is past its SLA. Idempotent per step. */
export async function runEscalations(now = new Date()) {
  const pending = await prisma.approvalRequest.findMany({ where: { status: 'PENDING', escalatedAt: null } });
  let escalated = 0;
  for (const req of pending) {
    const step = stepsOf(req).find((s) => s.stepNo === req.currentStepNo);
    if (!step) continue;
    if (req.stepStartedAt.getTime() + step.slaHours * 3600_000 > now.getTime()) continue;
    const h = handlers.get(req.docType);
    const recipients = step.escalateToRoleCode ? await usersWithRole(prisma, req.orgId, req.projectId, step.escalateToRoleCode) : [];
    const approvers = await stepApprovers(prisma, req.orgId, req.projectId, step);
    await prisma.$transaction([
      prisma.approvalRequest.update({ where: { id: req.id }, data: { escalatedAt: now } }),
      prisma.approvalAction.create({ data: { requestId: req.id, stepNo: step.stepNo, actorId: req.submittedById, action: 'ESCALATE', comment: `SLA of ${step.slaHours}h exceeded` } }),
    ]);
    await notify(prisma, {
      userIds: [...recipients, ...approvers],
      type: 'APPROVAL_ESCALATED',
      title: `Overdue approval: ${req.title}`,
      body: `${step.name} has exceeded its ${step.slaHours}h SLA`,
      link: h ? `/approvals?request=${req.id}` : undefined,
      projectId: req.projectId,
      dedupeKey: `escalate:${req.id}:${step.stepNo}`,
    });
    escalated++;
  }
  return escalated;
}

export async function requestHistory(db: Db, docType: string, entityId: string) {
  const reqs = await db.approvalRequest.findMany({ where: { docType, entityId }, orderBy: { submittedAt: 'asc' }, include: { actions: { orderBy: { createdAt: 'asc' } } } });
  const userIds = [...new Set(reqs.flatMap((r) => [r.submittedById, ...r.actions.flatMap((a) => [a.actorId, a.onBehalfOfId ?? ''])]).filter(Boolean))];
  const users = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return reqs.map((r) => ({
    id: r.id,
    status: r.status,
    amount: r.amount,
    submittedAt: r.submittedAt,
    completedAt: r.completedAt,
    submittedBy: users.get(r.submittedById) ?? r.submittedById,
    currentStepNo: r.currentStepNo,
    steps: r.steps,
    actions: r.actions.map((a) => ({ ...a, actorName: users.get(a.actorId) ?? a.actorId, onBehalfOfName: a.onBehalfOfId ? users.get(a.onBehalfOfId) : null })),
  }));
}
