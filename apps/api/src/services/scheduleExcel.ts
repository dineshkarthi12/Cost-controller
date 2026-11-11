/**
 * Schedule import from an Excel sheet, as site and planning teams keep it: one row per activity with a
 * name, dates (or a start and a duration), and optionally a code, predecessors, WBS / section, milestone,
 * % complete, unit, quantity and weight. Column names are recognised in common wordings; rows without
 * dates under which activities follow (e.g. "TOWER A") are taken as WBS / section headings.
 */
import ExcelJS from 'exceljs';
import type { ImportedActivity, ImportedDependency, ParsedSchedule } from './scheduleImport.js';

type Field = 'code' | 'id' | 'name' | 'start' | 'finish' | 'duration' | 'predecessors' | 'wbs' | 'milestone' | 'percent' | 'actualStart' | 'actualFinish' | 'unit' | 'qty' | 'weight';

/** Header words (lower case, letters and digits only) for each field. The first matching column wins. */
const ALIASES: Record<Field, string[]> = {
  code: ['activityid', 'activitycode', 'code', 'taskid', 'taskcode', 'actid', 'activityno', 'wbsno'],
  id: ['id', 'sno', 'slno', 'sl', 'no', 'srno', 'serialno', 'rowid'],
  name: ['activityname', 'activity', 'taskname', 'task', 'description', 'descriptionofwork', 'workdescription', 'particulars', 'name', 'item', 'itemofwork', 'scopeofwork'],
  start: ['plannedstart', 'planstart', 'start', 'startdate', 'from', 'fromdate', 'begin', 'scheduledstart', 'baselinestart'],
  finish: ['plannedfinish', 'planfinish', 'finish', 'finishdate', 'end', 'enddate', 'to', 'todate', 'completion', 'completiondate', 'scheduledfinish', 'baselinefinish'],
  duration: ['duration', 'durationdays', 'days', 'dur', 'originalduration', 'noofdays', 'plannedduration'],
  predecessors: ['predecessors', 'predecessor', 'pred', 'preds', 'dependson', 'dependency', 'dependencies'],
  wbs: ['wbs', 'wbscode', 'package', 'section', 'zone', 'block', 'location'],
  milestone: ['milestone', 'ismilestone'],
  percent: ['complete', 'percentcomplete', 'progress', 'done', 'completion', 'physicalcomplete'],
  actualStart: ['actualstart', 'actstart', 'startedon'],
  actualFinish: ['actualfinish', 'actfinish', 'finishedon', 'completedon'],
  unit: ['unit', 'uom'],
  qty: ['qty', 'quantity', 'plannedqty', 'scope', 'scopeqty'],
  weight: ['weight', 'weightage', 'weighting'],
};

const norm = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) return (v as ExcelJS.CellFormulaValue).result;
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return (v as ExcelJS.CellHyperlinkValue).text;
  }
  return v;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};

/** A date as written in Indian schedules: Excel dates, 15-01-2027, 15/1/27, 15.01.2027, 15-Jan-27, 15 Jan 2027, 2027-01-15. Day first. */
export function readDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  if (typeof raw === 'number') {
    if (raw < 20000 || raw > 80000) return null; // Excel serial day numbers (1954–2119)
    return new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86_400_000).toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[-\s/.]([a-z]{3})[a-z]*[-\s/.,]+(\d{2,4})$/i.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

const addDays = (isoDate: string, n: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const truthy = (v: unknown) => /^(y|yes|true|1|x|✓|milestone|ms)$/i.test(String(v ?? '').trim());

/** "A-100, A-110FS+2, 7SS, A-120 FF -1d" → references with link type and lag (days). */
export function readPredecessors(raw: unknown): Array<{ ref: string; type: ImportedDependency['type']; lagDays: number }> {
  return String(raw ?? '')
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const m = /^(.*?)(?:\s*(FS|SS|FF|SF))?(?:\s*([+-])\s*(\d+)\s*(?:d|days?)?)?$/i.exec(t);
      // "A-100" is a code, not "A" with a lag of −100: a negative lag needs a link type before it ("A-120 FF -1").
      if (!m || (!m[2] && m[3] === '-')) return { ref: t, type: 'FS' as const, lagDays: 0 };
      const lag = m[4] ? Number(m[4]) * (m[3] === '-' ? -1 : 1) : 0;
      return { ref: m[1].trim(), type: (m[2] ?? 'FS').toUpperCase() as ImportedDependency['type'], lagDays: lag };
    })
    .filter((p) => p.ref);
}

