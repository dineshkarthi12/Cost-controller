import crypto from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { EVIDENCE_STATUS } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { config } from '../config.js';
import { pageParams, param, parseBody } from '../lib/http.js';
import { conflict, forbidden, notFound, validationError } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { toDateOnly } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess, canAccessProject, type AccessContext } from '../services/access.js';
import { audit } from '../services/audit.js';
import { detectAllowedType, storage } from '../services/storage.js';
import { nextNumber } from '../services/numbering.js';
import { notify } from '../services/notifications.js';
import { assertRefsInScope } from '../services/lookups.js';
import type { Tx } from '../lib/prisma.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 20 } });

export const filesRouter = Router();
export const projectFilesRouter = Router({ mergeParams: true });

projectFilesRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

/** Stores a validated file and returns its FileObject. Original bytes are never modified. */
export async function storeFile(tx: Tx, ctx: AccessContext, projectId: string | null, f: Express.Multer.File, opts: { imagesOnly?: boolean; clientMeta?: Record<string, unknown> } = {}) {
  const mime = detectAllowedType(f.buffer, f.mimetype, f.originalname, opts);
  if (!mime) throw validationError(`${f.originalname}: file type not allowed${opts.imagesOnly ? ' (JPEG, PNG or WebP photos only)' : ''}`);
  const hash = sha256(f.buffer);
  const ext = path.extname(f.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 8);
  const key = `${ctx.orgId}/${projectId ?? 'org'}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${ext}`;
  await storage.put(key, f.buffer, mime);
  return tx.fileObject.create({
    data: {
      orgId: ctx.orgId,
      projectId,
      storageKey: key,
      originalName: f.originalname.slice(0, 250),
      mimeType: mime,
      size: f.size,
      sha256: hash,
      uploadedById: ctx.user.id,
      clientMeta: { ...(opts.clientMeta ?? {}), _note: 'Client-reported metadata is unverified' } as never,
    },
  });
}

filesRouter.get('/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const f = await prisma.fileObject.findUnique({ where: { id: param(req, 'id') } });
  if (!f || f.orgId !== ctx.orgId || (f.projectId && !canAccessProject(ctx, f.projectId))) throw notFound('File');
  if (f.projectId) {
    // Confidential document revisions require document.manage.
    const rev = await prisma.documentRevision.findFirst({ where: { fileId: f.id }, include: { document: { select: { confidential: true } } } });
    if (rev?.document.confidential) assertCan(ctx, 'document.manage', f.projectId);
  }
  res.setHeader('Content-Type', f.mimeType);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.originalName)}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-File-Sha256', f.sha256);
  if (req.query.download) await audit(prisma, ctx, { action: 'FILE_DOWNLOAD', entityType: 'file', entityId: f.id, projectId: f.projectId, summary: f.originalName });
  (await storage.get(f.storageKey)).pipe(res);
});

// ───────── Site evidence ─────────

const EVIDENCE_CATEGORIES = ['MANPOWER', 'MEASUREMENT', 'WORK_COMPLETION', 'MATERIAL_RECEIPT', 'MATERIAL_DAMAGE', 'EQUIPMENT', 'QUALITY', 'SAFETY', 'DRAWING', 'GENERAL'] as const;

const evidenceMeta = z.object({
  category: z.enum(EVIDENCE_CATEGORIES),
  caption: z.string().max(500).optional(),
  location: z.string().max(200).optional(),
  activityId: z.string().optional(),
  phase: z.enum(['BEFORE', 'AFTER', 'NA']).default('NA'),
  pairKey: z.string().max(100).optional(),
  linkedType: z.string().max(50).optional(),
  linkedId: z.string().max(64).optional(),
  claimedTakenAt: z.string().optional(),
  claimedGps: z.string().max(100).optional(),
  clientUploadId: z.string().max(100).optional(),
});

const LINKABLE: Record<string, string> = {
  measurement: 'measurement',
  manpowerReport: 'manpowerReport',
  siteDiary: 'siteDiary',
  grn: 'grn',
  inspection: 'inspection',
  ncr: 'ncr',
  safetyIncident: 'safetyIncident',
  equipmentLog: 'equipmentLog',
  activity: 'activity',
  task: 'task',
  expense: 'expense',
};

async function assertLinkable(tx: Tx, projectId: string, type?: string, id?: string) {
  if (!type && !id) return;
  if (!type || !id || !LINKABLE[type]) throw validationError('Invalid linked record');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = await (tx as any)[LINKABLE[type]].count({ where: { id, projectId } });
  if (!found) throw validationError('Linked record not found in this project');
}

