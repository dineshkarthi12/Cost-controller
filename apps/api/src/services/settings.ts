import { z } from 'zod';
import { MODULES, MODULES_ADDED_LATER } from '@toprock/shared';
import type { Db } from '../lib/prisma.js';

export const orgSettingsSchema = z.object({
  taxIsCost: z.boolean().default(false),
  manpowerUniqueness: z.enum(['PROJECT_DATE_SHIFT_CONTRACTOR', 'PROJECT_DATE_SHIFT']).default('PROJECT_DATE_SHIFT_CONTRACTOR'),
  budgetCheckMode: z.enum(['WARN', 'BLOCK']).default('WARN'),
  priceTolerancePct: z.string().regex(/^\d+(\.\d+)?$/).default('0.02'),
  overReceiptTolerancePct: z.string().regex(/^\d+(\.\d+)?$/).default('0.00'),
  /**
   * Match check on MR / PR / PO approval (BOM, source document, quotation, budget).
   * ENFORCE: materials outside the BOM cannot be approved; other differences need a reason and an attachment.
   * WARN: the check is shown but never blocks.
   */
  purchaseMatchCheck: z.enum(['ENFORCE', 'WARN']).default('ENFORCE'),
  /** Quantity tolerance of the match check (fraction; 0.05 = 5 %). The rate tolerance is priceTolerancePct. */
  qtyTolerancePct: z.string().regex(/^\d+(\.\d+)?$/).default('0.05'),
  alertWarnPct: z.string().regex(/^\d+(\.\d+)?$/).default('0.95'),
  measurementDuplicateMode: z.enum(['BLOCK_UNLESS_REASON', 'WARN']).default('BLOCK_UNLESS_REASON'),
  autoBudgetRevisionFromVariation: z.boolean().default(true),
  /** Approved purchase orders set each material's standard rate to the latest purchase rate. */
  updateStandardRateFromPo: z.boolean().default(true),
  visibleModules: z.array(z.string()).default(MODULES.map((m) => m.key)),
  /** Later modules already offered to this organisation (so hiding one sticks). */
  modulesOffered: z.array(z.string()).default([]),
  rounding: z.enum(['HALF_UP']).default('HALF_UP'),
  dataRetentionYears: z.number().int().min(1).max(50).default(10),
  // Daily labour report day rates (defaults from TOPROCK's productivity workbook); each report keeps the rates it was created with.
  masonDayRate: z.string().regex(/^\d+(\.\d{1,2})?$/).default('1300'),
  helperDayRate: z.string().regex(/^\d+(\.\d{1,2})?$/).default('1000'),
  /** People reports are sent to on WhatsApp in one click (e.g. the Executive Director). */
  whatsappContacts: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Enter a name').max(80),
        role: z.string().trim().max(80).default(''),
        phone: z.string().trim().regex(/^\+?[\d\s()-]{8,20}$/, 'Enter a mobile number with country code, e.g. +91 98765 43210'),
        email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]).default(''),
        /** Gets the end-of-day pack. */
        dailyPack: z.boolean().default(true),
      }),
    )
    .max(20)
    .default([]),
  /** End-of-day pack: sent (or, without the WhatsApp Business API, prepared with a reminder) at this local time. */
  dailyPackAuto: z.boolean().default(false),
  dailyPackTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 18:30').default('18:30'),
  /** Evening reminders to site engineers (DPR, MPR, daily labour report) and the QS team (daily work report) for reports still missing today. */
  reportReminders: z.boolean().default(true),
  reportReminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 18:00').default('18:00'),
});

export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export async function getOrgSettings(db: Db, orgId: string): Promise<OrgSettings> {
  const org = await db.organisation.findUnique({ where: { id: orgId }, select: { settings: true } });
  const s = orgSettingsSchema.parse(org?.settings ?? {});
  // Modules added after the organisation was set up are shown until an administrator hides them.
  for (const k of MODULES_ADDED_LATER) {
    if (s.modulesOffered.includes(k)) continue;
    if (!s.visibleModules.includes(k)) s.visibleModules.push(k);
    s.modulesOffered.push(k);
  }
  return s;
}
