/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { app, day, PASSWORD, prisma, setupWorld, type World } from './helpers.js';
import { setLabourSheetClientForTests } from '../src/services/labourSheetAi.js';

let w: World;
let se: ReturnType<typeof request.agent>;
const norms: Record<string, any> = {};
let report: any;
const base = () => `${w.P}/labour-reports`;

beforeAll(async () => {
  w = await setupWorld();
  se = request.agent(app);
  await se.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.se.email, password: PASSWORD });
});
afterEach(() => setLabourSheetClientForTests(null));

// The Kadara page of TOPROCK's sheet for 29 Oct 2026 (names shortened).
const MORNING = [
  { work: 'Aluminium frame work (facade ceiling)', workers: ['Chandan', 'Sunil', 'Venkatesh', 'Manjith'], masons: 1, helpers: 3 },
  { work: 'Water tank pipe routing & laying', workers: ['Manimaran', 'Vijay', 'Rama'], masons: 1, helpers: 2 },
  { work: 'Borewater & sump water pipeline', workers: ['Ganesh', 'Maruthu', 'Palanivel'], masons: 1, helpers: 2 },
  { work: 'Arch ceiling (cafe area)', workers: ['Abdul', 'Sathish', 'Pradeep'], masons: 1, helpers: 2 },
  { work: 'Ceiling black paint', workers: ['Jaish', 'Suraj', 'Akhilesh'], masons: 1, helpers: 2 },
  { work: 'Cafe area arch ceiling jointing', workers: ['Shatrughan', 'Dilip'], masons: 1, helpers: 1 },
  { work: 'Steps cladding', workers: ['Raj', 'Ankit'], masons: 1, helpers: 1 },
  { work: 'Site cleaning & block shifting to terrace', workers: ['Nihal', 'Chottelal', 'Mansur', 'Ramnath', 'Minhaz'], masons: 0, helpers: 5 },
];

describe('labour norms', () => {
  it('are kept per organisation; read-only roles cannot add them', async () => {
    for (const [code, name, outputPerDay, unit, m, h] of [
      ['PIPE-RUN', 'Pipe / frame running work', '100', 'Rft', 1, 1],
      ['PAINT-2C', 'Paint two coats', '240', 'Sq.ft', 1, 0],
      ['BRICK-NOS', 'Brick installation', '600', 'Nos', 1, 2],
    ] as const) {
      norms[code] = await w.c.admin.ok.post('/org/r/labourNorms', { code, name, outputPerDay, unit, masonsPerCrew: m, helpersPerCrew: h });
    }
    expect((await w.c.auditor.post('/org/r/labourNorms', { code: 'X', name: 'X', outputPerDay: '1', unit: 'Nos', masonsPerCrew: 1, helpersPerCrew: 0 })).status).toBe(403);
    const opts = await w.c.se.ok.get(`${w.P}/lookups/labourNorms`);
    expect(opts.map((o: any) => o.extra?.code ?? o.code).length).toBe(3);
  });
});

