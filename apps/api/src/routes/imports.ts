import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { D, COST_CATEGORIES } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { config } from '../config.js';
import { param, parseBody } from '../lib/http.js';
import { businessRule, conflict, notFound, validationError } from '../lib/errors.js';
import { today } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { accessibleProjectIds, assertCan, type AccessContext } from '../services/access.js';
import { audit } from '../services/audit.js';
import { postStock } from '../services/stock.js';
import { detectAllowedType } from '../services/storage.js';
import { toCsv } from '../services/exporter.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });
export const importsRouter = Router();

type Kind = 'BOQ' | 'COST_CODES' | 'MATERIALS' | 'SUPPLIERS' | 'OPENING_STOCK';
interface FieldSpec {
  key: string;
  label: string;
  required?: boolean;
  type?: 'number' | 'text';
  aliases?: string[];
}

const num = (key: string, label: string, required = false, aliases: string[] = []): FieldSpec => ({ key, label, required, type: 'number', aliases });
const txt = (key: string, label: string, required = false, aliases: string[] = []): FieldSpec => ({ key, label, required, type: 'text', aliases });

export const IMPORT_SPECS: Record<Kind, { title: string; projectScoped: boolean; permission: string; fields: FieldSpec[] }> = {
  BOQ: {
    title: 'BOQ items',
    projectScoped: true,
    permission: 'boq.manage',
    fields: [txt('itemCode', 'Item code', true, ['item', 'item no', 'code', 'sl no']), txt('description', 'Description', true, ['desc', 'item description']), txt('unit', 'Unit', true, ['uom']), num('contractQty', 'Contract qty', true, ['qty', 'quantity']), num('unitRate', 'Unit rate', true, ['rate']), num('estimatedQty', 'Estimated qty'), txt('section', 'Section', false, ['work package', 'package']), txt('boqRef', 'BOQ ref'), txt('costCode', 'Cost code'), txt('drawingRef', 'Drawing ref'), txt('remarks', 'Remarks')],
  },
  COST_CODES: {
    title: 'Cost codes & budget',
    projectScoped: true,
    permission: 'costcode.manage',
    fields: [txt('code', 'Cost code', true, ['code']), txt('name', 'Name', true, ['description']), txt('category', 'Category', true), txt('wbsCode', 'WBS code'), txt('wbsName', 'WBS name'), num('originalBudget', 'Original budget', false, ['budget'])],
  },
  MATERIALS: {
    title: 'Material master',
    projectScoped: false,
    permission: 'material.manage',
    fields: [txt('code', 'Code', true), txt('name', 'Name', true, ['material', 'description']), txt('category', 'Category', true), txt('unit', 'Unit', true, ['uom']), txt('specification', 'Specification'), num('reorderLevel', 'Reorder level'), num('standardRate', 'Standard rate', false, ['rate'])],
  },
  SUPPLIERS: {
    title: 'Suppliers & contractors',
    projectScoped: false,
    permission: 'material.manage',
    fields: [txt('code', 'Code', true), txt('name', 'Name', true), txt('kinds', 'Roles (comma separated)', true, ['type', 'role']), txt('contactName', 'Contact'), txt('email', 'Email'), txt('phone', 'Phone'), txt('taxId', 'Tax ID', false, ['gstin', 'gst']), txt('address', 'Address'), num('paymentTermsDays', 'Payment terms (days)')],
  },
  OPENING_STOCK: {
    title: 'Opening stock',
    projectScoped: true,
    permission: 'stock.manage',
    fields: [txt('storeCode', 'Store code', true, ['store']), txt('materialCode', 'Material code', true, ['material']), num('qty', 'Quantity', true, ['qty']), num('unitCost', 'Unit cost', true, ['rate', 'cost']), txt('batchNo', 'Batch')],
  },
};

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function autoMap(headers: string[], fields: FieldSpec[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const f of fields) {
    const candidates = [f.key, f.label, ...(f.aliases ?? [])].map(norm);
    const idx = headers.findIndex((h) => candidates.includes(norm(h)));
    if (idx >= 0) map[f.key] = idx;
  }
  return map;
}

async function readTable(file: Express.Multer.File): Promise<string[][]> {
  const type = detectAllowedType(file.buffer, file.mimetype, file.originalname);
  const wb = new ExcelJS.Workbook();
  if (type === 'text/csv' || type === 'text/plain') {
    const { Readable } = await import('node:stream');
    await wb.csv.read(Readable.from(file.buffer.toString('utf8')));
  } else if (type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || (type === 'application/zip' && file.originalname.endsWith('.xlsx'))) {
    await wb.xlsx.load(file.buffer as never);
  } else throw validationError('Upload an .xlsx or .csv file');
  const ws = wb.worksheets[0];
  if (!ws) throw validationError('The file has no worksheet');
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = (row.values as unknown[]).slice(1).map((v) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && v !== null && 'result' in v) return String((v as { result: unknown }).result ?? '');
      if (typeof v === 'object' && v !== null && 'text' in v) return String((v as { text: unknown }).text ?? '');
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).trim();
    });
    rows.push(vals);
  });
  if (rows.length > 5001) throw validationError('Imports are limited to 5,000 rows per file');
  return rows;
}

