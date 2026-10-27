import type { Db } from '../lib/prisma.js';
import type { AccessContext } from './access.js';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

function clean(v: unknown): unknown {
  if (v === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val) => (['passwordHash', 'mfaSecret', 'tokenHash'].includes(k) ? '[redacted]' : val)),
  );
}

/** Shallow diff: only keys whose JSON value changed. */
export function diff(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined) {
  if (!before || !after) return { before, after };
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'updatedAt') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}

export async function audit(db: Db, ctx: Pick<AccessContext, 'orgId' | 'user' | 'ip' | 'userAgent'> | { orgId: string; user?: undefined; ip?: string; userAgent?: string }, input: AuditInput) {
  await db.auditEvent.create({
    data: {
      orgId: ctx.orgId,
      actorId: ctx.user?.id ?? null,
      projectId: input.projectId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary?.slice(0, 500),
      before: clean(input.before) as never,
      after: clean(input.after) as never,
      reason: input.reason ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent?.slice(0, 300) ?? null,
    },
  });
}