describe('daily labour report', () => {
  it('morning: records who does what, with labour cost from the day rates', async () => {
    report = await w.c.se.ok.post(base(), { date: day(0), gangs: MORNING });
    expect(report.status).toBe('PLANNED');
    expect(Number(report.masonRate)).toBe(1300);
    expect(Number(report.helperRate)).toBe(1000);
    expect(report.gangs).toHaveLength(8);
    expect(report.summary.masonDays).toBe(7);
    expect(report.summary.helperDays).toBe(18);
    expect(report.summary.labourCost).toBe('27100.00');
    expect(report.summary.result).toBe('NOT_MEASURED');
  });

  it('one report per project per day, never for a future date', async () => {
    expect((await w.c.se.post(base(), { date: day(0), gangs: MORNING })).status).toBe(409);
    expect((await w.c.se.post(base(), { date: day(3), gangs: MORNING })).status).toBe(422);
  });

  it('evening: measured work gives output % and profit / loss per gang and for the day', async () => {
    const evening = MORNING.map((g) => ({ ...g, progress: 'IN_PROGRESS' as string, outcome: 'on progress' as string | null, normId: null as string | null, doneQty: null as string | null }));
    Object.assign(evening[0], { normId: norms['PIPE-RUN'].id, doneQty: '125', progress: 'DONE', outcome: '125 Rft done' });
    Object.assign(evening[1], { normId: norms['PIPE-RUN'].id, doneQty: '65', progress: 'DONE', outcome: '65 Rft done' });
    Object.assign(evening[2], { normId: norms['PIPE-RUN'].id, doneQty: '145', progress: 'DONE', outcome: '145 Rft done' });
    Object.assign(evening[4], { normId: norms['PAINT-2C'].id, doneQty: '350', progress: 'DONE', outcome: '350 sq ft done' });
    const r = await w.c.se.ok.put(`${base()}/${report.id}`, { status: 'COMPLETED', gangs: evening, expectedUpdatedAt: report.updatedAt });
    expect(r.status).toBe('COMPLETED');
    const g0 = r.gangs[0];
    expect(g0.unit).toBe('Rft'); // taken from the norm
    expect(Number(g0.outputPct)).toBe(1.25);
    expect(g0.result).toBe('PROFIT');
    expect(Number(g0.profitLoss)).toBe(1075);
    expect(r.gangs[1].result).toBe('LOSS');
    expect(r.gangs[3].result).toBe('NOT_MEASURED');
    // Same totals as the Kadara sheet of the workbook.
    expect(r.summary).toMatchObject({ labourCost: '27100.00', outputPct: '1.2055', profitLoss: '2917.50', result: 'PROFIT', workDone: { Rft: '335.0000', 'Sq.ft': '350.0000' } });
    expect(Number(r.profitLoss)).toBe(2917.5);
    report = r;
  });

  it('a quantity in a different unit from its norm is refused', async () => {
    const gangs = [{ ...MORNING[0], normId: norms['PIPE-RUN'].id, doneQty: '50', unit: 'Sq.ft' }];
    const r = await w.c.se.put(`${base()}/${report.id}`, { gangs });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/Sq\.ft.*Rft/);
  });

  it('changed day rates apply to new reports; existing reports keep their rates', async () => {
    await w.c.admin.ok.put('/admin/settings', { settings: { masonDayRate: '1400' } });
    const y = await w.c.se.ok.post(base(), { date: day(-1), gangs: [{ work: 'Brick work', workers: ['Anuj', 'Munna'], masons: 1, helpers: 1, normId: norms['BRICK-NOS'].id, doneQty: '70' }] });
    expect(Number(y.masonRate)).toBe(1400);
    expect(y.summary.labourCost).toBe('2400.00');
    expect(Number((await w.c.se.ok.get(`${base()}/${report.id}`)).masonRate)).toBe(1300);
  });

  it('read-only roles can view but not change; non-members cannot see it', async () => {
    expect((await w.c.auditor.get(`${base()}/${report.id}`)).status).toBe(200);
    expect((await w.c.auditor.put(`${base()}/${report.id}`, { gangs: MORNING })).status).toBe(403);
    expect((await w.c.outsider.get(`${base()}/${report.id}`)).status).toBe(404);
  });

  it('the management summary lists each project per day with totals', async () => {
    const s = await w.c.pm.ok.get(`/labour-reports/summary?from=${day(-1)}&to=${day(0)}&projectId=${w.project.id}`);
    expect(s.rows).toHaveLength(2);
    const today = s.rows.find((r: any) => r.date === day(0));
    expect(today).toMatchObject({ labourCost: '27100.00', profitLoss: '2917.50', result: 'PROFIT', gangs: 8 });
    expect(s.total.labourCost).toBe((27100 + 2400).toFixed(2));
  });

  it('exports an Excel workbook in the TOPROCK layout with live formulas', async () => {
    const r = await se
      .get(`/api/labour-reports/export?date=${day(0)}&projectId=${w.project.id}`)
      .set('X-Requested-With', 'toprock')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/Daily_Labour_Report_\d{2}-\d{2}-\d{4}\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body as any);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Summary', w.project.name.slice(0, 28)]);
    const sum = wb.getWorksheet('Summary')!;
    expect(sum.getCell('A1').value).toBe('Daily Labour Productivity Report');
    expect(sum.getRow(6).getCell(15).value).toBe('Profit / Loss ₹');
    const pl = sum.getCell('O7').value as ExcelJS.CellFormulaValue;
    expect(pl.formula).toMatch(/^SUMIFS\(/);
    expect(pl.result).toBe(2917.5);
    expect((sum.getCell('N7').value as ExcelJS.CellFormulaValue).result).toBe('PROFIT');
    const sheet = wb.worksheets[1];
    expect(sheet.getCell('B4').value).toBe('Work');
    expect(sheet.getCell('B6').value).toBe('Aluminium frame work (facade ceiling) – done');
    expect(sheet.getCell('C6').value).toBe('Chandan, Sunil, Venkatesh, Manjith');
    expect(sheet.getCell('D6').value).toBe('125 Rft');
    expect(sheet.getCell('E6').value).toBe('100 Rft/day per 1 Mason (+1 Helper)');
    expect((sheet.getCell('L6').value as ExcelJS.CellFormulaValue).formula).toBe('H6*X6+I6*Y6');
    expect((sheet.getCell('M9').value as ExcelJS.CellFormulaValue).result).toBe('Not measured');
  });

  it('deleting needs a reason and is audited', async () => {
    const y = await prisma.dailyLabourReport.findFirstOrThrow({ where: { projectId: w.project.id, date: new Date(`${day(-1)}T00:00:00Z`) } });
    expect((await w.c.se.del(`${base()}/${y.id}`)).status).toBe(422);
    const r = await se.delete(`/api${base()}/${y.id}`).set('X-Requested-With', 'toprock').send({ reason: 'Entered on the wrong day' });
    expect(r.status).toBe(200);
    const a = await prisma.auditEvent.findFirst({ where: { entityId: y.id, action: 'DELETE' } });
    expect(a?.reason).toBe('Entered on the wrong day');
  });
});

