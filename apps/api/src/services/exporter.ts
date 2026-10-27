import ExcelJS from 'exceljs';
import { D, formatMoney, humanize } from '@toprock/shared';
import type { ReportColumn, ReportResult } from './reports.js';
import { renderPdf } from './pdf.js';

function cell(v: unknown, type?: string): string {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'pct') return `${(Number(v) * 100).toFixed(1)}%`;
  if (type === 'status') return humanize(String(v));
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function csvEscape(s: string) {
  // Neutralise spreadsheet formula injection and quote.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(r: ReportResult): string {
  const header = r.columns.map((c) => csvEscape(c.label)).join(',');
  const lines = r.rows.map((row) => r.columns.map((c) => csvEscape(cell(row[c.key], c.type))).join(','));
  if (r.totals) lines.push(r.columns.map((c) => csvEscape(cell(r.totals![c.key], c.type))).join(','));
  return '﻿' + [header, ...lines].join('\r\n');
}

export async function toXlsx(title: string, meta: Array<[string, string]>, r: ReportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TOPROCK GLOBAL';
  const ws = wb.addWorksheet(title.slice(0, 31));
  ws.addRow(['TOPROCK GLOBAL — ' + title]).font = { bold: true, size: 14, color: { argb: 'FF14306B' } };
  for (const [k, v] of meta) ws.addRow([k, v]);
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14306B' } }));
  const numeric = (c: ReportColumn) => c.type === 'money' || c.type === 'qty' || c.type === 'int' || c.type === 'pct';
  const toVal = (v: unknown, c: ReportColumn) => {
    if (v === null || v === undefined || v === '') return null;
    if (numeric(c) && /^-?\d+(\.\d+)?$/.test(String(v))) return Number(v);
    if (c.type === 'status') return humanize(String(v));
    return String(v);
  };
  for (const row of r.rows) ws.addRow(r.columns.map((c) => toVal(row[c.key], c)));
  if (r.totals) ws.addRow(r.columns.map((c) => toVal(r.totals![c.key], c))).font = { bold: true };
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(50, Math.max(12, c.label.length + 4));
    if (c.type === 'money') col.numFmt = '#,##0.00';
    if (c.type === 'pct') col.numFmt = '0.0%';
  });
  for (const n of r.notes ?? []) ws.addRow([n]).font = { italic: true, color: { argb: 'FF5B6475' } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function toPdf(title: string, subtitle: string, meta: Array<[string, string]>, r: ReportResult, currency: string) {
  const fmt = (v: unknown, c: ReportColumn) => (c.type === 'money' && v !== null && v !== undefined && v !== '' && /^-?\d/.test(String(v)) ? formatMoney(D(String(v)), currency) : cell(v, c.type));
  return renderPdf({
    title,
    subtitle,
    meta,
    landscape: r.columns.length > 6,
    columns: r.columns.map((c) => ({ key: c.key, label: c.label, width: c.type === 'text' || !c.type ? 3 : 2, align: c.type && ['money', 'qty', 'int', 'pct'].includes(c.type) ? 'right' : 'left' })),
    rows: r.rows.map((row) => Object.fromEntries(r.columns.map((c) => [c.key, fmt(row[c.key], c)]))),
    totals: r.totals ? r.columns.filter((c) => r.totals![c.key] !== undefined && c.type === 'money').map((c) => [c.label, fmt(r.totals![c.key], c)] as [string, string]) : undefined,
    footerNotes: r.notes,
  });
}
