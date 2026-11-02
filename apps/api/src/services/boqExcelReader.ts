/**
 * Reads a BOQ laid out the way estimators write it (e.g. TOPROCK's LOF Mega Mall BOQ):
 *   1      PRELIMINARIES                          ← section (whole number, no quantity)
 *   1.01   Site Mobilisation:- Allow cost for …   ← item heading with the specification
 *   a      Whole unit                1  Item  90000  =C*E   note   ← priced line
 *          TOTAL AMOUNT (PRELIMINARIES)                    =SUM   ← section total (checked, not imported)
 * The header row may be anywhere in the first rows of any sheet (a Summary sheet is skipped).
 * Each priced line becomes one BOQ item: code "1.01.a", description "Heading – line", the full
 * heading text as specification, and text in unlabelled columns after the amount as remarks.
 */
import ExcelJS from 'exceljs';

export interface StructuredBoqItem {
  itemCode: string;
  description: string;
  specification: string | null;
  section: string | null;
  unit: string;
  qty: number;
  rate: number;
  amount: number;
  remarks: string | null;
  row: number;
}
export interface StructuredBoq {
  sheet: string;
  items: StructuredBoqItem[];
  sections: number;
  /** Sum of the section totals written in the file (cached formula results), when present. */
  fileTotal: number | null;
  importedTotal: number;
  warnings: string[];
}

