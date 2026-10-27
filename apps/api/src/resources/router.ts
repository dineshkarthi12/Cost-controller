/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, type Request } from 'express';
import { RESOURCES, buildResourceSchemas, DEFAULT_EDITABLE, type FieldDef, type ResourceDef } from '@toprock/shared';
import { prisma, transaction, type Db, type Tx } from '../lib/prisma.js';
import { conflict, forbidden, notFound, validationError } from '../lib/errors.js';
import { toDateOnly } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess, can, type AccessContext } from '../services/access.js';
import { audit, diff } from '../services/audit.js';
import { nextNumber } from '../services/numbering.js';
import { upsertRegister } from '../services/register.js';
import { assertRefsInScope, resolveLabels } from '../services/lookups.js';
import { submitDocument, getHandler } from '../services/workflow.js';
import { hooksFor, type Scope } from './hooks.js';

const RESERVED = new Set(['page', 'pageSize', 'sort', 'dir', 'q', 'from', 'to']);
const delegate = (db: Db, model: string) => (db as any)[model];

export function getDef(key: string, projectScoped: boolean): ResourceDef {
  const def = RESOURCES[key];
  if (!def || def.projectScoped !== projectScoped) throw notFound('Resource');
  return def;
}

function convertValue(f: FieldDef, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null || v === '') return f.type === 'tags' ? [] : null;
  switch (f.type) {
    case 'date':
      return toDateOnly(v as string);
    case 'datetime':
      return new Date(v as string);
    case 'lines':
      return (v as Record<string, unknown>[]).map((row) => convertRow(f.lines ?? [], row));
    default:
      return v;
  }
}

