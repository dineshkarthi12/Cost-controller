import { Router } from 'express';
import { z } from 'zod';
import { ALL_PERMISSIONS, DEFAULT_DOC_TYPES, DEFAULT_ROLES, zDecimal } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { pageParams, param, parseBody } from '../lib/http.js';
import { conflict, forbidden, notFound, validationError } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { ctxOf } from '../middleware/auth.js';
import { accessibleProjectIds, assertCan, can } from '../services/access.js';
import { audit, diff } from '../services/audit.js';
import { getOrgSettings, orgSettingsSchema } from '../services/settings.js';
import { assertRefsInScope } from '../services/lookups.js';
import { appLink, emailStatus, sendEmail, sendEmailNow } from '../services/email.js';

export const adminRouter = Router();

// ───────── Users & invitations ─────────

adminRouter.get('/users', async (req, res) => {
  const ctx = ctxOf(req);
  // Team leads with team.view can see the directory; editing needs user.manage.
  if (!can(ctx, 'user.manage') && !can(ctx, 'team.view') && ![...ctx.projectPermissions.values()].some((s) => s.has('team.view'))) throw forbidden();
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const users = await prisma.user.findMany({
    where: { orgId: ctx.orgId, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}), ...(typeof req.query.status === 'string' ? { status: req.query.status } : {}) },
    select: {
      id: true,
      name: true,
      email: true,
      employeeId: true,
      designation: true,
      department: true,
      phone: true,
      status: true,
      mfaEnabled: true,
      approvalLimit: true,
      skills: true,
      responsibilities: true,
      reportingManagerId: true,
      backupUserId: true,
      lastLoginAt: true,
      roles: { select: { projectId: true, role: { select: { code: true, name: true } } } },
      memberships: { where: { isActive: true }, select: { projectId: true, projectRole: true, project: { select: { code: true, name: true } } } },
    },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

const userSchema = z.object({
  name: z.string().trim().min(2).max(200),
  employeeId: z.string().max(50).nullish(),
  designation: z.string().max(100).nullish(),
  department: z.string().max(100).nullish(),
  phone: z.string().max(50).nullish(),
  approvalLimit: zDecimal(2).nullish(),
  skills: z.array(z.string().max(100)).max(30).optional(),
  responsibilities: z.string().max(2000).nullish(),
  reportingManagerId: z.string().nullish(),
  backupUserId: z.string().nullish(),
  roleCodes: z.array(z.string()).optional(),
});

adminRouter.post('/users/invite', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'user.manage');
  const data = parseBody(userSchema.extend({ email: z.string().email().max(200), projectIds: z.array(z.string()).default([]) }), req.body);
  const email = data.email.toLowerCase();
  if (data.roleCodes?.includes('SUPER_ADMIN') && !ctx.orgRoleCodes.includes('SUPER_ADMIN')) throw forbidden('Only a Super Admin can grant Super Admin');
  const out = await transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email } })) throw conflict('A user with this email already exists');
    const roles = await tx.role.findMany({ where: { orgId: ctx.orgId, code: { in: data.roleCodes ?? [] } } });
    if (roles.length !== (data.roleCodes ?? []).length) throw validationError('Unknown role');
    const projects = await tx.project.findMany({ where: { orgId: ctx.orgId, id: { in: data.projectIds } } });
    const { roleCodes: _r, projectIds: _p, ...profile } = data;
    void _r;
    void _p;
    const user = await tx.user.create({ data: { ...profile, email, orgId: ctx.orgId, status: 'INVITED', skills: data.skills ?? [], roles: { create: roles.map((r) => ({ roleId: r.id })) }, memberships: { create: projects.map((p) => ({ projectId: p.id })) } } });
    const token = randomToken();
    await tx.invitation.create({ data: { orgId: ctx.orgId, email, name: data.name, roleCodes: data.roleCodes ?? [], projectIds: data.projectIds, tokenHash: sha256(token), invitedById: ctx.user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    await audit(tx, ctx, { action: 'USER_INVITED', entityType: 'user', entityId: user.id, summary: `${email} invited`, after: { roles: data.roleCodes, projects: data.projectIds } });
    const link = `${config.appBaseUrl}/accept-invitation?token=${token}`;
    return { user, link };
  });
  const inviter = ctx.user.name;
  const mail = await sendEmail({
    to: email,
    subject: 'You are invited to TOPROCK GLOBAL Cost Control',
    text: `Hello ${data.name},\n\n${inviter} has invited you to the TOPROCK GLOBAL construction cost control system.\n\nSet your password using the button below. The link works once and expires in 7 days.`,
    action: { url: out.link, label: 'Accept invitation' },
  });
  if (!mail.sent) logger.info({ email, reason: mail.error }, 'invitation email not sent');
  // Without working email the administrator must share the one-time link securely themselves.
  res.status(201).json({ user: out.user, emailSent: mail.sent, emailError: mail.sent ? undefined : mail.error, inviteLink: mail.sent ? undefined : out.link });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'user.manage');
  const data = parseBody(userSchema.partial(), req.body);
  const out = await transaction(async (tx) => {
    const before = await tx.user.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId }, include: { roles: { where: { projectId: null }, include: { role: true } } } });
    if (!before) throw notFound('User');
    for (const k of ['reportingManagerId', 'backupUserId'] as const) if (data[k]) await assertRefsInScope(tx, 'users', ctx.orgId, null, [data[k] as string], k);
    if (data.reportingManagerId === before.id || data.backupUserId === before.id) throw validationError('A user cannot be their own manager or backup');
    const { roleCodes, ...profile } = data;
    if (roleCodes) {
      const granting = roleCodes.includes('SUPER_ADMIN') && !before.roles.some((r) => r.role.code === 'SUPER_ADMIN');
      if (granting && !ctx.orgRoleCodes.includes('SUPER_ADMIN')) throw forbidden('Only a Super Admin can grant Super Admin');
      if (before.id === ctx.user.id && !roleCodes.some((c) => ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes(c)) && before.roles.some((r) => ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes(r.role.code))) throw validationError('You cannot remove your own administrator role');
      const roles = await tx.role.findMany({ where: { orgId: ctx.orgId, code: { in: roleCodes } } });
      if (roles.length !== roleCodes.length) throw validationError('Unknown role');
      await tx.userRole.deleteMany({ where: { userId: before.id, projectId: null } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: before.id, roleId: r.id })) });
    }
    const u = await tx.user.update({ where: { id: before.id }, data: { ...profile, skills: profile.skills ?? undefined } });
    const d = diff(JSON.parse(JSON.stringify({ ...before, roles: before.roles.map((r) => r.role.code) })), JSON.parse(JSON.stringify({ ...u, roles: roleCodes ?? before.roles.map((r) => r.role.code) })));
    await audit(tx, ctx, { action: 'USER_UPDATED', entityType: 'user', entityId: u.id, summary: `${u.email} updated`, before: d.before, after: d.after });
    return u;
  });
  res.json({ id: out.id });
});

