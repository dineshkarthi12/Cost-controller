import { computeBill, D, money, sum } from '@toprock/shared';
import type { Tx } from '../lib/prisma.js';
import { businessRule, notFound, validationError } from '../lib/errors.js';
import { toDateOnly } from '../lib/dates.js';
import type { AccessContext } from './access.js';
import { nextNumber } from './numbering.js';
import { upsertRegister } from './register.js';
import { audit } from './audit.js';

/**
 * Prepares a subcontractor RA bill from CERTIFIED, unbilled measurements of the subcontract.
 * Quantities never come from the client; only certified measurements are used.
 */
export async function createContractorBill(tx: Tx, ctx: AccessContext, projectId: string, input: { subcontractId: string; periodFrom: string; periodTo: string; otherDeductions?: string; deductionNotes?: string; contractorInvoiceNo?: string }) {
  const sc = await tx.subcontract.findFirst({ where: { id: input.subcontractId, projectId }, include: { items: true } });
  if (!sc) throw notFound('Subcontract');
  if (sc.status !== 'APPROVED') throw businessRule('Bills can only be raised against an approved subcontract');
  const open = await tx.contractorBill.count({ where: { subcontractId: sc.id, status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED'] } } });
  if (open) throw businessRule('Finish or cancel the open bill for this subcontract before raising another');
  const measurements = await tx.measurement.findMany({ where: { projectId, subcontractId: sc.id, status: 'CERTIFIED', contractorBillId: null, measuredOn: { lte: toDateOnly(input.periodTo)! } } });
  const prevBills = await tx.contractorBill.findMany({ where: { subcontractId: sc.id, status: { in: ['CERTIFIED', 'PARTIALLY_PAID', 'PAID'] } }, include: { lines: true }, orderBy: { billSeq: 'desc' } });
  const last = prevBills[0];
  const prevQty = new Map<string, ReturnType<typeof D>>();
  for (const l of last?.lines ?? []) prevQty.set(l.subcontractItemId ?? l.boqItemId ?? l.description, D(l.cumulativeQty));
  const curQty = new Map<string, { qty: ReturnType<typeof D>; ids: string[] }>();
  for (const m of measurements) {
    const item = sc.items.find((i) => i.boqItemId === m.boqItemId);
    if (!item) continue;
    const cur = curQty.get(item.id) ?? { qty: D(0), ids: [] };
    cur.qty = cur.qty.plus(D(m.verifiedQty ?? 0));
    cur.ids.push(m.id);
    curQty.set(item.id, cur);
  }
  const items = sc.items.filter((i) => prevQty.has(i.id) || curQty.has(i.id));
  const advanceRecovered = sum(prevBills.map((b) => b.advanceRecovery));
  const previousRetention = sum(prevBills.map((b) => b.retention));
  const calc = computeBill(
    items.map((i) => ({ previousQty: prevQty.get(i.id) ?? 0, currentQty: curQty.get(i.id)?.qty ?? 0, rate: i.rate })),
    {
      contractValue: sc.contractValue,
      retentionPct: sc.retentionPct,
      retentionCapPct: sc.retentionCapPct,
      advanceRecoveryPct: sc.advanceRecoveryPct,
      advanceOutstanding: D(sc.advanceAmount).minus(advanceRecovered),
      taxRate: sc.taxRate,
      previousGross: last?.grossToDate ?? 0,
      previousRetention,
      otherDeductions: input.otherDeductions ?? '0',
    },
  );
  if (D(calc.currentWorkValue).lte(0)) throw businessRule('No new certified work since the last bill. Certify measurements first.');
  const billSeq = (await tx.contractorBill.count({ where: { subcontractId: sc.id } })) + 1;
  const number = await nextNumber(tx, { orgId: ctx.orgId, projectId, docType: 'CONTRACTOR_BILL' });
  const bill = await tx.contractorBill.create({
    data: {
      projectId,
      number,
      subcontractId: sc.id,
      contractorId: sc.contractorId,
      billSeq,
      periodFrom: toDateOnly(input.periodFrom)!,
      periodTo: toDateOnly(input.periodTo)!,
      grossToDate: calc.grossToDate,
      previousGross: calc.previousGross,
      currentWorkValue: calc.currentWorkValue,
      variationValue: calc.variationValue,
      retention: calc.retention,
      advanceRecovery: calc.advanceRecovery,
      otherDeductions: calc.otherDeductions,
      deductionNotes: input.deductionNotes ?? null,
      taxAmount: calc.taxAmount,
      netPayable: calc.netPayable,
      contractorInvoiceNo: input.contractorInvoiceNo ?? null,
      createdById: ctx.user.id,
      lines: {
        create: items.map((i, idx) => ({
          subcontractItemId: i.id,
          boqItemId: i.boqItemId,
          description: i.description,
          unit: i.unit,
          rate: i.rate,
          previousQty: calc.lines[idx].previousQty,
          currentQty: calc.lines[idx].currentQty,
          cumulativeQty: calc.lines[idx].cumulativeQty,
          currentAmount: calc.lines[idx].currentAmount,
          cumulativeAmount: calc.lines[idx].cumulativeAmount,
          measurementIds: curQty.get(i.id)?.ids ?? [],
        })),
      },
    },
  });
  await tx.measurement.updateMany({ where: { id: { in: [...curQty.values()].flatMap((c) => c.ids) } }, data: { contractorBillId: bill.id } });
  await upsertRegister(tx, { orgId: ctx.orgId, projectId, docType: 'CONTRACTOR_BILL', number, entityType: 'contractorBill', entityId: bill.id, title: `RA-${billSeq} ${sc.title}`, status: 'DRAFT', ownerId: ctx.user.id, amount: bill.netPayable.toString() });
  await audit(tx, ctx, { action: 'CREATE', entityType: 'contractorBill', entityId: bill.id, projectId, summary: `RA bill ${number} prepared (${measurements.length} certified measurements)` });
  return bill;
}

/** Client RA bill from certified quantities not yet billed to the client, at BOQ contract rates. */
export async function createClientBill(tx: Tx, ctx: AccessContext, projectId: string, input: { periodFrom: string; periodTo: string; type?: string; milestoneId?: string; otherDeductions?: string }) {
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
  const open = await tx.clientBill.count({ where: { projectId, status: { in: ['DRAFT', 'SUBMITTED', 'RETURNED'] } } });
  if (open) throw businessRule('Finish or cancel the open client bill before raising another');
  const prevBills = await tx.clientBill.findMany({ where: { projectId, status: { notIn: ['DRAFT', 'SUBMITTED', 'RETURNED', 'REJECTED', 'CANCELLED'] } }, include: { lines: true }, orderBy: { billSeq: 'desc' } });
  const last = prevBills[0];
  const prevQty = new Map<string, ReturnType<typeof D>>((last?.lines ?? []).map((l) => [l.boqItemId, D(l.cumulativeQty)]));
  const measurements = await tx.measurement.findMany({ where: { projectId, status: 'CERTIFIED', clientBillId: null, measuredOn: { lte: toDateOnly(input.periodTo)! } } });
  const cur = new Map<string, { qty: ReturnType<typeof D>; ids: string[] }>();
  for (const m of measurements) {
    const c = cur.get(m.boqItemId) ?? { qty: D(0), ids: [] };
    c.qty = c.qty.plus(D(m.verifiedQty ?? 0));
    c.ids.push(m.id);
    cur.set(m.boqItemId, c);
  }
  const boqIds = [...new Set([...prevQty.keys(), ...cur.keys()])];
  const boq = await tx.boqItem.findMany({ where: { id: { in: boqIds } } });
  const approvedVo = await tx.variation.aggregate({ where: { projectId, status: 'APPROVED' }, _sum: { approvedValue: true } });
  let milestoneValue = D(0);
  if (input.milestoneId) {
    const ms = await tx.billingMilestone.findFirst({ where: { id: input.milestoneId, projectId } });
    if (!ms) throw validationError('Milestone not found');
    milestoneValue = D(ms.amount);
  }
  const calc = computeBill(
    boq.map((b) => ({ previousQty: prevQty.get(b.id) ?? 0, currentQty: cur.get(b.id)?.qty ?? 0, rate: b.revisedRate ?? b.unitRate })),
    {
      contractValue: project.contractValue,
      retentionPct: project.retentionPct,
      retentionCapPct: null,
      advanceRecoveryPct: project.advanceRecoveryPct,
      advanceOutstanding: D(project.advanceReceived).minus(sum(prevBills.map((b) => b.advanceRecovery))),
      taxRate: project.taxRate,
      previousGross: last?.grossToDate ?? 0,
      previousRetention: sum(prevBills.map((b) => b.retention)),
      approvedVariationsToDate: D(approvedVo._sum.approvedValue ?? 0).plus(milestoneValue),
      otherDeductions: input.otherDeductions ?? '0',
    },
  );
  if (D(calc.currentWorkValue).lte(0)) throw businessRule('No new certified work or approved variations since the last client bill');
  const billSeq = (await tx.clientBill.count({ where: { projectId } })) + 1;
  const number = await nextNumber(tx, { orgId: ctx.orgId, projectId, docType: 'CLIENT_BILL' });
  const bill = await tx.clientBill.create({
    data: {
      projectId,
      number,
      billSeq,
      type: input.type ?? 'RA',
      milestoneId: input.milestoneId ?? null,
      periodFrom: toDateOnly(input.periodFrom)!,
      periodTo: toDateOnly(input.periodTo)!,
      grossToDate: calc.grossToDate,
      previousGross: calc.previousGross,
      currentWorkValue: calc.currentWorkValue,
      variationValue: calc.variationValue,
      retention: calc.retention,
      advanceRecovery: calc.advanceRecovery,
      otherDeductions: calc.otherDeductions,
      taxAmount: calc.taxAmount,
      netAmount: calc.netPayable,
      createdById: ctx.user.id,
      lines: {
        create: boq.map((b, i) => ({
          boqItemId: b.id,
          description: b.description.slice(0, 300),
          unit: b.unit,
          rate: b.revisedRate ?? b.unitRate,
          previousQty: calc.lines[i].previousQty,
          currentQty: calc.lines[i].currentQty,
          cumulativeQty: calc.lines[i].cumulativeQty,
          currentAmount: calc.lines[i].currentAmount,
          cumulativeAmount: calc.lines[i].cumulativeAmount,
        })),
      },
    },
  });
  await tx.measurement.updateMany({ where: { id: { in: [...cur.values()].flatMap((c) => c.ids) } }, data: { clientBillId: bill.id } });
  await upsertRegister(tx, { orgId: ctx.orgId, projectId, docType: 'CLIENT_BILL', number, entityType: 'clientBill', entityId: bill.id, title: `Client bill ${billSeq}`, status: 'DRAFT', ownerId: ctx.user.id, amount: money(calc.netPayable) });
  await audit(tx, ctx, { action: 'CREATE', entityType: 'clientBill', entityId: bill.id, projectId, summary: `Client bill ${number} prepared` });
  return bill;
}
