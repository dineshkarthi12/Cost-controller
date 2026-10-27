import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { pageParams, param, parseBody } from '../lib/http.js';
import { ctxOf } from '../middleware/auth.js';

export const notificationsRouter = Router();

export const NOTIFICATION_TYPES = [
  'TASK_ASSIGNED',
  'TASK_DUE_SOON',
  'TASK_OVERDUE',
  'TASK_ESCALATED',
  'TASK_REVIEW',
  'APPROVAL_PENDING',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'APPROVAL_ESCALATED',
  'CHANGES_REQUESTED',
  'MEASUREMENT_VERIFICATION',
  'MEASUREMENT_VERIFIED',
  'EVIDENCE_REVIEW',
  'DELIVERY_DELAYED',
  'BUDGET_THRESHOLD',
  'FORECAST_OVERRUN',
  'MISSING_DAILY_REPORT',
  'PAYMENT_DUE',
  'CONTRACTOR_BILL_DUE',
  'CONTRACT_EXPIRY',
  'DRAWING_REVISION',
  'RISK_ESCALATION',
  'MONTH_END_DEADLINE',
  'MENTION',
] as const;

notificationsRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  const { skip, take, page, pageSize } = pageParams(req, 100);
  const where = { userId: ctx.user.id, ...(req.query.unread === 'true' ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
  ]);
  res.json({ items, total, page, pageSize, unread });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const ctx = ctxOf(req);
  await prisma.notification.updateMany({ where: { id: param(req, 'id'), userId: ctx.user.id }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const ctx = ctxOf(req);
  await prisma.notification.updateMany({ where: { userId: ctx.user.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

notificationsRouter.get('/preferences', async (req, res) => {
  const ctx = ctxOf(req);
  const prefs = await prisma.notificationPreference.findMany({ where: { userId: ctx.user.id } });
  res.json(NOTIFICATION_TYPES.map((type) => ({ type, inApp: prefs.find((p) => p.type === type)?.inApp ?? true, email: prefs.find((p) => p.type === type)?.email ?? false })));
});

notificationsRouter.put('/preferences', async (req, res) => {
  const ctx = ctxOf(req);
  const data = parseBody(z.object({ preferences: z.array(z.object({ type: z.enum(NOTIFICATION_TYPES), inApp: z.boolean(), email: z.boolean() })) }), req.body);
  for (const p of data.preferences) {
    await prisma.notificationPreference.upsert({ where: { userId_type: { userId: ctx.user.id, type: p.type } }, create: { userId: ctx.user.id, ...p }, update: { inApp: p.inApp, email: p.email } });
  }
  res.json({ ok: true });
});