export async function parseScheduleExcel(buf: Buffer): Promise<ParsedSchedule> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new Error('Could not read the Excel file. Save it as .xlsx (Excel Workbook) and try again.');
  }
  // The first sheet with a header row that has an activity name and at least one date or duration column.
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(ws.rowCount, 25); r++) {
      const headers = new Map<number, string>();
      ws.getRow(r).eachCell({ includeEmpty: false }, (c, col) => headers.set(col, norm(cellValue(c.value))));
      const cols = {} as Partial<Record<Field, number>>;
      const used = new Set<number>();
      for (const f of Object.keys(ALIASES) as Field[]) {
        for (const a of ALIASES[f]) {
          const col = [...headers.entries()].find(([c, h]) => h === a && !used.has(c))?.[0];
          if (col) {
            cols[f] = col;
            used.add(col);
            break;
          }
        }
      }
      if (cols.name && (cols.start || cols.finish || cols.duration)) return readRows(ws, r, cols);
    }
  }
  throw new Error('No schedule found. The sheet needs a header row with an activity name column and Start / Finish dates (or Start and Duration). Download the template to see the layout.');
}

function readRows(ws: ExcelJS.Worksheet, headerRow: number, cols: Partial<Record<Field, number>>): ParsedSchedule {
  const warnings: string[] = [];
  const activities: Array<ImportedActivity & { preds: string; id: string | null; dur: number | null }> = [];
  let section: string | null = null;
  const get = (row: ExcelJS.Row, f: Field) => (cols[f] ? cellValue(row.getCell(cols[f]!).value) : null);
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = String(get(row, 'name') ?? '').trim();
    if (!name) continue;
    let start = readDate(get(row, 'start'));
    let finish = readDate(get(row, 'finish'));
    const dur = num(get(row, 'duration'));
    const pred = String(get(row, 'predecessors') ?? '').trim();
    if (!start && !finish && dur === null && !pred) {
      // A heading row: the activities below belong to it (unless the sheet has its own WBS column).
      section = name.slice(0, 80);
      continue;
    }
    const msFlag = truthy(get(row, 'milestone'));
    if (start && !finish && dur !== null) finish = addDays(start, Math.max(0, Math.round(dur) - 1));
    if (!start && finish && dur !== null) start = addDays(finish, -Math.max(0, Math.round(dur) - 1));
    if (msFlag && start && !finish) finish = start;
    if (msFlag && finish && !start) start = finish;
    if (start && finish && finish < start) {
      warnings.push(`Row ${r}: finish is before start; dates swapped`);
      [start, finish] = [finish, start];
    }
    const pctRaw = num(get(row, 'percent'));
    const pctIsFraction = !!cols.percent && /%/.test(row.getCell(cols.percent).numFmt ?? '');
    const pct = pctRaw === null ? 0 : pctIsFraction || (pctRaw > 0 && pctRaw < 1) ? pctRaw * 100 : pctRaw;
    const code = String(get(row, 'code') ?? '').trim();
    const id = cols.id ? String(get(row, 'id') ?? '').trim() || null : null;
    const qty = num(get(row, 'qty'));
    const weight = num(get(row, 'weight'));
    const unit = String(get(row, 'unit') ?? '').trim();
    activities.push({
      key: `R${r}`,
      code: (code || (id && /[a-z]/i.test(id) ? id : '')).replace(/\s+/g, '-').slice(0, 40),
      id,
      name: name.slice(0, 300),
      wbs: String(get(row, 'wbs') ?? '').trim() || section,
      plannedStart: start,
      plannedFinish: finish,
      actualStart: readDate(get(row, 'actualStart')),
      actualFinish: readDate(get(row, 'actualFinish')),
      percentComplete: Math.min(100, Math.max(0, pct)),
      isMilestone: msFlag || dur === 0,
      unit: unit || null,
      plannedQty: qty !== null && qty >= 0 ? String(qty) : null,
      weight: weight !== null && weight > 0 ? String(weight) : null,
      preds: pred,
      dur: dur === null ? null : Math.max(0, Math.round(dur)),
    });
  }
  // Activities without a code get A-0010, A-0020… in sheet order (codes already used in the sheet are skipped).
  const used = new Set(activities.map((a) => a.code).filter(Boolean));
  let n = 0;
  for (const a of activities) {
    if (a.code) continue;
    do n += 10;
    while (used.has(`A-${String(n).padStart(4, '0')}`));
    a.code = `A-${String(n).padStart(4, '0')}`;
    used.add(a.code);
  }
  // Duplicate codes in the sheet are renamed.
  const seen = new Map<string, number>();
  for (const a of activities) {
    const k = seen.get(a.code) ?? 0;
    seen.set(a.code, k + 1);
    if (k) {
      const c = `${a.code}-${k + 1}`;
      warnings.push(`Duplicate code ${a.code} renamed to ${c}`);
      a.code = c;
    }
  }
  // Predecessors may name an activity code or the row's ID / S.No.
  const byCode = new Map(activities.map((a) => [a.code.toLowerCase(), a.key]));
  const byId = new Map(activities.filter((a) => a.id).map((a) => [a.id!.toLowerCase(), a.key]));
  const dependencies: ImportedDependency[] = [];
  const unknown = new Set<string>();
  for (const a of activities) {
    for (const p of readPredecessors(a.preds)) {
      const key = byCode.get(p.ref.toLowerCase()) ?? byId.get(p.ref.toLowerCase());
      if (key) dependencies.push({ predecessorKey: key, successorKey: a.key, type: p.type, lagDays: p.lagDays });
      else unknown.add(p.ref);
    }
  }
  // Rows with a duration and predecessors but no dates are scheduled from their predecessors (calendar days),
  // as MS Project would: FS starts the day after the predecessor finishes, SS with it, plus any lag.
  const byKey = new Map(activities.map((a) => [a.key, a]));
  let scheduled = 0;
  for (let pass = 0, changed = true; changed && pass < activities.length + 1; pass++) {
    changed = false;
    for (const a of activities) {
      if (a.plannedStart || a.dur === null) continue;
      const links = dependencies.filter((d) => d.successorKey === a.key);
      if (!links.length) continue;
      const preds = links.map((l) => ({ l, p: byKey.get(l.predecessorKey)! }));
      if (preds.some(({ p }) => !p.plannedStart || !p.plannedFinish)) continue;
      const len = Math.max(a.dur, 1);
      const starts = preds.map(({ l, p }) => {
        if (l.type === 'SS') return addDays(p.plannedStart!, l.lagDays);
        if (l.type === 'FF') return addDays(p.plannedFinish!, l.lagDays - len + 1);
        if (l.type === 'SF') return addDays(p.plannedStart!, l.lagDays - len + 1);
        return addDays(p.plannedFinish!, (a.dur === 0 ? 0 : 1) + l.lagDays); // FS (a milestone falls on the predecessor's finish)
      });
      a.plannedStart = starts.sort().at(-1)!;
      a.plannedFinish = addDays(a.plannedStart, len - 1);
      scheduled++;
      changed = true;
    }
  }
  if (scheduled) warnings.push(`${scheduled} activit${scheduled === 1 ? 'y was' : 'ies were'} given dates from their predecessors and durations (calendar days)`);
  if (unknown.size) warnings.push(`Predecessors not found in the sheet and ignored: ${[...unknown].slice(0, 15).join(', ')}${unknown.size > 15 ? '…' : ''}`);
  const found = (Object.keys(cols) as Field[]).filter((f) => f !== 'name');
  warnings.unshift(`Sheet "${ws.name}", header on row ${headerRow}; columns read: name, ${found.join(', ')}`);
  return { format: 'EXCEL', projectName: null, activities: activities.map(({ preds: _p, id: _i, dur: _d, ...a }) => a), dependencies, warnings };
}

