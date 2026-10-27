import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma, transaction } from '../lib/prisma.js';
import { config } from '../config.js';
import { param, parseBody } from '../lib/http.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { toDateOnly, today } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess, can } from '../services/access.js';
import { audit } from '../services/audit.js';
import { submitDocument } from '../services/workflow.js';
import { storeFile } from './files.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

export const documentsRouter = Router({ mergeParams: true });

documentsRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

/** Adds a new revision. Existing revisions are never overwritten. */
documentsRouter.post('/documents/:id/revisions', upload.single('file'), async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'document.manage', projectId);
  const data = parseBody(z.object({ revision: z.string().trim().min(1).max(10), issueDate: z.string().optional(), description: z.string().max(1000).optional() }), req.body);
  const out = await transaction(async (tx) => {
    const doc = await tx.document.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!doc) throw notFound('Document');
    const dup = await tx.documentRevision.findUnique({ where: { documentId_revision: { documentId: doc.id, revision: data.revision } } });
    if (dup) throw conflict(`Revision ${data.revision} already exists. Revisions cannot be overwritten — issue a new revision.`);
    const file = req.file ? await storeFile(tx, ctx, projectId, req.file) : null;
    const rev = await tx.documentRevision.create({ data: { documentId: doc.id, projectId, revision: data.revision, fileId: file?.id ?? null, issueDate: data.issueDate ? toDateOnly(data.issueDate) : today(), description: data.description ?? null, status: 'FOR_REVIEW', createdById: ctx.user.id } });
    await audit(tx, ctx, { action: 'REVISION_ADDED', entityType: 'document', entityId: doc.id, projectId, summary: `${doc.number} rev ${data.revision} added` });
    return rev;
  });
  res.status(201).json(out);
});

documentsRouter.post('/document-revisions/:revId/submit', async (req, res) => {
  const rev = await prisma.documentRevision.findFirst({ where: { id: param(req, 'revId'), projectId: param(req, 'projectId') } });
  if (!rev) throw notFound('Revision');
  res.json(await submitDocument(ctxOf(req), 'DOCUMENT_REVISION', rev.id, req.body?.comment));
});

documentsRouter.post('/transmittals/:id/send', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'rfi.manage', projectId);
  const { revisionIds } = parseBody(z.object({ revisionIds: z.array(z.string()).min(1) }), req.body);
  const out = await transaction(async (tx) => {
    const t = await tx.transmittal.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!t) throw notFound('Transmittal');
    if (t.status !== 'DRAFT') throw conflict('Transmittal already sent');
    const revs = await tx.documentRevision.findMany({ where: { id: { in: revisionIds }, projectId }, include: { document: true } });
    if (revs.length !== revisionIds.length) throw validationError('Revision not found in this project');
    if (revs.some((r) => r.document.confidential) && !can(ctx, 'document.manage', projectId)) throw validationError('Restricted documents can only be transmitted by document controllers');
    const u = await tx.transmittal.update({ where: { id: t.id }, data: { status: 'SENT', sentDate: today(), revisionIds } });
    await tx.registerEntry.updateMany({ where: { entityType: 'transmittal', entityId: t.id }, data: { status: 'SENT' } });
    await audit(tx, ctx, { action: 'TRANSMITTAL_SENT', entityType: 'transmittal', entityId: t.id, projectId, summary: `${t.number} sent to ${t.recipientName} with ${revs.length} revision(s)` });
    return u;
  });
  res.json(out);
});

documentsRouter.post('/transmittals/:id/acknowledge', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'rfi.manage', projectId);
  const { acknowledgedBy } = parseBody(z.object({ acknowledgedBy: z.string().trim().min(2).max(200) }), req.body);
  const out = await transaction(async (tx) => {
    const t = await tx.transmittal.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!t) throw notFound('Transmittal');
    if (t.status !== 'SENT') throw conflict('Only sent transmittals can be acknowledged');
    const u = await tx.transmittal.update({ where: { id: t.id }, data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedBy } });
    await tx.registerEntry.updateMany({ where: { entityType: 'transmittal', entityId: t.id }, data: { status: 'ACKNOWLEDGED' } });
    await audit(tx, ctx, { action: 'TRANSMITTAL_ACK', entityType: 'transmittal', entityId: t.id, projectId, summary: `${t.number} acknowledged by ${acknowledgedBy}` });
    return u;
  });
  res.json(out);
});

documentsRouter.post('/contract-clauses/:clauseId/validate', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'contract.approve', projectId);
  const out = await transaction(async (tx) => {
    const c = await tx.contractClause.findFirst({ where: { id: param(req, 'clauseId'), contract: { projectId } } });
    if (!c) throw notFound('Clause');
    if (!c.interpretation) throw validationError('Write an interpretation before validating');
    const u = await tx.contractClause.update({ where: { id: c.id }, data: { validatedById: ctx.user.id, validatedAt: new Date() } });
    await audit(tx, ctx, { action: 'CLAUSE_VALIDATED', entityType: 'contract', entityId: c.contractId, projectId, summary: `Clause ${c.clauseRef} interpretation validated` });
    return u;
  });
  res.json(out);
});
