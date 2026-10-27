import type { Db } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export interface NotifyInput {
  userIds: string[];
  type: string;
  title: string;
  body?: string;
  link?: string;
  projectId?: string | null;
  entityType?: string;
  entityId?: string;
  /** Same key for the same user is delivered once (prevents duplicate alerts). */
  dedupeKey?: string;
}

/**
 * Creates in-app notifications honouring preferences. Email is an extensible interface:
 * no transport is active until SMTP is configured, so messages are only logged.
 */
export async function notify(db: Db, n: NotifyInput) {
  const userIds = [...new Set(n.userIds.filter(Boolean))];
  if (userIds.length === 0) return;
  const prefs = await db.notificationPreference.findMany({ where: { userId: { in: userIds }, type: n.type } });
  const muted = new Set(prefs.filter((p) => !p.inApp).map((p) => p.userId));
  const emailUsers = prefs.filter((p) => p.email).map((p) => p.userId);
  const rows = userIds
    .filter((u) => !muted.has(u))
    .map((userId) => ({
      userId,
      type: n.type,
      title: n.title.slice(0, 200),
      body: n.body?.slice(0, 1000) ?? null,
      link: n.link ?? null,
      projectId: n.projectId ?? null,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
      dedupeKey: n.dedupeKey ?? null,
    }));
  if (rows.length) await db.notification.createMany({ data: rows, skipDuplicates: true });
  if (emailUsers.length) emailTransport.send(emailUsers, n.title, n.body ?? '');
}

export const emailTransport = {
  send(userIds: string[], subject: string, _body: string) {
    logger.info({ userIds, subject }, 'email transport not configured — email not sent');
  },
};