adminRouter.post('/users/:id/deactivate', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'user.manage');
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(3) }), req.body);
  if (param(req, 'id') === ctx.user.id) throw validationError('You cannot deactivate yourself');
  await transaction(async (tx) => {
    const u = await tx.user.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId } });
    if (!u) throw notFound('User');
    await tx.user.update({ where: { id: u.id }, data: { status: 'DEACTIVATED' } });
    await tx.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, ctx, { action: 'USER_DEACTIVATED', entityType: 'user', entityId: u.id, summary: `${u.email} deactivated; sessions revoked`, reason });
  });
  res.json({ ok: true });
});

adminRouter.post('/users/:id/reactivate', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'user.manage');
  const u = await prisma.user.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId } });
  if (!u) throw notFound('User');
  await prisma.user.update({ where: { id: u.id }, data: { status: u.passwordHash ? 'ACTIVE' : 'INVITED' } });
  await audit(prisma, ctx, { action: 'USER_REACTIVATED', entityType: 'user', entityId: u.id });
  res.json({ ok: true });
});

adminRouter.post('/users/:id/revoke-sessions', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'user.manage');
  const u = await prisma.user.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId } });
  if (!u) throw notFound('User');
  const r = await prisma.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(prisma, ctx, { action: 'SESSIONS_REVOKED', entityType: 'user', entityId: u.id, summary: `${r.count} session(s) revoked` });
  res.json({ revoked: r.count });
});

