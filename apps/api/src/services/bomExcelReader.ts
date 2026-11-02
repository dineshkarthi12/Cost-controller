/**
 * Reads a bill of materials laid out like TOPROCK's BOM workbooks (e.g. PUKO Vadapalani):
 * one sheet per package (ARCH-BOM, Joinery-BOM…), each with
 *   9       JOINERY WORKS                                       ← section
 *   9.01    Curved checker element panel (MDF)                  ← BOM item (usually one BOQ item)
 *           BOQ 290 sqft (10.05) | MEASURED …   Taking Qty : 290 Sqft   ← BOQ reference and quantity taken
 *   S.No | Description | Qty | % wstg | T. Qty | Unit | Cost | Amount | Remarks   ← header
 *   A       Material / B Man Power                              ← groups
 *   1       18mm BWP ply …   7   0   7   Sht   …                ← lines
 *   Total amount                                                ← skipped
 * Summary, norms and other sheets without that header are skipped. Formula cells use their saved results.
 */
import ExcelJS from 'exceljs';
import { validationError } from '../lib/errors.js';

export type BomKind = 'MATERIAL' | 'LABOUR' | 'EQUIPMENT' | 'OTHER';
export interface ParsedBomLine {
  kind: BomKind;
  description: string;
  qty: number;
  wastagePct: number;
  totalQty: number;
  unit: string;
  rate: number | null;
  remarks: string | null;
}
export interface ParsedBomItem {
  sheet: string;
  section: string | null;
  refCode: string;
  title: string;
  boqRef: string | null;
  boqNote: string | null;
  takingQty: number | null;
  takingUnit: string | null;
  lines: ParsedBomLine[];
}
export interface ParsedBom {
  items: ParsedBomItem[];
  sheets: string[];
  warnings: string[];
}