projectFilesRouter.post('/evidence', upload.array('files', 20), async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'evidence.manage', projectId);
  const meta = parseBody(evidenceMeta, req.body);
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw validationError('Attach at least one photo');
  const created = await transaction(async (tx) => {
    if (meta.activityId) await assertRefsInScope(tx, 'activities', ctx.orgId, projectId, [meta.activityId], 'Activity');
    await assertLinkable(tx, projectId, meta.linkedType, meta.linkedId);
    const out = [];
    for (const f of files) {
      const file = await storeFile(tx, ctx, projectId, f, { imagesOnly: meta.category !== 'DRAWING', clientMeta: { claimedTakenAt: meta.claimedTakenAt ?? null, claimedGps: meta.claimedGps ?? null, clientUploadId: meta.clientUploadId ?? null, userAgent: ctx.userAgent ?? null } });
      const number = await nextNumber(tx, { orgId: ctx.orgId, projectId, docType: 'EVIDENCE' });
      const claimed = meta.claimedTakenAt ? new Date(meta.claimedTakenAt) : null;
      const ev = await tx.evidence.create({
        data: {
          projectId,
          number,
          fileId: file.id,
          category: meta.category,
          caption: meta.caption ?? null,
          location: meta.location ?? null,
          activityId: meta.activityId ?? null,
          phase: meta.phase,
          pairKey: meta.pairKey ?? null,
          linkedType: meta.linkedType ?? null,
          linkedId: meta.linkedId ?? null,
          claimedTakenAt: claimed && !Number.isNaN(claimed.getTime()) ? claimed : null,
          submittedById: ctx.user.id,
        },
      });
      out.push(ev);
    }
    await audit(tx, ctx, { action: 'EVIDENCE_UPLOADED', entityType: 'evidence', projectId, summary: `${out.length} photo(s) uploaded (${meta.category})`, after: { ids: out.map((e) => e.id), linkedType: meta.linkedType, linkedId: meta.linkedId } });
    return out;
  });
  res.status(201).json(created);
});

