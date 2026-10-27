import { Router } from 'express';
import { z } from 'zod';
import { PROJECT_STATUS, zDecimal, zDate } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { parseBody, param } from '../lib/http.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { toDateOnly } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { accessibleProjectIds, assertCan, assertProjectAccess } from '../services/access.js';
import { audit, diff } from '../services/audit.js';
import { assertRefsInScope } from '../services/lookups.js';
import { ensurePeriod } from '../services/periods.js';
import { projectCostPositions } from '../services/budget.js';

export const projectsRouter = Router();

const projectFields = {
  name: z.string().trim().min(2).max(200),
  description: z.string().max(5000).nullish(),
  clientId: z.string().nullish(),
  consultantId: z.string().nullish(),
  location: z.string().max(300).nullish(),
  projectManagerId: z.string().nullish(),
  startDate: zDate.nullish(),
  plannedCompletionDate: zDate.nullish(),
  contractValue: zDecimal(2).optional(),
  contractType: z.enum(['LUMP_SUM', 'ITEM_RATE', 'COST_PLUS', 'DESIGN_BUILD', 'EPC']).optional(),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).optional(),
  taxRate: zDecimal(6).optional(),
  retentionPct: zDecimal(6).optional(),
  advanceReceived: zDecimal(2).optional(),
  advanceRecoveryPct: zDecimal(6).optional(),
  reportingPeriod: z.enum(['MONTHLY']).optional(),
  status: z.enum(PROJECT_STATUS).optional(),
};

const createSchema = z.object({ code: z.string().trim().regex(/^[A-Z0-9-]{2,12}$/, 'Use 2–12 upper-case letters, digits or dashes'), template: z.enum(['NONE', 'STANDARD']).default('STANDARD'), ...projectFields });
const updateSchema = z.object({ ...projectFields }).partial();

const STANDARD_COST_CODES: Array<[string, string, string, string]> = [
  ['01', 'Preliminaries & General', '01-100', 'OVERHEAD'],
  ['02', 'Substructure', '02-100', 'SUBCONTRACT'],
  ['03', 'Superstructure', '03-100', 'MATERIAL'],
  ['04', 'MEP Services', '04-100', 'SUBCONTRACT'],
  ['05', 'Finishes', '05-100', 'MATERIAL'],
];

function dates<T extends Record<string, unknown>>(d: T) {
  const out: Record<string, unknown> = { ...d };
  for (const k of ['startDate', 'plannedCompletionDate']) if (k in out) out[k] = toDateOnly(out[k] as string);
  return out;
}

projectsRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'project.view');
  const ids = await accessibleProjectIds(prisma, ctx);
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const projects = await prisma.project.findMany({
    where: { id: { in: ids }, ...(status ? { status } : {}), ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { location: { contains: q, mode: 'insensitive' } }] } : {}) },
    include: { client: { select: { name: true } }, projectManager: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  const withFinancials = await Promise.all(
    projects.map(async (p) => {
      const pos = await projectCostPositions(prisma, p.id);
      const acts = await prisma.activity.findMany({ where: { projectId: p.id }, select: { weight: true, percentComplete: true } });
      const tw = acts.reduce((a, x) => a + Number(x.weight), 0);
      const progress = tw ? acts.reduce((a, x) => a + Number(x.weight) * Number(x.percentComplete), 0) / tw : null;
      return { ...p, approvedBudget: pos.total.approvedBudget, eac: pos.total.eac, incurred: pos.total.incurred, costVariance: pos.total.costVariance, alert: pos.total.alert, physicalProgress: progress === null ? null : progress.toFixed(1) };
    }),
  );
  res.json(withFinancials);
});

projectsRouter.post('/', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'project.manage');
  const data = parseBody(createSchema, req.body);
  const exists = await prisma.project.findUnique({ where: { orgId_code: { orgId: ctx.orgId, code: data.code } } });
  if (exists) throw conflict(`Project code ${data.code} already exists`);
  const project = await transaction(async (tx) => {
    for (const [k, src] of [['clientId', 'clients'], ['consultantId', 'parties'], ['projectManagerId', 'users']] as const) {
      if (data[k]) await assertRefsInScope(tx, src, ctx.orgId, null, [data[k] as string], k);
    }
    const { template, ...rest } = data;
    const p = await tx.project.create({ data: { ...(dates(rest) as Record<string, unknown>), code: data.code, name: data.name, orgId: ctx.orgId, createdById: ctx.user.id } as never });
    await tx.projectMember.create({ data: { projectId: p.id, userId: ctx.user.id, projectRole: 'Creator' } });
    if (data.projectManagerId && data.projectManagerId !== ctx.user.id) await tx.projectMember.create({ data: { projectId: p.id, userId: data.projectManagerId, projectRole: 'Project Manager' } });
    if (template === 'STANDARD') {
      for (const [wbs, name, cc, cat] of STANDARD_COST_CODES) {
        const node = await tx.wbsNode.create({ data: { projectId: p.id, code: wbs, name, level: 1 } });
        const code = await tx.costCode.create({ data: { projectId: p.id, wbsNodeId: node.id, code: cc, name, category: cat } });
        await tx.budgetLine.create({ data: { projectId: p.id, costCodeId: code.id, originalAmount: '0' } });
      }
      await tx.store.create({ data: { projectId: p.id, code: 'MAIN', name: 'Main site store' } });
    }
    await ensurePeriod(tx, p.id, toDateOnly(data.startDate ?? new Date()) as Date);
    await audit(tx, ctx, { action: 'CREATE', entityType: 'project', entityId: p.id, projectId: p.id, summary: `Project ${p.code} created`, after: p });
    return p;
  });
  res.status(201).json(project);
});

