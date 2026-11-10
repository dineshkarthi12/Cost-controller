import { Router } from 'express';
import { z } from 'zod';
import { MATERIAL_PRESETS } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { parseBody } from '../lib/http.js';
import { validationError } from '../lib/errors.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan } from '../services/access.js';
import { audit } from '../services/audit.js';
import { DEFAULT_UOMS } from '../services/bootstrap.js';

/** Ready-made material list: see which presets the organisation already has, and add the chosen ones in one go. */
export const materialPresetsRouter = Router();

const norm = (s: string) => s.trim().toLowerCase();

/** Existing materials matched by code or by name (case-insensitive), so a preset is never added twice. */
async function existingKeys(orgId: string) {
  const rows = await prisma.material.findMany({ where: { orgId }, select: { code: true, name: true } });
  return { codes: new Set(rows.map((r) => norm(r.code))), names: new Set(rows.map((r) => norm(r.name))) };
}

materialPresetsRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'material.view');
  const ex = await existingKeys(ctx.orgId);
  res.json(MATERIAL_PRESETS.map((m) => ({ ...m, exists: ex.codes.has(norm(m.code)) || ex.names.has(norm(m.name)) })));
});

const rate = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => v === '' || (/^\d+(\.\d{1,4})?$/.test(v) && Number(v) < 1e12), 'Enter a number with up to 4 decimals')
  .optional();
const addSchema = z.object({
  items: z.array(z.object({ code: z.string().trim().min(1), standardRate: rate, reorderLevel: rate })).min(1, 'Choose at least one material').max(500),
});

materialPresetsRouter.post('/', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'material.manage');
  const { items } = parseBody(addSchema, req.body);
  const byCode = new Map(MATERIAL_PRESETS.map((m) => [m.code, m]));
  const unknown = items.filter((i) => !byCode.has(i.code)).map((i) => i.code);
  if (unknown.length) throw validationError(`Not in the preset list: ${unknown.slice(0, 10).join(', ')}`);

  const result = await transaction(async (tx) => {
    const rows = await tx.material.findMany({ where: { orgId: ctx.orgId }, select: { code: true, name: true } });
    const codes = new Set(rows.map((r) => norm(r.code)));
    const names = new Set(rows.map((r) => norm(r.name)));
    const created: string[] = [];
    const skipped: Array<{ code: string; reason: string }> = [];
    for (const i of items) {
      const m = byCode.get(i.code)!;
      if (codes.has(norm(m.code)) || names.has(norm(m.name))) {
        skipped.push({ code: m.code, reason: 'Already in the material list' });
        continue;
      }
      // The unit list starts with these units, but an administrator may have removed one.
      const uom = DEFAULT_UOMS.find(([c]) => c === m.unit);
      if (uom) await tx.uom.upsert({ where: { orgId_code: { orgId: ctx.orgId, code: uom[0] } }, create: { orgId: ctx.orgId, code: uom[0], name: uom[1], dimension: uom[2] }, update: {} });
      await tx.material.create({
        data: { orgId: ctx.orgId, code: m.code, name: m.name, category: m.category, unit: m.unit, specification: m.specification ?? null, standardRate: i.standardRate || null, reorderLevel: i.reorderLevel || null },
      });
      codes.add(norm(m.code));
      names.add(norm(m.name));
      created.push(m.code);
    }
    if (created.length) await audit(tx, ctx, { action: 'CREATE', entityType: 'material', summary: `${created.length} material(s) added from the preset list: ${created.join(', ')}` });
    return { created, skipped };
  });
  res.status(201).json(result);
});