projectFilesRouter.get('/evidence', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'evidence.view', projectId);
  const { skip, take, page, pageSize } = pageParams(req, 100);
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const where = {
    projectId,
    ...(typeof req.query.status === 'string' ? { status: req.query.status } : {}),
    ...(typeof req.query.category === 'string' ? { category: req.query.category } : {}),
    ...(typeof req.query.submittedById === 'string' ? { submittedById: req.query.submittedById } : {}),
    ...(typeof req.query.linkedType === 'string' ? { linkedType: req.query.linkedType } : {}),
    ...(typeof req.query.linkedId === 'string' ? { linkedId: req.query.linkedId } : {}),
    ...(typeof req.query.pairKey === 'string' ? { pairKey: req.query.pairKey } : {}),
    ...(req.query.from || req.query.to ? { createdAt: { ...(req.query.from ? { gte: toDateOnly(String(req.query.from))! } : {}), ...(req.query.to ? { lte: new Date(String(req.query.to) + 'T23:59:59Z') } : {}) } } : {}),
    ...(q ? { OR: [{ caption: { contains: q, mode: 'insensitive' as const } }, { number: { contains: q, mode: 'insensitive' as const } }, { location: { contains: q, mode: 'insensitive' as const } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.evidence.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { file: { select: { id: true, originalName: true, mimeType: true, size: true, sha256: true, uploadedAt: true, clientMeta: true } } } }),
    prisma.evidence.count({ where }),
  ]);
  const people = new Map((await prisma.user.findMany({ where: { id: { in: items.flatMap((i) => [i.verifiedById, i.submittedById]).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  res.json({ items: items.map((i) => ({ ...i, submittedByName: people.get(i.submittedById) ?? null, verifiedByName: i.verifiedById ? people.get(i.verifiedById) : null })), total, page, pageSize });
});

projectFilesRouter.post('/evidence/:id/review', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'evidence.approve', projectId);
  const { status, comment } = parseBody(z.object({ status: z.enum(EVIDENCE_STATUS).refine((s) => s !== 'PENDING'), comment: z.string().max(1000).optional() }), req.body);
  if (status !== 'VERIFIED' && !comment?.trim()) throw validationError('A comment is required when rejecting or requesting correction');
  const out = await transaction(async (tx) => {
    const ev = await tx.evidence.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!ev) throw notFound('Evidence');
    if (ev.submittedById === ctx.user.id) throw forbidden('Separation of duties: you cannot verify your own evidence');
    if (ev.status === 'VERIFIED' && status === 'VERIFIED') throw conflict('Already verified');
    const u = await tx.evidence.update({ where: { id: ev.id }, data: { status, reviewComment: comment ?? null, verifiedById: ctx.user.id, verifiedAt: new Date() } });
    await audit(tx, ctx, { action: `EVIDENCE_${status}`, entityType: 'evidence', entityId: ev.id, projectId, summary: `${ev.number} marked ${status}`, reason: comment });
    if (status !== 'VERIFIED') await notify(tx, { userIds: [ev.submittedById], type: 'EVIDENCE_REVIEW', title: `Photo ${ev.number}: ${status.replace('_', ' ').toLowerCase()}`, body: comment, link: `/evidence?focus=${ev.id}`, projectId, entityType: 'evidence', entityId: ev.id });
    return u;
  });
  res.json(out);
});

// ───────── Generic attachments ─────────

const ATTACHABLE = ['purchaseOrder', 'materialRequisition', 'purchaseRequisition', 'grn', 'mir', 'supplierInvoice', 'expense', 'payment', 'subcontract', 'contractorBill', 'clientBill', 'variation', 'claim', 'contract', 'measurement', 'manpowerReport', 'siteDiary', 'inspection', 'ncr', 'safetyIncident', 'rfi', 'transmittal', 'task', 'risk', 'budgetRevision', 'boqItem', 'equipmentLog', 'closeout', 'reportingPeriod'];

projectFilesRouter.get('/attachments', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  const entityType = String(req.query.entityType ?? '');
  const entityId = String(req.query.entityId ?? '');
  if (!ATTACHABLE.includes(entityType)) throw validationError('Invalid entity type');
  void ctx;
  const rows = await prisma.attachment.findMany({ where: { projectId, entityType, entityId }, orderBy: { createdAt: 'desc' } });
  const files = new Map((await prisma.fileObject.findMany({ where: { id: { in: rows.map((r) => r.fileId) } } })).map((f) => [f.id, f]));
  const users = new Map((await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.uploadedById) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  res.json(rows.map((r) => ({ ...r, file: files.get(r.fileId), uploadedByName: users.get(r.uploadedById) })));
});

projectFilesRouter.post('/attachments', upload.array('files', 10), async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  const { entityType, entityId, label } = parseBody(z.object({ entityType: z.enum(ATTACHABLE as [string, ...string[]]), entityId: z.string(), label: z.string().max(200).optional() }), req.body);
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw validationError('Choose a file');
  const out = await transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = await (tx as any)[entityType].count({ where: entityType === 'closeout' || entityType === 'reportingPeriod' ? { id: entityId, projectId } : { id: entityId, projectId } });
    if (!exists) throw notFound('Record');
    const rows = [];
    for (const f of files) {
      const file = await storeFile(tx, ctx, projectId, f);
      rows.push(await tx.attachment.create({ data: { projectId, entityType, entityId, fileId: file.id, label: label ?? f.originalname, uploadedById: ctx.user.id } }));
    }
    await audit(tx, ctx, { action: 'ATTACHMENT_ADDED', entityType, entityId, projectId, summary: `${rows.length} attachment(s) added` });
    return rows;
  });
  res.status(201).json(out);
});

// ───────── Comments with mentions ─────────

projectFilesRouter.get('/comments', async (req, res) => {
  const projectId = param(req, 'projectId');
  const rows = await prisma.comment.findMany({ where: { projectId, entityType: String(req.query.entityType ?? ''), entityId: String(req.query.entityId ?? '') }, orderBy: { createdAt: 'asc' } });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.authorId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  res.json(rows.map((r) => ({ ...r, authorName: users.get(r.authorId) })));
});

projectFilesRouter.post('/comments', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  const data = parseBody(z.object({ entityType: z.string().min(1).max(50), entityId: z.string().min(1).max(64), body: z.string().trim().min(1).max(5000), mentions: z.array(z.string()).max(20).default([]), link: z.string().max(300).optional() }), req.body);
  const out = await transaction(async (tx) => {
    if (data.mentions.length) await assertRefsInScope(tx, 'users', ctx.orgId, null, data.mentions, 'Mentioned user');
    const c = await tx.comment.create({ data: { projectId, entityType: data.entityType, entityId: data.entityId, authorId: ctx.user.id, body: data.body, mentions: data.mentions } });
    await notify(tx, { userIds: data.mentions.filter((m) => m !== ctx.user.id), type: 'MENTION', title: `${ctx.user.name} mentioned you`, body: data.body.slice(0, 200), link: data.link, projectId, entityType: data.entityType, entityId: data.entityId });
    return c;
  });
  res.status(201).json({ ...out, authorName: ctx.user.name });
});