projectsRouter.get('/:projectId', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'project.view', param(req, 'projectId'));
  await assertProjectAccess(prisma, ctx, param(req, 'projectId'));
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: param(req, 'projectId') },
    include: { client: { select: { id: true, name: true } }, consultant: { select: { id: true, name: true } }, projectManager: { select: { id: true, name: true } } },
  });
  const approvedVo = await prisma.variation.aggregate({ where: { projectId: p.id, status: 'APPROVED' }, _sum: { approvedValue: true } });
  res.json({ ...p, approvedVariations: approvedVo._sum.approvedValue ?? '0' });
});

projectsRouter.patch('/:projectId', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  await assertProjectAccess(prisma, ctx, projectId);
  assertCan(ctx, 'project.manage', projectId);
  const data = parseBody(updateSchema, req.body);
  const updated = await transaction(async (tx) => {
    const before = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    if (before.status === 'CLOSED' && data.status !== 'ACTIVE') throw conflict('A closed project is read-only');
    if (data.projectManagerId) await assertRefsInScope(tx, 'users', ctx.orgId, null, [data.projectManagerId], 'Project manager');
    if (data.clientId) await assertRefsInScope(tx, 'clients', ctx.orgId, null, [data.clientId], 'Client');
    const p = await tx.project.update({ where: { id: projectId }, data: dates(data) as never });
    const d = diff(JSON.parse(JSON.stringify(before)), JSON.parse(JSON.stringify(p)));
    await audit(tx, ctx, { action: 'UPDATE', entityType: 'project', entityId: projectId, projectId, summary: `Project ${p.code} updated`, before: d.before, after: d.after });
    return p;
  });
  res.json(updated);
});

// ── Team membership & project roles ──

projectsRouter.get('/:projectId/members', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  await assertProjectAccess(prisma, ctx, projectId);
  assertCan(ctx, 'project.view', projectId);
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { id: true, name: true, email: true, designation: true, department: true, status: true, roles: { where: { OR: [{ projectId }, { projectId: null }] }, select: { projectId: true, role: { select: { code: true, name: true } } } } } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(members);
});

const memberSchema = z.object({ userId: z.string(), projectRole: z.string().max(100).nullish(), approvalLimit: zDecimal(2).nullish(), roleCodes: z.array(z.string()).default([]) });

projectsRouter.post('/:projectId/members', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  await assertProjectAccess(prisma, ctx, projectId);
  assertCan(ctx, 'team.manage', projectId);
  const data = parseBody(memberSchema, req.body);
  const m = await transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: data.userId, orgId: ctx.orgId } });
    if (!user) throw notFound('User');
    const member = await tx.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: data.userId } },
      create: { projectId, userId: data.userId, projectRole: data.projectRole ?? null, approvalLimit: data.approvalLimit ?? null },
      update: { projectRole: data.projectRole ?? null, approvalLimit: data.approvalLimit ?? null, isActive: true },
    });
    if (data.roleCodes.length) {
      const roles = await tx.role.findMany({ where: { orgId: ctx.orgId, code: { in: data.roleCodes } } });
      if (roles.length !== data.roleCodes.length) throw validationError('Unknown role code');
      if (data.roleCodes.includes('SUPER_ADMIN')) throw validationError('Super Admin cannot be granted per project');
      await tx.userRole.deleteMany({ where: { userId: data.userId, projectId } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: data.userId, roleId: r.id, projectId })) });
    }
    await audit(tx, ctx, { action: 'MEMBER_UPSERT', entityType: 'projectMember', entityId: member.id, projectId, summary: `${user.name} added/updated on project`, after: { ...data } });
    return member;
  });
  res.status(201).json(m);
});

projectsRouter.delete('/:projectId/members/:userId', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  await assertProjectAccess(prisma, ctx, projectId);
  assertCan(ctx, 'team.manage', projectId);
  await transaction(async (tx) => {
    await tx.projectMember.updateMany({ where: { projectId, userId: param(req, 'userId') }, data: { isActive: false } });
    await tx.userRole.deleteMany({ where: { projectId, userId: param(req, 'userId') } });
    await audit(tx, ctx, { action: 'MEMBER_REMOVED', entityType: 'projectMember', entityId: param(req, 'userId'), projectId });
  });
  res.json({ ok: true });
});
