import { Router } from 'express';
import { z } from 'zod';
import { D, zDate, zDecimal, RESOURCES } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { validationError, businessRule } from '../lib/errors.js';
import { isoDate, toDateOnly } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { createResource } from '../resources/router.js';

export const manpowerRouter = Router({ mergeParams: true });

manpowerRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

/** Attendance register for a date: every active worker with their record (if any). */
manpowerRouter.get('/attendance', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'manpower.view', projectId);
  const date = toDateOnly(String(req.query.date ?? new Date().toISOString()))!;
  const shift = typeof req.query.shift === 'string' ? req.query.shift : 'DAY';
  const workers = await prisma.worker.findMany({ where: { projectId, isActive: true }, orderBy: [{ trade: 'asc' }, { name: 'asc' }], include: { contractor: { select: { name: true } } } });
  const recs = await prisma.attendanceRecord.findMany({ where: { projectId, date, shift } });
  res.json({ date: isoDate(date), shift, rows: workers.map((w) => ({ worker: w, record: recs.find((r) => r.workerId === w.id) ?? null })) });
});

const attendanceSchema = z.object({
  date: zDate,
  shift: z.enum(['DAY', 'NIGHT', 'GENERAL']).default('DAY'),
  correctionReason: z.string().max(500).optional(),
  records: z.array(z.object({ workerId: z.string(), status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE']), regularHours: zDecimal(2).default('0'), overtimeHours: zDecimal(2).default('0') })).min(1),
});

/** Saves attendance. Changes to existing records require a correction reason and are audited. */
manpowerRouter.post('/attendance', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'manpower.manage', projectId);
  const data = parseBody(attendanceSchema, req.body);
  const date = toDateOnly(data.date)!;
  if (date > new Date()) throw validationError('Attendance cannot be recorded for a future date');
  const result = await transaction(async (tx) => {
    const workers = await tx.worker.findMany({ where: { projectId, id: { in: data.records.map((r) => r.workerId) } } });
    if (workers.length !== new Set(data.records.map((r) => r.workerId)).size) throw validationError('Worker not found in this project');
    const verified = await tx.manpowerReport.count({ where: { projectId, date, shift: data.shift, status: 'VERIFIED' } });
    let created = 0;
    let corrected = 0;
    for (const r of data.records) {
      if (D(r.regularHours).plus(D(r.overtimeHours)).gt(24)) throw validationError('Hours cannot exceed 24');
      const existing = await tx.attendanceRecord.findUnique({ where: { workerId_date_shift: { workerId: r.workerId, date, shift: data.shift } } });
      if (!existing) {
        await tx.attendanceRecord.create({ data: { projectId, workerId: r.workerId, date, shift: data.shift, status: r.status, regularHours: r.regularHours, overtimeHours: r.overtimeHours, createdById: ctx.user.id } });
        created++;
        continue;
      }
      const changed = existing.status !== r.status || !D(existing.regularHours).eq(D(r.regularHours)) || !D(existing.overtimeHours).eq(D(r.overtimeHours));
      if (!changed) continue;
      if (!data.correctionReason?.trim()) throw validationError('Changing saved attendance requires a correction reason');
      if (verified) throw businessRule('The manpower report for this date is verified. Corrections need the MPR to be returned first.');
      await tx.attendanceRecord.update({ where: { id: existing.id }, data: { status: r.status, regularHours: r.regularHours, overtimeHours: r.overtimeHours, correctionReason: data.correctionReason, correctedById: ctx.user.id } });
      await audit(tx, ctx, { action: 'ATTENDANCE_CORRECTED', entityType: 'attendanceRecord', entityId: existing.id, projectId, before: { status: existing.status, regularHours: existing.regularHours, overtimeHours: existing.overtimeHours }, after: r, reason: data.correctionReason });
      corrected++;
    }
    return { created, corrected };
  });
  res.json(result);
});

/** Builds a draft MPR from the attendance register (grouped by contractor and trade). */
manpowerRouter.post('/attendance/to-mpr', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  const { date, shift, contractorId, costCodeId } = parseBody(z.object({ date: zDate, shift: z.enum(['DAY', 'NIGHT', 'GENERAL']).default('DAY'), contractorId: z.string().nullish(), costCodeId: z.string().optional() }), req.body);
  const recs = await prisma.attendanceRecord.findMany({ where: { projectId, date: toDateOnly(date)!, shift, status: { in: ['PRESENT', 'HALF_DAY'] }, worker: { contractorId: contractorId ?? null } }, include: { worker: true } });
  if (!recs.length) throw businessRule('No attendance recorded for this date and contractor');
  const groups = new Map<string, typeof recs>();
  for (const r of recs) groups.set(`${r.worker.trade}|${r.worker.category}|${r.worker.hourlyRate}`, [...(groups.get(`${r.worker.trade}|${r.worker.category}|${r.worker.hourlyRate}`) ?? []), r]);
  const lines = [...groups.values()].map((g) => {
    const n = g.length;
    const reg = g.reduce((a, r) => a.plus(D(r.regularHours)), D(0)).div(n);
    const ot = g.reduce((a, r) => a.plus(D(r.overtimeHours)), D(0)).div(n);
    const rate = D(g[0].worker.hourlyRate);
    return { trade: g[0].worker.trade, category: g[0].worker.category, plannedCount: n, actualCount: n, regularHours: reg.toFixed(2), overtimeHours: ot.toFixed(2), hourlyRate: rate.toFixed(4), overtimeRate: rate.times(1.5).toFixed(4), chargeable: !contractorId, costCodeId: costCodeId ?? undefined };
  });
  const mpr = await createResource(ctx, RESOURCES.manpowerReports, { orgId: ctx.orgId, projectId }, { date, shift, contractorId: contractorId ?? undefined, remarks: `Generated from attendance register (${recs.length} workers)`, lines });
  res.status(201).json(mpr);
});
