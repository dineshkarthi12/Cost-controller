/**
 * Payroll workbook from the attendance register: a "Payroll" sheet (one row per worker, live formulas
 * with the computed values cached, so a corrected rate or hour count recalculates in Excel) and an
 * "Attendance" sheet (P / H / A / L per day).
 */
import ExcelJS from 'exceljs';
import { D, PAYROLL_OT_MULTIPLIER, type PayrollRow } from '@toprock/shared';

const NAVY = 'FF1F3864';
const BAND = 'FFD9E1F2';
const RUPEE = '"₹"#,##0.00';
const num = (v: string) => D(v).toNumber();

export async function payrollWorkbook(o: { project: { code: string; name: string }; from: string; to: string; dates: string[]; scope: 'OWN' | 'ALL'; rows: PayrollRow[] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TOPROCK Cost Control';
  const ws = wb.addWorksheet('Payroll', { views: [{ state: 'frozen', ySplit: 4 }] });
  const withContractor = o.scope === 'ALL';
  const head = ['S.No', 'Worker ID', 'Name', 'Trade', 'Category', ...(withContractor ? ['Contractor'] : []), 'Present', 'Half days', 'Leave', 'Absent', 'Paid days', 'Regular hrs', 'OT hrs', 'Rate / hr', 'OT rate / hr', 'Regular pay', 'OT pay', 'Gross pay'];
  const col = (name: string) => head.indexOf(name) + 1;
  const L = (name: string) => ws.getColumn(col(name)).letter;

  ws.mergeCells(1, 1, 1, head.length);
  ws.getCell(1, 1).value = `Payroll – ${o.project.code} · ${o.project.name}`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.mergeCells(2, 1, 2, head.length);
  ws.getCell(2, 1).value = `Period ${o.from} to ${o.to} · ${withContractor ? 'own and subcontractor workers' : 'own workers'} · from the attendance register`;
  ws.getCell(2, 1).font = { italic: true, color: { argb: 'FF5B6475' } };
  const hr = ws.getRow(4);
  hr.values = head;
  hr.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  hr.height = 30;

  const first = 5;
  o.rows.forEach((r, i) => {
    const n = first + i;
    const row = ws.getRow(n);
    const v: Record<string, ExcelJS.CellValue> = {
      'S.No': i + 1,
      'Worker ID': r.worker.workerCode,
      Name: r.worker.name,
      Trade: r.worker.trade,
      Category: r.worker.category,
      Contractor: r.worker.contractor ?? 'Own',
      Present: r.present,
      'Half days': r.halfDays,
      Leave: r.leave,
      Absent: r.absent,
      'Paid days': { formula: `${L('Present')}${n}+${L('Half days')}${n}/2`, result: num(r.paidDays) },
      'Regular hrs': num(r.regularHours),
      'OT hrs': num(r.overtimeHours),
      'Rate / hr': num(r.hourlyRate),
      'OT rate / hr': { formula: `${L('Rate / hr')}${n}*${PAYROLL_OT_MULTIPLIER}`, result: num(r.overtimeRate) },
      'Regular pay': { formula: `${L('Regular hrs')}${n}*${L('Rate / hr')}${n}`, result: num(r.regularPay) },
      'OT pay': { formula: `${L('OT hrs')}${n}*${L('OT rate / hr')}${n}`, result: num(r.overtimePay) },
      'Gross pay': { formula: `${L('Regular pay')}${n}+${L('OT pay')}${n}`, result: num(r.gross) },
    };
    head.forEach((h, j) => (row.getCell(j + 1).value = v[h]));
    if (i % 2) row.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FB' } }));
  });
  const last = first + o.rows.length - 1;
  const t = ws.getRow(last + 1);
  t.getCell(col('Name')).value = 'Total';
  for (const h of ['Present', 'Half days', 'Leave', 'Absent', 'Paid days', 'Regular hrs', 'OT hrs', 'Regular pay', 'OT pay', 'Gross pay']) {
    const c = col(h);
    const total = o.rows.reduce((a, r) => a + (h === 'Present' ? r.present : h === 'Half days' ? r.halfDays : h === 'Leave' ? r.leave : h === 'Absent' ? r.absent : num({ 'Paid days': r.paidDays, 'Regular hrs': r.regularHours, 'OT hrs': r.overtimeHours, 'Regular pay': r.regularPay, 'OT pay': r.overtimePay, 'Gross pay': r.gross }[h]!)), 0);
    t.getCell(c).value = o.rows.length ? { formula: `SUM(${L(h)}${first}:${L(h)}${last})`, result: Math.round(total * 100) / 100 } : 0;
  }
  t.eachCell((c) => {
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
  });
  for (const h of ['Rate / hr', 'OT rate / hr', 'Regular pay', 'OT pay', 'Gross pay']) ws.getColumn(col(h)).numFmt = RUPEE;
  for (const h of ['Regular hrs', 'OT hrs', 'Paid days']) ws.getColumn(col(h)).numFmt = '0.##';
  head.forEach((h, j) => (ws.getColumn(j + 1).width = h === 'Name' ? 26 : h === 'Contractor' ? 22 : h === 'S.No' ? 6 : h.length < 9 ? 11 : 14));
  const note = ws.getRow(last + 3);
  note.getCell(1).value = `Paid days = present + ½ half days. Leave and absence are unpaid. OT is paid at ${PAYROLL_OT_MULTIPLIER}× the hourly rate. Change a rate or hours in the blue cells and the pay recalculates.`;
  note.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF5B6475' } };
  for (let n = first; n <= last; n++) for (const h of ['Rate / hr', 'Regular hrs', 'OT hrs']) ws.getCell(n, col(h)).font = { color: { argb: 'FF0000FF' } };

  // Attendance grid
  const g = wb.addWorksheet('Attendance', { views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }] });
  g.getCell(1, 1).value = `Attendance ${o.from} to ${o.to} · P present, H half day, L leave, A absent`;
  g.getCell(1, 1).font = { bold: true, color: { argb: NAVY } };
  const gh = g.getRow(2);
  gh.values = ['Worker ID', 'Name', 'Trade', ...o.dates.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7)), 'P', 'H', 'L', 'A'];
  gh.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: 'center' };
  });
  const colour: Record<string, string> = { P: 'FFDCF5E6', H: 'FFFFF4CC', L: 'FFE6ECF7', A: 'FFFDE3E0' };
  o.rows.forEach((r, i) => {
    const row = g.getRow(3 + i);
    row.values = [r.worker.workerCode, r.worker.name, r.worker.trade, ...o.dates.map((d) => r.days[d] ?? ''), r.present, r.halfDays, r.leave, r.absent];
    o.dates.forEach((d, j) => {
      const c = row.getCell(4 + j);
      c.alignment = { horizontal: 'center' };
      const s = r.days[d];
      if (s) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour[s] } };
    });
  });
  g.getColumn(1).width = 11;
  g.getColumn(2).width = 24;
  g.getColumn(3).width = 14;
  for (let j = 0; j < o.dates.length; j++) g.getColumn(4 + j).width = 6;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