// ───────── Roles & permissions ─────────

adminRouter.get('/roles', async (req, res) => {
  const ctx = ctxOf(req);
  const roles = await prisma.role.findMany({ where: { orgId: ctx.orgId }, include: { permissions: true, _count: { select: { users: true } } }, orderBy: { name: 'asc' } });
  res.json({ roles: roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permissionCode) })), allPermissions: ALL_PERMISSIONS });
});

const roleSchema = z.object({ code: z.string().regex(/^[A-Z0-9_]{2,40}$/), name: z.string().min(2).max(100), description: z.string().max(500).optional(), permissions: z.array(z.string()) });

adminRouter.post('/roles', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'role.manage');
  const data = parseBody(roleSchema, req.body);
  const bad = data.permissions.filter((p) => !(ALL_PERMISSIONS as string[]).includes(p));
  if (bad.length) throw validationError(`Unknown permissions: ${bad.join(', ')}`);
  const role = await transaction(async (tx) => {
    if (await tx.role.findUnique({ where: { orgId_code: { orgId: ctx.orgId, code: data.code } } })) throw conflict('Role code already exists');
    const r = await tx.role.create({ data: { orgId: ctx.orgId, code: data.code, name: data.name, description: data.description, permissions: { create: data.permissions.map((p) => ({ permissionCode: p })) } } });
    await audit(tx, ctx, { action: 'ROLE_CREATED', entityType: 'role', entityId: r.id, summary: `Role ${r.name} created`, after: data });
    return r;
  });
  res.status(201).json(role);
});

adminRouter.put('/roles/:id', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'role.manage');
  const data = parseBody(roleSchema.omit({ code: true }), req.body);
  const bad = data.permissions.filter((p) => !(ALL_PERMISSIONS as string[]).includes(p));
  if (bad.length) throw validationError(`Unknown permissions: ${bad.join(', ')}`);
  const out = await transaction(async (tx) => {
    const r = await tx.role.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId }, include: { permissions: true } });
    if (!r) throw notFound('Role');
    if (r.code === 'SUPER_ADMIN') throw forbidden('The Super Admin role cannot be edited');
    await tx.rolePermission.deleteMany({ where: { roleId: r.id } });
    await tx.rolePermission.createMany({ data: data.permissions.map((p) => ({ roleId: r.id, permissionCode: p })) });
    const u = await tx.role.update({ where: { id: r.id }, data: { name: data.name, description: data.description } });
    await audit(tx, ctx, { action: 'ROLE_UPDATED', entityType: 'role', entityId: r.id, summary: `Role ${r.name} updated`, before: { permissions: r.permissions.map((p) => p.permissionCode) }, after: { permissions: data.permissions } });
    return u;
  });
  res.json(out);
});

adminRouter.post('/roles/:id/reset', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'role.manage');
  const r = await prisma.role.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId } });
  if (!r) throw notFound('Role');
  const tpl = DEFAULT_ROLES.find((x) => x.code === r.code);
  if (!tpl) throw validationError('Custom roles have no default template');
  await transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: r.id } });
    await tx.rolePermission.createMany({ data: [...new Set(tpl.permissions)].map((p) => ({ roleId: r.id, permissionCode: p })) });
    await audit(tx, ctx, { action: 'ROLE_RESET', entityType: 'role', entityId: r.id, summary: `Role ${r.name} reset to defaults` });
  });
  res.json({ ok: true });
});

adminRouter.delete('/roles/:id', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'role.manage');
  const r = await prisma.role.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId }, include: { _count: { select: { users: true } } } });
  if (!r) throw notFound('Role');
  if (r.isSystem) throw conflict('System roles cannot be deleted');
  if (r._count.users) throw conflict('Role is assigned to users');
  await prisma.role.delete({ where: { id: r.id } });
  await audit(prisma, ctx, { action: 'ROLE_DELETED', entityType: 'role', entityId: r.id, summary: `Role ${r.name} deleted` });
  res.json({ ok: true });
});

