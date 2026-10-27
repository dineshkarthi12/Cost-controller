import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { MODULES } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { config } from '../config.js';
import { parseBody } from '../lib/http.js';
import { badRequest, unauthorized, validationError, forbidden } from '../lib/errors.js';
import { hashPassword, verifyPassword, randomToken, sha256, passwordPolicyErrors, generateTotpSecret, verifyTotp } from '../lib/crypto.js';
import { requireAuth, ctxOf } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { permissionsFor, roleCodesFor, accessibleProjectIds } from '../services/access.js';
import { getOrgSettings } from '../services/settings.js';
import { logger } from '../lib/logger.js';

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: config.relaxedLimits ? 10_000 : 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' } } });

function cookieOpts(maxAgeMs: number) {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax' as const, path: '/', maxAge: maxAgeMs };
}

async function startSession(userId: string, ip: string | undefined, ua: string | undefined, mfaPending: boolean) {
  const token = randomToken();
  const ttl = mfaPending ? 10 * 60_000 : config.sessionTtlHours * 3600_000;
  await prisma.session.create({ data: { userId, tokenHash: sha256(token), mfaPending, ip, userAgent: ua?.slice(0, 300), expiresAt: new Date(Date.now() + ttl) } });
  return { token, ttl };
}

const MAX_FAILED = 5;

authRouter.post('/login', limiter, async (req, res) => {
  const { email, password } = parseBody(z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const generic = unauthorized('Invalid email or password');
  if (!user || user.status !== 'ACTIVE') {
    await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'); // equalise timing
    throw generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw forbidden('Account temporarily locked after repeated failed sign-ins. Try again later or reset your password.');
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + 15 * 60_000) : null } });
    await audit(prisma, { orgId: user.orgId, ip: req.ip, userAgent: req.get('user-agent') }, { action: 'LOGIN_FAILED', entityType: 'user', entityId: user.id, summary: `Failed sign-in for ${user.email}` });
    throw generic;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  const { token, ttl } = await startSession(user.id, req.ip, req.get('user-agent'), user.mfaEnabled);
  res.cookie(config.cookieName, token, cookieOpts(ttl));
  if (user.mfaEnabled) return res.json({ mfaRequired: true });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(prisma, { orgId: user.orgId, ip: req.ip, userAgent: req.get('user-agent') }, { action: 'LOGIN', entityType: 'user', entityId: user.id, summary: `${user.email} signed in` });
  res.json({ mfaRequired: false });
});

authRouter.post('/mfa/verify', limiter, async (req, res) => {
  const { code } = parseBody(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  const token = req.cookies?.[config.cookieName];
  if (!token) throw unauthorized();
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || !session.mfaPending || session.revokedAt || session.expiresAt < new Date() || !session.user.mfaSecret) throw unauthorized('Sign in again');
  if (!verifyTotp(session.user.mfaSecret, code)) throw unauthorized('Invalid verification code');
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  const fresh = await startSession(session.userId, req.ip, req.get('user-agent'), false);
  res.cookie(config.cookieName, fresh.token, cookieOpts(fresh.ttl));
  await prisma.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
  await audit(prisma, { orgId: session.user.orgId, ip: req.ip }, { action: 'LOGIN', entityType: 'user', entityId: session.userId, summary: `${session.user.email} signed in (MFA)` });
  res.json({ ok: true });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[config.cookieName];
  if (token) await prisma.session.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  res.clearCookie(config.cookieName, { path: '/' });
  res.json({ ok: true });
});

authRouter.post('/password/forgot', limiter, async (req, res) => {
  const { email } = parseBody(z.object({ email: z.string().email() }), req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  let devToken: string | undefined;
  if (user && user.status === 'ACTIVE') {
    const token = randomToken();
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60_000) } });
    // Email transport is not active; the link is logged in development only.
    if (!config.isProd) {
      logger.info({ link: `${config.appBaseUrl}/reset-password?token=${token}` }, 'password reset link (development only)');
      devToken = token;
    }
    await audit(prisma, { orgId: user.orgId, ip: req.ip }, { action: 'PASSWORD_RESET_REQUESTED', entityType: 'user', entityId: user.id });
  }
  // Same response whether or not the account exists.
  res.json({ ok: true, ...(devToken && !config.isProd ? { devToken } : {}) });
});

authRouter.post('/password/reset', limiter, async (req, res) => {
  const { token, password } = parseBody(z.object({ token: z.string().min(10), password: z.string().max(200) }), req.body);
  const errs = passwordPolicyErrors(password);
  if (errs.length) throw validationError(`Password needs ${errs.join(', ')}`);
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw badRequest('This reset link is invalid or has expired');
  await transaction(async (tx) => {
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { orgId: row.user.orgId, ip: req.ip }, { action: 'PASSWORD_RESET', entityType: 'user', entityId: row.userId });
  });
  res.json({ ok: true });
});

