import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const here = path.dirname(fileURLToPath(import.meta.url));
const LOGO_CANDIDATES = [path.resolve(here, '../../assets/toprock-logo.png'), path.resolve(here, '../assets/toprock-logo.png'), path.resolve(process.cwd(), 'assets/toprock-logo.png')];
const LOGO = LOGO_CANDIDATES.find((p) => fs.existsSync(p));

export interface PdfColumn {
  key: string;
  label: string;
  width: number; // relative weight
  align?: 'left' | 'right' | 'center';
}

export interface PdfSpec {
  title: string;
  subtitle?: string;
  meta: Array<[string, string]>;
  columns: PdfColumn[];
  rows: Array<Record<string, string>>;
  totals?: Array<[string, string]>;
  footerNotes?: string[];
  approvals?: Array<{ step: string; by: string; action: string; at: string; comment?: string }>;
  landscape?: boolean;
}

const NAVY = '#14306b';
const GREY = '#5b6475';

/** Branded PDF (logo, project details, table, totals, approval history). */
export function renderPdf(spec: PdfSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ bufferPages: true, size: 'A4', layout: spec.landscape ? 'landscape' : 'portrait', margin: 40, info: { Title: spec.title, Author: 'TOPROCK GLOBAL' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 80;
    if (LOGO) doc.image(LOGO, 40, 32, { width: 150 });
    doc.fillColor(NAVY).fontSize(16).font('Helvetica-Bold').text(spec.title, 40, 36, { width: W, align: 'right' });
    if (spec.subtitle) doc.fontSize(9).font('Helvetica').fillColor(GREY).text(spec.subtitle, 40, 58, { width: W, align: 'right' });
    doc.moveTo(40, 82).lineTo(40 + W, 82).strokeColor(NAVY).lineWidth(1).stroke();
    let y = 92;
    doc.fontSize(8.5);
    const half = W / 2;
    spec.meta.forEach(([k, v], i) => {
      const x = 40 + (i % 2) * half;
      if (i % 2 === 0 && i > 0) y += 14;
      doc.font('Helvetica-Bold').fillColor(GREY).text(`${k}:`, x, y, { width: 110 });
      doc.font('Helvetica').fillColor('#111').text(v || '—', x + 110, y, { width: half - 115 });
    });
    y += 24;
    const totalW = spec.columns.reduce((a, c) => a + c.width, 0);
    const colW = spec.columns.map((c) => (c.width / totalW) * W);
    const drawHeader = () => {
      doc.rect(40, y, W, 18).fill(NAVY);
      let x = 40;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff');
      spec.columns.forEach((c, i) => {
        doc.text(c.label, x + 3, y + 5, { width: colW[i] - 6, align: c.align ?? 'left' });
        x += colW[i];
      });
      y += 18;
    };
    drawHeader();
    doc.font('Helvetica').fontSize(8).fillColor('#111');
    spec.rows.forEach((r, ri) => {
      const h = Math.max(16, ...spec.columns.map((c, i) => doc.heightOfString(r[c.key] ?? '', { width: colW[i] - 6 }) + 6));
      if (y + h > doc.page.height - 70) {
        doc.addPage();
        y = 40;
        drawHeader();
        doc.font('Helvetica').fontSize(8).fillColor('#111');
      }
      if (ri % 2 === 1) doc.rect(40, y, W, h).fill('#f3f5f9').fillColor('#111');
      let x = 40;
      spec.columns.forEach((c, i) => {
        doc.text(r[c.key] ?? '', x + 3, y + 4, { width: colW[i] - 6, align: c.align ?? 'left' });
        x += colW[i];
      });
      y += h;
    });
    if (spec.rows.length === 0) {
      doc.fillColor(GREY).text('No records for the selected filters.', 40, y + 6);
      y += 20;
    }
    if (spec.totals?.length) {
      y += 8;
      for (const [k, v] of spec.totals) {
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = 40;
        }
        doc.font('Helvetica-Bold').fillColor(NAVY).text(k, 40 + W - 260, y, { width: 150, align: 'right' });
        doc.text(v, 40 + W - 105, y, { width: 105, align: 'right' });
        y += 14;
      }
    }
    if (spec.approvals?.length) {
      y += 12;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text('Approval history', 40, y);
      y += 14;
      doc.font('Helvetica').fontSize(8).fillColor('#111');
      for (const a of spec.approvals) {
        doc.text(`${a.at}  ${a.action}  ${a.step} — ${a.by}${a.comment ? ` — “${a.comment}”` : ''}`, 40, y, { width: W });
        y += 12;
      }
    }
    for (const n of spec.footerNotes ?? []) {
      y += 10;
      doc.fontSize(7.5).fillColor(GREY).text(n, 40, y, { width: W });
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).fillColor(GREY).text(`TOPROCK GLOBAL — Construction Cost Control · Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · Page ${i + 1} of ${range.count}`, 40, doc.page.height - 30, { width: W, align: 'center' });
    }
    doc.end();
  });
}
