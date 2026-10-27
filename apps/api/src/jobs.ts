import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { runEscalations } from './services/workflow.js';
import { generateRecurringTasks, taskAlerts } from './routes/tasks.js';
import { notify } from './services/notifications.js';
import { addDays, today } from './lib/dates.js';
import { usersWithRole } from './services/access.js';
import { projectCostPositions } from './services/budget.js';

/** Contract / guarantee expiry, delivery delays, payment due and overrun alerts (deduplicated daily). */
export async function businessAlerts() {
  const d = today();
  const key = d.toISOString().slice(0, 10);
  const projects = await prisma.project.findMany({ where: { status: { in: ['ACTIVE', 'PLANNING'] } } });
  for (const p of projects) {
    const pms = await usersWithRole(prisma, p.orgId, p.id, 'PROJECT_MANAGER');
    const ccl = await usersWithRole(prisma, p.orgId, p.id, 'COST_CONTROL_LEAD');
    const procurement = await usersWithRole(prisma, p.orgId, p.id, 'PROCUREMENT_OFFICER');
    const finance = await usersWithRole(prisma, p.orgId, p.id, 'FINANCE_OFFICER');
    const late = await prisma.purchaseOrder.findMany({ where: { projectId: p.id, status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] }, deliveryDate: { lt: d } } });
    for (const po of late) await notify(prisma, { userIds: procurement, type: 'DELIVERY_DELAYED', title: `Delivery overdue: ${po.number}`, link: `/procurement/po/${po.id}`, projectId: p.id, dedupeKey: `late:${po.id}:${key}` });
    const expiring = await prisma.guarantee.findMany({ where: { contract: { projectId: p.id }, status: 'ACTIVE', expiryDate: { lte: addDays(d, 30) } }, include: { contract: true } });
    for (const g of expiring) await notify(prisma, { userIds: pms, type: 'CONTRACT_EXPIRY', title: `${g.type.replace(/_/g, ' ')} ${g.reference} expires ${g.expiryDate.toISOString().slice(0, 10)}`, link: `/contracts/${g.contractId}`, projectId: p.id, dedupeKey: `guar:${g.id}:${key}` });
    const contracts = await prisma.contract.findMany({ where: { projectId: p.id, status: 'ACTIVE', endDate: { lte: addDays(d, 30) } } });
    for (const c of contracts) await notify(prisma, { userIds: pms, type: 'CONTRACT_EXPIRY', title: `Contract ${c.number} ends ${c.endDate?.toISOString().slice(0, 10)}`, link: `/contracts/${c.id}`, projectId: p.id, dedupeKey: `con:${c.id}:${key}` });
    const due = await prisma.supplierInvoice.findMany({ where: { projectId: p.id, status: { in: ['APPROVED', 'PARTIALLY_PAID'] }, dueDate: { lte: addDays(d, 3) } } });
    for (const i of due) await notify(prisma, { userIds: finance, type: 'PAYMENT_DUE', title: `Payment due: ${i.number} (${i.invoiceNo})`, link: `/payables/invoices/${i.id}`, projectId: p.id, dedupeKey: `due:${i.id}:${key}` });
    const bills = await prisma.contractorBill.findMany({ where: { projectId: p.id, status: { in: ['CERTIFIED', 'PARTIALLY_PAID'] }, dueDate: { lte: addDays(d, 3) } } });
    for (const b of bills) await notify(prisma, { userIds: finance, type: 'CONTRACTOR_BILL_DUE', title: `Contractor bill due: ${b.number}`, link: `/subcontractor-bills/${b.id}`, projectId: p.id, dedupeKey: `cbdue:${b.id}:${key}` });
    const missing = await prisma.manpowerReport.count({ where: { projectId: p.id, date: addDays(d, -1) } });
    if (!missing && p.status === 'ACTIVE') await notify(prisma, { userIds: await usersWithRole(prisma, p.orgId, p.id, 'HR_COORDINATOR'), type: 'MISSING_DAILY_REPORT', title: `No manpower report for ${addDays(d, -1).toISOString().slice(0, 10)}`, link: '/manpower', projectId: p.id, dedupeKey: `mpr-missing:${p.id}:${key}` });
    const pos = await projectCostPositions(prisma, p.id);
    for (const r of pos.rows.filter((x) => x.position.alert !== 'OK')) {
      await notify(prisma, { userIds: [...ccl, ...pms], type: r.position.alert === 'CRITICAL' ? 'FORECAST_OVERRUN' : 'BUDGET_THRESHOLD', title: `${r.position.alert === 'CRITICAL' ? 'Forecast overrun' : 'Budget threshold'}: ${r.code} ${r.name}`, body: `EAC ${r.position.eac} vs budget ${r.position.approvedBudget}`, link: '/budget', projectId: p.id, dedupeKey: `alert:${r.costCodeId}:${r.position.alert}:${key}` });
    }
    const risks = await prisma.risk.findMany({ where: { projectId: p.id, status: 'ESCALATED' } });
    for (const r of risks) await notify(prisma, { userIds: pms, type: 'RISK_ESCALATION', title: `Escalated risk: ${r.title}`, link: `/risks/${r.id}`, projectId: p.id, dedupeKey: `risk:${r.id}:${key}` });
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    if (lastDay.getTime() - d.getTime() <= 3 * 86_400_000) await notify(prisma, { userIds: ccl, type: 'MONTH_END_DEADLINE', title: `Month-end close due ${lastDay.toISOString().slice(0, 10)}`, link: '/month-end', projectId: p.id, dedupeKey: `mec:${p.id}:${key}` });
  }
}

const JOBS: Array<[string, () => Promise<unknown>, number]> = [
  ['approval escalations', runEscalations, 15 * 60_000],
  ['task alerts', taskAlerts, 60 * 60_000],
  ['recurring tasks', generateRecurringTasks, 60 * 60_000],
  ['business alerts', businessAlerts, 6 * 60 * 60_000],
];

export function startJobs() {
  for (const [name, fn, every] of JOBS) {
    const run = () => fn().catch((err) => logger.error({ err }, `job failed: ${name}`));
    setTimeout(run, 10_000);
    setInterval(run, every).unref();
  }
  logger.info('background jobs scheduled');
}

export async function runAllJobs() {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of JOBS) out[name] = await fn();
  return out;
}
