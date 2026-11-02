import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma, transaction } from '../lib/prisma.js';
import { param, parseBody } from '../lib/http.js';
import { conflict, forbidden, notFound, validationError } from '../lib/errors.js';
import { isoDate, toDateOnly } from '../lib/dates.js';
import { ctxOf } from '../middleware/auth.js';
import { accessibleProjectIds, assertCan, assertProjectAccess, can } from '../services/access.js';
import { audit } from '../services/audit.js';
import { assertReportDate, createReportSchema, currentRates, loadReport, parseRange, prepareGangs, reportBodySchema, reportsInRange, reportSummary } from '../services/labourReports.js';
import { buildLabourWorkbook } from '../services/labourExport.js';
import { labourTemplate, readLabourWorkbook, type ImportedGang, type ImportedSheet } from '../services/labourExcelImport.js';
import { extractLabourSheet, labourSheetAiConfigured, MAX_SHEET_IMAGE_BYTES, SHEET_IMAGE_TYPES, type SheetImageType } from '../services/labourSheetAi.js';

/** /projects/:projectId/labour-reports */
export const projectLabourRouter = Router({ mergeParams: true });

projectLabourRouter.use(async (req, _res, next) => {
  await assertProjectAccess(prisma, ctxOf(req), param(req, 'projectId'));
  next();
});

const withSummary = (r: NonNullable<Awaited<ReturnType<typeof loadReport>>>) => ({ ...r, summary: reportSummary(r) });

projectLabourRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'manpower.view', projectId);
  const { from, to } = parseRange(req.query, 366);
  const items = await prisma.dailyLabourReport.findMany({ where: { projectId, date: { gte: toDateOnly(from)!, lte: toDateOnly(to)! } }, orderBy: { date: 'desc' }, take: 400, include: { _count: { select: { gangs: true } } } });
  res.json({ items, canManage: can(ctx, 'manpower.manage', projectId), rates: await currentRates(prisma, ctx.orgId), aiConfigured: labourSheetAiConfigured() });
});

/** Names used on this project before, and the worker register, for autocomplete and photo reading. */
async function knownWorkers(projectId: string) {
  const [register, recent] = await Promise.all([
    prisma.worker.findMany({ where: { projectId, isActive: true }, select: { name: true }, take: 500 }),
    prisma.dailyLabourGang.findMany({ where: { report: { projectId } }, select: { workers: true }, orderBy: { report: { date: 'desc' } }, take: 300 }),
  ]);
  const names = new Map<string, string>();
  for (const n of [...register.map((w) => w.name), ...recent.flatMap((g) => g.workers)]) if (!names.has(n.toLowerCase())) names.set(n.toLowerCase(), n);
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

projectLabourRouter.get('/worker-names', async (req, res) => {
  const projectId = param(req, 'projectId');
  assertCan(ctxOf(req), 'manpower.view', projectId);
  res.json(await knownWorkers(projectId));
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SHEET_IMAGE_BYTES, files: 1 } });

/** Reads a photo of the handwritten sheet into a draft. Nothing is saved. */
projectLabourRouter.post('/extract', upload.single('photo'), async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'manpower.manage', projectId);
  const file = req.file;
  if (!file) throw validationError('Choose a photo of the labour sheet');
  if (!SHEET_IMAGE_TYPES.includes(file.mimetype as SheetImageType)) throw validationError('Upload a JPG, PNG or WEBP photo');
  const stage = req.body?.stage === 'evening' ? 'evening' : 'morning';
  const draft = await extractLabourSheet(file.buffer, file.mimetype as SheetImageType, { stage, knownWorkers: await knownWorkers(projectId) });
  await audit(prisma, ctx, { action: 'LABOUR_SHEET_READ', entityType: 'dailyLabourReport', entityId: null, projectId, summary: `Labour sheet photo read (${stage}, ${draft.gangs.length} gangs)` });
  res.json(draft);
});

const xlsxUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