function convertRow(fields: FieldDef[], row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (!(f.name in row)) continue;
    const v = convertValue(f, row[f.name]);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

async function validateRefs(tx: Tx, scope: Scope, fields: FieldDef[], data: Record<string, any>) {
  for (const f of fields) {
    if (f.type === 'ref' && f.ref && data[f.name]) await assertRefsInScope(tx, f.ref, scope.orgId, scope.projectId, [data[f.name]], f.label);
    if (f.type === 'lines' && Array.isArray(data[f.name])) {
      for (const lf of f.lines ?? []) {
        if (lf.type === 'ref' && lf.ref) {
          const ids = data[f.name].map((r: any) => r[lf.name]).filter(Boolean);
          await assertRefsInScope(tx, lf.ref, scope.orgId, scope.projectId, ids, lf.label);
        }
      }
    }
  }
}

/** Attaches `_labels` with display names for every reference field. */
export async function decorate(db: Db, def: ResourceDef, scope: Scope, rows: any[]) {
  const refFields = def.fields.filter((f) => f.type === 'ref' && f.ref);
  const lineDefs = def.fields.filter((f) => f.type === 'lines');
  const maps = new Map<string, Map<string, string>>();
  for (const f of refFields) {
    maps.set(`${f.name}`, await resolveLabels(db, f.ref!, scope.orgId, scope.projectId, rows.map((r) => r[f.name])));
  }
  for (const r of rows) {
    r._labels = Object.fromEntries(refFields.filter((f) => r[f.name]).map((f) => [f.name, maps.get(f.name)?.get(r[f.name]) ?? null]));
  }
  for (const ld of lineDefs) {
    const all = rows.flatMap((r) => (Array.isArray(r[ld.name]) ? r[ld.name] : []));
    if (all.length === 0) continue;
    for (const lf of (ld.lines ?? []).filter((x) => x.type === 'ref' && x.ref)) {
      const m = await resolveLabels(db, lf.ref!, scope.orgId, scope.projectId, all.map((l: any) => l[lf.name]));
      for (const l of all) {
        l._labels = { ...(l._labels ?? {}), ...(l[lf.name] ? { [lf.name]: m.get(l[lf.name]) ?? null } : {}) };
      }
    }
  }
  return rows;
}

function scopeWhere(def: ResourceDef, scope: Scope) {
  return def.projectScoped ? { projectId: scope.projectId } : { orgId: scope.orgId };
}

function editableStatuses(def: ResourceDef): readonly string[] | null {
  if (def.editableStatuses) return def.editableStatuses;
  if (def.workflow) return DEFAULT_EDITABLE;
  return null;
}

export function recordPermissions(ctx: AccessContext, def: ResourceDef, scope: Scope, record: any) {
  const manage = can(ctx, `${def.area}.manage`, scope.projectId);
  const editable = editableStatuses(def);
  const statusOk = !editable || editable.includes(record.status);
  return {
    canEdit: manage && statusOk,
    canSubmit: manage && !!def.workflow && ['DRAFT', 'RETURNED'].includes(record.status),
    canDelete: manage && !!def.deletable && statusOk,
    canCancel: manage && !!def.workflow && ['DRAFT', 'RETURNED'].includes(record.status),
  };
}

function searchWhere(def: ResourceDef, q: string) {
  const fields = def.searchFields ?? [def.titleField];
  return { OR: fields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' } })) };
}

function buildListWhere(def: ResourceDef, scope: Scope, query: Request['query']) {
  const where: Record<string, unknown> = { ...scopeWhere(def, scope) };
  const and: Record<string, unknown>[] = [];
  for (const [k, raw] of Object.entries(query)) {
    if (RESERVED.has(k) || raw === undefined || raw === '') continue;
    const f = def.fields.find((x) => x.name === k);
    if (!f || (!f.filter && k !== 'status')) continue;
    const v = String(raw);
    if (f.type === 'boolean') and.push({ [k]: v === 'true' });
    else if (f.type === 'date') and.push({ [k]: toDateOnly(v) });
    else if (f.type === 'tags') and.push({ [k]: { has: v } });
    else if (v.includes(',')) and.push({ [k]: { in: v.split(',') } });
    else and.push({ [k]: v });
  }
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) and.push(searchWhere(def, q));
  const dateField = def.fields.find((f) => f.name === def.defaultSort?.field && f.type === 'date') ?? def.fields.find((f) => f.type === 'date' && f.list);
  if (dateField && (query.from || query.to)) {
    and.push({ [dateField.name]: { ...(query.from ? { gte: toDateOnly(String(query.from)) } : {}), ...(query.to ? { lte: toDateOnly(String(query.to)) } : {}) } });
  }
  if (and.length) where.AND = and;
  return where;
}

export async function listResource(ctx: AccessContext, def: ResourceDef, scope: Scope, query: Request['query']) {
  assertCan(ctx, `${def.area}.view`, scope.projectId);
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize ?? 25) || 25));
  const sortable = new Set(def.fields.filter((f) => f.sortable || f.list).map((f) => f.name).concat(['createdAt', 'updatedAt']));
  const sortField = typeof query.sort === 'string' && sortable.has(query.sort) ? query.sort : (def.defaultSort?.field ?? 'createdAt');
  const dir = query.dir === 'asc' || query.dir === 'desc' ? query.dir : (def.defaultSort?.dir ?? 'desc');
  const where = buildListWhere(def, scope, query);
  if (def.key === 'documents' && !can(ctx, 'document.manage', scope.projectId)) (where as any).confidential = false;
  const [items, total] = await Promise.all([
    delegate(prisma, def.model).findMany({ where, orderBy: [{ [sortField]: dir }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    delegate(prisma, def.model).count({ where }),
  ]);
  await decorate(prisma, def, scope, items);
  return { items, total, page, pageSize };
}

export async function getResource(ctx: AccessContext, def: ResourceDef, scope: Scope, id: string, db: Db = prisma) {
  assertCan(ctx, `${def.area}.view`, scope.projectId);
  const hooks = hooksFor(def.key);
  const rec = await delegate(db, def.model).findFirst({ where: { id, ...scopeWhere(def, scope) }, include: hooks.include });
  if (!rec) throw notFound(def.label);
  if (def.key === 'documents' && rec.confidential && !can(ctx, 'document.manage', scope.projectId)) throw notFound(def.label);
  await decorate(db, def, scope, [rec]);
  rec._permissions = recordPermissions(ctx, def, scope, rec);
  return rec;
}

function nestedLines(def: ResourceDef, data: Record<string, any>, mode: 'create' | 'update') {
  for (const f of def.fields.filter((x) => x.type === 'lines')) {
    if (!Array.isArray(data[f.name])) continue;
    data[f.name] = mode === 'create' ? { create: data[f.name] } : { deleteMany: {}, create: data[f.name] };
  }
}

function snapshot(rec: any) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec ?? {})) if (!Array.isArray(v) && (typeof v !== 'object' || v === null || v instanceof Date || (v as any).constructor?.name === 'Decimal')) out[k] = v;
  return JSON.parse(JSON.stringify(out));
}

