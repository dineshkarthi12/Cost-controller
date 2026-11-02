/**
 * The end-of-day pack: every document made or moved that day, on every project, in one PDF —
 * site diary / DPR, daily labour report (with profit / loss), manpower reports, MR, PR, PO, GRN,
 * issues, invoices, bills, measurements, BOQ items, BOM… each with its details and lines.
 * It is what is sent to the Executive Director at the end of the day.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { RESOURCES, type FieldDef, type ResourceDef } from '@toprock/shared';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { toDateOnly, tzOffsetMinutes } from '../lib/dates.js';
import { decorate } from '../resources/router.js';
import { hooksFor } from '../resources/hooks.js';
import { loadReport, reportSummary } from './labourReports.js';
import { dailyDigest } from './dailyDigest.js';
import { renderPack, type PackBlock } from './pdf.js';
import { getOrgSettings } from './settings.js';
import { emailConfigured, sendEmailNow } from './email.js';
import { sendDocumentTemplate, whatsappApiConfigured } from './whatsappApi.js';
import { notify } from './notifications.js';
import { audit } from './audit.js';

const BY_MODEL = new Map<string, ResourceDef>();
for (const d of Object.values(RESOURCES)) if (!BY_MODEL.has(d.model)) BY_MODEL.set(d.model, d);

/** Order of the documents in the pack (site first, then materials, money, quality). */
const ORDER = ['siteDiary', 'dailyLabourReport', 'manpowerReport', 'progressEntry', 'measurement', 'boqItem', 'bom', 'materialRequisition', 'purchaseRequisition', 'purchaseOrder', 'grn', 'mir', 'materialIssue', 'stockCount', 'supplierInvoice', 'payment', 'expense', 'subcontract', 'variation', 'claim', 'inspection', 'ncr', 'safetyIncident', 'rfi', 'document', 'task', 'equipmentLog'];
const SKIP = new Set(['party', 'uom', 'material', 'store', 'labourNorm', 'worker', 'checklistTemplate', 'wbsNode', 'costCode', 'cashFlowPlan', 'activity', 'equipment', 'equipmentMaintenance', 'billingMilestone']);
const WORD: Record<string, string> = { CREATE: 'created', UPDATE: 'updated', SUBMIT: 'submitted', APPROVE: 'approved', REJECT: 'rejected', RETURN: 'returned', CANCEL: 'cancelled', IMPORT_COMMITTED: 'imported' };

export interface PackDoc {
  projectId: string;
  projectName: string;
  entityType: string;
  type: string;
  id: string;
  title: string;
  status: string | null;
  actions: string[];
  link: string | null;
}