/** Reads an Excel labour sheet (TOPROCK workbook, this app's export, or the upload template) into a draft. Nothing is saved. */
projectLabourRouter.post('/import-excel', xlsxUpload.single('file'), async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'manpower.manage', projectId);
  if (!req.file) throw validationError('Choose an Excel file');
  const opts = parseBody(
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), createMissingNorms: z.enum(['true', 'false']).optional(), saveAll: z.enum(['true', 'false']).optional(), sheet: z.string().max(100).optional() }),
    req.body ?? {},
  );
  const date = opts.date ?? isoDate(new Date())!;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true, code: true } });
  const sheets = await readLabourWorkbook(req.file.buffer);

  // Norms: by code, or by the output/crew written in the file. Missing ones can be added in one go.
  let norms = await prisma.labourNorm.findMany({ where: { orgId: ctx.orgId } });
  const unitCode = (u: string) => u.replace(/[^a-z]/gi, '').toUpperCase();
  const specKey = (x: { unit: string; outputPerDay: unknown; masonsPerCrew: number; helpersPerCrew: number }) => `${x.unit}|${Number(x.outputPerDay)}|${x.masonsPerCrew}|${x.helpersPerCrew}`;
  const missing = new Map<string, { code: string; name: string; unit: string; outputPerDay: number; masonsPerCrew: number; helpersPerCrew: number }>();
  for (const r of sheets.flatMap((sh) => sh.rows)) {
    for (const spec of [r.normCode ? null : r.normSpec, r.normSpec2]) {
      if (!spec || norms.some((n) => specKey(n) === specKey(spec))) continue;
      const k = specKey(spec);
      if (!missing.has(k)) missing.set(k, { code: `${unitCode(spec.unit)}-${spec.outputPerDay}-${spec.masonsPerCrew}M${spec.helpersPerCrew}H`.slice(0, 30), name: r.work.slice(0, 120), ...spec });
    }
  }
  if (opts.createMissingNorms === 'true' && missing.size) {
    if (!can(ctx, 'manpower.manage', null)) throw forbidden('Only users who manage labour norms for the organisation can add norms');
    await transaction(async (tx) => {
      for (const m of missing.values()) {
        const code = norms.some((n) => n.code === m.code) ? `${m.code}-${Date.now().toString(36).slice(-3)}` : m.code;
        await tx.labourNorm.create({ data: { ...m, code, outputPerDay: String(m.outputPerDay), orgId: ctx.orgId, createdById: ctx.user.id, notes: `Added from the labour sheet ${req.file!.originalname}` } });
      }
      await audit(tx, ctx, { action: 'CREATE', entityType: 'labourNorm', entityId: null, projectId, summary: `${missing.size} labour norm(s) added from ${req.file!.originalname}` });
    });
    norms = await prisma.labourNorm.findMany({ where: { orgId: ctx.orgId } });
    missing.clear();
  }
  const byCode = new Map(norms.map((n) => [n.code.toUpperCase(), n]));
  const bySpec = new Map(norms.map((n) => [specKey(n), n]));
  const normFor = (g: { normCode: string | null; normSpec: ImportedGang['normSpec'] }) => (g.normCode ? byCode.get(g.normCode.toUpperCase()) : g.normSpec ? bySpec.get(specKey(g.normSpec)) : undefined);
  const existing = new Set((await prisma.dailyLabourReport.findMany({ where: { projectId }, select: { date: true } })).map((r) => isoDate(r.date)!));

  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const projectWords = new Set([...words(project.name), project.code.toLowerCase()]);
  const normInfo = (n: (typeof norms)[number] | undefined) => (n ? { id: n.id, code: n.code, name: n.name, unit: n.unit, outputPerDay: n.outputPerDay.toString(), masonsPerCrew: n.masonsPerCrew, helpersPerCrew: n.helpersPerCrew } : null);
  const toGang = ({ date: _d, normCode, normSpec, normSpec2, ...g }: ImportedSheet['rows'][number], warnings: string[]) => {
    const norm = normFor({ normCode, normSpec });
    const norm2 = normSpec2 ? bySpec.get(specKey(normSpec2)) : undefined;
    if (normCode && !norm) warnings.push(`Norm code ${normCode} is not in Labour norms`);
    return { ...g, normId: norm?.id ?? null, norm: normInfo(norm), normId2: norm2?.id ?? null, norm2: normInfo(norm2) };
  };

  // Save every day of a weekly sheet at once (days that already have a report are left alone).
  if (opts.saveAll === 'true') {
    const sh = sheets.find((x) => x.sheet === opts.sheet);
    if (!sh) throw validationError('Choose the sheet to save');
    const created: string[] = [];
    const skipped: string[] = [];
    await transaction(async (tx) => {
      const rates = await currentRates(tx, ctx.orgId);
      for (const d of sh.dates) {
        if (existing.has(d)) {
          skipped.push(d);
          continue;
        }
        assertReportDate(d);
        const gangs = sh.rows.filter((r) => r.date === d).map((r) => toGang(r, []));
        const p = await prepareGangs(tx, ctx.orgId, gangs.map((g) => ({ ...g, doneQty: g.doneQty === null ? null : String(g.doneQty), doneQty2: g.doneQty2 === null ? null : String(g.doneQty2) })), rates);
        const measured = gangs.some((g) => g.doneQty !== null || g.progress !== 'PLANNED');
        const r = await tx.dailyLabourReport.create({ data: { projectId, date: toDateOnly(d)!, status: measured ? 'COMPLETED' : 'PLANNED', masonRate: rates.masonRate, helperRate: rates.helperRate, remarks: `Imported from ${req.file!.originalname} (${sh.sheet})`, createdById: ctx.user.id, ...p.totals, gangs: { create: p.gangs } } });
        await audit(tx, ctx, { action: 'CREATE', entityType: 'dailyLabourReport', entityId: r.id, projectId, summary: `Daily labour report ${d} imported from ${req.file!.originalname} (${sh.sheet}, ${p.gangs.length} gangs)` });
        created.push(d);
      }
    });
    return res.status(201).json({ created, skipped });
  }

  const result = sheets.map((sh) => {
    const forDate = sh.rows.filter((r) => r.date === date);
    // Rows without a date, or a file holding a single other date, are offered with a warning.
    const rows = forDate.length ? forDate : sh.dates.length <= 1 ? sh.rows : [];
    const warnings: string[] = [...sh.notes];
    if (!forDate.length && rows.length && sh.dates.length === 1) warnings.push(`This sheet is for ${sh.dates[0]}, not ${date}.`);
    if (!rows.length) warnings.push(`No rows for ${date}. Dates in this sheet: ${sh.dates.join(', ')}`);
    const gangs = rows.map((r) => toGang(r, warnings));
    return {
      sheet: sh.sheet,
      dates: sh.dates.map((d) => ({ date: d, rows: sh.rows.filter((r) => r.date === d).length, existing: existing.has(d) })),
      matchesProject: words(sh.sheet).some((w) => projectWords.has(w)) || sh.sheet.toLowerCase() === project.code.toLowerCase(),
      gangs,
      warnings: [...new Set(warnings)],
    };
  });
  const preferred = result.find((r) => r.matchesProject && (r.gangs.length || r.dates.length > 1)) ?? (result.length === 1 ? result[0] : null);
  res.json({ date, sheets: result, preferred: preferred?.sheet ?? null, missingNorms: [...missing.values()], canAddNorms: can(ctx, 'manpower.manage', null) });
});

