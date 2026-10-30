/**
 * Excel export of daily labour reports in the layout of TOPROCK's "Daily Labour Productivity
 * Report" workbook: a Summary sheet and one "Work & Labour Check" sheet per project.
 * Cells hold live formulas (with the computed values cached), so changing a mason/helper count
 * or a day rate in Excel recalculates the sheet.
 */
import ExcelJS from 'exceljs';
import { D } from '@toprock/shared';
import { reportSummary, type reportsInRange } from './labourReports.js';

type Reports = Awaited<ReturnType<typeof reportsInRange>>;
type Report = Reports[number];

const NAVY = 'FF1F3864';
const BROWN = 'FF833C0B';
const BAND = 'FFD9E1F2';
const INPUT_FILL = 'FFEAF1FB';
const INPUT_FONT = 'FF0000FF';
const RUPEE = '"₹"#,##0';
const RUPEE2 = '"₹"#,##0.00;[Red]-"₹"#,##0.00';
const PCT = '0.0%';
const DATE_FMT = 'dd-mmm (ddd)';

const longDate = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'long', timeZone: 'UTC' }).replace(/^(\w+), (.*)$/, '$2 ($1)');
const num = (v: unknown) => (v === null || v === undefined ? null : D(v as string).toNumber());
const fmtQty = (v: unknown) => String(Number(D(v as string).toFixed(4)));