// ───────── Settings & document types ─────────

adminRouter.get('/settings', async (req, res) => {
  const ctx = ctxOf(req);
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: ctx.orgId } });
  res.json({ org: { id: org.id, name: org.name, code: org.code, baseCurrency: org.baseCurrency, timezone: org.timezone, isDemo: org.isDemo }, settings: await getOrgSettings(prisma, ctx.orgId) });
});

adminRouter.put('/settings', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'settings.manage');
  const body = parseBody(z.object({ name: z.string().min(2).max(200).optional(), baseCurrency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).optional(), timezone: z.string().max(60).optional(), settings: orgSettingsSchema.partial().optional() }), req.body);
  const out = await transaction(async (tx) => {
    const before = await getOrgSettings(tx, ctx.orgId);
    const next = orgSettingsSchema.parse({ ...before, ...(body.settings ?? {}) });
    const org = await tx.organisation.update({ where: { id: ctx.orgId }, data: { name: body.name, baseCurrency: body.baseCurrency, timezone: body.timezone, settings: next as never } });
    const d = diff(before as never, next as never);
    await audit(tx, ctx, { action: 'SETTINGS_UPDATED', entityType: 'organisation', entityId: ctx.orgId, before: d.before, after: d.after });
    return { org, settings: next };
  });
  res.json(out);
});

adminRouter.get('/document-types', async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await prisma.documentType.findMany({ where: { orgId: ctx.orgId }, orderBy: { code: 'asc' } });
  res.json(rows.map((r) => ({ ...r, workflow: DEFAULT_DOC_TYPES.find((d) => d.code === r.code)?.workflow ?? false, financial: DEFAULT_DOC_TYPES.find((d) => d.code === r.code)?.financial ?? false })));
});

adminRouter.put('/document-types/:id', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'settings.manage');
  const data = parseBody(
    z.object({
      name: z.string().min(2).max(100),
      abbreviation: z.string().regex(/^[A-Z0-9-]{1,10}$/),
      numberFormat: z.string().min(5).max(80).refine((f) => /\{SEQ(:\d+)?\}/.test(f), 'Format must include {SEQ}').refine((f) => f.includes('{PROJECT}') || f.includes('{ABBR}'), 'Include {PROJECT} or {ABBR} to keep numbers unique'),
      resetPolicy: z.enum(['NEVER', 'YEARLY', 'MONTHLY']),
      requiredAttachments: z.coerce.number().int().min(0).max(10),
      isActive: z.boolean(),
    }),
    req.body,
  );
  if (data.resetPolicy !== 'NEVER' && !/\{YY(YY)?\}/.test(data.numberFormat)) throw validationError('Formats that reset yearly or monthly must include {YYYY} or {YY} (and {MM} for monthly) to stay unique');
  if (data.resetPolicy === 'MONTHLY' && !data.numberFormat.includes('{MM}')) throw validationError('Monthly reset requires {MM} in the format');
  const before = await prisma.documentType.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId } });
  if (!before) throw notFound('Document type');
  const u = await prisma.documentType.update({ where: { id: before.id }, data });
  await audit(prisma, ctx, { action: 'DOCTYPE_UPDATED', entityType: 'documentType', entityId: u.id, before, after: u });
  res.json(u);
});

// ───────── Workflows ─────────

adminRouter.get('/workflows', async (req, res) => {
  const ctx = ctxOf(req);
  res.json(await prisma.workflowDefinition.findMany({ where: { orgId: ctx.orgId }, include: { steps: { orderBy: { stepNo: 'asc' } } }, orderBy: [{ docType: 'asc' }, { projectId: 'asc' }] }));
});

