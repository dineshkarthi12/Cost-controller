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
    expect(opts.map((o: any) => o.extra?.code ?? o.code).filter((c: string) => !c.startsWith('STD-')).length).toBe(3);
    expect(opts.length).toBeGreaterThan(40); // plus the standard library
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

describe('filling the report from an Excel file', () => {
  const upload = (buf: Buffer, date = day(0), name = 'labour.xlsx') =>
    se.post(`/api${base()}/import-excel`).set('X-Requested-With', 'toprock').field('date', date).attach('file', buf, { filename: name });

  /** Same layout as TOPROCK's productivity workbook: header on row 4, a merged date banner, quantity/unit/norm code in O–Q without headers. */
  async function toprockStyle(sheets: Record<string, Array<[string, string, string, number, number, number | null, string | null, string | null]>>) {
    const wb = new ExcelJS.Workbook();
    for (const [name, rows] of Object.entries(sheets)) {
      const ws = wb.addWorksheet(name);
      ws.getCell('A1').value = `${name} – Work & Labour Check`;
      ws.getRow(4).values = ['Date', 'Work', 'Workers', 'Done Qty', 'Per-Day Norm', 'Should Do Qty (norm × masons)', 'Output %', 'Mason Used', 'Helper Used', 'Mason Needed', 'Helper Needed', 'Labour Cost ₹', 'Result', 'Profit / Loss ₹'];
      ws.mergeCells('A5:N5');
      ws.getCell('A5').value = 'Banner (Thursday)';
      rows.forEach(([work, workers, done, m, h, qty, unit, code], i) => {
        const r = ws.getRow(6 + i);
        r.values = [new Date(`${day(0)}T00:00:00Z`), work, workers, done, '-', '-', '-', m, h];
        if (qty !== null) Object.assign(r.getCell(15), { value: qty }), (r.getCell(16).value = unit), (r.getCell(17).value = code);
      });
      ws.getRow(6 + rows.length).getCell(2).value = 'TOTAL';
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('reads the TOPROCK workbook layout, matching norm codes and the project sheet', async () => {
    const sheetName = w.project.name.split(' ')[1]; // a word of the project name, like "Ponram" or "Kadara"
    const buf = await toprockStyle({
      Other: [['Some work', 'A, B', '-', 1, 1, null, null, null]],
      [sheetName]: [
        ['Pipe running – done', 'Ravi, Mani, Selva', '125 Rft', 1, 2, 125, 'Rft', 'PIPE-RUN'],
        ['Glue filling + brick installation – 110 Nos installed', 'Arun, Babu, Charan', '110 Nos', 1, 2, 110, 'Nos', 'BRICK-NOS'],
        ['Steps cladding (20% pending)', 'Raj, Ankit', '-', 1, 1, null, null, null],
        ['Light box framing – 9 of 48 Nos complete', 'Prem', '9 Nos (no norm)', 0, 1, null, null, null],
        ['Unknown norm work', 'Dev', '5 Nos', 1, 0, 5, 'Nos', 'NOT-A-CODE'],
      ],
    });
    const r = await upload(buf);
    expect(r.status).toBe(200);
    expect(r.body.preferred).toBe(sheetName);
    const sh = r.body.sheets.find((s: any) => s.sheet === sheetName);
    expect(sh.gangs.map((g: any) => g.work)).toEqual(['Pipe running', 'Glue filling + brick installation', 'Steps cladding (20% pending)', 'Light box framing', 'Unknown norm work']);
    expect(sh.gangs[0]).toMatchObject({ workers: ['Ravi', 'Mani', 'Selva'], masons: 1, helpers: 2, doneQty: 125, unit: 'Rft', progress: 'DONE', normId: norms['PIPE-RUN'].id });
    expect(sh.gangs[1]).toMatchObject({ outcome: '110 Nos installed', normId: norms['BRICK-NOS'].id });
    expect(sh.gangs[2]).toMatchObject({ doneQty: null, progress: 'IN_PROGRESS' });
    expect(sh.gangs[3]).toMatchObject({ doneQty: 9, unit: 'Nos', normId: null, masons: 0, helpers: 1 }); // quantity without a norm: not measured
    expect(sh.warnings).toContain('Norm code NOT-A-CODE is not in Labour norms');
  });

  it('the downloadable template round-trips, and nothing is saved by reading a file', async () => {
    const t = await se.get(`/api/labour-reports/template?date=${day(-2)}`).set('X-Requested-With', 'toprock').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(t.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.body as any);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Labour', 'Norm codes']);
    const ws = wb.getWorksheet('Labour')!;
    ws.addRow([new Date(`${day(-2)}T00:00:00Z`), 'Painting lobby', 'Kannan, Ravi', 1, 1, 300, 'Sq.ft', 'PAINT-2C', '300 sq ft done']);
    const before = await prisma.dailyLabourReport.count();
    const r = await upload(Buffer.from(await wb.xlsx.writeBuffer()), day(-2));
    expect(r.status).toBe(200);
    const g = r.body.sheets[0].gangs;
    expect(g).toHaveLength(2); // the example row and ours
    expect(g[1]).toMatchObject({ work: 'Painting lobby', masons: 1, helpers: 1, doneQty: 300, unit: 'Sq.ft', normId: norms['PAINT-2C'].id, outcome: '300 sq ft done', progress: 'DONE' });
    expect(await prisma.dailyLabourReport.count()).toBe(before);
  });

  it('explains files it cannot use', async () => {
    expect((await upload(Buffer.from('not a spreadsheet'))).status).toBe(422);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Notes').getCell('A1').value = 'nothing here';
    const r = await upload(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/Work.*Workers/);
  });
});

describe('weekly Excel in the current TOPROCK layout', () => {
  /** Header on row 4, date banners, "Day Total" rows; hidden O qty, P unit, Q output/day, R masons, S helpers per crew, V–Z second measurement. */
  async function weekly() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(w.project.name.split(' ')[1]);
    ws.getRow(4).values = ['Date', 'Work', 'Workers', 'Done Qty', 'Per-Day Norm', 'Should Do', 'Output %', 'Mason Used', 'Helper Used', 'Mason Needed', 'Helper Needed', 'Labour Cost ₹', 'Result', 'Profit / Loss ₹'];
    let r = 5;
    const days: Array<[string, Array<{ work: string; workers: string; m: number; h: number; q?: [number, string, number, number, number]; q2?: [number, string, number, number, number] }>]> = [
      [day(-6), [
        { work: 'Booth seating brick', workers: 'Anuj, Munna', m: 1, h: 1, q: [75, 'Nos', 600, 1, 2] },
        { work: 'Plastering + block wall', workers: 'Ravi, Mani', m: 1, h: 1, q: [60, 'Sq.ft', 161, 1, 1], q2: [40, 'Sq.ft', 320, 1, 2] },
        { work: 'Toilet lobby painting (till 12 pm)', workers: 'Kannan, Selva', m: 0.5, h: 0.5 },
      ]],
      [day(-5), [{ work: 'Brick installation', workers: 'Anuj, Munna, Arun', m: 1, h: 2, q: [110, 'Nos', 600, 1, 2] }]],
    ];
    for (const [d, rows] of days) {
      ws.mergeCells(r, 1, r, 14);
      ws.getCell(r, 1).value = `${d} banner`;
      r++;
      for (const g of rows) {
        const row = ws.getRow(r++);
        row.values = [new Date(`${d}T00:00:00Z`), g.work, g.workers, g.q ? `${g.q[0]} ${g.q[1]}` : '-', '-', '-', '-', g.m, g.h];
        if (g.q) [15, 16, 17, 18, 19].forEach((c, i) => (row.getCell(c).value = g.q![i]));
        if (g.q2) [22, 23, 24, 25, 26].forEach((c, i) => (row.getCell(c).value = g.q2![i]));
      }
      ws.getRow(r++).getCell(2).value = 'Day Total';
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const send = async (fields: Record<string, string>) => {
    let req = se.post(`/api${base()}/import-excel`).set('X-Requested-With', 'toprock');
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', await weekly(), { filename: 'weekly.xlsx' });
  };

  it('lists norms missing from the master, adds them on request, then saves every day', async () => {
    const pre = await send({ date: day(-6) });
    expect(pre.status).toBe(200);
    const sheet = pre.body.sheets[0];
    expect(sheet.dates.map((d: any) => d.date)).toEqual([day(-6), day(-5)]);
    expect(sheet.gangs).toHaveLength(3); // "Day Total" and banners skipped
    expect(sheet.gangs[2]).toMatchObject({ masons: 0.5, helpers: 0.5 });
    expect(sheet.gangs[1]).toMatchObject({ doneQty: 60, doneQty2: 40, unit2: 'Sq.ft' });
    // BRICK-NOS (600 Nos, 1+2) already exists; the two plastering norms do not.
    expect(pre.body.missingNorms.map((n: any) => n.code).sort()).toEqual(['SQFT-161-1M1H', 'SQFT-320-1M2H']);
    expect(sheet.gangs[0].normId).toBe(norms['BRICK-NOS'].id);

    // The site engineer manages manpower on the project, but norms are organisation-wide: the admin adds them.
    const adm = request.agent(app);
    await adm.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.admin.email, password: PASSWORD });
    const add = await adm.post(`/api${base()}/import-excel`).set('X-Requested-With', 'toprock').field('createMissingNorms', 'true').attach('file', await weekly(), { filename: 'weekly.xlsx' });
    expect(add.status).toBe(200);
    expect(add.body.missingNorms).toEqual([]);

    const saved = await send({ saveAll: 'true', sheet: sheet.sheet });
    expect(saved.status).toBe(201);
    expect(saved.body.created).toEqual([day(-6), day(-5)]);
    const s = await w.c.pm.ok.get(`/labour-reports/summary?from=${day(-6)}&to=${day(-6)}&projectId=${w.project.id}`);
    // Rates are ₹1,400 / ₹1,000 here (changed earlier in this file): 2.5 × 1,400 + 2.5 × 1,000. Output is weighted over the two measured gangs.
    expect(s.rows[0]).toMatchObject({ labourCost: '6000.00', masonDays: 2.5, helperDays: 2.5, workDone: { Nos: '75.0000', 'Sq.ft': '100.0000' } });
    expect(Number(s.rows[0].outputPct)).toBeCloseTo((75 / 600 + 60 / 161 + 40 / 320) / 2, 4);

    const again = await send({ saveAll: 'true', sheet: sheet.sheet });
    expect(again.body).toMatchObject({ created: [], skipped: [day(-6), day(-5)] }); // existing days are left alone
  });
});

describe('one Excel file for several sites (Ponram, Kadara, Factory)', () => {
  const D = day(-12);
  let ponram: any;
  let kadara: any;
  let adm: ReturnType<typeof request.agent>;
  beforeAll(async () => {
    ponram = await w.c.admin.ok.post('/projects', { code: `PO${w.tag.slice(-5)}`, name: 'Ponram Residence', template: 'NONE', clientId: w.client.id, contractValue: '1000000', contractType: 'ITEM_RATE', currency: 'INR', taxRate: '0.18', retentionPct: '0.05', startDate: day(-60), plannedCompletionDate: day(300), status: 'ACTIVE' });
    kadara = await w.c.admin.ok.post('/projects', { code: `KA${w.tag.slice(-5)}`, name: 'Kadara Cafe', template: 'NONE', clientId: w.client.id, contractValue: '1000000', contractType: 'ITEM_RATE', currency: 'INR', taxRate: '0.18', retentionPct: '0.05', startDate: day(-60), plannedCompletionDate: day(300), status: 'ACTIVE' });
    for (const p of [ponram, kadara]) await w.c.admin.ok.post(`/projects/${p.id}/members`, { userId: w.users.se.id });
    adm = request.agent(app);
    await adm.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.admin.email, password: PASSWORD });
  });

  /** The upload template layout, one sheet per site. */
  async function file() {
    const wb = new ExcelJS.Workbook();
    const sheets: Record<string, Array<[string, string, number, number, number | null, string | null]>> = {
      Ponram: [
        ['Floor screeding – 1st floor hall', 'Ravi, Mani', 1, 1, 500, 'Sq.ft'],
        ['Brick installation', 'Anuj, Munna, Arun', 1, 2, 600, 'Nos'],
      ],
      Kadara: [['Terrace screeding work', 'Selva, Kannan', 1, 1, 300, 'Sq.ft'], ['Mural sketching', 'Ravi', 1, 0, 20, 'Sq.ft']],
      Factory: [['Site cleaning', 'Nihal', 0, 1, null, null]],
    };
    for (const [name, rows] of Object.entries(sheets)) {
      const ws = wb.addWorksheet(name);
      ws.addRow(['Date', 'Work', 'Workers', 'Mason Used', 'Helper Used', 'Done Qty', 'Unit', 'Note']);
      for (const [work, workers, m, h, q, u] of rows) ws.addRow([new Date(`${D}T00:00:00Z`), work, workers, m, h, q, u, '']);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const send = async (agent: ReturnType<typeof request.agent>, fields: Record<string, string> = {}) => {
    let req = agent.post(`/api/projects/${ponram.id}/labour-reports/import-excel`).set('X-Requested-With', 'toprock').field('date', D);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', await file(), { filename: 'sites.xlsx' });
  };

  it('sends each sheet to the project it is named after', async () => {
    const r = await send(se);
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.sheets.map((s: any) => [s.sheet, s]));
    expect(by.Ponram).toMatchObject({ matchesProject: true, project: { id: ponram.id }, newDays: 1 });
    expect(by.Kadara).toMatchObject({ matchesProject: false, project: { id: kadara.id }, newDays: 1 });
    expect(by.Factory.project).toBeNull();
    expect(r.body.preferred).toBe('Ponram');
  });

  it('every common work is measured from the standard library; works it cannot name are listed for an average', async () => {
    const r = await send(se);
    const [screed, brick] = r.body.sheets[0].gangs;
    // Own norm (BRICK-NOS) wins over the standard brickwork norm; screeding comes from the standard library.
    expect(brick.normId).toBe(norms['BRICK-NOS'].id);
    expect(screed.norm).toMatchObject({ code: 'STD-SCREED', unit: 'Sq.ft', outputPerDay: '250', masonsPerCrew: 1, helpersPerCrew: 2 });
    expect(r.body.sheets.find((x: any) => x.sheet === 'Kadara').gangs[0].norm.code).toBe('STD-ROOF-SCREED'); // terrace screed
    expect(r.body.unmeasured.map((u: any) => u.work)).toEqual(['Mural sketching']);
    // A typed average becomes the organisation's own norm and is used from then on.
    const ok = await send(adm, { newNorms: JSON.stringify([{ name: 'Mural sketching', unit: 'Sq.ft', outputPerDay: 40, masonsPerCrew: 1, helpersPerCrew: 0 }]) });
    expect(ok.status).toBe(200);
    expect(ok.body.unmeasured).toEqual([]);
    expect((await send(adm, { newNorms: JSON.stringify([{ name: 'X', unit: 'Sq.ft', outputPerDay: 0, masonsPerCrew: 1, helpersPerCrew: 0 }]) })).status).toBe(422);
  });

  it('saves every sheet to its own project in one go, with profit or loss', async () => {
    const r = await send(se, { saveAllSheets: 'true' });
    expect(r.status).toBe(201);
    const by = Object.fromEntries(r.body.results.map((x: any) => [x.sheet, x]));
    expect(by.Ponram).toMatchObject({ project: { id: ponram.id }, created: [D] });
    expect(by.Kadara).toMatchObject({ project: { id: kadara.id }, created: [D] });
    expect(by.Factory).toMatchObject({ project: null, created: [] });
    const s = await w.c.admin.ok.get(`/labour-reports/summary?from=${D}&to=${D}`);
    const row = (pid: string) => s.rows.find((x: any) => x.projectId === pid);
    // Kadara: 300 Sq.ft terrace screed against 150 a day for 1 mason → 200 %; the 20 Sq.ft mural (40 a day) → 50 %.
    expect(row(kadara.id).result).toBe('PROFIT');
    expect(Number(row(kadara.id).profitLoss)).toBeCloseTo(2400 * 1 + 1400 * -0.5, 2); // ₹1,400 mason, ₹1,000 helper
    expect(row(ponram.id).result).not.toBe('NOT_MEASURED');
    expect((await send(se, { saveAllSheets: 'true' })).body.created).toEqual([]); // nothing twice
  });

  it('typed reports pick the norm from the work name too', async () => {
    const r = await w.c.se.ok.post(`/projects/${kadara.id}/labour-reports`, { date: day(-13), gangs: [
      { work: 'Wall putty 2nd coat', workers: ['A'], masons: 1, helpers: 0, doneQty: '300', progress: 'DONE' },
      { work: 'Vitrified tile laying – lobby', workers: ['B', 'C'], masons: 1, helpers: 1, doneQty: '80', unit: 'Sq.ft', progress: 'DONE' },
    ] });
    expect(r.gangs.map((g: any) => g.norm?.code)).toEqual(['STD-PUTTY', 'STD-TILE-FLOOR']);
    expect(r.gangs[0]).toMatchObject({ unit: 'Sq.ft', result: 'PROFIT' }); // 300 against 250 a day
    expect(Number(r.gangs[0].outputPct)).toBe(1.2);
    expect(r.gangs[1].result).toBe('LOSS'); // 80 against 100 a day
    expect(Number(r.gangs[1].outputPct)).toBe(0.8);
  });
});

