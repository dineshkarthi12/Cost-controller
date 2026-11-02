/**
 * Reads a daily labour report from Excel: TOPROCK's productivity workbook (and this app's own
 * export, which has the same layout) or the simple upload template. Columns are found by their
 * header names, so extra or reordered columns are fine. Nothing is saved here: the rows fill
 * the form for the user to check.
 */
import ExcelJS from 'exceljs';
import { LABOUR_UNITS, defaultCrewSplit, type GangProgress } from '@toprock/shared';
import { validationError } from '../lib/errors.js';

export interface NormSpec {
  outputPerDay: number;
  unit: string;
  masonsPerCrew: number;
  helpersPerCrew: number;
}
export interface ImportedGang {
  work: string;
  workers: string[];
  masons: number;
  helpers: number;
  normCode: string | null;
  /** Norm written in the file (output per day and crew), used when there is no norm code. */
  normSpec: NormSpec | null;
  doneQty: number | null;
  unit: string | null;
  /** Second measurement in the same gang (weekly layout columns V–Z). */
  doneQty2: number | null;
  unit2: string | null;
  normSpec2: NormSpec | null;
  progress: GangProgress;
  outcome: string | null;
}
export interface ImportedSheet {
  sheet: string;
  dates: string[];
  rows: Array<ImportedGang & { date: string | null }>;
  notes: string[];
}