projectLabourRouter.get('/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'manpower.view', projectId);
  const r = await loadReport(prisma, projectId, param(req, 'id'));
  if (!r) throw notFound('Labour report');
  res.json({ ...withSummary(r), canManage: can(ctx, 'manpower.manage', projectId) });
});

projectLabourRouter.post('/', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'manpower.manage', projectId);
  const body = parseBody(createReportSchema, req.body);
  const date = assertReportDate(body.date);
  const out = await transaction(async (tx) => {
    if (await tx.dailyLabourReport.findUnique({ where: { projectId_date: { projectId, date } } })) throw conflict(`A labour report for ${body.date} already exists. Open it and update it instead.`);
    const rates = await currentRates(tx, ctx.orgId);
    const p = await prepareGangs(tx, ctx.orgId, body.gangs, rates);
    const r = await tx.dailyLabourReport.create({
      data: { projectId, date, status: body.status ?? 'PLANNED', masonRate: rates.masonRate, helperRate: rates.helperRate, remarks: body.remarks ?? null, createdById: ctx.user.id, ...p.totals, gangs: { create: p.gangs } },
    });
    await audit(tx, ctx, { action: 'CREATE', entityType: 'dailyLabourReport', entityId: r.id, projectId, summary: `Daily labour report ${body.date} created (${p.gangs.length} gangs, ${p.totals.masonDays} masons, ${p.totals.helperDays} helpers)` });
    return r;
  });
  res.status(201).json(withSummary((await loadReport(prisma, projectId, out.id))!));
});

projectLabourRouter.put('/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'manpower.manage', projectId);
  const body = parseBody(reportBodySchema, req.body);
  const id = param(req, 'id');
  await transaction(async (tx) => {
    const existing = await tx.dailyLabourReport.findFirst({ where: { id, projectId }, include: { gangs: true } });
    if (!existing) throw notFound('Labour report');
    if (body.expectedUpdatedAt && new Date(body.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) throw conflict('This report was changed by someone else. Reload to see the latest version.');
    const p = await prepareGangs(tx, ctx.orgId, body.gangs, { masonRate: existing.masonRate, helperRate: existing.helperRate });
    await tx.dailyLabourGang.deleteMany({ where: { reportId: id } });
    await tx.dailyLabourReport.update({ where: { id }, data: { status: body.status ?? existing.status, remarks: body.remarks === undefined ? existing.remarks : body.remarks, ...p.totals, gangs: { create: p.gangs } } });
    await audit(tx, ctx, {
      action: 'UPDATE',
      entityType: 'dailyLabourReport',
      entityId: id,
      projectId,
      summary: `Daily labour report ${isoDate(existing.date)} ${body.status === 'COMPLETED' && existing.status !== 'COMPLETED' ? 'measured (evening)' : 'updated'}`,
      before: { status: existing.status, gangs: existing.gangs.length, labourCost: existing.labourCost.toString(), profitLoss: existing.profitLoss.toString() },
      after: { status: body.status ?? existing.status, gangs: p.gangs.length, labourCost: p.totals.labourCost, profitLoss: p.totals.profitLoss },
    });
  });
  res.json(withSummary((await loadReport(prisma, projectId, id))!));
});