const workflowSchema = z.object({
  docType: z.string(),
  projectId: z.string().nullish(),
  name: z.string().min(2).max(200),
  isActive: z.boolean().default(true),
  allowSelfApproval: z.boolean().default(false),
  steps: z
    .array(
      z.object({
        stepNo: z.coerce.number().int().min(1).max(20),
        name: z.string().min(2).max(100),
        approverRoleCode: z.string().nullish(),
        approverUserId: z.string().nullish(),
        minAmount: zDecimal(2).nullish(),
        maxAmount: zDecimal(2).nullish(),
        requiredApprovals: z.coerce.number().int().min(1).max(10).default(1),
        slaHours: z.coerce.number().int().min(1).max(720).default(48),
        escalateToRoleCode: z.string().nullish(),
      }),
    )
    .min(1),
});

adminRouter.put('/workflows', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'settings.manage');
  const data = parseBody(workflowSchema, req.body);
  if (!DEFAULT_DOC_TYPES.some((d) => d.code === data.docType && d.workflow)) throw validationError('This document type is not approval-controlled');
  for (const s of data.steps) if (!s.approverRoleCode && !s.approverUserId) throw validationError(`Step ${s.stepNo}: choose an approver role or user`);
  if (new Set(data.steps.map((s) => s.stepNo)).size !== data.steps.length) throw validationError('Step numbers must be unique');
  const out = await transaction(async (tx) => {
    if (data.projectId) {
      const p = await tx.project.findFirst({ where: { id: data.projectId, orgId: ctx.orgId } });
      if (!p) throw notFound('Project');
    }
    const roleCodes = data.steps.flatMap((s) => [s.approverRoleCode, s.escalateToRoleCode]).filter((x): x is string => !!x);
    const roles = await tx.role.findMany({ where: { orgId: ctx.orgId, code: { in: roleCodes } } });
    if (new Set(roleCodes).size !== roles.length) throw validationError('Unknown approver role');
    const existing = await tx.workflowDefinition.findFirst({ where: { orgId: ctx.orgId, projectId: data.projectId ?? null, docType: data.docType }, include: { steps: true } });
    const def = existing
      ? await tx.workflowDefinition.update({ where: { id: existing.id }, data: { name: data.name, isActive: data.isActive, allowSelfApproval: data.allowSelfApproval } })
      : await tx.workflowDefinition.create({ data: { orgId: ctx.orgId, projectId: data.projectId ?? null, docType: data.docType, name: data.name, isActive: data.isActive, allowSelfApproval: data.allowSelfApproval } });
    await tx.workflowStep.deleteMany({ where: { definitionId: def.id } });
    await tx.workflowStep.createMany({ data: data.steps.map((s) => ({ ...s, definitionId: def.id, approverRoleCode: s.approverRoleCode ?? null, approverUserId: s.approverUserId ?? null, minAmount: s.minAmount ?? null, maxAmount: s.maxAmount ?? null, escalateToRoleCode: s.escalateToRoleCode ?? null })) });
    await audit(tx, ctx, { action: 'WORKFLOW_SAVED', entityType: 'workflowDefinition', entityId: def.id, projectId: data.projectId ?? null, summary: `Workflow for ${data.docType} saved (${data.steps.length} steps). Pending requests keep the steps resolved at submission.`, before: existing ?? undefined, after: data });
    return def;
  });
  res.json(out);
});

// ───────── Responsibility matrix (RACI) ─────────

adminRouter.get('/responsibility', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  const rows = await prisma.responsibilityAssignment.findMany({ where: { orgId: ctx.orgId, ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}) }, orderBy: [{ processType: 'asc' }, { projectId: 'asc' }] });
  const users = new Map((await prisma.user.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  res.json(rows.map((r) => ({ ...r, names: Object.fromEntries((['responsibleId', 'accountableId', 'reviewerId', 'approverId', 'backupId', 'escalationUserId'] as const).map((k) => [k, r[k] ? users.get(r[k]!) : null])) })));
});

