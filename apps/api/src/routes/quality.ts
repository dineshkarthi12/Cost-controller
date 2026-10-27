import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { RESOURCES, blockingHoldPoint, checklistSummary, type ChecklistItem } from '@toprock/shared';
import { prisma, transaction, type Tx } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { businessRule, conflict, forbidden, notFound, validationError } from '../lib/errors.js';
import { today } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess, can } from '../services/access.js';
import { audit } from '../services/audit.js';
import { createResource } from '../resources/router.js';

/** Inspection checklists (ITP): apply a template, record item results, raise an NCR from a failed item. */
export const qualityRouter = Router({ mergeParams: true });

qualityRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

/** Loads the inspection and locks its row so concurrent item updates cannot overwrite each other. */
async function lockInspection(tx: Tx, projectId: string, id: string) {
  const ins = await tx.inspection.findFirst({ where: { id, projectId } });
  if (!ins) throw notFound('Inspection');
  await tx.$queryRaw`SELECT id FROM "Inspection" WHERE id = ${id} FOR UPDATE`;
  return { ...ins, items: ins.checklist as unknown as ChecklistItem[] };
}

const applySchema = z.object({ templateId: z.string().min(1) });

qualityRouter.post('/:id/checklist/template', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'quality.manage', projectId);
  const { templateId } = parseBody(applySchema, req.body);
  const out = await transaction(async (tx) => {
    const ins = await lockInspection(tx, projectId, param(req, 'id'));
    if (ins.status !== 'OPEN') throw conflict('A checklist can only be applied to an open inspection');
    if (ins.items.some((i) => i.result !== 'PENDING')) throw conflict('Results have already been recorded on this checklist, so it cannot be replaced');
    const tpl = await tx.checklistTemplate.findFirst({ where: { id: templateId, orgId: ctx.orgId }, include: { items: { orderBy: { lineNo: 'asc' } } } });
    if (!tpl) throw validationError('Checklist template not found');
    if (!tpl.active) throw businessRule('This template is inactive');
    if (!tpl.items.length) throw businessRule('This template has no checks');
    const items: ChecklistItem[] = tpl.items.map((t, i) => ({
      id: randomUUID(),
      lineNo: i + 1,
      stage: t.stage,
      description: t.description,
      acceptanceCriteria: t.acceptanceCriteria,
      reference: t.reference,
      pointType: t.pointType as ChecklistItem['pointType'],
      result: 'PENDING',
      remarks: null,
      checkedById: null,
      checkedAt: null,
      ncrId: null,
    }));
    const rec = await tx.inspection.update({ where: { id: ins.id }, data: { templateId: tpl.id, checklist: items as object[], result: 'PENDING' } });
    await audit(tx, ctx, { action: 'CHECKLIST_APPLIED', entityType: 'inspection', entityId: ins.id, projectId, summary: `Checklist "${tpl.name}" (${items.length} checks) applied to ${ins.number}` });
    return rec;
  });
  res.json(out);
});

const resultSchema = z.object({
  result: z.enum(['PENDING', 'PASS', 'FAIL', 'NA']),
  remarks: z.string().trim().max(2000).optional().nullable(),
});

