import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { D, money, matchMaterial, unitFactor } from '@toprock/shared';
import { prisma, transaction, type Db } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess, can } from '../services/access.js';
import { audit } from '../services/audit.js';
import { readBomWorkbook, type ParsedBomItem } from '../services/bomExcelReader.js';
import { PURCHASED_PO_STATUSES, rateForLine } from '../services/materialRates.js';

/** Bill of materials per BOQ item: import from the estimator's workbook, material summary, rates, export. */
export const bomRouter = Router({ mergeParams: true });

bomRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

const include = { lines: { orderBy: { lineNo: 'asc' as const }, include: { material: { select: { id: true, code: true, name: true, unit: true } } } }, boqItem: { select: { id: true, itemCode: true, description: true, unit: true, contractQty: true } } };
const amountOf = (totalQty: unknown, rate: unknown) => (rate === null || rate === undefined ? null : money(D(totalQty as string).times(D(rate as string))));


// ───────────── Material master link and rates ─────────────

type MaterialForRate = { id: string; code: string; name: string; unit: string; standardRate: unknown; lastPurchaseRate: unknown };

async function orgMaterials(db: Db, orgId: string): Promise<MaterialForRate[]> {
  return db.material.findMany({ where: { orgId, isActive: true }, select: { id: true, code: true, name: true, unit: true, standardRate: true, lastPurchaseRate: true } });
}


async function loadBom(projectId: string) {
  return prisma.bomItem.findMany({ where: { projectId }, orderBy: { lineNo: 'asc' }, include });
}
type Bom = Awaited<ReturnType<typeof loadBom>>;

/** Totals per kind, and the material / labour summary (same description and unit added together). */
function summarise(items: Bom) {
  const lines = items.flatMap((i) => i.lines.map((l) => ({ ...l, refCode: i.refCode })));
  type Material = { id: string; code: string; name: string; unit: string } | null;
  const groups = new Map<string, { kind: string; description: string; unit: string; material: Material; totalQty: ReturnType<typeof D>; amount: ReturnType<typeof D>; priced: number; lines: number; usedIn: Set<string>; rates: Set<string> }>();
  for (const l of lines) {
    const key = `${l.kind}|${l.description.toLowerCase().replace(/\s+/g, ' ').trim()}|${l.unit.toLowerCase()}|${l.materialId ?? ''}`;
    const g = groups.get(key) ?? { kind: l.kind, description: l.description, unit: l.unit, material: l.material ?? null, totalQty: D(0), amount: D(0), priced: 0, lines: 0, usedIn: new Set<string>(), rates: new Set<string>() };
    g.totalQty = g.totalQty.plus(D(l.totalQty));
    if (l.amount !== null) {
      g.amount = g.amount.plus(D(l.amount));
      g.priced++;
    }
    if (l.rate !== null) g.rates.add(D(l.rate).toString());
    g.lines++;
    g.usedIn.add(l.refCode);
    groups.set(key, g);
  }
  const summary = [...groups.values()]
    .map((g) => ({ kind: g.kind, description: g.description, unit: g.unit, material: g.material, totalQty: D(g.totalQty).toDecimalPlaces(4).toString(), rate: g.rates.size === 1 ? [...g.rates][0] : null, amount: g.priced ? money(g.amount) : null, pricedLines: g.priced, lines: g.lines, usedIn: [...g.usedIn] }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.description.localeCompare(b.description));
  const byKind: Record<string, { lines: number; amount: string; priced: number }> = {};
  for (const l of lines) {
    const k = (byKind[l.kind] ??= { lines: 0, amount: '0.00', priced: 0 });
    k.lines++;
    if (l.amount !== null) {
      k.amount = money(D(k.amount).plus(D(l.amount)));
      k.priced++;
    }
  }
  const materialLines = lines.filter((l) => l.kind === 'MATERIAL');
  const links = { materialLines: materialLines.length, linked: materialLines.filter((l) => l.materialId).length };
  return { summary, totals: { items: items.length, lines: lines.length, priced: lines.filter((l) => l.amount !== null).length, links, amount: money(lines.reduce((a, l) => a.plus(D(l.amount ?? 0)), D(0))), byKind } };
}

bomRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'boq.view', projectId);
  const items = await loadBom(projectId);
  const { summary, totals } = summarise(items);
  res.json({ items, summary, totals, canManage: can(ctx, 'boq.manage', projectId) });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