const rs = (v: unknown) => `Rs ${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function valueText(f: FieldDef, r: Record<string, any>): string {
  const v = r[f.name];
  if (f.type === 'ref') return r._labels?.[f.name] ?? '';
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (f.type === 'date' || f.type === 'datetime') return String(v).slice(0, 10);
  if (f.type === 'money') return rs(v);
  if (f.type === 'percent') return `${Math.round(Number(v) * 10000) / 100}%`;
  if (f.type === 'boolean') return v ? 'Yes' : 'No';
  if (f.type === 'decimal') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  if (Array.isArray(v)) return v.join(', ');
  return String(v).replace(/₹/g, 'Rs ');
}

async function dayWindow(orgId: string, date: string) {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, timezone: true } });
  const day = toDateOnly(date)!;
  const from = new Date(day.getTime() - tzOffsetMinutes(org.timezone, day) * 60000);
  return { org, day, from, to: new Date(from.getTime() + 86_400_000) };
}

/** The documents of the day, per project, in pack order. */
export async function packDocs(orgId: string, date: string, projectIds: string[]): Promise<PackDoc[]> {
  const { day, from, to } = await dayWindow(orgId, date);
  const projects = new Map((await prisma.project.findMany({ where: { orgId, id: { in: projectIds } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const events = await prisma.auditEvent.findMany({ where: { orgId, projectId: { in: [...projects.keys()] }, createdAt: { gte: from, lt: to } }, select: { action: true, entityType: true, entityId: true, projectId: true, summary: true }, orderBy: { createdAt: 'asc' } });
  const docs = new Map<string, PackDoc>();
  const add = (d: Omit<PackDoc, 'actions'>, action?: string) => {
    const k = `${d.entityType}|${d.id}`;
    const cur = docs.get(k) ?? { ...d, actions: [] };
    if (action && !cur.actions.includes(action)) cur.actions.push(action);
    docs.set(k, cur);
  };
  // Today's site diaries and labour reports, even if they were written earlier.
  for (const d of await prisma.siteDiary.findMany({ where: { projectId: { in: [...projects.keys()] }, date: day }, select: { id: true, projectId: true, number: true, status: true } })) add({ projectId: d.projectId, projectName: projects.get(d.projectId)!, entityType: 'siteDiary', type: 'Site diary / DPR', id: d.id, title: d.number, status: d.status, link: `/site-diary/${d.id}` });
  for (const d of await prisma.dailyLabourReport.findMany({ where: { projectId: { in: [...projects.keys()] }, date: day }, select: { id: true, projectId: true, status: true } })) add({ projectId: d.projectId, projectName: projects.get(d.projectId)!, entityType: 'dailyLabourReport', type: 'Daily labour report', id: d.id, title: date, status: d.status, link: '/manpower/daily' });
  for (const e of events) {
    const word = WORD[e.action];
    if (!word || !e.projectId || !e.entityId || SKIP.has(e.entityType)) continue;
    const def = BY_MODEL.get(e.entityType);
    if (e.entityType === 'bom' || e.entityType === 'bomItem' || e.entityType === 'bomLine') add({ projectId: e.projectId, projectName: projects.get(e.projectId)!, entityType: 'bom', type: 'BOM', id: e.projectId, title: 'Bill of materials', status: null, link: '/boq/bom' }, word);
    else if (e.entityType === 'dailyLabourReport') add({ projectId: e.projectId, projectName: projects.get(e.projectId)!, entityType: 'dailyLabourReport', type: 'Daily labour report', id: e.entityId, title: date, status: null, link: '/manpower/daily' }, word);
    else if (e.entityType === 'importJob' && /BOQ/i.test(e.summary ?? '')) add({ projectId: e.projectId, projectName: projects.get(e.projectId)!, entityType: 'boqImport', type: 'BOQ import', id: e.entityId, title: (e.summary ?? '').slice(0, 80), status: null, link: '/boq' }, word);
    else if (def) add({ projectId: e.projectId, projectName: projects.get(e.projectId)!, entityType: e.entityType, type: def.label, id: e.entityId, title: '', status: null, link: null }, word);
  }
  // Titles and statuses of the records (deleted ones drop out).
  const list = [...docs.values()];
  for (const [model, def] of BY_MODEL) {
    const ids = list.filter((d) => d.entityType === model && !d.title).map((d) => d.id);
    if (!ids.length) continue;
    const rows: any[] = await (prisma as any)[model].findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const d of list.filter((x) => x.entityType === model && !x.title)) {
      const r = byId.get(d.id);
      if (!r) {
        docs.delete(`${d.entityType}|${d.id}`);
        continue;
      }
      d.title = String(r.number ?? r[def.titleField] ?? '').slice(0, 120);
      d.status = r.status ?? null;
      d.link = `${moduleBase(def)}/${d.id}`;
    }
  }
  const rank = (t: string) => (ORDER.indexOf(t) < 0 ? 99 : ORDER.indexOf(t));
  return [...docs.values()].sort((a, b) => a.projectName.localeCompare(b.projectName) || rank(a.entityType) - rank(b.entityType) || a.title.localeCompare(b.title, 'en', { numeric: true }));
}

/** Where a record opens in the web app (same paths as the navigation in apps/web/src/App.tsx). */
const PATHS: Record<string, string> = { manpowerReports: '/manpower', workers: '/manpower/workers', labourNorms: '/manpower/norms', siteDiaries: '/site-diary', progressEntries: '/progress/entries', activities: '/schedule/activities', equipment: '/equipment', equipmentLogs: '/equipment/logs', equipmentMaintenance: '/equipment/maintenance', costCodes: '/cost-codes', wbsNodes: '/cost-codes/wbs', boqItems: '/boq', takeoffs: '/takeoff', measurements: '/measurements', materials: '/materials', uoms: '/materials/units', stores: '/materials/stores', parties: '/materials/parties', mrs: '/procurement/mr', prs: '/procurement/pr', purchaseOrders: '/procurement/po', grns: '/procurement/grn', mirs: '/procurement/mir', materialIssues: '/stock/issues', stockCounts: '/stock/counts', expenses: '/expenses', budgetRevisions: '/budget/revisions', cashFlowPlans: '/cash-flow/plan', supplierInvoices: '/payables/invoices', payments: '/payables/payments', subcontracts: '/subcontractors/contracts', billingMilestones: '/client-billing/milestones', creditNotes: '/client-billing/notes', contracts: '/contracts', variations: '/variations', risks: '/risks', claims: '/risks/claims', inspections: '/quality', ncrs: '/quality/ncrs', checklistTemplates: '/quality/templates', safetyIncidents: '/safety', toolboxTalks: '/safety/toolbox-talks', documents: '/documents', transmittals: '/transmittals', rfis: '/transmittals/rfis', tasks: '/tasks' };
function moduleBase(def: ResourceDef): string {
  return PATHS[def.key] ?? `/${def.key}`;
}

async function recordBlocks(orgId: string, doc: PackDoc): Promise<PackBlock[]> {
  const def = BY_MODEL.get(doc.entityType)!;
  const rec: any = await (prisma as any)[def.model].findFirst({ where: { id: doc.id }, include: hooksFor(def.key).include });
  if (!rec) return [];
  await decorate(prisma, def, { orgId, projectId: doc.projectId }, [rec]);
  const out: PackBlock[] = [{ kind: 'h2', text: `${def.label} ${doc.title}${rec.status ? `  ·  ${String(rec.status).replace(/_/g, ' ')}` : ''}`, note: doc.actions.length ? `Today: ${doc.actions.join(', ')}` : undefined }];
  const kv: Array<[string, string]> = [];
  for (const f of def.fields) {
    if (f.type === 'lines' || f.hideInForm || f.name === 'number' || f.name === 'status') continue;
    const t = valueText(f, rec);
    if (t) kv.push([f.label, t.length > 600 ? `${t.slice(0, 599)}…` : t]);
  }
  if (kv.length) out.push({ kind: 'kv', rows: kv });
  for (const lf of def.fields.filter((f) => f.type === 'lines')) {
    const rows: any[] = rec[lf.name] ?? [];
    if (!rows.length) continue;
    const cols = (lf.lines ?? []).filter((c) => !c.hideInForm && rows.some((r) => valueText(c, r)));
    out.push({ kind: 'table', title: `${lf.label} (${rows.length})`, columns: [{ key: '#', label: '#', width: 0.4 }, ...cols.map((c) => ({ key: c.name, label: c.label, width: c.type === 'ref' || c.name === 'description' || c.type === 'text' ? 2.2 : c.type === 'money' ? 1.5 : 1, align: (['decimal', 'money', 'percent', 'int'].includes(c.type) ? 'right' : 'left') as 'right' | 'left' }))], rows: rows.map((r, i) => ({ '#': String(i + 1), ...Object.fromEntries(cols.map((c) => [c.name, valueText(c, r)])) })) });
  }
  return out;
}

async function labourBlocks(doc: PackDoc): Promise<PackBlock[]> {
  const r = await loadReport(prisma, doc.projectId, doc.id);
  if (!r) return [];
  const s = reportSummary(r);
  const pl = Number(s.profitLoss);
  return [
    { kind: 'h2', text: `Daily labour report  ·  ${r.status === 'COMPLETED' ? 'evening measured' : 'morning plan'}` },
    { kind: 'kv', rows: [['Labour', `${s.masonDays} masons, ${s.helperDays} helpers`], ['Labour cost', rs(s.labourCost)], ['Output vs norm', s.outputPct === null ? 'not measured' : `${(Number(s.outputPct) * 100).toFixed(1)}%`], ['Profit / loss on labour', s.result === 'NOT_MEASURED' ? '-' : `${pl >= 0 ? 'Profit' : 'Loss'} ${rs(Math.abs(pl))}`]] },
    {
      kind: 'table',
      title: `Gangs (${r.gangs.length})`,
      columns: [{ key: 'n', label: '#', width: 0.4 }, { key: 'work', label: 'Work', width: 3 }, { key: 'crew', label: 'M + H', width: 0.9 }, { key: 'done', label: 'Done', width: 1.3 }, { key: 'norm', label: 'Norm / day', width: 1.3 }, { key: 'out', label: 'Output', width: 0.9, align: 'right' }, { key: 'cost', label: 'Cost', width: 1.2, align: 'right' }, { key: 'pl', label: 'Profit / loss', width: 1.3, align: 'right' }],
      rows: r.gangs.map((g) => ({ n: String(g.lineNo), work: g.work, crew: `${Number(g.masons)} + ${Number(g.helpers)}`, done: g.doneQty ? `${Number(g.doneQty)} ${g.unit ?? ''}` : g.outcome ?? '', norm: g.norm ? `${Number(g.norm.outputPerDay)} ${g.norm.unit}` : '', out: g.outputPct === null ? '' : `${(Number(g.outputPct) * 100).toFixed(0)}%`, cost: rs(g.labourCost), pl: g.result === 'NOT_MEASURED' ? '' : rs(g.profitLoss) })),
    },
  ];
}

async function bomBlocks(doc: PackDoc): Promise<PackBlock[]> {
  const items = await prisma.bomItem.findMany({ where: { projectId: doc.projectId }, include: { lines: true }, orderBy: { lineNo: 'asc' } });
  const lines = items.flatMap((i) => i.lines);
  const sum = new Map<string, { unit: string; qty: number }>();
  for (const l of lines.filter((x) => x.kind === 'MATERIAL')) {
    const k = `${l.description}|${l.unit}`;
    sum.set(k, { unit: l.unit, qty: (sum.get(k)?.qty ?? 0) + Number(l.totalQty) });
  }
  return [
    { kind: 'h2', text: `BOM  ·  ${items.length} BOQ items, ${lines.length} lines`, note: doc.actions.length ? `Today: ${doc.actions.join(', ')}` : undefined },
    { kind: 'table', title: 'Materials needed (whole BOM)', columns: [{ key: 'm', label: 'Material', width: 4 }, { key: 'q', label: 'Total qty', width: 1, align: 'right' }, { key: 'u', label: 'Unit', width: 0.8 }], rows: [...sum.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ m: k.split('|')[0], q: v.qty.toLocaleString('en-IN', { maximumFractionDigits: 2 }), u: v.unit })) },
  ];
}

/** The pack as a PDF, with the day's summary per project on top. */
export async function buildDailyPack(orgId: string, date: string, projectIds: string[]) {
  const { org } = await dayWindow(orgId, date);
  const docs = await packDocs(orgId, date, projectIds);
  const projects = await prisma.project.findMany({ where: { orgId, id: { in: projectIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const blocks: PackBlock[] = [];
  const active = projects.filter((p) => docs.some((d) => d.projectId === p.id));
  blocks.push({ kind: 'kv', rows: [['Date', date], ['Projects with activity', String(active.length)], ['Documents', String(docs.length)]] });
  blocks.push({ kind: 'table', title: 'Documents in this pack', columns: [{ key: 'p', label: 'Project', width: 1.6 }, { key: 't', label: 'Document', width: 1.6 }, { key: 'n', label: 'No. / title', width: 2 }, { key: 's', label: 'Status', width: 1 }, { key: 'a', label: 'Today', width: 1.4 }], rows: docs.map((d) => ({ p: d.projectName, t: d.type, n: d.title, s: (d.status ?? '').replace(/_/g, ' '), a: d.actions.join(', ') })) });
  for (const p of active) {
    blocks.push({ kind: 'h1', text: p.name, pageBreak: true });
    const digest = await dailyDigest(orgId, p.id, date);
    blocks.push({ kind: 'text', text: digest.text.split('\n').slice(2).join('\n').replace(/\*/g, '').replace(/₹/g, 'Rs ').trim() });
    for (const d of docs.filter((x) => x.projectId === p.id)) {
      if (d.entityType === 'dailyLabourReport') blocks.push(...(await labourBlocks(d)));
      else if (d.entityType === 'bom') blocks.push(...(await bomBlocks(d)));
      else if (d.entityType === 'boqImport') blocks.push({ kind: 'h2', text: d.title });
      else if (BY_MODEL.has(d.entityType)) blocks.push(...(await recordBlocks(orgId, d)));
    }
  }
  if (!docs.length) blocks.push({ kind: 'text', text: 'Nothing was recorded in the app for this day.' });
  const pdf = await renderPack({ title: 'Daily report pack', subtitle: `${org.name} · ${date}`, blocks });
  return { pdf, docs, fileName: `Daily-pack-${date}.pdf` };
}

/** WhatsApp message that goes with the pack: one line per project and the link to the PDF. */
export async function packMessage(orgId: string, date: string, projectIds: string[], link: string) {
  const docs = await packDocs(orgId, date, projectIds);
  const { org } = await dayWindow(orgId, date);
  const byProject = new Map<string, PackDoc[]>();
  for (const d of docs) byProject.set(d.projectName, [...(byProject.get(d.projectName) ?? []), d]);
  const lines = [`*Daily report – ${org.name}*`, date, ''];
  for (const [name, ds] of byProject) {
    const count = new Map<string, number>();
    for (const d of ds) count.set(d.type, (count.get(d.type) ?? 0) + 1);
    lines.push(`*${name}*: ${[...count.entries()].map(([t, n]) => (n > 1 ? `${n} ${t}` : t)).join(', ')}`);
  }
  if (!docs.length) lines.push('Nothing was recorded in the app today.');
  lines.push('', `All documents (PDF): ${link}`);
  return { text: lines.join('\n'), docs };
}

/* ------------------------------------------------------------- links that open without a login */

const secret = () => process.env.LINK_SECRET || config.cronSecret || createHmac('sha256', 'toprock-pack').update(config.databaseUrl || 'dev').digest('hex');
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

/** A link to the day's pack that works for 7 days without signing in (for WhatsApp). */
export function packLink(orgId: string, date: string, projectIds: string[], days = 7) {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const payload = Buffer.from(JSON.stringify({ o: orgId, d: date, p: projectIds, e: exp })).toString('base64url');
  return `${config.appBaseUrl}/api/public/daily-pack/${payload}.${sign(payload)}`;
}

export function readPackToken(token: string): { orgId: string; date: string; projectIds: string[] } | null {
  const [payload, sig] = token.replace(/\.pdf$/, '').split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof p.e !== 'number' || p.e < Date.now() / 1000) return null;
    return { orgId: String(p.o), date: String(p.d), projectIds: (p.p as unknown[]).map(String) };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- sending */


export interface PackSendResult {
  date: string;
  documents: number;
  link: string;
  text: string;
  whatsappApi: boolean;
  sent: Array<{ to: string; via: 'whatsapp' | 'email'; ok: boolean; error?: string }>;
}

/** Projects that go in the organisation's pack: everything not closed. */
export async function packProjects(orgId: string) {
  return (await prisma.project.findMany({ where: { orgId, status: { notIn: ['CLOSED', 'CANCELLED'] } }, select: { id: true } })).map((p) => p.id);
}

/**
 * Sends the day's pack to every WhatsApp contact marked for it: by the WhatsApp Business API when it is
 * set up, and by email (PDF attached) to contacts with an email address.
 */
export async function sendDailyPack(orgId: string, date: string, projectIds: string[], actor?: { id: string }): Promise<PackSendResult> {
  const settings = await getOrgSettings(prisma, orgId);
  const link = packLink(orgId, date, projectIds);
  const { text, docs } = await packMessage(orgId, date, projectIds, link);
  const contacts = settings.whatsappContacts.filter((c) => c.dailyPack);
  const sent: PackSendResult['sent'] = [];
  let pdf: Awaited<ReturnType<typeof buildDailyPack>> | null = null;
  for (const c of contacts) {
    if (whatsappApiConfigured()) {
      const r = await sendDocumentTemplate(c.phone, { link, fileName: `Daily-pack-${date}.pdf` }, text.split('\n').filter((l) => l && !l.startsWith('All documents')).slice(1).join(' · '));
      sent.push({ to: c.name, via: 'whatsapp', ok: r.ok, error: r.error });
    }
    if (c.email && emailConfigured()) {
      pdf ??= await buildDailyPack(orgId, date, projectIds);
      const r = await sendEmailNow({ to: c.email, subject: `Daily report ${date}`, text: text.replace(/\*/g, ''), attachments: [{ filename: pdf.fileName, content: pdf.pdf, contentType: 'application/pdf' }] });
      sent.push({ to: c.name, via: 'email', ok: r.sent, error: r.error });
    }
  }
  await audit(prisma, { orgId, ...(actor ? { user: { id: actor.id } as never } : {}) }, { action: 'DAILY_PACK_SENT', entityType: 'organisation', entityId: orgId, summary: `Daily pack ${date} (${docs.length} documents): ${sent.length ? sent.map((s) => `${s.to} by ${s.via}${s.ok ? '' : ' – failed'}`).join(', ') : 'nothing sent automatically'}` });
  return { date, documents: docs.length, link, text, whatsappApi: whatsappApiConfigured(), sent };
}

/** Local date and HH:MM in the organisation's time zone. */
function localNow(tz: string, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * Scheduled: once the organisation's pack time (e.g. 18:30) has passed, sends today's pack once.
 * Without the WhatsApp Business API, the people who send it get a notification instead: one tap opens
 * the pack page with the message ready for WhatsApp.
 */
export async function dailyPackJob(now = new Date()) {
  const out: Array<{ org: string; date: string; result: string }> = [];
  for (const org of await prisma.organisation.findMany({ select: { id: true, code: true, timezone: true } })) {
    const s = await getOrgSettings(prisma, org.id);
    if (!s.dailyPackAuto) continue;
    const { date, time } = localNow(org.timezone, now);
    if (time < s.dailyPackTime) continue;
    const done = await prisma.auditEvent.findFirst({ where: { orgId: org.id, action: { in: ['DAILY_PACK_SENT', 'DAILY_PACK_REMINDER'] }, entityType: 'organisation', summary: { contains: `pack ${date}` }, actorId: null } });
    if (done) continue;
    const projects = await packProjects(org.id);
    const canSend = whatsappApiConfigured() || (emailConfigured() && s.whatsappContacts.some((c) => c.dailyPack && c.email));
    if (canSend) {
      const r = await sendDailyPack(org.id, date, projects);
      out.push({ org: org.code, date, result: `sent ${r.sent.filter((x) => x.ok).length}/${r.sent.length}` });
    }
    if (!whatsappApiConfigured()) {
      // Remind the senders: tap → pack page → "Send to Gowtham".
      const users = await prisma.user.findMany({ where: { orgId: org.id, status: 'ACTIVE', roles: { some: { role: { OR: [{ code: { in: ['PROJECT_MANAGER', 'PROJECT_DIRECTOR', 'COMPANY_ADMIN'] } }, { permissions: { some: { permissionCode: 'settings.manage' } } }] } } } }, select: { id: true } });
      const names = s.whatsappContacts.filter((c) => c.dailyPack).map((c) => c.name).join(', ') || 'the management';
      await notify(prisma, { userIds: users.map((u) => u.id), type: 'DAILY_PACK_READY', title: `Today's report pack is ready – send it to ${names} on WhatsApp`, body: 'Tap to open the pack and send it in one click.', link: `/daily-pack?date=${date}`, dedupeKey: `daily-pack:${org.id}:${date}` });
      await audit(prisma, { orgId: org.id }, { action: 'DAILY_PACK_REMINDER', entityType: 'organisation', entityId: org.id, summary: `Daily pack ${date} ready; ${users.length} sender(s) reminded` });
      out.push({ org: org.code, date, result: `reminded ${users.length}` });
    }
  }
  return out;
}