interface PreviewRow {
  row: number;
  values: Record<string, string>;
  errors: string[];
  action: 'CREATE' | 'SKIP';
}

async function validateRows(ctx: AccessContext, kind: Kind, projectId: string | null, rows: Record<string, string>[]): Promise<PreviewRow[]> {
  const spec = IMPORT_SPECS[kind];
  const out: PreviewRow[] = rows.map((values, i) => {
    const errors: string[] = [];
    for (const f of spec.fields) {
      const v = values[f.key] ?? '';
      if (f.required && !v) errors.push(`${f.label} is required`);
      if (v && f.type === 'number' && !/^-?\d+(\.\d+)?$/.test(v.replace(/,/g, ''))) errors.push(`${f.label} must be a number`);
      if (f.type === 'number' && v) values[f.key] = v.replace(/,/g, '');
    }
    return { row: i + 2, values, errors, action: 'CREATE' };
  });
  const seen = new Set<string>();
  const keyOf = (v: Record<string, string>) => (kind === 'BOQ' ? v.itemCode : kind === 'OPENING_STOCK' ? `${v.storeCode}|${v.materialCode}` : v.code)?.toUpperCase();
  for (const r of out) {
    const k = keyOf(r.values);
    if (k && seen.has(k)) r.errors.push('Duplicate row in file');
    if (k) seen.add(k);
  }
  if (kind === 'BOQ') {
    const existing = new Set((await prisma.boqItem.findMany({ where: { projectId: projectId! }, select: { itemCode: true } })).map((x) => x.itemCode.toUpperCase()));
    const codes = new Set((await prisma.costCode.findMany({ where: { projectId: projectId! }, select: { code: true } })).map((x) => x.code));
    for (const r of out) {
      if (existing.has(r.values.itemCode?.toUpperCase())) r.errors.push('Item code already exists in this project');
      if (r.values.costCode && !codes.has(r.values.costCode)) r.errors.push(`Unknown cost code ${r.values.costCode}`);
      if (r.values.unitRate && D(r.values.unitRate).isNeg()) r.errors.push('Rate cannot be negative');
    }
  }
  if (kind === 'COST_CODES') {
    const existing = new Set((await prisma.costCode.findMany({ where: { projectId: projectId! }, select: { code: true } })).map((x) => x.code.toUpperCase()));
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId! } });
    for (const r of out) {
      if (existing.has(r.values.code?.toUpperCase())) r.errors.push('Cost code already exists');
      if (r.values.category && !(COST_CATEGORIES as readonly string[]).includes(r.values.category.toUpperCase())) r.errors.push(`Category must be one of ${COST_CATEGORIES.join(', ')}`);
      if (r.values.originalBudget && project.budgetBaselinedAt) r.errors.push('Budget is baselined — import cost codes without budget, then use a budget revision');
    }
  }
  if (kind === 'MATERIALS' || kind === 'SUPPLIERS') {
    const existing = new Set(
      (kind === 'MATERIALS' ? await prisma.material.findMany({ where: { orgId: ctx.orgId }, select: { code: true } }) : await prisma.party.findMany({ where: { orgId: ctx.orgId }, select: { code: true } })).map((x) => x.code.toUpperCase()),
    );
    const uoms = new Set((await prisma.uom.findMany({ where: { orgId: ctx.orgId } })).map((u) => u.code));
    for (const r of out) {
      if (existing.has(r.values.code?.toUpperCase())) r.errors.push('Code already exists (duplicate)');
      if (kind === 'MATERIALS' && r.values.unit && !uoms.has(r.values.unit)) r.errors.push(`Unknown unit ${r.values.unit}`);
      if (kind === 'SUPPLIERS') {
        const kinds = (r.values.kinds ?? '').split(',').map((k) => k.trim().toUpperCase()).filter(Boolean);
        if (kinds.some((k) => !['CLIENT', 'CONSULTANT', 'SUPPLIER', 'SUBCONTRACTOR'].includes(k))) r.errors.push('Roles must be CLIENT, CONSULTANT, SUPPLIER or SUBCONTRACTOR');
        if (r.values.email && !/^\S+@\S+\.\S+$/.test(r.values.email)) r.errors.push('Invalid email');
      }
    }
  }
  if (kind === 'OPENING_STOCK') {
    const stores = new Map((await prisma.store.findMany({ where: { projectId: projectId! } })).map((s) => [s.code, s.id]));
    const mats = new Map((await prisma.material.findMany({ where: { orgId: ctx.orgId } })).map((m) => [m.code, m.id]));
    const existing = await prisma.stockTransaction.findMany({ where: { projectId: projectId!, type: 'OPENING' }, select: { storeId: true, materialId: true } });
    for (const r of out) {
      const sid = stores.get(r.values.storeCode);
      const mid = mats.get(r.values.materialCode);
      if (!sid) r.errors.push(`Unknown store ${r.values.storeCode}`);
      if (!mid) r.errors.push(`Unknown material ${r.values.materialCode}`);
      if (sid && mid && existing.some((e) => e.storeId === sid && e.materialId === mid)) r.errors.push('Opening stock already posted for this store/material');
      if (r.values.qty && D(r.values.qty).lte(0)) r.errors.push('Quantity must be positive');
    }
  }
  for (const r of out) r.action = r.errors.length ? 'SKIP' : 'CREATE';
  return out;
}