/** Step 1: read the workbook and show what will be imported. Nothing is written to the BOM. */
bomRouter.post('/import/preview', upload.single('file'), async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'boq.manage', projectId);
  if (!req.file) throw validationError('Choose the BOM Excel file');
  const parsed = await readBomWorkbook(req.file.buffer);
  const mats = await orgMaterials(prisma, ctx.orgId);
  const boq = new Map((await prisma.boqItem.findMany({ where: { projectId }, select: { id: true, itemCode: true } })).map((b) => [b.itemCode.toUpperCase(), b.id]));
  const refs = parsed.items.filter((i) => i.boqRef);
  const matched = refs.filter((i) => boq.has(i.boqRef!.toUpperCase())).length;
  const lines = parsed.items.flatMap((i) => i.lines);
  const summary = {
    sheets: parsed.sheets,
    items: parsed.items.length,
    lines: lines.length,
    material: lines.filter((l) => l.kind === 'MATERIAL').length,
    labour: lines.filter((l) => l.kind === 'LABOUR').length,
    other: lines.filter((l) => l.kind !== 'MATERIAL' && l.kind !== 'LABOUR').length,
    priced: lines.filter((l) => l.rate !== null).length,
    materialMatched: lines.filter((l) => l.kind === 'MATERIAL' && matchMaterial(l.description, mats)).length,
    boqRefs: refs.length,
    boqMatched: matched,
    unmatchedRefs: [...new Set(refs.filter((i) => !boq.has(i.boqRef!.toUpperCase())).map((i) => i.boqRef!))].slice(0, 30),
    existingItems: await prisma.bomItem.count({ where: { projectId } }),
    warnings: parsed.warnings.slice(0, 50),
  };
  const job = await prisma.importJob.create({ data: { orgId: ctx.orgId, projectId, kind: 'BOM', fileName: req.file.originalname.slice(0, 200), rows: parsed.items as never, summary, createdById: ctx.user.id } });
  res.status(201).json({ id: job.id, summary, sample: parsed.items.slice(0, 5) });
});

/** Step 2: save. An existing BOM is only replaced when the user confirms. */
bomRouter.post('/import/:id/commit', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'boq.manage', projectId);
  const { replace } = parseBody(z.object({ replace: z.boolean().default(false) }), req.body ?? {});
  const job = await prisma.importJob.findFirst({ where: { id: param(req, 'id'), projectId, kind: 'BOM' } });
  if (!job) throw notFound('BOM import');
  if (job.status !== 'PREVIEW') throw conflict('This import has already been processed');
  const items = job.rows as unknown as ParsedBomItem[];
  const out = await transaction(async (tx) => {
    const existing = await tx.bomItem.count({ where: { projectId } });
    if (existing && !replace) throw conflict(`This project already has a BOM with ${existing} items. Confirm to replace it.`);
    if (existing) await tx.bomItem.deleteMany({ where: { projectId } });
    const boq = new Map((await tx.boqItem.findMany({ where: { projectId }, select: { id: true, itemCode: true } })).map((b) => [b.itemCode.toUpperCase(), b.id]));
    let n = 0;
    const mats = await orgMaterials(tx, ctx.orgId);
    let linked = 0;
    let pricedFromMaterial = 0;
    /** Material lines are linked to the material master by name; a line without a rate in the file takes the material's rate. */
    const lineData = (l: ParsedBomItem['lines'][number], j: number) => {
      const m = l.kind === 'MATERIAL' ? matchMaterial(l.description, mats) : null;
      if (m) linked++;
      let rate: string | null = l.rate === null ? null : String(l.rate);
      let rateSource: string | null = rate === null ? null : 'FILE';
      if (rate === null && m) {
        const r = rateForLine(m, l.unit);
        if (r.rate) {
          rate = r.rate;
          rateSource = 'MATERIAL';
          pricedFromMaterial++;
        }
      }
      return { lineNo: j + 1, kind: l.kind, description: l.description, qty: String(l.qty), wastagePct: String(l.wastagePct), totalQty: String(l.totalQty), unit: l.unit, rate, rateSource, amount: amountOf(l.totalQty, rate), remarks: l.remarks, materialId: m?.id ?? null };
    };
    for (const [i, it] of items.entries()) {
      await tx.bomItem.create({
        data: {
          projectId,
          lineNo: i + 1,
          sheet: it.sheet,
          section: it.section,
          refCode: it.refCode,
          title: it.title,
          boqRef: it.boqRef,
          boqItemId: it.boqRef ? (boq.get(it.boqRef.toUpperCase()) ?? null) : null,
          boqNote: it.boqNote?.slice(0, 1000) ?? null,
          takingQty: it.takingQty === null ? null : String(it.takingQty),
          takingUnit: it.takingUnit,
          createdById: ctx.user.id,
          lines: { create: it.lines.map(lineData) },
        },
      });
      n += it.lines.length;
    }
    await tx.importJob.update({ where: { id: job.id }, data: { status: 'COMMITTED', committedAt: new Date() } });
    await audit(tx, ctx, { action: 'IMPORT_COMMITTED', entityType: 'bom', entityId: job.id, projectId, summary: `BOM imported from ${job.fileName}: ${items.length} items, ${n} lines, ${linked} linked to materials, ${pricedFromMaterial} priced from material rates${existing ? ` (replaced ${existing} items)` : ''}` });
    return { items: items.length, lines: n, replaced: existing, linked, pricedFromMaterial };
  });
  res.json(out);
});

