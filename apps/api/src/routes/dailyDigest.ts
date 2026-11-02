import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { param } from '../lib/http.js';
import { isoDate, today } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertProjectAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { dailyDigest } from '../services/dailyDigest.js';

/** /projects/:projectId/daily-digest?date= — the day's progress as a WhatsApp message. */
export const dailyDigestRouter = Router({ mergeParams: true });

dailyDigestRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  await assertProjectAccess(prisma, ctx, projectId);
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : isoDate(today())!;
  res.json(await dailyDigest(ctx.orgId, projectId, date));
});

/** Records that a report was shared (who, what, to whom) in the audit trail. */
dailyDigestRouter.post('/shared', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  await assertProjectAccess(prisma, ctx, projectId);
  const what = String(req.body?.what ?? 'report').slice(0, 120);
  const to = String(req.body?.to ?? '').slice(0, 120);
  await audit(prisma, ctx, { action: 'SHARED_WHATSAPP', entityType: 'project', entityId: projectId, projectId, summary: `${what} shared on WhatsApp${to ? ` with ${to}` : ''}` });
  res.json({ ok: true });
});