export async function createResource(ctx: AccessContext, def: ResourceDef, scope: Scope, body: unknown, tx?: Tx) {
  assertCan(ctx, `${def.area}.manage`, scope.projectId);
  const parsed = buildResourceSchemas(def).create.safeParse(body ?? {});
  if (!parsed.success) throw validationError('Please correct the highlighted fields', parsed.error.flatten());
  const run = async (t: Tx) => {
    const data = convertRow(def.fields, parsed.data) as Record<string, any>;
    await validateRefs(t, scope, def.fields, data);
    if (def.workflow || def.editableStatuses) {
      if (!def.manualStatuses) data.status = 'DRAFT';
    }
    if (def.manualStatuses && data.status && !def.manualStatuses.includes(data.status)) throw validationError('Invalid status');
    await hooksFor(def.key).prepare?.(t, ctx, scope, data, null);
    if (def.docType && def.fields.some((f) => f.name === 'number')) {
      const dateField = def.fields.find((f) => f.type === 'date' && data[f.name]);
      data.number = await nextNumber(t, { orgId: scope.orgId, projectId: scope.projectId, docType: def.docType, date: dateField ? data[dateField.name] : new Date() });
    }
    if (def.creatorField) data[def.creatorField] = ctx.user.id;
    Object.assign(data, scopeWhere(def, scope));
    nestedLines(def, data, 'create');
    const rec = await delegate(t, def.model).create({ data });
    await hooksFor(def.key).afterSave?.(t, ctx, scope, rec, null);
    if (def.docType && rec.number) {
      await upsertRegister(t, { orgId: scope.orgId, projectId: scope.projectId, docType: def.docType, number: rec.number, entityType: def.model, entityId: rec.id, title: String(rec[def.titleField] ?? ''), status: rec.status ?? null, ownerId: def.creatorField ? ctx.user.id : null, amount: rec.total ?? rec.netAmount ?? rec.amount ?? rec.contractValue ?? null });
    }
    await audit(t, ctx, { action: 'CREATE', entityType: def.model, entityId: rec.id, projectId: scope.projectId, summary: `${def.label} ${rec.number ?? rec[def.titleField] ?? ''} created`, after: snapshot(rec) });
    return rec;
  };
  const rec = tx ? await run(tx) : await transaction(run);
  return rec;
}

export async function updateResource(ctx: AccessContext, def: ResourceDef, scope: Scope, id: string, body: any, tx?: Tx) {
  assertCan(ctx, `${def.area}.manage`, scope.projectId);
  const parsed = buildResourceSchemas(def).update.safeParse(body ?? {});
  if (!parsed.success) throw validationError('Please correct the highlighted fields', parsed.error.flatten());
  const run = async (t: Tx) => {
    const existing = await delegate(t, def.model).findFirst({ where: { id, ...scopeWhere(def, scope) }, include: hooksFor(def.key).include });
    if (!existing) throw notFound(def.label);
    if (body?.expectedUpdatedAt && new Date(body.expectedUpdatedAt).getTime() !== new Date(existing.updatedAt).getTime()) {
      throw conflict('This record was changed by someone else. Reload to see the latest version.');
    }
    const editable = editableStatuses(def);
    if (editable && existing.status && !editable.includes(existing.status)) throw conflict(`A ${def.label.toLowerCase()} in status ${existing.status} cannot be edited`);
    const data = convertRow(def.fields, parsed.data) as Record<string, any>;
    if ('status' in data) {
      if (!def.manualStatuses) delete data.status;
      else if (!def.manualStatuses.includes(data.status)) throw validationError('Invalid status');
    }
    await validateRefs(t, scope, def.fields, data);
    await hooksFor(def.key).prepare?.(t, ctx, scope, data, existing);
    nestedLines(def, data, 'update');
    const rec = await delegate(t, def.model).update({ where: { id }, data });
    await hooksFor(def.key).afterSave?.(t, ctx, scope, rec, existing);
    if (def.docType && rec.number) {
      await upsertRegister(t, { orgId: scope.orgId, projectId: scope.projectId, docType: def.docType, number: rec.number, entityType: def.model, entityId: rec.id, title: String(rec[def.titleField] ?? ''), status: rec.status ?? null, amount: rec.total ?? rec.netAmount ?? rec.amount ?? rec.contractValue ?? null });
    }
    const d = diff(snapshot(existing), snapshot(rec));
    await audit(t, ctx, { action: 'UPDATE', entityType: def.model, entityId: id, projectId: scope.projectId, summary: `${def.label} ${rec.number ?? rec[def.titleField] ?? ''} updated`, before: d.before, after: d.after, reason: body?.reason ?? null });
    return rec;
  };
  return tx ? run(tx) : transaction(run);
}