const lineSchema = z.object({
  rate: z.union([z.number().min(0), z.string().regex(/^\d+(\.\d{1,4})?$/), z.null()]).optional(),
  qty: z.union([z.number().min(0), z.string().regex(/^\d+(\.\d{1,4})?$/)]).optional(),
  wastagePct: z.union([z.number().min(0).max(5), z.string().regex(/^\d+(\.\d{1,4})?$/)]).optional(),
  remarks: z.string().trim().max(1000).nullable().optional(),
  /** Link to a material of the master (null clears it). Linking a line without a rate takes the material's rate. */
  materialId: z.string().min(1).max(64).nullable().optional(),
});

/** Procurement fills in costs line by line; quantity and wastage can be corrected. */
bomRouter.patch('/lines/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'boq.manage', projectId);
  const body = parseBody(lineSchema, req.body);
  const out = await transaction(async (tx) => {
    const l = await tx.bomLine.findFirst({ where: { id: param(req, 'id'), bomItem: { projectId } } });
    if (!l) throw notFound('BOM line');
    const qty = body.qty !== undefined ? D(body.qty) : D(l.qty);
    const w = body.wastagePct !== undefined ? D(body.wastagePct) : D(l.wastagePct);
    const totalQty = qty.times(D(1).plus(w)).toDecimalPlaces(4);
    let rate: unknown = body.rate !== undefined ? body.rate : l.rate;
    let rateSource = body.rate !== undefined ? (body.rate === null ? null : 'MANUAL') : l.rateSource;
    let materialId = l.materialId;
    if (body.materialId !== undefined) {
      materialId = body.materialId;
      if (materialId) {
        const m = await tx.material.findFirst({ where: { id: materialId, orgId: ctx.orgId }, select: { id: true, unit: true, standardRate: true, lastPurchaseRate: true } });
        if (!m) throw validationError('Material not found');
        if ((rate === null || rate === undefined) && body.rate === undefined) {
          const r = rateForLine(m, l.unit);
          if (r.rate) {
            rate = r.rate;
            rateSource = 'MATERIAL';
          }
        }
      }
    }
    const u = await tx.bomLine.update({ where: { id: l.id }, data: { qty: qty.toString(), wastagePct: w.toString(), totalQty: totalQty.toString(), rate: rate === null || rate === undefined ? null : String(rate), rateSource, materialId, amount: amountOf(totalQty, rate ?? null), remarks: body.remarks === undefined ? l.remarks : body.remarks } });
    await audit(tx, ctx, { action: 'UPDATE', entityType: 'bomLine', entityId: l.id, projectId, summary: `BOM line “${l.description.slice(0, 60)}” updated`, before: { qty: l.qty.toString(), wastagePct: l.wastagePct.toString(), rate: l.rate?.toString() ?? null, materialId: l.materialId }, after: { qty: u.qty.toString(), wastagePct: u.wastagePct.toString(), rate: u.rate?.toString() ?? null, materialId: u.materialId } });
    return u;
  });
  res.json(out);
});