projectLabourRouter.delete('/:id', async (req, res) => {
  const ctx = ctxOf(req);
  const projectId = param(req, 'projectId');
  assertCan(ctx, 'manpower.manage', projectId);
  const { reason } = parseBody(z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) }), req.body);
  await transaction(async (tx) => {
    const r = await tx.dailyLabourReport.findFirst({ where: { id: param(req, 'id'), projectId } });
    if (!r) throw notFound('Labour report');
    await tx.dailyLabourReport.delete({ where: { id: r.id } });
    await audit(tx, ctx, { action: 'DELETE', entityType: 'dailyLabourReport', entityId: r.id, projectId, summary: `Daily labour report ${isoDate(r.date)} deleted`, reason, before: { status: r.status, labourCost: r.labourCost.toString(), profitLoss: r.profitLoss.toString() } });
  });
  res.json({ ok: true });
});

/** /labour-reports — across the projects the user can see */
export const labourRouter = Router();

async function visibleProjects(req: Parameters<typeof ctxOf>[0], projectId?: unknown) {
  const ctx = ctxOf(req);
  const ids = (await accessibleProjectIds(prisma, ctx)).filter((id) => can(ctx, 'manpower.view', id));
  return typeof projectId === 'string' && projectId ? ids.filter((id) => id === projectId) : ids;
}

labourRouter.get('/template', async (req, res) => {
  const ctx = ctxOf(req);
  const norms = await prisma.labourNorm.findMany({ where: { orgId: ctx.orgId, active: true }, orderBy: { code: 'asc' } });
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : isoDate(new Date())!;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Daily_Labour_Upload_Template.xlsx"');
  res.send(await labourTemplate(norms, date));
});

labourRouter.get('/summary', async (req, res) => {
  const { from, to } = parseRange(req.query);
  const reports = await reportsInRange(prisma, await visibleProjects(req, req.query.projectId), from, to);
  const rows = reports.map((r) => ({ id: r.id, projectId: r.projectId, project: r.project, date: isoDate(r.date), status: r.status, gangs: r.gangs.length, ...reportSummary(r) }));
  const all = reports.flatMap((r) => r.gangs);
  const measured = all.filter((g) => g.result !== 'NOT_MEASURED');
  const cost = measured.reduce((a, g) => a + Number(g.labourCost), 0);
  const total = {
    masonDays: rows.reduce((a, r) => a + r.masonDays, 0),
    helperDays: rows.reduce((a, r) => a + r.helperDays, 0),
    labourCost: rows.reduce((a, r) => a + Number(r.labourCost), 0).toFixed(2),
    profitLoss: rows.reduce((a, r) => a + Number(r.profitLoss), 0).toFixed(2),
    outputPct: cost > 0 ? (measured.reduce((a, g) => a + Number(g.labourCost) * Number(g.outputPct), 0) / cost).toFixed(4) : null,
  };
  res.json({ from, to, rows, total, aiConfigured: labourSheetAiConfigured() });
});

labourRouter.get('/export', async (req, res) => {
  const ctx = ctxOf(req);
  const { from, to } = parseRange(req.query);
  const projectIds = await visibleProjects(req, req.query.projectId);
  const buf = await buildLabourWorkbook(await reportsInRange(prisma, projectIds, from, to), { from, to });
  await audit(prisma, ctx, { action: 'EXPORT', entityType: 'dailyLabourReport', entityId: null, projectId: typeof req.query.projectId === 'string' ? req.query.projectId : null, summary: `Daily labour report exported (${from}${from === to ? '' : ` to ${to}`})` });
  const [d, m, y] = from.split('-').reverse();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Daily_Labour_Report_${d}-${m}-${y}${from === to ? '' : `_to_${to.split('-').reverse().join('-')}`}.xlsx"`);
  res.send(buf);
});