adminRouter.put('/responsibility', async (req, res) => {
  const ctx = ctxOf(req);
  const data = parseBody(
    z.object({
      projectId: z.string().nullish(),
      processType: z.string().min(2).max(60),
      responsibleId: z.string().nullish(),
      accountableId: z.string().nullish(),
      reviewerId: z.string().nullish(),
      approverId: z.string().nullish(),
      backupId: z.string().nullish(),
      slaHours: z.coerce.number().int().min(1).max(2000).nullish(),
      escalationUserId: z.string().nullish(),
      notes: z.string().max(1000).nullish(),
    }),
    req.body,
  );
  if (data.projectId) {
    const ids = await accessibleProjectIds(prisma, ctx);
    if (!ids.includes(data.projectId)) throw notFound('Project');
    assertCan(ctx, 'team.manage', data.projectId);
  } else assertCan(ctx, 'settings.manage');
  const userIds = [data.responsibleId, data.accountableId, data.reviewerId, data.approverId, data.backupId, data.escalationUserId].filter((x): x is string => !!x);
  await assertRefsInScope(prisma, 'users', ctx.orgId, null, userIds, 'User');
  const existing = await prisma.responsibilityAssignment.findFirst({ where: { orgId: ctx.orgId, projectId: data.projectId ?? null, processType: data.processType } });
  const row = existing
    ? await prisma.responsibilityAssignment.update({ where: { id: existing.id }, data: { ...data, projectId: data.projectId ?? null } })
    : await prisma.responsibilityAssignment.create({ data: { ...data, projectId: data.projectId ?? null, orgId: ctx.orgId } });
  await audit(prisma, ctx, { action: 'RACI_SAVED', entityType: 'responsibilityAssignment', entityId: row.id, projectId: data.projectId ?? null, before: existing ?? undefined, after: row });
  res.json(row);
});

adminRouter.delete('/responsibility/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const r = await prisma.responsibilityAssignment.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId } });
  if (!r) throw notFound('Assignment');
  if (r.projectId) assertCan(ctx, 'team.manage', r.projectId);
  else assertCan(ctx, 'settings.manage');
  await prisma.responsibilityAssignment.delete({ where: { id: r.id } });
  await audit(prisma, ctx, { action: 'RACI_DELETED', entityType: 'responsibilityAssignment', entityId: r.id, before: r });
  res.json({ ok: true });
});

// ───────── Audit trail ─────────

adminRouter.get('/audit', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'audit.view');
  const { skip, take, page, pageSize } = pageParams(req);
  const ids = await accessibleProjectIds(prisma, ctx);
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  const where = {
    orgId: ctx.orgId,
    ...(projectId ? { projectId: ids.includes(projectId) ? projectId : '__none__' } : ctx.allProjects ? {} : { OR: [{ projectId: null }, { projectId: { in: ids } }] }),
    ...(typeof req.query.entityType === 'string' ? { entityType: req.query.entityType } : {}),
    ...(typeof req.query.entityId === 'string' ? { entityId: req.query.entityId } : {}),
    ...(typeof req.query.actorId === 'string' ? { actorId: req.query.actorId } : {}),
    ...(typeof req.query.action === 'string' ? { action: req.query.action } : {}),
    ...(req.query.from || req.query.to ? { createdAt: { ...(req.query.from ? { gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { lte: new Date(String(req.query.to) + 'T23:59:59Z') } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }), prisma.auditEvent.count({ where })]);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: items.map((i) => i.actorId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  res.json({ items: items.map((i) => ({ ...i, actorName: i.actorId ? users.get(i.actorId) : 'System' })), total, page, pageSize });
});

/** Record-level audit history (available to anyone who can see the record's project). */
adminRouter.get('/audit/entity', async (req, res) => {
  const ctx = ctxOf(req);
  const entityType = String(req.query.entityType ?? '');
  const entityId = String(req.query.entityId ?? '');
  const ids = await accessibleProjectIds(prisma, ctx);
  const items = await prisma.auditEvent.findMany({ where: { orgId: ctx.orgId, entityType, entityId, OR: [{ projectId: null }, { projectId: { in: ids } }] }, orderBy: { createdAt: 'desc' }, take: 200 });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: items.map((i) => i.actorId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  res.json(items.map((i) => ({ ...i, actorName: i.actorId ? users.get(i.actorId) : 'System' })));
});

// ───────── Email ─────────

adminRouter.get('/email', async (req, res) => {
  assertCan(ctxOf(req), 'integration.manage');
  res.json(emailStatus());
});

/** Sends a test email to the signed-in administrator and reports the real result. */
adminRouter.post('/email/test', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'integration.manage');
  const r = await sendEmailNow({ to: ctx.user.email, subject: 'TOPROCK test email', text: `Hello ${ctx.user.name},\n\nThis is a test email from the TOPROCK GLOBAL cost control system. If you can read this, email delivery works.`, action: { url: appLink('/'), label: 'Open TOPROCK' } });
  await audit(prisma, ctx, { action: 'EMAIL_TEST', entityType: 'integrationConfig', entityId: 'email', summary: r.sent ? `Test email sent to ${ctx.user.email}` : `Test email failed: ${r.error}` });
  res.json({ ...r, to: ctx.user.email });
});