/** Links material lines that are not linked yet to the material master by name (e.g. after adding materials). Empty rates are filled. */
bomRouter.post('/link-materials', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'boq.manage', projectId);
  const out = await transaction(async (tx) => {
    const mats = await orgMaterials(tx, ctx.orgId);
    const lines = await tx.bomLine.findMany({ where: { bomItem: { projectId }, kind: 'MATERIAL', materialId: null } });
    let linked = 0;
    let priced = 0;
    for (const l of lines) {
      const m = matchMaterial(l.description, mats);
      if (!m) continue;
      linked++;
      const data: Record<string, unknown> = { materialId: m.id };
      if (l.rate === null) {
        const r = rateForLine(m, l.unit);
        if (r.rate) {
          Object.assign(data, { rate: r.rate, rateSource: 'MATERIAL', amount: amountOf(l.totalQty, r.rate) });
          priced++;
        }
      }
      await tx.bomLine.update({ where: { id: l.id }, data });
    }
    if (linked) await audit(tx, ctx, { action: 'UPDATE', entityType: 'bom', projectId, summary: `BOM: ${linked} material line(s) linked to the material list by name, ${priced} priced from material rates` });
    return { checked: lines.length, linked, priced, unlinked: lines.length - linked };
  });
  res.json(out);
});

/**
 * Re-prices linked material lines from the materials' current rates (standard rate, which follows
 * approved POs, else last purchase rate). Rates typed in the app are kept unless includeManual is set.
 */
bomRouter.post('/refresh-rates', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'boq.manage', projectId);
  const { includeManual } = parseBody(z.object({ includeManual: z.boolean().default(false) }), req.body ?? {});
  const out = await transaction(async (tx) => {
    const lines = await tx.bomLine.findMany({ where: { bomItem: { projectId }, materialId: { not: null } }, include: { material: { select: { id: true, unit: true, standardRate: true, lastPurchaseRate: true } } } });
    const r = { updated: 0, unchanged: 0, keptManual: 0, noRate: 0, unitMismatch: 0, before: D(0), after: D(0) };
    for (const l of lines) {
      if (!l.material) continue;
      if (l.rateSource === 'MANUAL' && !includeManual) {
        r.keptManual++;
        continue;
      }
      const x = rateForLine(l.material, l.unit);
      if (!x.rate) {
        if (x.reason === 'UNIT') r.unitMismatch++;
        else r.noRate++;
        continue;
      }
      if (l.rate !== null && D(l.rate).eq(D(x.rate)) && l.rateSource === 'MATERIAL') {
        r.unchanged++;
        continue;
      }
      r.before = r.before.plus(D(l.amount ?? 0));
      const amount = amountOf(l.totalQty, x.rate);
      r.after = r.after.plus(D(amount ?? 0));
      await tx.bomLine.update({ where: { id: l.id }, data: { rate: x.rate, rateSource: 'MATERIAL', amount } });
      r.updated++;
    }
    const result = { updated: r.updated, unchanged: r.unchanged, keptManual: r.keptManual, noRate: r.noRate, unitMismatch: r.unitMismatch, amountBefore: money(r.before), amountAfter: money(r.after) };
    if (r.updated) await audit(tx, ctx, { action: 'UPDATE', entityType: 'bom', projectId, summary: `BOM rates refreshed from material rates: ${r.updated} line(s), ${money(r.before)} → ${money(r.after)}${includeManual ? ' (including rates typed by hand)' : ''}`, after: result });
    return result;
  });
  res.json(out);
});