describe('matching helpers', () => {
  it('finds the norm named in the work, never a doubtful one', async () => {
    const { normByName, projectForSheet } = await import('../src/services/labourExcelImport.js');
    const list = [
      { name: 'Screeding', unit: 'Sq.ft' },
      { name: 'Brick installation', unit: 'Nos' },
      { name: 'Wall plastering', unit: 'Sq.ft' },
      { name: 'Ceiling plastering', unit: 'Sq.ft' },
    ];
    expect(normByName('Floor screeding – 2nd floor', 'Sq.ft', list)?.name).toBe('Screeding');
    expect(normByName('Floor screeding', 'Nos', list)).toBeUndefined(); // unit disagrees
    expect(normByName('Glue filling + brick installation', null, list)?.name).toBe('Brick installation');
    expect(normByName('Plastering', 'Sq.ft', list)).toBeUndefined(); // wall or ceiling? not guessed
    expect(normByName('Wall plastering 2nd floor', 'Sq.ft', list)?.name).toBe('Wall plastering');
    expect(normByName('Ceiling plastering 1st floor', 'Sq.ft', list)?.name).toBe('Ceiling plastering');
    const projects = [{ name: 'Ponram Residence', code: 'PON' }, { name: 'Kadara Cafe', code: 'KAD' }, { name: 'Toprock Factory', code: 'FAC' }];
    expect(projectForSheet('Ponram', projects)?.code).toBe('PON');
    expect(projectForSheet('FAC', projects)?.code).toBe('FAC');
    expect(projectForSheet('Factory', projects)?.code).toBe('FAC');
    expect(projectForSheet('Sheet1', projects)).toBeUndefined();
    // Other words and the standard library: own norms first, the most specific wins, ties match nothing.
    const { STANDARD_LABOUR_NORMS } = await import('../src/services/standardNorms.js');
    const code = (work: string, unit: string | null = null) => normByName(work, unit, STANDARD_LABOUR_NORMS)?.code;
    expect(code('Ceiling plastering 1st floor')).toBe('STD-PLAS-CEIL');
    expect(code('External plastering north side')).toBe('STD-PLAS-EXT');
    expect(code('Toilet wall tiling')).toBe('STD-TILE-WALL');
    expect(code('Glass partition fixing')).toBe('STD-GLAZING');
    expect(code('Gypsum false ceiling framing')).toBe('STD-GYP-CEIL');
    expect(code('Core cutting for AC drain')).toBe('STD-CORE-CUT');
    expect(code('Slab shuttering', 'Sq.ft')).toBe('STD-SHUTTER');
    expect(code('Light box framing', 'Nos')).toBeUndefined();
    expect(normByName('Floor screeding', 'Sq.ft', [...STANDARD_LABOUR_NORMS, { code: 'MY-SCREED', name: 'Screed', unit: 'Sq.ft' }])?.code).toBe('MY-SCREED');
  });
});
