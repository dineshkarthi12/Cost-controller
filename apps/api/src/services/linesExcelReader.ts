/**
 * Fills the lines of any form (MR, PR, PO, GRN, issues, stock counts, bills…) from an Excel or CSV sheet.
 *
 * Every row of the file comes back, in the file's order, with its row number. Nothing is dropped
 * quietly: blank rows and total rows are listed as skipped with the reason, and a line whose
 * material, cost code… cannot be found is still returned with the text from the file, so the user
 * picks it before saving. Columns are found by their header names; extra columns are ignored.
 */
import ExcelJS from 'exceljs';
import type { FieldDef, RefSource } from '@toprock/shared';
import type { Db } from '../lib/prisma.js';
import { validationError } from '../lib/errors.js';
import { LOOKUPS } from './lookups.js';

export interface ReadLine {
  row: number;
  values: Record<string, unknown>;
  _labels: Record<string, string>;
  problems: string[];
}
export interface ReadLinesResult {
  sheet: string;
  headerRow: number;
  /** Line field → header text it was read from. */
  columns: Record<string, string>;
  lines: ReadLine[];
  skipped: Array<{ row: number; reason: string }>;
  rowsInFile: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

/** Other headers people use for each kind of line field. */
const ALIASES: Record<string, string[]> = {
  materialId: ['material', 'material name', 'material code', 'item', 'item name', 'item code', 'material description', 'name of material'],
  description: ['description', 'item description', 'particulars', 'description of work', 'description of works', 'description of material', 'details', 'work'],
  specification: ['specification', 'spec', 'specs', 'make', 'brand', 'size'],
  qty: ['qty', 'quantity', 'qty required', 'required qty', 'order qty', 'nos', 'qty received', 'received qty', 'counted qty', 'physical qty', 'counted'],
  unit: ['unit', 'uom', 'units', 'unit of measure'],
  rate: ['rate', 'unit rate', 'price', 'unit price', 'rate inr', 'rate rs'],
  estimatedRate: ['rate', 'est rate', 'estimated rate', 'unit rate', 'price'],
  unitRate: ['rate', 'unit rate', 'price'],
  unitCost: ['rate', 'unit cost', 'cost'],
  discountPct: ['discount', 'disc', 'disc %', 'discount %'],
  taxRate: ['gst', 'gst %', 'tax', 'tax %', 'tax rate'],
  costCodeId: ['cost code', 'costcode', 'budget code', 'cost head'],
  suggestedSupplierId: ['supplier', 'vendor', 'suggested supplier'],
  boqItemId: ['boq item', 'boq', 'boq code', 'item code', 'boq ref'],
  remarks: ['remarks', 'remark', 'note', 'notes', 'comments'],
  amount: ['amount', 'total'],
};

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return text((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('').trim();
    if ('text' in v) return String((v as { text: unknown }).text).trim();
    return '';
  }
  return String(v).trim();
}
const numberText = (s: string) => {
  const t = s.replace(/[,₹\s]/g, '').replace(/^rs\.?/i, '');
  return /^-?\d+(\.\d+)?%?$/.test(t) ? t : null;
};

async function load(buf: Buffer, name: string) {
  const wb = new ExcelJS.Workbook();
  try {
    if (/\.csv$/i.test(name)) {
      const { Readable } = await import('node:stream');
      await wb.csv.read(Readable.from(buf.toString('utf8')));
    } else await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw validationError('This file could not be read. Save it as .xlsx (or .csv) and try again.');
  }
  return wb;
}

export async function readLinesFromExcel(db: Db, args: { buf: Buffer; fileName: string; fields: FieldDef[]; orgId: string; projectId: string | null }): Promise<ReadLinesResult> {
  const fields = args.fields.filter((f) => !f.readOnly && !f.hideInForm);
  const wb = await load(args.buf, args.fileName);
  // The sheet and header row with the most recognised columns (a quantity or description column is needed).
  let best: { ws: ExcelJS.Worksheet; row: number; col: Record<string, number>; headers: Record<string, string> } | null = null;
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(25, ws.rowCount); r++) {
      const col: Record<string, number> = {};
      const headers: Record<string, string> = {};
      const cells: Array<[number, string]> = [];
      ws.getRow(r).eachCell((c, n) => cells.push([n, text(c.value)]));
      // Forms without a description (MR) read the material from a "Description" column.
      const aliases = (f: FieldDef) => [...(ALIASES[f.name] ?? []), ...(f.name === 'materialId' && !fields.some((x) => x.name === 'description') ? ALIASES.description : [])];
      for (const f of fields) {
        const names = [f.name, f.label, ...aliases(f)].map(norm);
        const hit = cells.find(([n, h]) => h && names.includes(norm(h)) && !Object.values(col).includes(n));
        if (hit) [col[f.name], headers[f.name]] = [hit[0], hit[1]];
      }
      const score = Object.keys(col).length;
      if ((col.qty || col.description || col.materialId) && score >= 2 && (!best || score > Object.keys(best.col).length)) best = { ws, row: r, col, headers };
    }
  }
  if (!best) throw validationError(`No header row found. The sheet needs columns such as ${fields.slice(0, 5).map((f) => `“${f.label}”`).join(', ')}.`);

  // Reference fields: match by code, name or label, ignoring case; a unique partial name match is accepted.
  const refs = new Map<string, Array<{ id: string; keys: string[]; label: string; extra: Record<string, unknown> }>>();
  for (const f of fields.filter((x) => x.type === 'ref' && x.ref && (best!.col[x.name] !== undefined || (x.name === 'materialId' && best!.col.description !== undefined)))) {
    const def = LOOKUPS[f.ref as RefSource];
    if (!def || refs.has(f.name)) continue;
    const where = { ...(def.scope === 'project' ? { projectId: args.projectId } : { orgId: args.orgId }), ...(def.where ?? {}) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: Record<string, unknown>[] = await (db as any)[def.model].findMany({ where, select: def.select, take: 20000 });
    refs.set(f.name, rows.map((r) => ({ id: String(r[def.valueField ?? 'id']), label: def.label(r), keys: [...def.search.map((k) => norm(String(r[k] ?? ''))), norm(def.label(r))].filter(Boolean), extra: r })));
  }
  const findRef = (name: string, s: string) => {
    const list = refs.get(name) ?? [];
    const k = norm(s);
    if (!k) return undefined;
    const exact = list.filter((o) => o.keys.includes(k));
    if (exact.length === 1) return exact[0];
    const part = list.filter((o) => o.keys.some((x) => x.length > 2 && (x.includes(k) || k.includes(x))));
    return part.length === 1 ? part[0] : undefined;
  };

  const { ws, row: headerRow, col, headers } = best;
  const lines: ReadLine[] = [];
  const skipped: ReadLinesResult['skipped'] = [];
  let lastRow = headerRow;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw: Record<string, string> = {};
    for (const [k, c] of Object.entries(col)) raw[k] = text(row.getCell(c).value);
    const any = Object.values(raw).some(Boolean);
    if (!any) continue; // empty row
    lastRow = r;
    const label = raw.description || raw.materialId || '';
    if (/^(sub[\s-]*)?total\b|^grand total|^net total|^gst\b|^round(ed)? off/i.test(label) && !raw.qty) {
      skipped.push({ row: r, reason: `Total row (“${label.slice(0, 40)}”)` });
      continue;
    }
    const values: Record<string, unknown> = {};
    const labels: Record<string, string> = {};
    const problems: string[] = [];
    for (const f of fields) {
      const s = raw[f.name] ?? '';
      if (f.type === 'ref') {
        // A material column, or else the description, names the material.
        const src = s || (f.name === 'materialId' ? raw.description ?? '' : '');
        if (!src) continue;
        const hit = findRef(f.name, src);
        if (hit) {
          values[f.name] = hit.id;
          labels[f.name] = hit.label;
          if (f.name === 'materialId') {
            if (!raw.unit && hit.extra.unit) values.unit = String(hit.extra.unit);
            if (!raw.description && fields.some((x) => x.name === 'description')) values.description = String(hit.extra.name ?? '');
          }
        } else if (s || f.required) problems.push(`${f.label} “${src.slice(0, 60)}” not found – choose it`);
        continue;
      }
      if (!s) continue;
      if (f.type === 'decimal' || f.type === 'money' || f.type === 'int') {
        const n = numberText(s);
        if (n === null) problems.push(`${f.label} “${s}” is not a number`);
        else values[f.name] = n.replace('%', '');
        continue;
      }
      if (f.type === 'percent') {
        const n = numberText(s);
        if (n === null) problems.push(`${f.label} “${s}” is not a percentage`);
        // 18, 18% → 0.18; 0.18 stays.
        else values[f.name] = String(n.endsWith('%') || Number(n) > 1 ? Number(n.replace('%', '')) / 100 : Number(n));
        continue;
      }
      if (f.type === 'select' && f.options) {
        const o = f.options.find((x) => norm(x) === norm(s));
        if (o) values[f.name] = o;
        else problems.push(`${f.label} “${s}” is not one of ${f.options.join(', ')}`);
        continue;
      }
      values[f.name] = s.slice(0, f.maxLength ?? 1000);
    }
    for (const f of fields) if (f.required && (values[f.name] === undefined || values[f.name] === '') && !problems.some((p) => p.startsWith(f.label))) problems.push(`${f.label} is empty`);
    lines.push({ row: r, values, _labels: labels, problems });
  }
  if (!lines.length) throw validationError('The sheet has a header row but no lines under it.');
  if (lines.length > 500) throw validationError(`The sheet has ${lines.length} lines; a form takes at most 500. Split the file.`);
  return { sheet: ws.name, headerRow, columns: headers, lines, skipped, rowsInFile: lastRow - headerRow };
}
