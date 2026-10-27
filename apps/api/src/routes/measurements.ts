import { Router } from 'express';
import { z } from 'zod';
import { measurementVariance, zDecimal } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notifications.js';
import { setRegisterStatus } from '../services/register.js';
import { usersWithRole } from '../services/access.js';

/**
 * Measurement verification (BUSINESS_RULES §4). Certification is a separate workflow step
 * (POST /r/measurements/:id/submit). A verified photo never verifies a measurement.
 */
export const measurementsRouter = Router({ mergeParams: true });

measurementsRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

async function load(projectId: string, id: string) {
  const m = await prisma.measurement.findFirst({ where: { id, projectId } });
  if (!m) throw notFound('Measurement');
  return m;
}

measurementsRouter.post('/:id/submit-for-verification', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'measurement.manage', projectId);
  const m = await load(projectId, param(req, 'id'));
  if (!['DRAFT', 'RETURNED'].includes(m.status)) throw conflict(`Cannot submit a measurement in status ${m.status}`);
  const updated = await transaction(async (tx) => {
    const u = await tx.measurement.update({ where: { id: m.id }, data: { status: 'SUBMITTED', submittedById: ctx.user.id, submittedAt: new Date() } });
    await setRegisterStatus(tx, 'measurement', m.id, 'SUBMITTED');
    await audit(tx, ctx, { action: 'SUBMIT_FOR_VERIFICATION', entityType: 'measurement', entityId: m.id, projectId, summary: `${m.number} submitted for site verification` });
    const engineers = await usersWithRole(tx, ctx.orgId, projectId, 'SITE_ENGINEER');
    const qs = await usersWithRole(tx, ctx.orgId, projectId, 'QUANTITY_SURVEYOR');
    await notify(tx, { userIds: [...engineers, ...qs].filter((u) => u !== ctx.user.id), type: 'MEASUREMENT_VERIFICATION', title: `Measurement awaiting verification: ${m.number}`, link: `/measurements/${m.id}`, projectId, entityType: 'measurement', entityId: m.id, dedupeKey: `mverify:${m.id}:${m.revision}` });
    return u;
  });
  res.json(updated);
});

measurementsRouter.post('/:id/verify', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'measurement.approve', projectId);
  const body = parseBody(z.object({ verifiedQty: zDecimal(4), note: z.string().max(2000).optional(), participants: z.array(z.string().max(200)).optional() }), req.body);
  const m = await load(projectId, param(req, 'id'));
  if (m.status !== 'SUBMITTED') throw conflict('Only submitted measurements can be verified');
  if (m.createdById === ctx.user.id || m.submittedById === ctx.user.id) throw forbidden('Separation of duties: the person who recorded the measurement cannot verify it');
  const v = measurementVariance(m.submittedQty, body.verifiedQty);
  const updated = await transaction(async (tx) => {
    const u = await tx.measurement.update({
      where: { id: m.id },
      data: { status: 'VERIFIED', verifiedQty: body.verifiedQty, variance: v.difference, verificationNote: body.note ?? null, verifiedById: ctx.user.id, verifiedAt: new Date(), ...(body.participants ? { participants: body.participants } : {}) },
    });
    await tx.boqItem.update({ where: { id: m.boqItemId }, data: { verifiedQty: { increment: body.verifiedQty } } });
    await setRegisterStatus(tx, 'measurement', m.id, 'VERIFIED');
    await audit(tx, ctx, { action: 'VERIFY', entityType: 'measurement', entityId: m.id, projectId, summary: `${m.number} verified at ${body.verifiedQty} ${m.unit} (variance ${v.difference})`, reason: body.note });
    await notify(tx, { userIds: [m.createdById], type: 'MEASUREMENT_VERIFIED', title: `Measurement verified: ${m.number}`, body: `Verified qty ${body.verifiedQty} ${m.unit}`, link: `/measurements/${m.id}`, projectId, entityType: 'measurement', entityId: m.id });
    return u;
  });
  res.json(updated);
});

measurementsRouter.post('/:id/return-for-correction', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'measurement.approve', projectId);
  const { note } = parseBody(z.object({ note: z.string().trim().min(3).max(2000) }), req.body);
  const m = await load(projectId, param(req, 'id'));
  if (m.status !== 'SUBMITTED') throw conflict('Only submitted measurements can be returned for correction');
  const updated = await transaction(async (tx) => {
    const u = await tx.measurement.update({ where: { id: m.id }, data: { status: 'RETURNED', verificationNote: note } });
    await setRegisterStatus(tx, 'measurement', m.id, 'RETURNED');
    await audit(tx, ctx, { action: 'RETURN', entityType: 'measurement', entityId: m.id, projectId, summary: `${m.number} returned for correction`, reason: note });
    await notify(tx, { userIds: [m.createdById], type: 'CHANGES_REQUESTED', title: `Measurement returned: ${m.number}`, body: note, link: `/measurements/${m.id}`, projectId, entityType: 'measurement', entityId: m.id });
    return u;
  });
  res.json(updated);
});
