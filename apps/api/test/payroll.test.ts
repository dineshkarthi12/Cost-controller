/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, day, PASSWORD, prisma, setupWorld, type World } from './helpers.js';

/** Payroll from the attendance register: preview and Excel export. */
let w: World;
let from: string;
let to: string;
beforeAll(async () => {
  w = await setupWorld();
  const own = await prisma.worker.create({ data: { projectId: w.project.id, workerCode: 'W-001', name: 'Murugan', trade: 'Mason', category: 'SKILLED', hourlyRate: '150' } });
  const helper = await prisma.worker.create({ data: { projectId: w.project.id, workerCode: 'W-002', name: 'Selvi', trade: 'Helper', category: 'UNSKILLED', hourlyRate: '100' } });
  const sub = await prisma.worker.create({ data: { projectId: w.project.id, contractorId: w.sub.id, workerCode: 'S-001', name: 'Ravi', trade: 'Bar bender', category: 'SKILLED', hourlyRate: '120' } });
  from = day(-3);
  to = day(-1);
  const post = (date: string, records: any[]) => w.c.se.ok.post(`${w.P}/manpower/attendance`, { date, records });
  await post(day(-3), [
    { workerId: own.id, status: 'PRESENT', regularHours: '8', overtimeHours: '2' },
    { workerId: helper.id, status: 'PRESENT', regularHours: '8', overtimeHours: '0' },
    { workerId: sub.id, status: 'PRESENT', regularHours: '8', overtimeHours: '0' },
  ]);
  await post(day(-2), [
    { workerId: own.id, status: 'HALF_DAY', regularHours: '4', overtimeHours: '0' },
    { workerId: helper.id, status: 'LEAVE', regularHours: '0', overtimeHours: '0' },
  ]);
  await post(day(-1), [{ workerId: own.id, status: 'ABSENT', regularHours: '0', overtimeHours: '0' }]);
});

describe('payroll', () => {
  it('previews own workers: paid days, hours and pay (OT at 1.5×)', async () => {
    const p = await w.c.cc.ok.get(`${w.P}/manpower/payroll?from=${from}&to=${to}`);
    expect(p.scope).toBe('OWN');
    expect(p.dates).toHaveLength(3);
    expect(p.rows.map((r: any) => r.worker.workerCode)).toEqual(['W-002', 'W-001']); // by trade: Helper, Mason
    const mason = p.rows.find((r: any) => r.worker.workerCode === 'W-001');
    expect(mason).toMatchObject({ present: 1, halfDays: 1, absent: 1, leave: 0, paidDays: '1.5', regularHours: '12.00', overtimeHours: '2.00', regularPay: '1800.00', overtimePay: '450.00', gross: '2250.00' });
    expect(p.totals).toMatchObject({ workers: 2, paidDays: '2.5', gross: '3050.00' });
    expect(mason.days).toBeUndefined(); // the grid is only in the workbook
  });

  it('includes subcontractor workers when asked', async () => {
    const p = await w.c.cc.ok.get(`${w.P}/manpower/payroll?from=${from}&to=${to}&scope=ALL`);
    expect(p.rows.find((r: any) => r.worker.workerCode === 'S-001')).toMatchObject({ gross: '960.00', worker: { contractor: 'Test Subcontractor' } });
    expect(p.totals.gross).toBe('4010.00');
  });

  it('exports an audited workbook with live formulas and an attendance grid', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.cc.email, password: PASSWORD });
    const r = await agent.get(`/api${w.P}/manpower/payroll/export?from=${from}&to=${to}`).set('X-Requested-With', 'toprock').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain(`Payroll_${w.project.code}_${from}_to_${to}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body as never);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Payroll', 'Attendance']);
    const ws = wb.getWorksheet('Payroll')!;
    const header = (ws.getRow(4).values as unknown[]).slice(1);
    const gross = header.indexOf('Gross pay') + 1;
    const masonRow = [5, 6].find((n) => ws.getCell(n, 2).value === 'W-001')!;
    expect(ws.getCell(masonRow, gross).value).toMatchObject({ result: 2250 });
    expect((ws.getCell(masonRow, gross).value as any).formula).toMatch(/\+/);
    expect(ws.getCell(7, gross).value).toMatchObject({ result: 3050 }); // total row
    const grid = wb.getWorksheet('Attendance')!;
    const gridRow = [3, 4].find((n) => grid.getCell(n, 1).value === 'W-001')!;
    expect([4, 5, 6].map((c) => grid.getCell(gridRow, c).value)).toEqual(['P', 'H', 'A']);
    expect(await prisma.auditEvent.count({ where: { projectId: w.project.id, action: 'EXPORT', entityType: 'payroll' } })).toBe(1);
  });

  it('checks the period and project access', async () => {
    expect((await w.c.cc.get(`${w.P}/manpower/payroll?from=${to}&to=${from}`)).status).toBe(422);
    expect((await w.c.cc.get(`${w.P}/manpower/payroll?from=${day(-90)}&to=${day(0)}`)).status).toBe(422);
    expect((await w.c.outsider.get(`${w.P}/manpower/payroll?from=${from}&to=${to}`)).status).toBe(404);
  });
});