function val(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return (v as ExcelJS.CellFormulaValue).result ?? null;
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    if ('text' in v) return (v as { text: unknown }).text;
    if ('error' in v) return null;
  }
  return v;
}
const str = (v: ExcelJS.CellValue) => {
  const x = val(v);
  return x === null || x === undefined ? '' : String(x).replace(/\s+/g, ' ').trim();
};
const num = (v: ExcelJS.CellValue): number | null => {
  const x = val(v);
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x ?? '').replace(/[,₹\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};
const code = (v: ExcelJS.CellValue) => {
  const x = val(v);
  if (typeof x === 'number') {
    if (Number.isInteger(x)) return String(x);
    for (const dp of [2, 3]) if (Math.abs(x - Number(x.toFixed(dp))) < 1e-6) return x.toFixed(dp);
    return String(x);
  }
  return str(v);
};
const kindOf = (s: string): BomKind => {
  const t = s.toLowerCase();
  if (/material/.test(t)) return 'MATERIAL';
  if (/man\s*power|labou?r|manpower/.test(t)) return 'LABOUR';
  if (/equipment|machinery|tools?|plant/.test(t)) return 'EQUIPMENT';
  return 'OTHER';
};
const HEADER: Record<string, (h: string) => boolean> = {
  sno: (h) => /^s\.?\s*no\.?$|^sl\.?\s*no\.?$/.test(h),
  desc: (h) => h.startsWith('description'),
  qty: (h) => h === 'qty' || h === 'quantity',
  wstg: (h) => h.includes('wstg') || h.includes('wastage'),
  tqty: (h) => /^t\.?\s*qty|^total qty/.test(h),
  unit: (h) => h === 'unit' || h === 'uom',
  cost: (h) => h.startsWith('cost') || h.startsWith('rate'),
  remarks: (h) => h.startsWith('remark'),
};

export async function readBomWorkbook(buf: Buffer): Promise<ParsedBom> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw validationError('This is not an Excel (.xlsx) file. Save it as .xlsx and try again.');
  }
  const items: ParsedBomItem[] = [];
  const sheets: string[] = [];
  const warnings: string[] = [];
  for (const ws of wb.worksheets) {
    // A BOM sheet has at least one header row with Description, Qty and Unit.
    const rows = ws.rowCount;
    const isHeader = (r: number) => {
      const found: Record<string, number> = {};
      ws.getRow(r).eachCell((c, n) => {
        const h = str(c.value).toLowerCase();
        for (const [k, t] of Object.entries(HEADER)) if (!found[k] && h && t(h)) found[k] = n;
      });
      return found.desc && found.qty && found.unit ? found : null;
    };
    let col: Record<string, number> | null = null;
    for (let r = 1; r <= rows && !col; r++) col = isHeader(r);
    if (!col) continue;
    sheets.push(ws.name);
    const A = col.sno ?? 1;
    const takingRow = (r: number) => {
      const row = ws.getRow(r);
      for (let c = 1; c <= Math.min(ws.columnCount, 12); c++) if (/^taking qty/i.test(str(row.getCell(c).value))) return c;
      return 0;
    };
    const blank = (r: number) => !str(ws.getRow(r).getCell(A).value) && !str(ws.getRow(r).getCell(col!.desc).value) && !takingRow(r);

    let section: string | null = null;
    let current: ParsedBomItem | null = null;
    let kind: BomKind = 'MATERIAL';
    let stop = false;
    for (let r = 1; r <= rows && !stop; r++) {
      const row = ws.getRow(r);
      const a = str(row.getCell(A).value);
      const desc = str(row.getCell(col.desc).value);
      if (/^package subtotals|grand total/i.test(a) || /grand total/i.test(desc)) {
        stop = true;
        continue;
      }
      if (isHeader(r)) {
        col = isHeader(r)!;
        // A header straight after a section (no item heading) starts an item for the whole section.
        if (!current && section) current = { sheet: ws.name, section, refCode: section.split(' ')[0], title: section, boqRef: null, boqNote: null, takingQty: null, takingUnit: null, lines: [] };
        if (current && !items.includes(current)) items.push(current);
        kind = 'MATERIAL';
        continue;
      }
      const tc = takingRow(r);
      if (tc) {
        if (current) {
          current.takingQty = num(row.getCell(tc + 1).value);
          current.takingUnit = str(row.getCell(tc + 2).value) || null;
          current.boqNote = desc || null;
          current.boqRef = desc.match(/\((\d+(?:\.\d+)+[a-z]?)\)/i)?.[1] ?? null;
        }
        continue;
      }
      if (/^total( amount)?$/i.test(a) || /^total amount$/i.test(desc)) continue;
      if (/^[a-z]$/i.test(a) && desc && num(row.getCell(col.qty).value) === null) {
        kind = kindOf(desc);
        continue;
      }
      const qty = num(row.getCell(col.qty).value);
      if (qty === null) {
        if (!a || !desc || a.length > 12) continue;
        // Numbered line without a quantity (1.01, 3.01b, A.1 …): an item heading when a "Taking Qty" or header
        // row follows, a section when it is a whole number, otherwise ignored.
        let next = r + 1;
        while (next <= rows && blank(next)) next++;
        const heading = next <= rows && (takingRow(next) || isHeader(next));
        if (!heading && !/^\d+$/.test(a)) continue;
        if (heading) {
          current = { sheet: ws.name, section, refCode: a, title: desc.slice(0, 300), boqRef: null, boqNote: null, takingQty: null, takingUnit: null, lines: [] };
        } else {
          section = `${a} ${desc}`.slice(0, 200);
          current = null;
        }
        continue;
      }
      if (!current) {
        warnings.push(`${ws.name} row ${r}: line “${desc.slice(0, 40)}” is outside a BOM item – skipped`);
        continue;
      }
      const unit = str(row.getCell(col.unit).value);
      if (!desc || !unit) {
        warnings.push(`${ws.name} row ${r}: line without a description or unit – skipped`);
        continue;
      }
      const wst = col.wstg ? (num(row.getCell(col.wstg).value) ?? 0) : 0;
      const tq = col.tqty ? num(row.getCell(col.tqty).value) : null;
      current.lines.push({
        kind,
        description: desc.slice(0, 500),
        qty,
        wastagePct: wst,
        totalQty: tq ?? Math.round(qty * (1 + wst) * 10000) / 10000,
        unit: unit.slice(0, 20),
        rate: col.cost ? num(row.getCell(col.cost).value) : null,
        remarks: col.remarks ? str(row.getCell(col.remarks).value).slice(0, 1000) || null : null,
      });
    }
  }
  const withLines = items.filter((i) => i.lines.length);
  if (!withLines.length) throw validationError('No BOM lines found. Each BOM sheet needs a header row with Description, Qty and Unit.');
  const empty = items.length - withLines.length;
  if (empty) warnings.push(`${empty} BOM item(s) without lines were skipped`);
  return { items: withLines, sheets, warnings };
}
