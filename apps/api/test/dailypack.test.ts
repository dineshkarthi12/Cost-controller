/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { app, day, PASSWORD, prisma, setupWorld, type World } from './helpers.js';
import { setWhatsAppFetchForTests } from '../src/services/whatsappApi.js';
import { dailyPackJob } from '../src/services/dailyPack.js';

let w: World;
const D = day(0);
const pdfOf = (r: request.Response) => (r.body as Buffer).subarray(0, 5).toString();
const binary = (res: any, cb: any) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  w = await setupWorld();
  await w.c.admin.ok.put('/admin/settings', { settings: { whatsappContacts: [{ name: 'Gowtham', role: 'Executive Director', phone: '+91 89407 42959', email: '', dailyPack: true }] } });
  await w.c.admin.ok.post(`${w.P}/r/siteDiaries`, { date: D, shift: 'DAY', activitiesPerformed: 'Gypsum partition 106 sqft', nextDayPlan: 'Wallpaper' });
  await w.c.se.ok.post(`${w.P}/labour-reports`, { date: D, gangs: [{ work: 'Wall putty', workers: ['A'], masons: 1, helpers: 0, doneQty: '300', progress: 'DONE' }] });
  await w.c.se.ok.post(`${w.P}/r/mrs`, { requiredBy: day(5), lines: [{ materialId: w.cement.id, qty: '50', unit: 'BAG' }] });
  await w.c.admin.ok.post(`${w.P}/r/purchaseOrders`, { supplierId: w.supplier.id, orderDate: D, lines: [{ description: 'Cement OPC 53', materialId: w.cement.id, qty: '100', unit: 'BAG', rate: '410', taxRate: '0.18', costCodeId: w.cc.material.id }] });
});
afterEach(() => {
  setWhatsAppFetchForTests(null);
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
});

describe('end-of-day pack', () => {
  it("lists every document of the day in one place, with a WhatsApp message and a link to the PDF", async () => {
    const r = await w.c.pm.ok.get(`/daily-pack?date=${D}`);
    const types = r.docs.filter((d: any) => d.projectId === w.project.id).map((d: any) => d.entityType);
    expect(types).toEqual(['siteDiary', 'dailyLabourReport', 'materialRequisition', 'purchaseOrder']); // pack order
    expect(r.contacts).toMatchObject([{ name: 'Gowtham', phone: '+91 89407 42959' }]);
    expect(r.text).toContain(`*${w.project.name}*: Site Diary / DPR, Daily labour report, Material Requisition, Purchase Order`.replace('Site Diary / DPR', 'Site diary / DPR'));
    expect(r.text).toMatch(/All documents \(PDF\): http.*\/api\/public\/daily-pack\/[\w-]+\.[\w-]+/);
  });

  it('the PDF holds the documents; the link opens it without signing in, and a changed link does not', async () => {
    const pm = request.agent(app);
    await pm.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: w.users.pm.email, password: PASSWORD });
    const pdf = await pm.get(`/api/daily-pack/pdf?date=${D}`).set('X-Requested-With', 'toprock').buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdfOf(pdf)).toBe('%PDF-');
    expect((pdf.body as Buffer).length).toBeGreaterThan(5000);
    const { link } = await w.c.pm.ok.get(`/daily-pack?date=${D}`);
    const path = new URL(link).pathname;
    const pub = await request(app).get(path).buffer(true).parse(binary);
    expect(pub.status).toBe(200);
    expect(pub.headers['content-type']).toBe('application/pdf');
    expect(pdfOf(pub)).toBe('%PDF-');
    const bad = await request(app).get(path.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')));
    expect(bad.status).toBe(404);
  });

  it('sends by the WhatsApp Business API when it is set up: template with the PDF as the document', async () => {
    process.env.WHATSAPP_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    const calls: any[] = [];
    setWhatsAppFetchForTests((async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 });
    }) as any);
    const r = await w.c.pm.ok.post('/daily-pack/send', { date: D });
    expect(r.sent).toEqual([{ to: 'Gowtham', via: 'whatsapp', ok: true }]);
    expect(calls[0].url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect(calls[0].auth).toBe('Bearer test-token');
    expect(calls[0].body).toMatchObject({ messaging_product: 'whatsapp', to: '918940742959', type: 'template', template: { name: 'daily_report', language: { code: 'en' } } });
    const header = calls[0].body.template.components[0];
    expect(header.parameters[0].document).toMatchObject({ filename: `Daily-pack-${D}.pdf` });
    expect(header.parameters[0].document.link).toMatch(/\/api\/public\/daily-pack\//);
    expect(await prisma.auditEvent.count({ where: { orgId: w.org.id, action: 'DAILY_PACK_SENT' } })).toBe(1);
  });

  it('at the set time, without the Business API, the senders get one notification a day to send it', async () => {
    await w.c.admin.ok.put('/admin/settings', { settings: { dailyPackAuto: true, dailyPackTime: '00:00' } });
    // Saving one setting keeps the others (contacts, day rates…).
    expect((await w.c.admin.ok.get('/admin/settings')).settings.whatsappContacts).toHaveLength(1);
    await dailyPackJob();
    await dailyPackJob();
    const n = await prisma.notification.findMany({ where: { type: 'DAILY_PACK_READY', userId: w.users.admin.id } });
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe("Today's report pack is ready – send it to Gowtham on WhatsApp");
    expect(n[0].link).toMatch(/^\/daily-pack\?date=/);
  });

  it('only covers projects the user can see', async () => {
    const r = await w.c.outsider.ok.get(`/daily-pack?date=${D}`);
    expect(r.docs).toEqual([]);
  });
});