authRouter.post('/invitations/accept', limiter, async (req, res) => {
  const { token, password } = parseBody(z.object({ token: z.string().min(10), password: z.string().max(200) }), req.body);
  const errs = passwordPolicyErrors(password);
  if (errs.length) throw validationError(`Password needs ${errs.join(', ')}`);
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw badRequest('This invitation is invalid or has expired');
  await transaction(async (tx) => {
    const user = await tx.user.update({ where: { email: inv.email }, data: { passwordHash: await hashPassword(password), status: 'ACTIVE', passwordChangedAt: new Date() } });
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await audit(tx, { orgId: inv.orgId, ip: req.ip }, { action: 'INVITATION_ACCEPTED', entityType: 'user', entityId: user.id });
  });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
  const [user, org, projectIds] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { id: true, name: true, email: true, designation: true, department: true, mfaEnabled: true, employeeId: true } }),
    prisma.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { id: true, name: true, code: true, baseCurrency: true, isDemo: true } }),
    accessibleProjectIds(prisma, ctx),
  ]);
  const projects = await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, code: true, name: true, status: true, currency: true, isDemo: true, location: true }, orderBy: { name: 'asc' } });
  const settings = await getOrgSettings(prisma, ctx.orgId);
  const validProject = projectId && projectIds.includes(projectId) ? projectId : null;
  res.json({
    user,
    org,
    projects,
    permissions: permissionsFor(ctx, validProject),
    roles: roleCodesFor(ctx, validProject),
    visibleModules: settings.visibleModules.filter((k) => MODULES.some((m) => m.key === k)),
  });
});

authRouter.post('/password/change', requireAuth, async (req, res) => {
  const ctx = ctxOf(req);
  const { currentPassword, newPassword } = parseBody(z.object({ currentPassword: z.string(), newPassword: z.string().max(200) }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw unauthorized('Current password is incorrect');
  const errs = passwordPolicyErrors(newPassword);
  if (errs.length) throw validationError(`Password needs ${errs.join(', ')}`);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() } });
  await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: ctx.sessionId } }, data: { revokedAt: new Date() } });
  await audit(prisma, ctx, { action: 'PASSWORD_CHANGED', entityType: 'user', entityId: user.id });
  res.json({ ok: true });
});

authRouter.get('/sessions', requireAuth, async (req, res) => {
  const ctx = ctxOf(req);
  const sessions = await prisma.session.findMany({ where: { userId: ctx.user.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true }, orderBy: { lastSeenAt: 'desc' } });
  res.json(sessions.map((s) => ({ ...s, current: s.id === ctx.sessionId })));
});

authRouter.post('/sessions/:id/revoke', requireAuth, async (req, res) => {
  const ctx = ctxOf(req);
  await prisma.session.updateMany({ where: { id: String(req.params.id), userId: ctx.user.id }, data: { revokedAt: new Date() } });
  await audit(prisma, ctx, { action: 'SESSION_REVOKED', entityType: 'session', entityId: String(req.params.id) });
  res.json({ ok: true });
});

// Optional MFA enrolment (TOTP). Secret is shown once; enabling requires a valid code.
authRouter.post('/mfa/setup', requireAuth, async (req, res) => {
  const ctx = ctxOf(req);
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: ctx.user.id }, data: { mfaSecret: secret, mfaEnabled: false } });
  res.json({ secret, otpauthUrl: `otpauth://totp/TOPROCK:${encodeURIComponent(ctx.user.email)}?secret=${secret}&issuer=TOPROCK%20GLOBAL` });
});

authRouter.post('/mfa/enable', requireAuth, async (req, res) => {
  const ctx = ctxOf(req);
  const { code } = parseBody(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (!user.mfaSecret || !verifyTotp(user.mfaSecret, code)) throw validationError('Invalid verification code');
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
  await audit(prisma, ctx, { action: 'MFA_ENABLED', entityType: 'user', entityId: user.id });
  res.json({ ok: true });
});

authRouter.post('/mfa/disable', requireAuth, async (req, res) => {
  const ctx = ctxOf(req);
  const { password } = parseBody(z.object({ password: z.string() }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (!(await verifyPassword(password, user.passwordHash))) throw unauthorized('Password is incorrect');
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null } });
  await audit(prisma, ctx, { action: 'MFA_DISABLED', entityType: 'user', entityId: user.id });
  res.json({ ok: true });
});