async function checkAccess(ctx: AccessContext, kind: Kind, projectId: string | null) {
  assertCan(ctx, 'import.manage', projectId);
  const spec = IMPORT_SPECS[kind];
  if (spec.projectScoped) {
    if (!projectId) throw validationError('Select a project');
    const ids = await accessibleProjectIds(prisma, ctx);
    if (!ids.includes(projectId)) throw notFound('Project');
  }
  assertCan(ctx, spec.permission, projectId);
}

importsRouter.get('/specs', (_req, res) => {
  res.json(Object.entries(IMPORT_SPECS).map(([kind, s]) => ({ kind, ...s })));
});

importsRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  const jobs = await prisma.importJob.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, kind: true, fileName: true, status: true, summary: true, createdAt: true, committedAt: true, projectId: true } });
  res.json(jobs);
});

/** Step 1 — upload & preview. Nothing is written to business tables. */
importsRouter.post('/preview', upload.single('file'), async (req, res) => {
  const ctx = ctxOf(req);
  const body = parseBody(z.object({ kind: z.enum(['BOQ', 'COST_CODES', 'MATERIALS', 'SUPPLIERS', 'OPENING_STOCK']), projectId: z.string().optional(), mapping: z.string().optional() }), req.body);
  const projectId = IMPORT_SPECS[body.kind].projectScoped ? (body.projectId ?? null) : null;
  await checkAccess(ctx, body.kind, projectId);
  if (!req.file) throw validationError('Choose a file');
  const table = await readTable(req.file);
  if (table.length < 2) throw validationError('The file needs a header row and at least one data row');
  const headers = table[0];
  const spec = IMPORT_SPECS[body.kind];
  const mapping: Record<string, number> = body.mapping ? JSON.parse(body.mapping) : autoMap(headers, spec.fields);
  const missing = spec.fields.filter((f) => f.required && mapping[f.key] === undefined);
  const records = table.slice(1).map((r) => Object.fromEntries(spec.fields.map((f) => [f.key, mapping[f.key] !== undefined ? (r[mapping[f.key]] ?? '').trim() : ''])));
  const rows = missing.length ? records.map((values, i) => ({ row: i + 2, values, errors: [`Map required columns: ${missing.map((m) => m.label).join(', ')}`], action: 'SKIP' as const })) : await validateRows(ctx, body.kind, projectId, records);
  const summary = { total: rows.length, valid: rows.filter((r) => r.action === 'CREATE').length, invalid: rows.filter((r) => r.action === 'SKIP').length, headers, missingRequired: missing.map((m) => m.key) };
  const job = await prisma.importJob.create({ data: { orgId: ctx.orgId, projectId, kind: body.kind, fileName: req.file.originalname.slice(0, 200), mapping, rows: rows as never, summary, createdById: ctx.user.id } });
  res.status(201).json({ id: job.id, summary, mapping, fields: spec.fields, rows: rows.slice(0, 500) });
});