/**
 * Material-wise cost for the project, in each material's own unit: what the BOM needs, what has been
 * ordered (approved POs), received (GRN), issued and is in stock, the rates, and the projected cost
 * (ordered value + still-to-order quantity at the current rate) against the BOM amount.
 */
bomRouter.get('/material-cost', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  if (!['boq.view', 'procurement.view', 'stock.view'].some((p) => can(ctx, p, projectId))) assertCan(ctx, 'boq.view', projectId);
  const [bomLines, poLines, stock] = await Promise.all([
    prisma.bomLine.findMany({ where: { bomItem: { projectId }, kind: 'MATERIAL' }, select: { materialId: true, totalQty: true, unit: true, amount: true, bomItem: { select: { refCode: true } } } }),
    prisma.purchaseOrderLine.findMany({ where: { materialId: { not: null }, po: { projectId, status: { in: PURCHASED_PO_STATUSES } } }, select: { materialId: true, qty: true, unit: true, amount: true, receivedQty: true } }),
    prisma.stockTransaction.groupBy({ by: ['materialId', 'type'], where: { projectId }, _sum: { qty: true, value: true } }),
  ]);
  const ids = [...new Set([...bomLines.map((l) => l.materialId), ...poLines.map((l) => l.materialId), ...stock.map((t) => t.materialId)].filter((x): x is string => !!x))];
  const mats = await prisma.material.findMany({ where: { id: { in: ids }, orgId: ctx.orgId }, select: { id: true, code: true, name: true, category: true, unit: true, standardRate: true, lastPurchaseRate: true, avgPurchaseRate: true, lastPurchaseDate: true, lastPurchaseRef: true } });
  const Z = () => D(0);
  const rows = new Map(mats.map((m) => [m.id, { m, required: Z(), bomAmount: Z(), bomPriced: 0, bomLines: 0, unitIssues: 0, usedIn: new Set<string>(), ordered: Z(), orderedValue: Z(), received: Z(), issued: Z(), wasted: Z(), stockQty: Z(), stockValue: Z() }]));
  for (const l of bomLines) {
    const r = l.materialId ? rows.get(l.materialId) : undefined;
    if (!r) continue;
    r.bomLines++;
    r.usedIn.add(l.bomItem.refCode);
    const f = unitFactor(l.unit, r.m.unit);
    if (!f) {
      r.unitIssues++;
      continue;
    }
    r.required = r.required.plus(D(l.totalQty).times(f));
    if (l.amount !== null) {
      r.bomAmount = r.bomAmount.plus(D(l.amount));
      r.bomPriced++;
    }
  }
  for (const l of poLines) {
    const r = rows.get(l.materialId!);
    if (!r) continue;
    const f = unitFactor(l.unit, r.m.unit);
    if (!f) {
      r.unitIssues++;
      continue;
    }
    r.ordered = r.ordered.plus(D(l.qty).times(f));
    r.orderedValue = r.orderedValue.plus(D(l.amount));
    r.received = r.received.plus(D(l.receivedQty).times(f));
  }
  for (const t of stock) {
    const r = rows.get(t.materialId);
    if (!r) continue;
    const q = D(t._sum.qty ?? 0);
    r.stockQty = r.stockQty.plus(q);
    r.stockValue = r.stockValue.plus(D(t._sum.value ?? 0));
    if (t.type === 'ISSUE' || t.type === 'RETURN_TO_STORE') r.issued = r.issued.minus(q);
    if (t.type === 'WASTAGE' || t.type === 'DAMAGE') r.wasted = r.wasted.minus(q);
  }
  const q4 = (v: ReturnType<typeof D>) => v.toDecimalPlaces(4).toString();
  const out = [...rows.values()].map((r) => {
    const currentRate = r.m.standardRate ?? r.m.lastPurchaseRate;
    const gap = r.required.minus(r.ordered);
    const toOrder = gap.isNegative() ? D(0) : gap;
    const beyondBom = gap.isNegative() && !r.required.isZero() ? gap.negated() : D(0);
    // Like for like with the BOM: the BOM quantity already ordered at this project's average PO rate,
    // plus the BOM quantity still to order at the current rate. Orders beyond the BOM quantity are shown
    // separately (beyondBomQty), so a partial BOM is never compared with every order of the project.
    const projectPoRate = r.ordered.isZero() ? null : r.orderedValue.div(r.ordered);
    const coveredQty = r.ordered.lt(r.required) ? r.ordered : r.required;
    let projected: ReturnType<typeof D> | null = null;
    if (!r.required.isZero()) {
      const covered = projectPoRate ? coveredQty.times(projectPoRate) : D(0);
      if (toOrder.isZero()) projected = covered;
      else if (currentRate !== null) projected = covered.plus(toOrder.times(D(currentRate)));
    }
    const bomFullyPriced = r.bomLines > 0 && r.bomPriced === r.bomLines - r.unitIssues;
    return {
      materialId: r.m.id,
      code: r.m.code,
      name: r.m.name,
      category: r.m.category,
      unit: r.m.unit,
      requiredQty: q4(r.required),
      bomAmount: r.bomPriced ? money(r.bomAmount) : null,
      bomRate: r.bomPriced && !r.required.isZero() && bomFullyPriced ? q4(r.bomAmount.div(r.required)) : null,
      bomFullyPriced,
      orderedQty: q4(r.ordered),
      orderedValue: money(r.orderedValue),
      receivedQty: q4(r.received),
      issuedQty: q4(r.issued),
      wastedQty: q4(r.wasted),
      stockQty: q4(r.stockQty),
      stockValue: money(r.stockValue),
      toOrderQty: q4(toOrder),
      beyondBomQty: q4(beyondBom),
      projectPoRate: projectPoRate ? q4(projectPoRate) : null,
      standardRate: r.m.standardRate?.toString() ?? null,
      lastPurchaseRate: r.m.lastPurchaseRate?.toString() ?? null,
      avgPurchaseRate: r.m.avgPurchaseRate?.toString() ?? null,
      lastPurchaseDate: r.m.lastPurchaseDate,
      lastPurchaseRef: r.m.lastPurchaseRef,
      projectedCost: projected === null ? null : money(projected),
      /** BOM amount − projected cost: positive is a saving against the BOM, negative an overrun. */
      variance: projected !== null && r.bomPriced && bomFullyPriced ? money(r.bomAmount.minus(projected)) : null,
      unitIssues: r.unitIssues,
      usedIn: [...r.usedIn],
    };
  });
  out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const unlinked = bomLines.filter((l) => !l.materialId);
  const sum = (k: 'bomAmount' | 'orderedValue' | 'stockValue' | 'projectedCost' | 'variance') => money(out.reduce((a, r) => a.plus(D(r[k] ?? 0)), D(0)));
  res.json({
    rows: out,
    totals: { materials: out.length, bomAmount: sum('bomAmount'), orderedValue: sum('orderedValue'), stockValue: sum('stockValue'), projectedCost: sum('projectedCost'), variance: sum('variance'), withoutProjection: out.filter((r) => r.projectedCost === null).length },
    unlinkedBom: { lines: unlinked.length, amount: money(unlinked.reduce((a, l) => a.plus(D(l.amount ?? 0)), D(0))) },
  });
});

