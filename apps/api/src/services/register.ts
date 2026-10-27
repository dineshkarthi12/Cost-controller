import type { Db } from '../lib/prisma.js';

/** Keeps the cross-module document register in sync. */
export async function upsertRegister(
  db: Db,
  e: { orgId: string; projectId?: string | null; docType: string; number: string; entityType: string; entityId: string; title?: string | null; status?: string | null; ownerId?: string | null; amount?: string | null },
) {
  const data = {
    orgId: e.orgId,
    projectId: e.projectId ?? null,
    docType: e.docType,
    number: e.number,
    entityType: e.entityType,
    entityId: e.entityId,
    title: e.title?.slice(0, 300) ?? null,
    status: e.status ?? null,
    ownerId: e.ownerId ?? null,
    amount: e.amount ?? null,
  };
  await db.registerEntry.upsert({ where: { entityType_entityId: { entityType: e.entityType, entityId: e.entityId } }, create: data, update: data });
}

export async function setRegisterStatus(db: Db, entityType: string, entityId: string, status: string) {
  await db.registerEntry.updateMany({ where: { entityType, entityId }, data: { status } });
}