function sheetName(name: string, used: Set<string>) {
  const base = name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Project';
  let n = base;
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 26)} ${i}`;
  used.add(n.toLowerCase());
  return n;
}
const ref = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;

function header(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  row.height = 32;
}

function resultFormatting(ws: ExcelJS.Worksheet, range: string) {
  ws.addConditionalFormatting({
    ref: range,
    rules: [
      { type: 'cellIs', operator: 'equal', formulae: ['"LOSS"'], priority: 1, style: { font: { bold: true, color: { argb: 'FFC00000' } } } },
      { type: 'cellIs', operator: 'equal', formulae: ['"PROFIT"'], priority: 2, style: { font: { bold: true, color: { argb: 'FF00703C' } } } },
    ],
  });
}

const RESULT_TEXT: Record<string, string> = { NOT_MEASURED: 'Not measured', PROFIT: 'PROFIT', OK: 'OK', LOSS: 'LOSS' };

interface SheetInfo {
  name: string;
  firstRow: number;
  lastRow: number;
}

function projectSheet(wb: ExcelJS.Workbook, name: string, title: string, reports: Report[]): SheetInfo {
  const ws = wb.addWorksheet(name);
  ws.columns = [
    { width: 13 }, { width: 46 }, { width: 38 }, { width: 14 }, { width: 30 }, { width: 13 }, { width: 10 }, { width: 9 }, { width: 9 }, { width: 10 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 14 },
    ...Array.from({ length: 11 }, () => ({ width: 10, hidden: true })),
  ];
  const masonRate = num(reports[0].masonRate)!;
  const helperRate = num(reports[0].helperRate)!;
  ws.getCell('A1').value = `${title} – Work & Labour Check`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: NAVY } };
  const span = reports.length === 1 ? longDate(reports[0].date) : `${longDate(reports[0].date)} to ${longDate(reports[reports.length - 1].date)}`;
  ws.getCell('A2').value = `${span}   |   Blue cells (Mason / Helper Used, day rates) can be changed – all figures recalculate`;
  ws.getCell('A2').font = { italic: true, size: 9, color: { argb: BROWN } };
  ws.getCell('C3').value = 'Mason ₹ / day';
  ws.getCell('F3').value = 'Helper ₹ / day';
  for (const [addr, v] of [['D3', masonRate], ['G3', helperRate]] as const) {
    const c = ws.getCell(addr);
    c.value = v;
    c.numFmt = RUPEE;
    c.font = { bold: true, color: { argb: INPUT_FONT } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  }
  for (const a of ['C3', 'F3']) ws.getCell(a).font = { bold: true, size: 10 };
  for (const a of ['C3', 'F3']) ws.getCell(a).alignment = { horizontal: 'right' };

  header(ws.getRow(4));
  ws.getRow(4).values = ['Date', 'Work', 'Workers', 'Done Qty', 'Per-Day Norm', 'Should Do Qty (norm × crew)', 'Output %', 'Mason Used', 'Helper Used', 'Mason Needed', 'Helper Needed', 'Labour Cost ₹', 'Result', 'Profit / Loss ₹', 'Qty', 'Unit', 'Norm code', 'Norm output', 'Masons / crew', 'Helpers / crew', 'Crew-days earned', 'Crew units', 'Weighted', 'Mason rate', 'Helper rate'];
  header(ws.getRow(4));

  let r = 5;
  const firstRow = r;
  for (const rep of reports) {
    ws.mergeCells(r, 1, r, 14);
    const band = ws.getCell(r, 1);
    band.value = longDate(rep.date) + (rep.status === 'PLANNED' ? '   (morning plan – evening measurement not entered yet)' : '');
    band.font = { bold: true, color: { argb: NAVY } };
    band.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    r++;
    const rm = num(rep.masonRate)!;
    const rh = num(rep.helperRate)!;
    for (const g of rep.gangs) {
      const row = ws.getRow(r);
      const qty = num(g.doneQty);
      const norm = g.norm;
      const measuredInput = qty !== null && norm;
      const suffix = g.progress === 'DONE' ? ' – done' : g.progress === 'IN_PROGRESS' ? ' (in progress)' : '';
      const doneText = qty !== null ? `${fmtQty(g.doneQty)} ${g.unit ?? ''}`.trim() : '-';
      // Keep the written note unless it only repeats the quantity or the status.
      const note = g.outcome && !/^\s*[\d.]+\s*[a-z.]*\s*(work\s*)?(done|completed|installed)?\.?\s*$/i.test(g.outcome) && !/^\s*(on progress|in progress|done|completed|work completed)\.?\s*$/i.test(g.outcome) ? ` – ${g.outcome}` : '';
      const normText = norm ? `${fmtQty(norm.outputPerDay)} ${norm.unit}/day per ${norm.masonsPerCrew} Mason${norm.helpersPerCrew ? ` (+${norm.helpersPerCrew} Helper)` : ''}` : '-';
      const cell = (col: number) => row.getCell(col);
      cell(1).value = rep.date;
      cell(1).numFmt = DATE_FMT;
      cell(2).value = g.work + suffix + note;
      cell(3).value = g.workers.join(', ');
      cell(4).value = doneText;
      cell(5).value = normText;
      cell(8).value = g.masons;
      cell(9).value = g.helpers;
      for (const c of [8, 9]) {
        cell(c).font = { color: { argb: INPUT_FONT } };
        cell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } };
      }
      // Hidden helper columns O..Y
      cell(15).value = measuredInput ? qty : null;
      cell(16).value = g.unit ?? null;
      cell(17).value = norm?.code ?? null;
      cell(18).value = measuredInput ? num(norm!.outputPerDay) : null;
      cell(19).value = norm?.masonsPerCrew ?? null;
      cell(20).value = norm?.helpersPerCrew ?? null;
      cell(24).value = rm === masonRate ? { formula: '$D$3', result: rm } : rm;
      cell(25).value = rh === helperRate ? { formula: '$G$3', result: rh } : rh;
      const pctV = num(g.outputPct);
      const cost = num(g.labourCost)!;
      const crew = !measuredInput ? null : norm!.masonsPerCrew === 0 ? g.helpers : g.masons > 0 ? g.masons : g.helpers;
      const earned = measuredInput ? qty! / num(norm!.outputPerDay)! : null;
      const f = (formula: string, result: unknown) => ({ formula, result }) as ExcelJS.CellFormulaValue;
      cell(21).value = f(`IF(OR(O${r}="",R${r}=""),"",O${r}/R${r})`, earned ?? '');
      cell(22).value = f(`IF(OR(O${r}="",R${r}=""),"",IF(S${r}=0,I${r},IF(H${r}>0,H${r},I${r})))`, crew ?? '');
      cell(6).value = f(`IF(AND(O${r}<>"",R${r}<>""),R${r}*V${r},"-")`, measuredInput ? num(norm!.outputPerDay)! * (crew ?? 0) : '-');
      cell(7).value = f(`IF(OR(O${r}="",R${r}="",N(V${r})=0),"-",U${r}/V${r})`, pctV ?? '-');
      cell(10).value = f(`IF(OR(O${r}="",R${r}=""),"-",O${r}/R${r}*S${r})`, measuredInput ? num(g.masonsNeeded) : '-');
      cell(11).value = f(`IF(OR(O${r}="",R${r}=""),"-",O${r}/R${r}*T${r})`, measuredInput ? num(g.helpersNeeded) : '-');
      cell(12).value = f(`H${r}*X${r}+I${r}*Y${r}`, cost);
      cell(14).value = f(`IF(ISNUMBER(G${r}),L${r}*(G${r}-1),0)`, num(g.profitLoss));
      cell(13).value = f(`IF(NOT(ISNUMBER(G${r})),"Not measured",IF(ROUND(N${r},0)>0,"PROFIT",IF(ROUND(N${r},0)=0,"OK","LOSS")))`, RESULT_TEXT[g.result]);
      cell(23).value = f(`IF(ISNUMBER(G${r}),L${r}*G${r},"")`, pctV !== null ? cost * pctV : '');
      cell(6).numFmt = '0.##';
      cell(7).numFmt = PCT;
      cell(10).numFmt = '0.00';
      cell(11).numFmt = '0.00';
      cell(12).numFmt = RUPEE;
      cell(14).numFmt = RUPEE2;
      for (const c of [1, 4, 6, 7, 8, 9, 10, 11, 13]) cell(c).alignment = { horizontal: 'center', vertical: 'top' };
      for (const c of [12, 14]) cell(c).alignment = { vertical: 'top' };
      for (const c of [2, 3, 5]) cell(c).alignment = { wrapText: true, vertical: 'top' };
      r++;
    }
  }
  const lastRow = r - 1;
  const total = ws.getRow(r);
  const all = reports.flatMap((x) => x.gangs);
  const sumOf = (k: 'masons' | 'helpers') => all.reduce((a, g) => a + g[k], 0);
  const summaries = reports.map(reportSummary);
  const measuredCost = all.filter((g) => g.result !== 'NOT_MEASURED').reduce((a, g) => a + num(g.labourCost)!, 0);
  const weighted = all.filter((g) => g.result !== 'NOT_MEASURED').reduce((a, g) => a + num(g.labourCost)! * num(g.outputPct)!, 0);
  total.getCell(2).value = 'TOTAL';
  total.getCell(7).value = { formula: `IFERROR(SUM(W${firstRow}:W${lastRow})/SUMIFS(L${firstRow}:L${lastRow},O${firstRow}:O${lastRow},"<>"),"-")`, result: measuredCost > 0 ? weighted / measuredCost : '-' };
  total.getCell(8).value = { formula: `SUM(H${firstRow}:H${lastRow})`, result: sumOf('masons') };
  total.getCell(9).value = { formula: `SUM(I${firstRow}:I${lastRow})`, result: sumOf('helpers') };
  total.getCell(10).value = { formula: `SUM(J${firstRow}:J${lastRow})`, result: summaries.reduce((a, s) => a + Number(s.masonsNeeded), 0) };
  total.getCell(11).value = { formula: `SUM(K${firstRow}:K${lastRow})`, result: summaries.reduce((a, s) => a + Number(s.helpersNeeded), 0) };
  total.getCell(12).value = { formula: `SUM(L${firstRow}:L${lastRow})`, result: summaries.reduce((a, s) => a + Number(s.labourCost), 0) };
  total.getCell(14).value = { formula: `SUM(N${firstRow}:N${lastRow})`, result: summaries.reduce((a, s) => a + Number(s.profitLoss), 0) };
  total.font = { bold: true };
  total.getCell(7).numFmt = PCT;
  total.getCell(10).numFmt = '0.00';
  total.getCell(11).numFmt = '0.00';
  total.getCell(12).numFmt = RUPEE;
  total.getCell(14).numFmt = RUPEE2;
  total.eachCell((c) => (c.border = { top: { style: 'thin' } }));
  resultFormatting(ws, `M${firstRow}:M${lastRow}`);
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  return { name, firstRow, lastRow };
}

export async function buildLabourWorkbook(reports: Reports, range: { from: string; to: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TOPROCK Cost Control';
  wb.calcProperties = { fullCalcOnLoad: true };
  const summary = wb.addWorksheet('Summary', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const used = new Set(['summary']);

  const byProject = new Map<string, Report[]>();
  for (const r of reports) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
  const sheets = new Map<string, SheetInfo>();
  for (const [pid, reps] of byProject) sheets.set(pid, projectSheet(wb, sheetName(reps[0].project.name, used), reps[0].project.name, reps));

  summary.columns = [{ width: 24 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 13 }, { width: 9 }, { width: 9 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 13 }, { width: 14 }, { width: 10, hidden: true }, { width: 10, hidden: true }];
  summary.getCell('A1').value = 'Daily Labour Productivity Report';
  summary.getCell('A1').font = { bold: true, size: 16, color: { argb: NAVY } };
  const from = new Date(`${range.from}T00:00:00Z`);
  const to = new Date(`${range.to}T00:00:00Z`);
  summary.getCell('A2').value = range.from === range.to ? longDate(from) : `${longDate(from)} to ${longDate(to)}`;
  summary.getCell('A2').font = { bold: true, color: { argb: BROWN } };
  summary.getCell('A3').value = 'Day rates are on each project sheet (row 3). Output % = work done ÷ per-day norm ÷ crew; Profit / Loss = labour cost × (output % − 1).';
  summary.getCell('A3').font = { italic: true, size: 9 };

  summary.mergeCells('A5:B5');
  summary.mergeCells('C5:E5');
  summary.mergeCells('F5:H5');
  summary.mergeCells('I5:O5');
  for (const [a, t] of [['C5', 'Labour Used (all work)'], ['F5', 'Work Done (measured)'], ['I5', 'Labour Check vs Per-Day Norm (measured work)']] as const) {
    const c = summary.getCell(a);
    c.value = t;
    c.font = { bold: true, color: { argb: NAVY }, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    c.alignment = { horizontal: 'center' };
  }
  summary.getRow(6).values = ['Project', 'Date', 'Mason Days', 'Helper Days', 'Labour Cost ₹', 'Sq.ft', 'Nos', 'Rmt / Rft', 'Mason Used', 'Mason Needed', 'Helper Used', 'Helper Needed', 'Output %', 'Result', 'Profit / Loss ₹', 'Weighted', 'Measured cost'];
  header(summary.getRow(6));

  let r = 7;
  const first = r;
  for (const rep of reports) {
    const sh = sheets.get(rep.projectId)!;
    const s = reportSummary(rep);
    const R = (col: string) => `${ref(sh.name)}!$${col}$${sh.firstRow}:$${col}$${sh.lastRow}`;
    const byDate = (col: string, extra = '') => `SUMIFS(${R(col)},${R('A')},$B${r}${extra})`;
    const measured = (col: string) => ['PROFIT', 'OK', 'LOSS'].map((x) => byDate(col, `,${R('M')},"${x}"`)).join('+');
    const unit = (u: string) => byDate('O', `,${R('P')},"${u}"`);
    const row = summary.getRow(r);
    const wd = (u: string) => Number(s.workDone[u] ?? 0);
    const measuredCost = rep.gangs.filter((g) => g.result !== 'NOT_MEASURED').reduce((a, g) => a + num(g.labourCost)!, 0);
    const weighted = rep.gangs.filter((g) => g.result !== 'NOT_MEASURED').reduce((a, g) => a + num(g.labourCost)! * num(g.outputPct)!, 0);
    const vals: Array<[number, ExcelJS.CellValue]> = [
      [1, rep.project.name],
      [2, rep.date],
      [3, { formula: byDate('H'), result: s.masonDays }],
      [4, { formula: byDate('I'), result: s.helperDays }],
      [5, { formula: byDate('L'), result: Number(s.labourCost) }],
      [6, { formula: unit('Sq.ft'), result: wd('Sq.ft') }],
      [7, { formula: unit('Nos'), result: wd('Nos') }],
      [8, { formula: `${unit('Rmt')}+${unit('Rft')}`, result: wd('Rmt') + wd('Rft') }],
      [9, { formula: measured('H'), result: s.masonsUsedMeasured }],
      [10, { formula: byDate('J'), result: Number(s.masonsNeeded) }],
      [11, { formula: measured('I'), result: s.helpersUsedMeasured }],
      [12, { formula: byDate('K'), result: Number(s.helpersNeeded) }],
      [13, { formula: `IFERROR(P${r}/Q${r},"-")`, result: s.outputPct === null ? '-' : Number(s.outputPct) }],
      [14, { formula: `IF(I${r}+K${r}=0,"Not measured",IF(ROUND(O${r},0)>0,"PROFIT",IF(ROUND(O${r},0)=0,"OK","LOSS")))`, result: RESULT_TEXT[s.result] }],
      [15, { formula: byDate('N'), result: Number(s.profitLoss) }],
      [16, { formula: byDate('W'), result: weighted }],
      [17, { formula: measured('L'), result: measuredCost }],
    ];
    for (const [c, v] of vals) row.getCell(c).value = v;
    row.getCell(2).numFmt = DATE_FMT;
    row.getCell(5).numFmt = RUPEE;
    row.getCell(10).numFmt = '0.00';
    row.getCell(12).numFmt = '0.00';
    row.getCell(13).numFmt = PCT;
    row.getCell(15).numFmt = RUPEE2;
    for (let c = 2; c <= 15; c++) row.getCell(c).alignment = { horizontal: 'center' };
    r++;
  }
  if (!reports.length) {
    summary.getCell('A7').value = 'No daily labour reports in this period.';
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const last = r - 1;
  const tot = summary.getRow(r);
  const sumCol = (col: string, i: number) => {
    const values = reports.map(reportSummary);
    const pick: Record<string, (s: (typeof values)[number]) => number> = {
      C: (s) => s.masonDays, D: (s) => s.helperDays, E: (s) => Number(s.labourCost), F: (s) => Number(s.workDone['Sq.ft'] ?? 0), G: (s) => Number(s.workDone.Nos ?? 0), H: (s) => Number(s.workDone.Rmt ?? 0) + Number(s.workDone.Rft ?? 0),
      I: (s) => s.masonsUsedMeasured, J: (s) => Number(s.masonsNeeded), K: (s) => s.helpersUsedMeasured, L: (s) => Number(s.helpersNeeded), O: (s) => Number(s.profitLoss),
    };
    tot.getCell(i).value = { formula: `SUM(${col}${first}:${col}${last})`, result: values.reduce((a, s) => a + pick[col](s), 0) };
  };
  tot.getCell(1).value = 'TOTAL';
  ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].forEach((col, i) => sumCol(col, i + 3));
  sumCol('O', 15);
  const allMeasured = reports.flatMap((x) => x.gangs).filter((g) => g.result !== 'NOT_MEASURED');
  const tw = allMeasured.reduce((a, g) => a + num(g.labourCost)! * num(g.outputPct)!, 0);
  const tc = allMeasured.reduce((a, g) => a + num(g.labourCost)!, 0);
  tot.getCell(16).value = { formula: `SUM(P${first}:P${last})`, result: tw };
  tot.getCell(17).value = { formula: `SUM(Q${first}:Q${last})`, result: tc };
  tot.getCell(13).value = { formula: `IFERROR(P${r}/Q${r},"-")`, result: tc > 0 ? tw / tc : '-' };
  const totalPl = reports.map(reportSummary).reduce((a, s) => a + Number(s.profitLoss), 0);
  tot.getCell(14).value = { formula: `IF(I${r}+K${r}=0,"Not measured",IF(ROUND(O${r},0)>0,"PROFIT",IF(ROUND(O${r},0)=0,"OK","LOSS")))`, result: allMeasured.length === 0 ? 'Not measured' : Math.round(totalPl) > 0 ? 'PROFIT' : Math.round(totalPl) === 0 ? 'OK' : 'LOSS' };
  tot.font = { bold: true };
  tot.getCell(5).numFmt = RUPEE;
  tot.getCell(10).numFmt = '0.00';
  tot.getCell(12).numFmt = '0.00';
  tot.getCell(13).numFmt = PCT;
  tot.getCell(15).numFmt = RUPEE2;
  tot.eachCell((c) => (c.border = { top: { style: 'thin' } }));
  for (let c = 2; c <= 15; c++) tot.getCell(c).alignment = { horizontal: 'center' };
  resultFormatting(summary, `N${first}:N${r}`);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