/** Links a BOM item to a BOQ item of this project (or clears the link). */
bomRouter.patch('/items/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'boq.manage', projectId);
  const { boqItemId } = parseBody(z.object({ boqItemId: z.string().nullable() }), req.body);
  const item = await prisma.bomItem.findFirst({ where: { id: param(req, 'id'), projectId } });
  if (!item) throw notFound('BOM item');
  if (boqItemId && !(await prisma.boqItem.count({ where: { id: boqItemId, projectId } }))) throw validationError('BOQ item not found in this project');
  const u = await prisma.bomItem.update({ where: { id: item.id }, data: { boqItemId }, include });
  await audit(prisma, ctx, { action: 'UPDATE', entityType: 'bomItem', entityId: item.id, projectId, summary: `BOM ${item.refCode} ${boqItemId ? `linked to BOQ ${u.boqItem?.itemCode}` : 'unlinked from BOQ'}` });
  res.json(u);
});

/** Excel: the BOM in the estimator's layout and a material / labour summary for procurement. */
bomRouter.get('/export', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'boq.view', projectId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true, code: true } });
  const items = await loadBom(projectId);
  const { summary } = summarise(items);
  const wb = new ExcelJS.Workbook();
  wb.calcProperties = { fullCalcOnLoad: true };
  const head = (row: ExcelJS.Row) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }));
  };
  const ws = wb.addWorksheet('BOM', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 8 }, { width: 50 }, { width: 10 }, { width: 8 }, { width: 10 }, { width: 8 }, { width: 12 }, { width: 14 }, { width: 40 }];
  ws.getCell('A1').value = `${project.name} – Bill of Materials`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1F3864' } };
  let r = 3;
  let section: string | null = null;
  const KIND: Record<string, string> = { MATERIAL: 'Material', LABOUR: 'Man Power', EQUIPMENT: 'Equipment', OTHER: 'Other' };
  for (const it of items) {
    if (it.section !== section && it.section) {
      section = it.section;
      ws.getCell(r, 1).value = section;
      ws.getCell(r, 1).font = { bold: true, size: 12 };
      r += 1;
    }
    ws.getCell(r, 1).value = it.refCode;
    ws.getCell(r, 2).value = it.title;
    ws.getRow(r).font = { bold: true };
    r++;
    if (it.boqNote || it.takingQty !== null || it.boqItem) {
      ws.getCell(r, 2).value = [it.boqItem ? `BOQ ${it.boqItem.itemCode}` : null, it.boqNote].filter(Boolean).join(' | ');
      ws.getCell(r, 7).value = 'Taking Qty :';
      ws.getCell(r, 8).value = it.takingQty === null ? null : Number(it.takingQty);
      ws.getCell(r, 9).value = it.takingUnit;
      r++;
    }
    ws.getRow(r).values = ['S.No', 'Description', 'Qty', '% wstg', 'T. Qty', 'Unit', 'Cost (INR)', 'Amount (INR)', 'Remarks'];
    head(ws.getRow(r));
    r++;
    const first = r;
    let kind = '';
    let n = 0;
    for (const l of it.lines) {
      if (l.kind !== kind) {
        kind = l.kind;
        n = 0;
        ws.getCell(r, 2).value = KIND[kind] ?? kind;
        ws.getCell(r, 2).font = { italic: true, bold: true };
        r++;
      }
      const row = ws.getRow(r);
      row.values = [++n, l.description, Number(l.qty), Number(l.wastagePct), null, l.unit, l.rate === null ? null : Number(l.rate), null, l.remarks];
      row.getCell(5).value = { formula: `C${r}*(1+D${r})`, result: Number(l.totalQty) };
      row.getCell(8).value = { formula: `IF(G${r}="","",E${r}*G${r})`, result: l.amount === null ? '' : Number(l.amount) };
      row.getCell(4).numFmt = '0%';
      row.getCell(8).numFmt = '#,##0.00';
      r++;
    }
    ws.getCell(r, 1).value = 'Total amount';
    ws.getCell(r, 8).value = { formula: `SUM(H${first}:H${r - 1})`, result: it.lines.reduce((a, l) => a + Number(l.amount ?? 0), 0) };
    ws.getRow(r).font = { bold: true };
    r += 2;
  }
  const sm = wb.addWorksheet('Material summary');
  sm.columns = [{ header: 'Type', width: 12 }, { header: 'Description', width: 60 }, { header: 'Total qty', width: 12 }, { header: 'Unit', width: 8 }, { header: 'Rate', width: 12 }, { header: 'Amount', width: 14 }, { header: 'Used in (BOM items)', width: 40 }];
  head(sm.getRow(1));
  for (const s of summary) sm.addRow([KIND[s.kind] ?? s.kind, s.description, Number(s.totalQty), s.unit, s.rate === null ? null : Number(s.rate), s.amount === null ? null : Number(s.amount), s.usedIn.join(', ')]);
  sm.views = [{ state: 'frozen', ySplit: 1 }];
  sm.autoFilter = { from: 'A1', to: 'G1' };
  await audit(prisma, ctx, { action: 'EXPORT', entityType: 'bom', entityId: null, projectId, summary: 'BOM exported to Excel' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${project.code}_BOM.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});