function value(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === 'object') {
    if ('result' in v) return (v as ExcelJS.CellFormulaValue).result ?? null;
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    if ('text' in v) return (v as { text: unknown }).text;
    if (v instanceof Date) return v;
    return null;
  }
  return v;
}
const str = (v: ExcelJS.CellValue) => {
  const x = value(v);
  return x === null || x === undefined ? '' : String(x).trim();
};
const numOf = (v: ExcelJS.CellValue): number | null => {
  const x = value(v);
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x ?? '').replace(/[,₹\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim();

const HEADER_TESTS: Record<string, (h: string) => boolean> = {
  sl: (h) => /^(sl|s|sr|item|si)( ?no| ?n)?$|^no$|^sno$/.test(h),
  desc: (h) => h.includes('description') || h === 'particulars' || h === 'item description',
  qty: (h) => h === 'qty' || h === 'quantity' || h.startsWith('qty '),
  unit: (h) => h === 'unit' || h === 'uom' || h === 'units',
  rate: (h) => h.startsWith('rate'),
  amount: (h) => h.startsWith('total') || h.startsWith('amount'),
  remarks: (h) => h.startsWith('remark') || h === 'notes' || h === 'note',
};

/** First line of a heading such as "Site Mobilisation & Protection:- Allow cost for …". */
const titleOf = (t: string) => t.split(/:-|\n/)[0].replace(/[:\s]+$/, '').trim();

function codeOf(v: unknown): string {
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    // "=A3+0.01" leaves values like 2.0199999999999996; show them as written (2.02, 1.10).
    for (const dp of [2, 3]) if (Math.abs(v - Number(v.toFixed(dp))) < 1e-6) return v.toFixed(dp);
    return String(v);
  }
  return String(v ?? '').trim().replace(/\.$/, '');
}

export async function readStructuredBoq(buf: Buffer): Promise<StructuredBoq | null> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    return null;
  }
  for (const ws of wb.worksheets) {
    let headerRow = 0;
    const col: Record<string, number> = {};
    for (let r = 1; r <= Math.min(20, ws.rowCount) && !headerRow; r++) {
      const found: Record<string, number> = {};
      ws.getRow(r).eachCell((c, n) => {
        const h = norm(str(c.value));
        for (const [k, test] of Object.entries(HEADER_TESTS)) if (!found[k] && h && test(h)) found[k] = n;
      });
      if (found.desc && found.qty && found.unit && found.rate) {
        headerRow = r;
        Object.assign(col, found);
      }
    }
    if (!headerRow) continue;

    const items: StructuredBoqItem[] = [];
    const warnings: string[] = [];
    const codes = new Map<string, number>();
    let section: string | null = null;
    let sectionNo = '';
    let sections = 0;
    let heading: { code: string; text: string } | null = null;
    let fileTotal: number | null = null;
    let lineInHeading = 0;
    const lastCol = Math.max(...Object.values(col));

    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cell = (k: string) => (col[k] ? row.getCell(col[k]).value : null);
      const desc = str(cell('desc'));
      const slRaw = value(cell('sl'));
      const sl = codeOf(slRaw);
      const qty = numOf(cell('qty'));
      const rate = numOf(cell('rate'));
      const amount = numOf(cell('amount'));
      if (!desc && qty === null) continue;
      if (/^(sub[\s-]*)?total|^grand total|^net total|^gst\b/i.test(desc)) {
        if (/^total/i.test(desc) && amount !== null && !/grand|net/i.test(desc)) fileTotal = (fileTotal ?? 0) + amount;
        continue;
      }
      if (qty === null) {
        // A whole-number S.No (or an unnumbered capitalised line) starts a section; anything else is an item heading.
        const isSection = (typeof slRaw === 'number' && Number.isInteger(slRaw)) || /^\d+$/.test(sl) || (!sl && desc === desc.toUpperCase() && desc.length < 80);
        if (isSection) {
          section = titleOf(desc).slice(0, 200);
          sectionNo = sl;
          sections++;
          heading = null;
        } else {
          heading = { code: sl || `${sectionNo || sections}.${String(items.length + 1).padStart(2, '0')}`, text: desc };
          lineInHeading = 0;
        }
        continue;
      }
      const unit = str(cell('unit'));
      if (!unit) warnings.push(`Row ${r}: quantity without a unit – skipped`);
      if (!unit) continue;
      lineInHeading++;
      let code: string;
      let description: string;
      let specification: string | null = null;
      if (/^[a-z]{1,3}$|^[ivx]+$/i.test(sl) && heading) {
        code = `${heading.code}.${sl.toLowerCase()}`;
        description = `${titleOf(heading.text)} – ${desc}`;
        specification = heading.text;
      } else if (sl && /\d/.test(sl)) {
        code = sl;
        description = desc;
        if (heading && heading.code === sl) specification = heading.text;
      } else {
        code = heading ? `${heading.code}.${lineInHeading}` : `${sectionNo || sections || 1}.${String(items.length + 1).padStart(2, '0')}`;
        description = heading ? `${titleOf(heading.text)} – ${desc}` : desc;
        specification = heading?.text ?? null;
      }
      const seen = codes.get(code) ?? 0;
      codes.set(code, seen + 1);
      if (seen) {
        warnings.push(`Row ${r}: item code ${code} repeated – imported as ${code}-${seen + 1}`);
        code = `${code}-${seen + 1}`;
      }
      const r2 = rate ?? 0;
      const calc = Math.round(qty * r2 * 100) / 100;
      if (amount !== null && Math.abs(calc - amount) > 1) warnings.push(`Row ${r}: amount ${amount} in the file differs from qty × rate (${calc})`);
      // Notes such as "252.74 sqm (total floor less columns)" sit in unlabelled columns after the amount.
      const extra: string[] = [];
      if (col.remarks) extra.push(str(row.getCell(col.remarks).value));
      for (let c = lastCol + 1; c <= Math.min(lastCol + 4, ws.columnCount); c++) if (c !== col.remarks && !str(ws.getRow(headerRow).getCell(c).value)) extra.push(str(row.getCell(c).value));
      const remarks = extra.filter(Boolean).join(' | ') || null;
      items.push({ itemCode: code.slice(0, 50), description: description.replace(/\s+/g, ' ').slice(0, 1000), specification: specification ? specification.slice(0, 4000) : null, section, unit: unit.slice(0, 20), qty, rate: r2, amount: calc, remarks: remarks ? remarks.slice(0, 1000) : null, row: r });
    }
    if (!items.length) continue;
    const importedTotal = Math.round(items.reduce((a, i) => a + i.amount, 0) * 100) / 100;
    if (fileTotal !== null && Math.abs(fileTotal - importedTotal) > 1) warnings.unshift(`The section totals in the file add up to ${fileTotal.toFixed(2)}, but the imported items total ${importedTotal.toFixed(2)}. Check for lines without a quantity or unit.`);
    return { sheet: ws.name, items, sections, fileTotal: fileTotal === null ? null : Math.round(fileTotal * 100) / 100, importedTotal, warnings };
  }
  return null;
}