describe('reading a photo of the handwritten sheet', () => {
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const send = (stage = 'evening', type = 'image/jpeg') => se.post(`/api${base()}/extract`).set('X-Requested-With', 'toprock').field('stage', stage).attach('photo', photo, { filename: 'sheet.jpg', contentType: type });

  it('says clearly when no AI key is configured', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const r = await send();
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('AI_NOT_CONFIGURED');
  });

  it('returns a draft to review, using known worker names; nothing is saved', async () => {
    let sent: any;
    setLabourSheetClientForTests(async (params) => {
      sent = params;
      const json = { site: 'HADARA @ ECR', date: day(0), gangs: [{ workers: ['Chandan', ' Sunil ', ''], work: 'Aluminium frame work (facade ceiling)', outcome: '125 RFT DONE', doneQty: 125, unit: 'Rft', progress: 'DONE' }], unreadable: ['one struck-through name'] };
      return { id: 'msg_test', type: 'message', role: 'assistant', model: params.model, content: [{ type: 'text', text: JSON.stringify(json) }], stop_reason: 'end_turn' } as any;
    });
    const before = await prisma.dailyLabourReport.count();
    const r = await send();
    expect(r.status).toBe(200);
    expect(r.body.gangs[0]).toMatchObject({ workers: ['Chandan', 'Sunil'], doneQty: 125, unit: 'Rft', progress: 'DONE' });
    expect(r.body.unreadable).toEqual(['one struck-through name']);
    expect(await prisma.dailyLabourReport.count()).toBe(before);
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.output_config.format.type).toBe('json_schema');
    const text = sent.messages[0].content.find((c: any) => c.type === 'text').text;
    expect(text).toMatch(/evening sheet/);
    expect(text).toMatch(/Chandan/); // names from earlier reports help spelling
    expect(sent.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
  });

  it('handles refusals and unusable output without saving anything', async () => {
    setLabourSheetClientForTests(async () => ({ content: [], stop_reason: 'refusal' }) as any);
    expect((await send()).status).toBe(422);
    setLabourSheetClientForTests(async () => ({ content: [{ type: 'text', text: 'not json' }], stop_reason: 'end_turn' }) as any);
    expect((await send()).status).toBe(502);
  });

  it('accepts only photos, and only from users who can enter manpower', async () => {
    setLabourSheetClientForTests(async () => ({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' }) as any);
    expect((await send('morning', 'application/pdf')).status).toBe(422);
    const aud = request.agent(app);
    await aud.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.auditor.email, password: PASSWORD });
    const r = await aud.post(`/api${base()}/extract`).set('X-Requested-With', 'toprock').attach('photo', photo, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(403);
  });
});