const HEADERS: Record<string, string[]> = {
  date: ['date'],
  work: ['work', 'activity', 'work / activity'],
  workers: ['workers', 'names', 'worker names'],
  done: ['done qty', 'done', 'work done'],
  qty: ['qty', 'quantity'],
  unit: ['unit'],
  code: ['norm code', 'norm'],
  masons: ['mason used', 'masons', 'mason'],
  helpers: ['helper used', 'helpers', 'helper'],
  note: ['note', 'remarks', 'status', 'outcome'],
  normText: ['per-day norm', 'norm per day'],
};

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return text((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    if ('text' in v) return String((v as { text: unknown }).text);
    return '';
  }
  return String(v).trim();
}
function dateOf(v: ExcelJS.CellValue): string | null {
  const raw = v && typeof v === 'object' && 'result' in v ? (v as ExcelJS.CellFormulaValue).result : v;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const s = text(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return null;
}
const numberOf = (v: ExcelJS.CellValue) => {
  const s = text(v).replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};
const UNIT_ALIASES: Array<[RegExp, string]> = [
  [/^(sq\.?\s*ft|sqft|ft2|ft²|sft)$/i, 'Sq.ft'],
  [/^(nos?|numbers?|pcs?)$/i, 'Nos'],
  [/^(rft|r\.ft|running\s*ft)$/i, 'Rft'],
  [/^(rmt|r\.m|running\s*m(e?ters?)?)$/i, 'Rmt'],
  [/^(sqm|sq\.?\s*m|m2|m²)$/i, 'Sqm'],
  [/^(cum|cu\.?\s*m|m3|m³)$/i, 'Cum'],
  [/^kgs?$/i, 'Kg'],
  [/^bags?$/i, 'Bags'],
];
export function normaliseUnit(u: string | null | undefined): string | null {
  const s = (u ?? '').trim();
  if (!s) return null;
  if ((LABOUR_UNITS as readonly string[]).includes(s)) return s;
  return UNIT_ALIASES.find(([re]) => re.test(s))?.[1] ?? null;
}
/** "125 Rft", "350 sq ft done", "110 Nos installed" → quantity and unit. */
function parseDone(s: string): { qty: number | null; unit: string | null } {
  const m = s.match(/^\s*(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { qty: null, unit: null };
  const rest = m[2].split(/\s+(?:done|work|installed|completed)\b|\s*[(×]/i)[0].trim();
  return { qty: Number(m[1]), unit: normaliseUnit(rest) ?? normaliseUnit(rest.split(/\s+/)[0]) };
}
/** "600 Nos/day per 1 Mason (+2 Helper)" → norm spec. */
export function parseNormText(s: string): NormSpec | null {
  const m = s.match(/(\d+(?:\.\d+)?)\s*([a-z.²]+)\s*\/\s*day\s*per\s*(\d+)\s*mason(?:s)?(?:\s*\(\+\s*(\d+)\s*helpers?\))?/i);
  if (!m) return null;
  const unit = normaliseUnit(m[2]);
  return unit ? { outputPerDay: Number(m[1]), unit, masonsPerCrew: Number(m[3]), helpersPerCrew: Number(m[4] ?? 0) } : null;
}

function progressOf(work: string, note: string, hasQty: boolean): GangProgress {
  const all = `${work} ${note}`.toLowerCase();
  if (/\b100\s*%/.test(all) && !/pending/.test(all)) return 'DONE';
  if (/in progress|on progress|pending|\d+\s*%/.test(all)) return 'IN_PROGRESS';
  if (/\bdone\b|completed?|installed/.test(all) || hasQty) return 'DONE';
  return 'PLANNED';
}
export async function readLabourWorkbook(buf: Buffer): Promise<ImportedSheet[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw validationError('This is not an Excel (.xlsx) file. Save it as .xlsx and try again.');
  }
  const out: ImportedSheet[] = [];
  for (const ws of wb.worksheets) {
    // Find the header row: one that has both "Work" and "Workers".
    let headerRow = 0;
    const col: Record<string, number> = {};
    for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
      const cells = new Map<string, number>();
      ws.getRow(r).eachCell((c, n) => cells.set(text(c.value).toLowerCase(), n));
      if (cells.has('work') && cells.has('workers')) {
        headerRow = r;
        for (const [key, names] of Object.entries(HEADERS)) {
          const hit = names.map((n) => cells.get(n)).find((n) => n !== undefined);
          if (hit) col[key] = hit;
        }
        break;
      }
    }
    if (!headerRow) continue;
    // TOPROCK's workbook keeps the measurement in hidden columns without headers: O quantity, P unit, then
    // either Q norm code (older layout) or Q output per day, R masons, S helpers per crew (current layout).
    // The weekly layout adds a second quantity in V (unit W).
    const hiddenLayout = !col.qty && !text(ws.getRow(headerRow).getCell(15).value);
    if (hiddenLayout) Object.assign(col, { qty: 15, unit: col.unit ?? 16 });
    const notes: string[] = [];
    const rows: ImportedSheet['rows'] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (k: string) => (col[k] ? row.getCell(col[k]).value : null);
      const workRaw = text(get('work'));
      // Skip blanks, totals and the merged date banner rows the workbook puts above each day.
      if (!workRaw || /^(day\s+|grand\s+|week\s+)?total$/i.test(workRaw) || row.getCell(col.work).isMerged) continue;
      const workers = text(get('workers')).split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
      const doneText = text(get('done'));
      const note = text(get('note'));
      let qty = numberOf(get('qty'));
      let unit = normaliseUnit(text(get('unit')));
      if (qty === null && doneText && doneText !== '-') {
        const p = parseDone(doneText);
        qty = p.qty;
        unit = unit ?? p.unit;
      }
      if (qty !== null && !unit && doneText) unit = parseDone(doneText).unit;
      const m = numberOf(get('masons'));
      const h = numberOf(get('helpers'));
      const half = (x: number | null) => Math.max(0, Math.round((x ?? 0) * 2) / 2); // half days allowed
      const crew = m === null && h === null ? defaultCrewSplit(workers.length) : { masons: half(m), helpers: half(h) };
      // Norm: a code, the hidden output/crew columns, or the "Per-Day Norm" text.
      let normCode = col.code ? text(get('code')) || null : null;
      let normSpec: NormSpec | null = null;
      if (hiddenLayout) {
        const q = row.getCell(17).value;
        const qn = numberOf(q);
        if (qn === null && text(q)) normCode = normCode ?? text(q);
        else if (qn !== null && qn > 0 && unit) normSpec = { outputPerDay: qn, unit, masonsPerCrew: Math.round(numberOf(row.getCell(18).value) ?? 1), helpersPerCrew: Math.round(numberOf(row.getCell(19).value) ?? 0) };
      }
      if (!normCode && !normSpec && qty !== null && col.normText) {
        const spec = parseNormText(text(get('normText')));
        if (spec && (!unit || spec.unit === unit)) normSpec = spec;
      }
      if (normCode && /^-?\d+(\.\d+)?$/.test(normCode)) normCode = null;
      let doneQty2: number | null = null;
      let unit2: string | null = null;
      let normSpec2: NormSpec | null = null;
      if (hiddenLayout && qty !== null) {
        doneQty2 = numberOf(row.getCell(22).value);
        if (doneQty2 !== null) {
          unit2 = normaliseUnit(text(row.getCell(23).value)) ?? unit;
          const out2 = numberOf(row.getCell(24).value);
          if (out2 && unit2) normSpec2 = { outputPerDay: out2, unit: unit2, masonsPerCrew: Math.round(numberOf(row.getCell(25).value) ?? 1), helpersPerCrew: Math.round(numberOf(row.getCell(26).value) ?? 0) };
          else notes.push(`Row ${r}: second quantity ${doneQty2} ${unit2 ?? ''} has no norm, so it is not measured`);
        }
      }
      // "Work – done – note" (this app's export) or "Work – note" (written by hand): split the note off.
      const dash = workRaw.indexOf(' – ');
      const tail = dash >= 0 ? workRaw.slice(dash + 3).replace(/^(done|completed)(\s+–\s+)?/i, '').trim() : '';
      const work = (dash >= 0 ? workRaw.slice(0, dash) : workRaw).replace(/\s*\(in progress\)$/i, '').trim();
      const outcome = note || tail || (doneText && doneText !== '-' ? doneText : '');
      rows.push({
        date: dateOf(get('date')),
        work: work.slice(0, 300),
        workers: workers.slice(0, 60).map((w) => w.slice(0, 80)),
        masons: crew.masons,
        helpers: crew.helpers,
        normCode,
        normSpec,
        doneQty: qty,
        unit,
        doneQty2,
        unit2,
        normSpec2,
        progress: progressOf(workRaw, note, qty !== null),
        outcome: outcome ? outcome.slice(0, 300) : null,
      });
    }
    if (rows.length) out.push({ sheet: ws.name, dates: [...new Set(rows.map((x) => x.date).filter((d): d is string => !!d))].sort(), rows, notes });
  }
  if (!out.length) throw validationError('No labour rows found. The sheet needs a header row with “Work” and “Workers” columns – download the template to see the format.');
  return out;
}

/** A blank upload template with the norm codes listed on a second sheet. */
export async function labourTemplate(norms: Array<{ code: string; name: string; unit: string; outputPerDay: unknown; masonsPerCrew: number; helpersPerCrew: number }>, date: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Labour');
  ws.columns = [
    { header: 'Date', key: 'date', width: 13 },
    { header: 'Work', key: 'work', width: 40 },
    { header: 'Workers', key: 'workers', width: 40 },
    { header: 'Mason Used', key: 'masons', width: 11 },
    { header: 'Helper Used', key: 'helpers', width: 11 },
    { header: 'Done Qty', key: 'qty', width: 10 },
    { header: 'Unit', key: 'unit', width: 9 },
    { header: 'Norm code', key: 'code', width: 13 },
    { header: 'Note', key: 'note', width: 34 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  ws.addRow({ date: new Date(`${date}T00:00:00Z`), work: 'Example: Brick installation', workers: 'Anuj, Munna', masons: 1, helpers: 1, qty: 70, unit: 'Nos', code: norms.find((n) => n.unit === 'Nos')?.code ?? '', note: '70 Nos done' });
  ws.getColumn('date').numFmt = 'dd-mm-yyyy';
  ws.getCell('G2').dataValidation = { type: 'list', allowBlank: true, formulae: [`"${LABOUR_UNITS.join(',')}"`] };
  for (let r = 3; r <= 60; r++) ws.getCell(`G${r}`).dataValidation = ws.getCell('G2').dataValidation;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const ns = wb.addWorksheet('Norm codes');
  ns.columns = [
    { header: 'Norm code', key: 'code', width: 14 },
    { header: 'Work type', key: 'name', width: 34 },
    { header: 'Output per day', key: 'out', width: 14 },
    { header: 'Unit', key: 'unit', width: 9 },
    { header: 'Masons', key: 'm', width: 9 },
    { header: 'Helpers', key: 'h', width: 9 },
  ];
  ns.getRow(1).font = { bold: true };
  for (const n of norms) ns.addRow({ code: n.code, name: n.name, out: Number(n.outputPerDay), unit: n.unit, m: n.masonsPerCrew, h: n.helpersPerCrew });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
