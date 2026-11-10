import { Router } from 'express';
import { z } from 'zod';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan } from '../services/access.js';
import { audit } from '../services/audit.js';
import { repriceBomForMaterials } from '../services/materialRates.js';

/** One place for material rates: every material with its standard, last and average purchase rates and where it is used. */
export const materialRatesRouter = Router();

materialRatesRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'material.view');
  const [materials, usage] = await Promise.all([
    prisma.material.findMany({
      where: { orgId: ctx.orgId },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, category: true, unit: true, isActive: true, standardRate: true, lastPurchaseRate: true, avgPurchaseRate: true, lastPurchaseDate: true, lastPurchaseRef: true, updatedAt: true },
    }),
    prisma.bomLine.findMany({ where: { materialId: { not: null }, bomItem: { project: { orgId: ctx.orgId } } }, select: { materialId: true, rateSource: true, bomItem: { select: { project: { select: { code: true } } } } } }),
  ]);
  const use = new Map<string, { lines: number; following: number; projects: Set<string> }>();
  for (const l of usage) {
    const u = use.get(l.materialId!) ?? { lines: 0, following: 0, projects: new Set<string>() };
    u.lines++;
    if (l.rateSource === 'MATERIAL') u.following++;
    u.projects.add(l.bomItem.project.code);
    use.set(l.materialId!, u);
  }
  res.json(
    materials.map((m) => {
      const u = use.get(m.id);
      return { ...m, bomLines: u?.lines ?? 0, bomLinesFollowing: u?.following ?? 0, projects: u ? [...u.projects].sort() : [] };
    }),
  );
});

const rateSchema = z.object({
  standardRate: z.union([z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'Enter a rate with up to 4 decimals'), z.null()]),
});

/** Changes the standard rate; BOM lines in every project that take their rate from this material follow at once. */
materialRatesRouter.put('/:id', async (req, res) => {
  const ctx = ctxOf(req);
  assertCan(ctx, 'material.manage');
  const { standardRate } = parseBody(rateSchema, req.body);
  const out = await transaction(async (tx) => {
    const m = await tx.material.findFirst({ where: { id: param(req, 'id'), orgId: ctx.orgId } });
    if (!m) throw notFound('Material');
    const u = await tx.material.update({ where: { id: m.id }, data: { standardRate } });
    await audit(tx, ctx, { action: 'UPDATE', entityType: 'material', entityId: m.id, summary: `Standard rate of ${m.code} ${m.standardRate?.toString() ?? '—'} → ${standardRate ?? '—'}`, before: { standardRate: m.standardRate?.toString() ?? null }, after: { standardRate } });
    const repriced = await repriceBomForMaterials(tx, ctx, [m.id], `rate of ${m.code} changed`);
    return { material: u, repriced };
  });
  res.json(out);
});
