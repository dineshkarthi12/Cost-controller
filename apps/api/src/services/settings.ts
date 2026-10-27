import { z } from 'zod';
import { MODULES } from '@toprock/shared';
import type { Db } from '../lib/prisma.js';

export const orgSettingsSchema = z.object({
  taxIsCost: z.boolean().default(false),
  manpowerUniqueness: z.enum(['PROJECT_DATE_SHIFT_CONTRACTOR', 'PROJECT_DATE_SHIFT']).default('PROJECT_DATE_SHIFT_CONTRACTOR'),
  budgetCheckMode: z.enum(['WARN', 'BLOCK']).default('WARN'),
  priceTolerancePct: z.string().regex(/^\d+(\.\d+)?$/).default('0.02'),
  overReceiptTolerancePct: z.string().regex(/^\d+(\.\d+)?$/).default('0.00'),
  alertWarnPct: z.string().regex(/^\d+(\.\d+)?$/).default('0.95'),
  measurementDuplicateMode: z.enum(['BLOCK_UNLESS_REASON', 'WARN']).default('BLOCK_UNLESS_REASON'),
  autoBudgetRevisionFromVariation: z.boolean().default(true),
  visibleModules: z.array(z.string()).default(MODULES.map((m) => m.key)),
  rounding: z.enum(['HALF_UP']).default('HALF_UP'),
  dataRetentionYears: z.number().int().min(1).max(50).default(10),
});

export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export async function getOrgSettings(db: Db, orgId: string): Promise<OrgSettings> {
  const org = await db.organisation.findUnique({ where: { id: orgId }, select: { settings: true } });
  return orgSettingsSchema.parse(org?.settings ?? {});
}