importsRouter.get('/:id/errors.csv', async (req, res) => {
  const ctx = ctxOf(req);
  const job = await prisma.importJob.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId } });
  if (!job) throw notFound('Import');
  const rows = (job.rows as unknown as PreviewRow[]).filter((r) => r.errors.length);
  const spec = IMPORT_SPECS[job.kind as Kind];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="import-errors-${job.id}.csv"`);
  res.send(toCsv({ columns: [{ key: 'row', label: 'Row' }, ...spec.fields.map((f) => ({ key: f.key, label: f.label })), { key: 'errors', label: 'Errors' }], rows: rows.map((r) => ({ row: r.row, ...r.values, errors: r.errors.join('; ') })) }));
});

/** Step 2 — commit valid rows in one transaction after re-validation. */
importsRouter.post('/:id/commit', async (req, res) => {
  const ctx = ctxOf(req);
  const { skipInvalid } = parseBody(z.object({ skipInvalid: z.boolean().default(false) }), req.body);
  const job = await prisma.importJob.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId } });
  if (!job) throw notFound('Import');
  if (job.status !== 'PREVIEW') throw conflict('This import has already been processed');
  const kind = job.kind as Kind;
  await checkAccess(ctx, kind, job.projectId);
  const fresh = await validateRows(ctx, kind, job.projectId, (job.rows as unknown as PreviewRow[]).map((r) => r.values));
  const invalid = fresh.filter((r) => r.action === 'SKIP');
  if (invalid.length && !skipInvalid) throw businessRule(`${invalid.length} row(s) have errors. Fix them or confirm skipping invalid rows.`);
  const valid = fresh.filter((r) => r.action === 'CREATE');
  if (!valid.length) throw businessRule('No valid rows to import');
  const projectId = job.projectId;
  await transaction(async (tx) => {
    if (kind === 'BOQ') {
      const codes = new Map((await tx.costCode.findMany({ where: { projectId: projectId! } })).map((c) => [c.code, c.id]));
      await tx.boqItem.createMany({ data: valid.map(({ values: v }) => ({ projectId: projectId!, itemCode: v.itemCode, description: v.description, unit: v.unit, contractQty: v.contractQty, estimatedQty: v.estimatedQty || v.contractQty, unitRate: v.unitRate, section: v.section || null, boqRef: v.boqRef || null, costCodeId: v.costCode ? codes.get(v.costCode) ?? null : null, drawingRef: v.drawingRef || null, remarks: v.remarks || null })) });
    } else if (kind === 'COST_CODES') {
      for (const { values: v } of valid) {
        let wbsId: string | null = null;
        if (v.wbsCode) {
          const w = await tx.wbsNode.upsert({ where: { projectId_code: { projectId: projectId!, code: v.wbsCode } }, create: { projectId: projectId!, code: v.wbsCode, name: v.wbsName || v.wbsCode }, update: {} });
          wbsId = w.id;
        }
        const cc = await tx.costCode.create({ data: { projectId: projectId!, code: v.code, name: v.name, category: v.category.toUpperCase(), wbsNodeId: wbsId } });
        await tx.budgetLine.create({ data: { projectId: projectId!, costCodeId: cc.id, originalAmount: v.originalBudget || '0' } });
      }
    } else if (kind === 'MATERIALS') {
      await tx.material.createMany({ data: valid.map(({ values: v }) => ({ orgId: ctx.orgId, code: v.code, name: v.name, category: v.category, unit: v.unit, specification: v.specification || null, reorderLevel: v.reorderLevel || null, standardRate: v.standardRate || null })) });
    } else if (kind === 'SUPPLIERS') {
      await tx.party.createMany({ data: valid.map(({ values: v }) => ({ orgId: ctx.orgId, code: v.code, name: v.name, kinds: v.kinds.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean), contactName: v.contactName || null, email: v.email || null, phone: v.phone || null, taxId: v.taxId || null, address: v.address || null, paymentTermsDays: v.paymentTermsDays ? Number(v.paymentTermsDays) : null })) });
    } else if (kind === 'OPENING_STOCK') {
      const stores = new Map((await tx.store.findMany({ where: { projectId: projectId! } })).map((s) => [s.code, s.id]));
      const mats = new Map((await tx.material.findMany({ where: { orgId: ctx.orgId } })).map((m) => [m.code, m.id]));
      for (const { values: v } of valid) {
        await postStock(tx, { projectId: projectId!, storeId: stores.get(v.storeCode)!, materialId: mats.get(v.materialCode)!, date: today(), type: 'OPENING', qty: v.qty, unitCost: v.unitCost, batchNo: v.batchNo || null, refType: 'IMPORT', refId: job.id, reason: `Imported from ${job.fileName}`, createdById: ctx.user.id });
      }
    }
    await tx.importJob.update({ where: { id: job.id }, data: { status: 'COMMITTED', committedAt: new Date(), summary: { ...(job.summary as object), imported: valid.length, skipped: invalid.length } } });
    await audit(tx, ctx, { action: 'IMPORT_COMMITTED', entityType: 'importJob', entityId: job.id, projectId, summary: `${IMPORT_SPECS[kind].title}: ${valid.length} imported, ${invalid.length} skipped (${job.fileName})` });
  });
  res.json({ imported: valid.length, skipped: invalid.length });
});

importsRouter.post('/:id/cancel', async (req, res) => {
  const ctx = ctxOf(req);
  const job = await prisma.importJob.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId, status: 'PREVIEW' } });
  if (!job) throw notFound('Import');
  await prisma.importJob.update({ where: { id: job.id }, data: { status: 'CANCELLED' } });
  res.json({ ok: true });
});
