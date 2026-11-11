/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, PASSWORD, setupWorld, type World } from './helpers.js';
import { detectAllowedType } from '../src/services/storage.js';

/**
 * Phones often send a picked file as "application/octet-stream" (WhatsApp, Drive, Files), sometimes as
 * "application/vnd.ms-excel" or without the file extension. Uploads must go by the file's content.
 */
let w: World;
let qs: ReturnType<typeof request.agent>;
beforeAll(async () => {
  w = await setupWorld();
  qs = request.agent(app);
  await qs.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.admin.email, password: PASSWORD });
});

async function boqXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOQ');
  ws.addRow(['Item code', 'Description', 'Unit', 'Contract qty', 'Unit rate']);
  ws.addRow(['M1', 'Plastering 12 mm', 'Sqm', 100, 250]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
function docx() {
  // Zip signature plus the entry name every Word file has.
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/document.xml')]);
}

describe('uploads from phones', () => {
  it('reads an Excel file by its content whatever type the phone declares, with or without the extension', async () => {
    const buf = await boqXlsx();
    for (const [name, type] of [
      ['BOQ.xlsx', 'application/octet-stream'],
      ['BOQ.XLSX', 'application/vnd.ms-excel'],
      ['BOQ', 'application/octet-stream'],
      ['BOQ.xlsx', 'application/x-zip-compressed'],
    ] as const) {
      const r = await qs.post('/api/imports/preview').set('X-Requested-With', 'toprock').field('kind', 'BOQ').field('projectId', w.project.id).attach('file', buf, { filename: name, contentType: type });
      expect(r.status, `${name} ${type}: ${JSON.stringify(r.body)}`).toBe(201);
      expect(r.body.summary.valid).toBe(1);
    }
  });

  it('knows Excel and Word files by their content; other zips and executables are still refused', async () => {
    const x = await boqXlsx();
    expect(detectAllowedType(x, 'application/octet-stream', 'file')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(detectAllowedType(docx(), 'application/octet-stream', 'file')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const plainZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('random/entry.bin')]);
    expect(detectAllowedType(plainZip, 'application/octet-stream', 'x.zip')).toBeNull();
    expect(detectAllowedType(Buffer.from('MZ\x90\x00'), 'application/octet-stream', 'a.exe')).toBeNull();
    // CSV from a phone, declared as Excel or unknown.
    expect(detectAllowedType(Buffer.from('a,b\n1,2\n'), 'application/vnd.ms-excel', 'boq.csv')).toBe('text/csv');
    expect(detectAllowedType(Buffer.from('a,b\n1,2\n'), 'application/octet-stream', 'boq.CSV')).toBe('text/csv');
  });

});
