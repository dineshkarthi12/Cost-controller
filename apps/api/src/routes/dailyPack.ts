import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { parseBody } from '../lib/http.js';
import { isoDate, today } from '../lib/dates.js';
import { AppError, validationError } from '../lib/errors.js';
import { ctxOf } from '../middleware/auth.js';
import { accessibleProjectIds, type AccessContext } from '../services/access.js';
import { audit } from '../services/audit.js';
import { getOrgSettings } from '../services/settings.js';
import { emailConfigured } from '../services/email.js';
import { whatsappApiConfigured } from '../services/whatsappApi.js';
import { buildDailyPack, packLink, packMessage, readPackToken, sendDailyPack } from '../services/dailyPack.js';

/** /daily-pack — everything done today, on every project you can see, sent in one go at the end of the day. */
export const dailyPackRouter = Router();

const dateOf = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : isoDate(today())!);
async function projectsFor(ctx: AccessContext) {
  const ids = await accessibleProjectIds(prisma, ctx);
  return (await prisma.project.findMany({ where: { id: { in: ids }, status: { notIn: ['CLOSED', 'CANCELLED'] } }, select: { id: true } })).map((p) => p.id);
}

dailyPackRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  const date = dateOf(req.query.date);
  const projectIds = await projectsFor(ctx);
  const link = packLink(ctx.orgId, date, projectIds);
  const { text, docs } = await packMessage(ctx.orgId, date, projectIds, link);
  const s = await getOrgSettings(prisma, ctx.orgId);
  res.json({ date, docs, text, link, contacts: s.whatsappContacts.filter((c) => c.dailyPack), auto: { enabled: s.dailyPackAuto, time: s.dailyPackTime }, whatsappApi: whatsappApiConfigured(), email: emailConfigured() });
});

/** Whether automatic sending is set up (for Settings → Integrations). */
dailyPackRouter.get('/status', (_req, res) => {
  res.json({ whatsappApi: whatsappApiConfigured(), template: process.env.WHATSAPP_TEMPLATE?.trim() || 'daily_report', email: emailConfigured() });
});

dailyPackRouter.get('/pdf', async (req, res) => {
  const ctx = ctxOf(req);
  const date = dateOf(req.query.date);
  const pack = await buildDailyPack(ctx.orgId, date, await projectsFor(ctx));
  await audit(prisma, ctx, { action: 'EXPORT', entityType: 'organisation', entityId: ctx.orgId, summary: `Daily pack ${date} downloaded (${pack.docs.length} documents)` });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pack.fileName}"`);
  res.send(pack.pdf);
});

/** Sends from the server: WhatsApp Business API (when set up) and email with the PDF. */
dailyPackRouter.post('/send', async (req, res) => {
  const ctx = ctxOf(req);
  const { date } = parseBody(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body ?? {});
  const s = await getOrgSettings(prisma, ctx.orgId);
  if (!s.whatsappContacts.some((c) => c.dailyPack)) throw validationError('Add the people who get the daily pack under Settings → WhatsApp contacts');
  res.json(await sendDailyPack(ctx.orgId, dateOf(date), await projectsFor(ctx), { id: ctx.user.id }));
});

/** Records a one-click WhatsApp send from the browser. */
dailyPackRouter.post('/shared', async (req, res) => {
  const ctx = ctxOf(req);
  const { date, to } = parseBody(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().max(200).default('') }), req.body ?? {});
  await audit(prisma, ctx, { action: 'DAILY_PACK_SHARED', entityType: 'organisation', entityId: ctx.orgId, summary: `Daily pack ${date} shared on WhatsApp${to ? ` with ${to}` : ''}` });
  res.json({ ok: true });
});

/** The pack PDF behind a signed link (no login), for the person it was sent to. Valid for 7 days. */
export const publicPackRouter = Router();
publicPackRouter.get('/daily-pack/:token', async (req, res) => {
  const t = readPackToken(String(req.params.token));
  if (!t) throw new AppError(404, 'NOT_FOUND', 'This link has expired or is not valid. Ask for a new one.');
  const pack = await buildDailyPack(t.orgId, t.date, t.projectIds);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${pack.fileName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pack.pdf);
});