export async function deleteResource(ctx: AccessContext, def: ResourceDef, scope: Scope, id: string) {
  assertCan(ctx, `${def.area}.manage`, scope.projectId);
  if (!def.deletable) throw conflict(`${def.plural} cannot be deleted. Cancel or close the record instead so history is preserved.`);
  return transaction(async (t) => {
    const existing = await delegate(t, def.model).findFirst({ where: { id, ...scopeWhere(def, scope) } });
    if (!existing) throw notFound(def.label);
    const editable = editableStatuses(def);
    if (editable && existing.status && !editable.includes(existing.status)) throw conflict('Only draft records can be deleted');
    await delegate(t, def.model).delete({ where: { id } });
    await audit(t, ctx, { action: 'DELETE', entityType: def.model, entityId: id, projectId: scope.projectId, summary: `${def.label} deleted`, before: snapshot(existing) });
    return { ok: true };
  });
}

/** Cancels a draft / returned workflow document. Approved documents use module-specific reversal flows. */
export async function cancelResource(ctx: AccessContext, def: ResourceDef, scope: Scope, id: string, reason?: string) {
  assertCan(ctx, `${def.area}.manage`, scope.projectId);
  if (!def.workflow) throw conflict('This record type has no cancellation flow');
  return transaction(async (t) => {
    const existing = await delegate(t, def.model).findFirst({ where: { id, ...scopeWhere(def, scope) } });
    if (!existing) throw notFound(def.label);
    if (!['DRAFT', 'RETURNED'].includes(existing.status)) throw conflict(`Cannot cancel a document in status ${existing.status}`);
    if (!reason?.trim()) throw validationError('A cancellation reason is required');
    const rec = await delegate(t, def.model).update({ where: { id }, data: { status: 'CANCELLED' } });
    await t.registerEntry.updateMany({ where: { entityType: def.model, entityId: id }, data: { status: 'CANCELLED' } });
    await audit(t, ctx, { action: 'CANCEL', entityType: def.model, entityId: id, projectId: scope.projectId, summary: `${def.label} ${existing.number ?? ''} cancelled`, reason });
    return rec;
  });
}

function scopeFor(req: Request, projectScoped: boolean): Scope {
  const ctx = ctxOf(req);
  return { orgId: ctx.orgId, projectId: projectScoped ? String(req.params.projectId) : null };
}

/** Mounts CRUD routes for every registered resource. */
export function resourceRouter(projectScoped: boolean) {
  const r = Router({ mergeParams: true });

  r.use(async (req, _res, next) => {
    if (projectScoped) await assertProjectAccess(prisma, ctxOf(req), String(req.params.projectId));
    next();
  });

  r.get('/:resource', async (req, res) => {
    const def = getDef(String(req.params.resource), projectScoped);
    res.json(await listResource(ctxOf(req), def, scopeFor(req, projectScoped), req.query));
  });

  r.post('/:resource', async (req, res) => {
    const def = getDef(String(req.params.resource), projectScoped);
    const rec = await createResource(ctxOf(req), def, scopeFor(req, projectScoped), req.body);
    res.status(201).json(rec);
  });

  r.get('/:resource/:id', async (req, res) => {
    const def = getDef(String(req.params.resource), projectScoped);
    res.json(await getResource(ctxOf(req), def, scopeFor(req, projectScoped), String(req.params.id)));
  });

  r.patch('/:resource/:id', async (req, res) => {
    const def = getDef(String(req.params.resource), projectScoped);
    res.json(await updateResource(ctxOf(req), def, scopeFor(req, projectScoped), String(req.params.id), req.body));
  });

  r.delete('/:resource/:id', async (req, res) => {
    const def = getDef(String(req.params.resource), projectScoped);
    res.json(await deleteResource(ctxOf(req), def, scopeFor(req, projectScoped), String(req.params.id)));
  });

  r.post('/:resource/:id/submit', async (req, res) => {
    const def = getDef(String(req.params.resource), projectScoped);
    if (!def.workflow || !def.docType) throw conflict('This record type is not approval-controlled');
    const scope = scopeFor(req, projectScoped);
    const rec = await delegate(prisma, def.model).findFirst({ where: { id: String(req.params.id), ...scopeWhere(def, scope) }, select: def.model === 'measurement' ? { id: true, type: true } : { id: true } });
    if (!rec) throw notFound(def.label);
    const docType = def.model === 'measurement' ? rec.type : def.docType;
    getHandler(docType);
    const result = await submitDocument(ctxOf(req), docType, rec.id, req.body?.comment);
    res.json(result);
  });

  r.post('/:resource/:id/cancel', async (req, res) => {
    const def = getDef(String(req.params.resource), projectScoped);
    res.json(await cancelResource(ctxOf(req), def, scopeFor(req, projectScoped), String(req.params.id), req.body?.reason));
  });

  return r;
}

export function assertManage(ctx: AccessContext, area: string, projectId: string | null) {
  if (!can(ctx, `${area}.manage`, projectId)) throw forbidden(`Missing permission ${area}.manage`);
}
