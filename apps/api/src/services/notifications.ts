import { afterCommit, type Db } from '../lib/prisma.js';
import { appLink, emailConfigured, sendEmail } from './email.js';

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
 * Types emailed by default (when email is configured) unless the user turns email off for that
 * type. Everything else is emailed only when the user opts in. In-app delivery follows `inApp`.
 */
export const EMAIL_BY_DEFAULT = new Set(['APPROVAL_PENDING', 'APPROVAL_ESCALATED', 'CHANGES_REQUESTED', 'APPROVAL_REJECTED', 'APPROVAL_APPROVED', 'TASK_ASSIGNED', 'TASK_ESCALATED']);

/** Creates in-app notifications and (after the transaction commits) emails, honouring preferences. */
export async function notify(db: Db, n: NotifyInput) {
  const userIds = [...new Set(n.userIds.filter(Boolean))];
  if (userIds.length === 0) return;
  const prefs = await db.notificationPreference.findMany({ where: { userId: { in: userIds }, type: n.type } });
  const muted = new Set(prefs.filter((p) => !p.inApp).map((p) => p.userId));
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
  if (!emailConfigured()) return;
  const pref = new Map(prefs.map((p) => [p.userId, p]));
  const emailIds = userIds.filter((u) => (pref.has(u) ? pref.get(u)!.email : EMAIL_BY_DEFAULT.has(n.type)));
  if (!emailIds.length) return;
  // Repeated alerts with the same dedupe key are not emailed again.
  const fresh = n.dedupeKey ? (await db.notification.findMany({ where: { dedupeKey: n.dedupeKey, userId: { in: emailIds } }, select: { userId: true, createdAt: true } })).filter((x) => Date.now() - x.createdAt.getTime() < 60_000).map((x) => x.userId) : emailIds;
  const users = await db.user.findMany({ where: { id: { in: fresh }, status: 'ACTIVE' }, select: { email: true, name: true } });
  afterCommit(() => {
    for (const u of users) {
      void sendEmail({ to: u.email, subject: n.title, text: `Hello ${u.name},\n\n${n.title}${n.body ? `\n\n${n.body}` : ''}`, action: n.link ? { url: appLink(n.link), label: 'Open in TOPROCK' } : undefined });
    }
  });
}