/** A filled-in example sheet with the recognised columns. */
export async function scheduleTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Schedule');
  ws.columns = [
    { header: 'Activity ID', width: 12 },
    { header: 'Activity name', width: 40 },
    { header: 'WBS', width: 14 },
    { header: 'Start', width: 13, style: { numFmt: 'dd-mm-yyyy' } },
    { header: 'Finish', width: 13, style: { numFmt: 'dd-mm-yyyy' } },
    { header: 'Duration (days)', width: 10 },
    { header: 'Predecessors', width: 18 },
    { header: 'Milestone', width: 10 },
    { header: 'Unit', width: 8 },
    { header: 'Qty', width: 10 },
    { header: 'Weight', width: 8 },
    { header: '% Complete', width: 11 },
  ];
  ws.getRow(1).font = { bold: true };
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const rows: unknown[][] = [
    [null, 'TOWER A'],
    ['A-100', 'Excavation', 'TWR-A', d('2027-01-04'), null, 10, null, null, 'Cum', 1200, 2, 0],
    ['A-110', 'PCC below raft', 'TWR-A', null, null, 3, 'A-100', null, 'Cum', 60, 1, 0],
    ['A-120', 'Raft reinforcement & concrete', 'TWR-A', null, null, 12, 'A-110 FS+1', null, 'Cum', 450, 4, 0],
    ['A-130', 'Raft complete', 'TWR-A', null, null, 0, 'A-120', 'Yes'],
    ['A-200', 'Columns ground floor', 'TWR-A', null, null, 8, 'A-120 SS+5', null, 'Cum', 80, 2, 0],
  ];
  rows.forEach((r) => ws.addRow(r));
  ws.addRow([]);
  ws.addRow([null, 'Notes: give Start and Finish, or Start and Duration (calendar days). Predecessors: activity IDs separated by commas, optionally with FS/SS/FF/SF and a lag, e.g. "A-110 FS+1". Rows with only a name (like TOWER A) are headings. Dates as 15-01-2027 or 15-Jan-27.']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
