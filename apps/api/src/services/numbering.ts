import crypto from 'node:crypto';
import { DEFAULT_DOC_TYPES, formatDocNumber, sequenceScope } from '@toprock/shared';
import type { Db } from '../lib/prisma.js';

/**
 * Allocates the next document number atomically. INSERT … ON CONFLICT DO UPDATE takes a row
 * lock, so concurrent transactions serialise on the sequence row; each document table also
 * has a unique constraint on its number as a second line of defence.
 */
export async function nextNumber(db: Db, args: { orgId: string; projectId?: string | null; docType: string; date?: Date }): Promise<string> {
  const date = args.date ?? new Date();
  const configured = await db.documentType.findUnique({ where: { orgId_code: { orgId: args.orgId, code: args.docType } } });
  const def = configured ?? DEFAULT_DOC_TYPES.find((d) => d.code === args.docType);
  if (!def) throw new Error(`Unknown document type ${args.docType}`);
  let projectCode = 'ORG';
  if (args.projectId) {
    const p = await db.project.findUnique({ where: { id: args.projectId }, select: { code: true } });
    projectCode = p?.code ?? 'ORG';
  }
  const scope = sequenceScope(args.projectId ?? 'org', def.resetPolicy as 'NEVER' | 'YEARLY' | 'MONTHLY', date);
  const rows = await db.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "NumberSequence" ("id", "orgId", "docType", "scopeKey", "lastValue")
    VALUES (${crypto.randomUUID()}, ${args.orgId}, ${args.docType}, ${scope}, 1)
    ON CONFLICT ("orgId", "docType", "scopeKey") DO UPDATE SET "lastValue" = "NumberSequence"."lastValue" + 1
    RETURNING "lastValue"`;
  return formatDocNumber(def.numberFormat, { project: projectCode, abbr: def.abbreviation, date, seq: Number(rows[0].lastValue) });
}