// ───────── Integrations (interfaces only) ─────────

export const INTEGRATION_CATALOG = [
  { provider: 'tally', kind: 'ACCOUNTING', name: 'Tally ERP / TallyPrime', fields: ['host', 'company'] },
  { provider: 'sap', kind: 'ERP', name: 'SAP S/4HANA', fields: ['baseUrl', 'client'] },
  { provider: 'zoho-books', kind: 'ACCOUNTING', name: 'Zoho Books', fields: ['organisationId', 'region'] },
  { provider: 'payroll-generic', kind: 'PAYROLL', name: 'Payroll (CSV / API)', fields: ['endpoint'] },
  { provider: 's3', kind: 'STORAGE', name: 'S3-compatible object storage', fields: ['bucket', 'region', 'endpoint'] },
  { provider: 'primavera', kind: 'SCHEDULING', name: 'Oracle Primavera P6 (XER import)', fields: ['notes'] },
  { provider: 'ms-project', kind: 'SCHEDULING', name: 'Microsoft Project (XML import)', fields: ['notes'] },
];

adminRouter.get('/integrations', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'integration.manage');
  const rows = await prisma.integrationConfig.findMany({ where: { orgId: ctx.orgId } });
  res.json(INTEGRATION_CATALOG.map((c) => ({ ...c, config: rows.find((r) => r.provider === c.provider) ?? null })));
});

adminRouter.put('/integrations/:provider', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'integration.manage');
  const cat = INTEGRATION_CATALOG.find((c) => c.provider === param(req, 'provider'));
  if (!cat) throw notFound('Integration');
  const { config: cfg } = parseBody(z.object({ config: z.record(z.string(), z.string().max(500)) }), req.body);
  const secretLike = Object.keys(cfg).filter((k) => /secret|password|token|key/i.test(k));
  if (secretLike.length) throw validationError('Secrets must be provided through environment variables, not stored here');
  const row = await prisma.integrationConfig.upsert({
    where: { orgId_provider: { orgId: ctx.orgId, provider: cat.provider } },
    create: { orgId: ctx.orgId, provider: cat.provider, kind: cat.kind, status: 'CONFIGURED_UNTESTED', config: cfg },
    update: { config: cfg, status: 'CONFIGURED_UNTESTED' },
  });
  await audit(prisma, ctx, { action: 'INTEGRATION_CONFIGURED', entityType: 'integrationConfig', entityId: row.id, after: cfg });
  res.json(row);
});

/** No connector is implemented, so a test can never report success. */
adminRouter.post('/integrations/:provider/test', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'integration.manage');
  const row = await prisma.integrationConfig.findUnique({ where: { orgId_provider: { orgId: ctx.orgId, provider: param(req, 'provider') } } });
  if (!row) throw notFound('Integration configuration');
  const result = 'Connector not implemented in this release — integration remains inactive. No external system was contacted.';
  const u = await prisma.integrationConfig.update({ where: { id: row.id }, data: { lastTestAt: new Date(), lastTestResult: result, status: 'CONFIGURED_UNTESTED' } });
  await audit(prisma, ctx, { action: 'INTEGRATION_TEST', entityType: 'integrationConfig', entityId: row.id, summary: result });
  res.json(u);
});