qualityRouter.put('/:id/checklist/:itemId', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'quality.manage', projectId);
  const body = parseBody(resultSchema, req.body);
  const out = await transaction(async (tx) => {
    const ins = await lockInspection(tx, projectId, param(req, 'id'));
    if (ins.status === 'CLOSED') throw conflict('The inspection is closed');
    const item = ins.items.find((i) => i.id === param(req, 'itemId'));
    if (!item) throw notFound('Checklist item');
    const hold = blockingHoldPoint(ins.items, item.lineNo);
    if (hold) throw businessRule(`Hold point ${hold.lineNo} (“${hold.description}”) must be released before later checks are recorded`);
    if (item.pointType === 'HOLD' && body.result !== 'PENDING' && !can(ctx, 'quality.approve', projectId)) {
      throw forbidden('Only a user with quality approval rights can release or reject a hold point');
    }
    if (body.result === 'FAIL' && !body.remarks) throw validationError('Describe what failed in the remarks');
    if (item.ncrId && body.result !== 'FAIL' && body.result !== 'PASS') throw conflict('An NCR was raised for this check; record PASS once the rework is accepted');
    const before = { result: item.result, remarks: item.remarks };
    Object.assign(item, {
      result: body.result,
      remarks: body.remarks ?? null,
      checkedById: body.result === 'PENDING' ? null : ctx.user.id,
      checkedAt: body.result === 'PENDING' ? null : new Date().toISOString(),
    });
    // Later items cannot stay recorded behind a hold point that is no longer released.
    if (item.pointType === 'HOLD' && (body.result === 'PENDING' || body.result === 'FAIL') && ins.items.some((i) => i.lineNo > item.lineNo && i.result !== 'PENDING')) {
      throw conflict('Checks after this hold point are already recorded; reset them first');
    }
    const s = checklistSummary(ins.items);
    const data: Record<string, unknown> = { checklist: ins.items as unknown as object[] };
    // The overall result follows the checklist; a passed checklist keeps a manual CONDITIONAL result.
    data.result = s.outcome === 'PASS' && ins.result === 'CONDITIONAL' ? 'CONDITIONAL' : s.outcome;
    if (s.outcome !== 'PENDING') {
      if (ins.status === 'OPEN') data.status = 'INSPECTED';
      if (!ins.inspectedDate) data.inspectedDate = today();
      if (!ins.inspectorId) data.inspectorId = ctx.user.id;
    } else if (ins.status === 'INSPECTED') data.status = 'OPEN';
    const rec = await tx.inspection.update({ where: { id: ins.id }, data });
    await audit(tx, ctx, {
      action: 'CHECKLIST_RESULT',
      entityType: 'inspection',
      entityId: ins.id,
      projectId,
      summary: `${ins.number} check ${item.lineNo}${item.pointType === 'HOLD' ? ' (hold point)' : ''}: ${before.result} → ${body.result}`,
      before,
      after: { result: item.result, remarks: item.remarks },
    });
    return rec;
  });
  res.json(out);
});

const ncrSchema = z.object({
  severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL']),
  title: z.string().trim().max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  responsibleId: z.string().optional(),
  dueDate: z.string().optional(),
});

qualityRouter.post('/:id/checklist/:itemId/ncr', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'quality.manage', projectId);
  const body = parseBody(ncrSchema, req.body);
  const out = await transaction(async (tx) => {
    const ins = await lockInspection(tx, projectId, param(req, 'id'));
    const item = ins.items.find((i) => i.id === param(req, 'itemId'));
    if (!item) throw notFound('Checklist item');
    if (item.result !== 'FAIL') throw businessRule('An NCR can only be raised for a failed check');
    if (item.ncrId) throw conflict('An NCR has already been raised for this check');
    const defaultDescription = [
      `Failed check ${item.lineNo} of ${ins.number}: ${item.description}`,
      item.acceptanceCriteria ? `Acceptance criteria: ${item.acceptanceCriteria}` : null,
      item.reference ? `Reference: ${item.reference}` : null,
      item.remarks ? `Inspection remarks: ${item.remarks}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const ncr = await createResource(
      ctx,
      RESOURCES.ncrs,
      { orgId: ctx.orgId, projectId },
      {
        title: body.title || `${ins.title} — ${item.description}`.slice(0, 200),
        severity: body.severity,
        description: body.description || defaultDescription,
        activityId: ins.activityId ?? undefined,
        inspectionId: ins.id,
        responsibleId: body.responsibleId,
        dueDate: body.dueDate,
      },
      tx,
    );
    item.ncrId = ncr.id;
    await tx.inspection.update({ where: { id: ins.id }, data: { checklist: ins.items as unknown as object[] } });
    await audit(tx, ctx, { action: 'NCR_RAISED', entityType: 'inspection', entityId: ins.id, projectId, summary: `${ncr.number} raised from ${ins.number} check ${item.lineNo}` });
    return ncr;
  });
  res.status(201).json(out);
});
