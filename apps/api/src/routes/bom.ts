import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { D, money } from '@toprock/shared';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { ctxOf } from '../middleware/auth.js';
import { assertCan, assertProjectAccess, can } from '../services/access.js';
import { audit } from '../services/audit.js';
import { readBomWorkbook, type ParsedBomItem } from '../services/bomExcelReader.js';

/** Bill of materials per BOQ item: import from the estimator's workbook, material summary, rates, export. */
export const bomRouter = Router({ mergeParams: true });

bomRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

const include = { lines: { orderBy: { lineNo: 'asc' as const } }, boqItem: { select: { id: true, itemCode: true, description: true, unit: true, contractQty: true } } };
const amountOf = (totalQty: unknown, rate: unknown) => (rate === null || rate === undefined ? null : money(D(totalQty as string).times(D(rate as string))));

async function loadBom(projectId: string) {
  return prisma.bomItem.findMany({ where: { projectId }, orderBy: { lineNo: 'asc' }, include });
}
type Bom = Awaited<ReturnType<typeof loadBom>>;

/** Totals per kind, and the material / labour summary (same description and unit added together). */
function summarise(items: Bom) {
  const lines = items.flatMap((i) => i.lines.map((l) => ({ ...l, refCode: i.refCode })));
  const groups = new Map<string, { kind: string; description: string; unit: string; totalQty: ReturnType<typeof D>; amount: ReturnType<typeof D>; priced: number; lines: number; usedIn: Set<string>; rates: Set<string> }>();
  for (const l of lines) {
    const key = `${l.kind}|${l.description.toLowerCase().replace(/\s+/g, ' ').trim()}|${l.unit.toLowerCase()}`;
    const g = groups.get(key) ?? { kind: l.kind, description: l.description, unit: l.unit, totalQty: D(0), amount: D(0), priced: 0, lines: 0, usedIn: new Set<string>(), rates: new Set<string>() };
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
    .map((g) => ({ kind: g.kind, description: g.description, unit: g.unit, totalQty: D(g.totalQty).toDecimalPlaces(4).toString(), rate: g.rates.size === 1 ? [...g.rates][0] : null, amount: g.priced ? money(g.amount) : null, pricedLines: g.priced, lines: g.lines, usedIn: [...g.usedIn] }))
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
  return { summary, totals: { items: items.length, lines: lines.length, priced: lines.filter((l) => l.amount !== null).length, amount: money(lines.reduce((a, l) => a.plus(D(l.amount ?? 0)), D(0))), byKind } };
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
          lines: { create: it.lines.map((l, j) => ({ lineNo: j + 1, kind: l.kind, description: l.description, qty: String(l.qty), wastagePct: String(l.wastagePct), totalQty: String(l.totalQty), unit: l.unit, rate: l.rate === null ? null : String(l.rate), amount: amountOf(l.totalQty, l.rate), remarks: l.remarks })) },
        },
      });
      n += it.lines.length;
    }
    await tx.importJob.update({ where: { id: job.id }, data: { status: 'COMMITTED', committedAt: new Date() } });
    await audit(tx, ctx, { action: 'IMPORT_COMMITTED', entityType: 'bom', entityId: job.id, projectId, summary: `BOM imported from ${job.fileName}: ${items.length} items, ${n} lines${existing ? ` (replaced ${existing} items)` : ''}` });
    return { items: items.length, lines: n, replaced: existing };
  });
  res.json(out);
});

const lineSchema = z.object({
  rate: z.union([z.number().min(0), z.string().regex(/^\d+(\.\d{1,4})?$/), z.null()]).optional(),
  qty: z.union([z.number().min(0), z.string().regex(/^\d+(\.\d{1,4})?$/)]).optional(),
  wastagePct: z.union([z.number().min(0).max(5), z.string().regex(/^\d+(\.\d{1,4})?$/)]).optional(),
  remarks: z.string().trim().max(1000).nullable().optional(),
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
    const rate = body.rate !== undefined ? body.rate : l.rate;
    const u = await tx.bomLine.update({ where: { id: l.id }, data: { qty: qty.toString(), wastagePct: w.toString(), totalQty: totalQty.toString(), rate: rate === null ? null : String(rate), amount: amountOf(totalQty, rate), remarks: body.remarks === undefined ? l.remarks : body.remarks } });
    await audit(tx, ctx, { action: 'UPDATE', entityType: 'bomLine', entityId: l.id, projectId, summary: `BOM line “${l.description.slice(0, 60)}” updated`, before: { qty: l.qty.toString(), wastagePct: l.wastagePct.toString(), rate: l.rate?.toString() ?? null }, after: { qty: u.qty.toString(), wastagePct: u.wastagePct.toString(), rate: u.rate?.toString() ?? null } });
    return u;
  });
  res.json(out);
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
