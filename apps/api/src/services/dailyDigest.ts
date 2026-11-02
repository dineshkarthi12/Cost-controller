/**
 * "What happened today" on a project, as a WhatsApp message (plain text, *bold* headings):
 * site diary / DPR, labour and productivity, manpower, everything done in the app that day
 * (MR, PO, GRN, bills, measurements, BOQ, BOM… from the audit trail) and approvals waiting.
 */
import { D } from '@toprock/shared';
import { prisma } from '../lib/prisma.js';
import { toDateOnly, tzOffsetMinutes } from '../lib/dates.js';
import { reportSummary, loadReport } from './labourReports.js';

const LABEL: Record<string, string> = {
  materialRequisition: 'Material requisitions (MR)',
  purchaseRequisition: 'Purchase requisitions (PR)',
  purchaseOrder: 'Purchase orders (PO)',
  grn: 'Goods received (GRN)',
  materialIssue: 'Material issues',
  mir: 'Material inspections',
  stockCount: 'Stock counts',
  supplierInvoice: 'Supplier invoices',
  payment: 'Payments',
  expense: 'Site expenses',
  measurement: 'Measurements',
  progressEntry: 'Progress entries',
  boqItem: 'BOQ items',
  bom: 'BOM',
  bomItem: 'BOM items',
  importJob: 'Excel imports',
  clientBill: 'Client bills',
  contractorBill: 'Contractor bills',
  variation: 'Variations',
  subcontract: 'Subcontracts',
  inspection: 'Inspections',
  ncr: 'NCRs',
  rfi: 'RFIs',
  document: 'Documents',
  manpowerReport: 'Manpower reports',
  equipmentLog: 'Equipment logs',
  task: 'Tasks',
  risk: 'Risks',
  dailyLabourReport: 'Daily labour report',
  siteDiary: 'Site diary',
};
const WORD: Record<string, string> = { CREATE: 'created', UPDATE: 'updated', SUBMIT: 'submitted', APPROVE: 'approved', REJECT: 'rejected', RETURN: 'returned', IMPORT_COMMITTED: 'imported', DELETE: 'deleted', CANCEL: 'cancelled' };

const inr = (v: unknown) => `₹${D(v as string).toNumber().toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const clip = (s: string | null | undefined, n = 400) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s).trim() : '');

export async function dailyDigest(orgId: string, projectId: string, date: string) {
  const [org, project] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, timezone: true } }),
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true, code: true } }),
  ]);
  const day = toDateOnly(date)!;
  const from = new Date(day.getTime() - tzOffsetMinutes(org.timezone, day) * 60000);
  const to = new Date(from.getTime() + 86_400_000);
  const [diaries, labour, mprs, events, pending] = await Promise.all([
    prisma.siteDiary.findMany({ where: { projectId, date: day }, orderBy: { shift: 'asc' } }),
    prisma.dailyLabourReport.findFirst({ where: { projectId, date: day }, select: { id: true } }),
    prisma.manpowerReport.findMany({ where: { projectId, date: day }, select: { totalWorkers: true } }),
    prisma.auditEvent.findMany({ where: { orgId, projectId, createdAt: { gte: from, lt: to } }, select: { action: true, entityType: true, summary: true }, orderBy: { createdAt: 'asc' } }),
    prisma.approvalRequest.count({ where: { projectId, status: 'PENDING' } }),
  ]);
  const when = day.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const out: string[] = [`*Daily progress report – ${project.name}*`, `${when} · ${org.name}`];

  for (const d of diaries) {
    out.push('', `*Site diary${diaries.length > 1 ? ` (${d.shift.toLowerCase()} shift)` : ''}*${d.weather ? ` · ${d.weather.toLowerCase()}` : ''}`);
    if (d.activitiesPerformed) out.push(`Work done: ${clip(d.activitiesPerformed, 700)}`);
    if (d.workStoppages) out.push(`Stoppages: ${clip(d.workStoppages)}`);
    if (d.delays) out.push(`Delays: ${clip(d.delays)}`);
    if (d.safetyObservations) out.push(`Safety: ${clip(d.safetyObservations)}`);
    if (d.qualityObservations) out.push(`Quality: ${clip(d.qualityObservations)}`);
    if (d.instructions) out.push(`Instructions: ${clip(d.instructions)}`);
    if (d.nextDayPlan) out.push(`Tomorrow: ${clip(d.nextDayPlan)}`);
  }

  if (labour) {
    const r = (await loadReport(prisma, projectId, labour.id))!;
    const s = reportSummary(r);
    out.push('', '*Labour*', `${s.masonDays} masons · ${s.helperDays} helpers · cost ${inr(s.labourCost)}`);
    if (s.result !== 'NOT_MEASURED') {
      const pl = D(s.profitLoss);
      out.push(`Output ${(Number(s.outputPct) * 100).toFixed(1)}% of norm · ${pl.gte(0) ? 'profit' : 'loss'} ${inr(pl.abs())}`);
    } else out.push(r.status === 'COMPLETED' ? 'Work not measured against norms' : 'Evening update pending');
    for (const g of r.gangs.filter((x) => x.doneQty).slice(0, 12)) {
      const pct = g.outputPct === null ? '' : ` (${(Number(g.outputPct) * 100).toFixed(0)}%)`;
      out.push(`• ${clip(g.work, 60)}: ${Number(g.doneQty)} ${g.unit ?? ''}${pct}`);
    }
  }
  if (mprs.length) out.push('', `*Manpower on site*: ${mprs.reduce((a, m) => a + m.totalWorkers, 0)} workers`);

  // Everything done in the app that day, grouped: "Purchase orders (PO) approved: 2 – PO-0012 …".
  const groups = new Map<string, { label: string; count: number; examples: string[] }>();
  for (const e of events) {
    const label = LABEL[e.entityType];
    const word = WORD[e.action];
    if (!label || !word || e.entityType === 'siteDiary' || e.entityType === 'dailyLabourReport') continue;
    const k = `${label} ${word}`;
    const g = groups.get(k) ?? { label: k, count: 0, examples: [] };
    g.count++;
    if (e.summary && g.examples.length < 3 && !g.examples.includes(e.summary)) g.examples.push(clip(e.summary, 90));
    groups.set(k, g);
  }
  if (groups.size) {
    out.push('', '*Today in the app*');
    for (const g of groups.values()) out.push(`• ${g.label}: ${g.count}${g.examples.length ? ` – ${g.examples.join('; ')}` : ''}`);
  }
  if (pending) out.push('', `*Waiting for approval*: ${pending}`);
  if (!diaries.length && !labour && !mprs.length && !groups.size) out.push('', 'Nothing was recorded in the app for this day.');
  return { text: out.join('\n'), date };
}
