/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  D,
  money,
  qty as fmtQty,
  sum,
  priceLine,
  labourLineCost,
  calculateMeasurementQty,
  validateGrnLine,
  allowedInspectionResults,
  checklistSummary,
  type ChecklistItem,
} from '@toprock/shared';
import type { Tx } from '../lib/prisma.js';
import { businessRule, conflict, validationError } from '../lib/errors.js';
import type { AccessContext } from '../services/access.js';
import { getOrgSettings } from '../services/settings.js';
import { projectStock, stockBalance } from '../services/stock.js';
import { notify } from '../services/notifications.js';
import { addDays, toDateOnly } from '../lib/dates.js';

export interface Scope {
  orgId: string;
  projectId: string | null;
}

export interface ResourceHooks {
  /** Mutates `data` (already converted to Prisma-ready values) — compute derived fields here. */
  prepare?: (tx: Tx, ctx: AccessContext, scope: Scope, data: Record<string, any>, existing: Record<string, any> | null) => Promise<void>;
  afterSave?: (tx: Tx, ctx: AccessContext, scope: Scope, record: Record<string, any>, existing: Record<string, any> | null) => Promise<void>;
  /** Prisma include used for GET :id */
  include?: Record<string, unknown>;
}

const lines = (data: Record<string, any>, name = 'lines'): Record<string, any>[] | undefined => data[name];

async function linesOrExisting(tx: Tx, data: Record<string, any>, existing: Record<string, any> | null, model: string, fk: string, name = 'lines') {
  if (data[name]) return data[name] as Record<string, any>[];
  if (!existing) return [];
  return (tx as any)[model].findMany({ where: { [fk]: existing.id } });
}

export const HOOKS: Record<string, ResourceHooks> = {
  manpowerReports: {
    include: { lines: true },
    async prepare(tx, ctx, scope, data, existing) {
      const date = data.date ?? existing?.date;
      if (date && date > addDays(new Date(), 1)) throw validationError('Manpower cannot be reported for a future date');
      const settings = await getOrgSettings(tx, scope.orgId);
      const contractorId = data.contractorId !== undefined ? data.contractorId : existing?.contractorId;
      if (!existing) data.contractorKey = settings.manpowerUniqueness === 'PROJECT_DATE_SHIFT' ? 'ALL' : (contractorId ?? 'OWN');
      const ls = await linesOrExisting(tx, data, existing, 'manpowerLine', 'reportId');
      if (data.lines) {
        for (const l of data.lines) {
          // BUSINESS_RULES A3: subcontractor labour is costed through RA bills only.
          if (contractorId) l.chargeable = false;
          l.amount = labourLineCost({ actualCount: l.actualCount ?? 0, regularHours: l.regularHours ?? 8, overtimeHours: l.overtimeHours ?? 0, hourlyRate: l.hourlyRate ?? 0, overtimeRate: l.overtimeRate ?? 0 });
        }
      }
      data.totalWorkers = ls.reduce((a: number, l: any) => a + Number(l.actualCount ?? 0), 0);
      data.totalCost = money(sum(ls.map((l: any) => l.amount)));
    },
  },

  takeoffs: {
    async prepare(_tx, _ctx, _scope, data, existing) {
      const dims = { nos: data.nos ?? existing?.nos, length: data.length ?? existing?.length, width: data.width ?? existing?.width, depth: data.depth ?? existing?.depth };
      try {
        const r = calculateMeasurementQty(dims);
        data.quantity = r.quantity;
        data.formula = r.formula;
      } catch (e) {
        throw validationError((e as Error).message);
      }
    },
  },

  measurements: {
    include: { revisions: { orderBy: { revision: 'desc' } } },
    async prepare(tx, ctx, scope, data, existing) {
      const merged = { ...existing, ...data };
      let r;
      try {
        r = calculateMeasurementQty({ nos: merged.nos, length: merged.length, width: merged.width, depth: merged.depth });
      } catch (e) {
        throw validationError((e as Error).message);
      }
      data.calculatedQty = r.quantity;
      data.formula = r.formula;
      const boq = await tx.boqItem.findFirst({ where: { id: merged.boqItemId, projectId: scope.projectId! } });
      if (!boq) throw validationError('BOQ item not found in this project');
      data.unit = boq.unit;
      if (data.submittedQty === undefined || data.submittedQty === null) data.submittedQty = existing && data.nos === undefined && data.length === undefined ? existing.submittedQty : r.quantity;
      // Duplicate detection (BUSINESS_RULES §4)
      const dup = await tx.measurement.findFirst({
        where: {
          projectId: scope.projectId!,
          boqItemId: merged.boqItemId,
          location: merged.location ?? null,
          floor: merged.floor ?? null,
          grid: merged.grid ?? null,
          chainage: merged.chainage ?? null,
          calculatedQty: r.quantity,
          status: { notIn: ['REJECTED', 'CANCELLED'] },
          ...(existing ? { id: { not: existing.id } } : {}),
        },
        select: { number: true },
      });
      if (dup) {
        const settings = await getOrgSettings(tx, scope.orgId);
        if (settings.measurementDuplicateMode === 'BLOCK_UNLESS_REASON' && !merged.duplicateReason) {
          throw conflict(`Possible duplicate of ${dup.number} (same BOQ item, location and quantity). Provide a reason to record it anyway.`, { duplicateOf: dup.number, needsReason: true });
        }
      }
      if (existing && existing.status === 'RETURNED') {
        // Preserve history before a corrected resubmission.
        await tx.measurementRevision.create({ data: { measurementId: existing.id, revision: existing.revision + 1, snapshot: JSON.parse(JSON.stringify(existing)), reason: 'Correction after return', createdById: ctx.user.id } });
        data.revision = existing.revision + 1;
      }
    },
  },

  mrs: {
    include: { lines: true },
    async prepare(tx, _ctx, scope, data) {
      if (!data.lines) return;
      const stock = await projectStock(tx, scope.projectId!, data.lines.map((l: any) => l.materialId));
      for (const l of data.lines) l.stockAvailable = fmtQty(stock.get(l.materialId) ?? 0);
    },
  },

  prs: {
    include: { lines: true },
    async prepare(tx, _ctx, scope, data, existing) {
      if (data.mrId) {
        const mr = await tx.materialRequisition.findFirst({ where: { id: data.mrId, projectId: scope.projectId! } });
        if (!mr || mr.status !== 'APPROVED') throw businessRule('A purchase requisition can only reference an approved MR');
      }
      if (data.lines) for (const l of data.lines) l.amount = money(D(l.qty).times(D(l.estimatedRate)));
      const ls = await linesOrExisting(tx, data, existing, 'purchaseRequisitionLine', 'prId');
      data.estimatedTotal = money(sum(ls.map((l: any) => l.amount)));
    },
  },

  purchaseOrders: {
    include: { lines: { orderBy: { lineNo: 'asc' } }, revisions: { orderBy: { revisionNo: 'desc' } } },
    async prepare(tx, _ctx, scope, data, existing) {
      if (data.prId) {
        const pr = await tx.purchaseRequisition.findFirst({ where: { id: data.prId, projectId: scope.projectId! } });
        if (!pr || pr.status !== 'APPROVED') throw businessRule('A purchase order can only reference an approved PR');
      }
      if (data.lines) {
        data.lines.forEach((l: any, i: number) => {
          const p = priceLine({ quantity: l.qty, rate: l.rate, discountPct: l.discountPct ?? 0, taxRate: l.taxRate ?? 0 });
          l.lineNo = i + 1;
          l.amount = p.amount;
          l.taxAmount = p.taxAmount;
          l.discountPct = l.discountPct ?? '0';
          l.taxRate = l.taxRate ?? '0';
        });
      }
      const ls = await linesOrExisting(tx, data, existing, 'purchaseOrderLine', 'poId');
      const gross = sum(ls.map((l: any) => D(l.qty).times(D(l.rate)).toDecimalPlaces(2)));
      const net = sum(ls.map((l: any) => l.amount));
      data.subtotal = money(gross);
      data.discount = money(gross.minus(net));
      data.netAmount = money(net);
      data.taxAmount = money(sum(ls.map((l: any) => l.taxAmount)));
      data.total = money(net.plus(D(data.taxAmount)));
    },
  },

  grns: {
    include: { lines: true },
    async prepare(tx, _ctx, scope, data, existing) {
      const poId = data.poId ?? existing?.poId;
      const po = await tx.purchaseOrder.findFirst({ where: { id: poId, projectId: scope.projectId! }, include: { lines: true } });
      if (!po) throw validationError('Purchase order not found in this project');
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) throw businessRule(`Goods can only be received against an approved PO (current status ${po.status})`);
      data.supplierId = po.supplierId;
      const settings = await getOrgSettings(tx, scope.orgId);
      if (data.lines) {
        const errors: string[] = [];
        for (const l of data.lines) {
          const pl = po.lines.find((x) => x.id === l.poLineId);
          if (!pl) {
            errors.push('A received line does not belong to the selected PO');
            continue;
          }
          l.rejectedQty = l.rejectedQty ?? '0';
          l.materialId = pl.materialId;
          l.rate = pl.rate.toString();
          l.amount = money(D(l.acceptedQty).times(pl.rate));
          const errs = validateGrnLine({ orderedQty: pl.qty, previouslyAcceptedQty: pl.receivedQty, receivedQty: l.receivedQty, acceptedQty: l.acceptedQty, rejectedQty: l.rejectedQty, tolerancePct: settings.overReceiptTolerancePct });
          errors.push(...errs.map((e) => `Line ${pl.lineNo} (${pl.description}): ${e}`));
        }
        if (errors.length) throw validationError('GRN lines are invalid', { errors });
      }
      const ls = await linesOrExisting(tx, data, existing, 'grnLine', 'grnId');
      data.acceptedValue = money(sum(ls.map((l: any) => l.amount)));
    },
  },

  expenses: {
    async prepare(_tx, _ctx, _scope, data, existing) {
      const m = { ...existing, ...data };
      let base = m.amountBeforeTax;
      if ((base === null || base === undefined) && m.quantity && m.unitRate) base = money(D(m.quantity).times(D(m.unitRate)));
      if (base === null || base === undefined) throw validationError('Enter the amount before tax, or quantity and unit rate');
      data.amountBeforeTax = money(base);
      data.taxAmount = money(D(base).times(D(m.taxRate ?? 0)));
      data.total = money(D(base).plus(D(data.taxAmount)));
      if (!m.payeeId && !m.payeeName) throw validationError('Payee is required');
    },
  },

  supplierInvoices: {
    include: { lines: true },
    async prepare(tx, _ctx, scope, data, existing) {
      const m = { ...existing, ...data };
      if (m.poId) {
        const po = await tx.purchaseOrder.findFirst({ where: { id: m.poId, projectId: scope.projectId! } });
        if (!po) throw validationError('PO not found');
        if (po.supplierId !== m.supplierId) throw validationError('Invoice supplier differs from the PO supplier');
        if (data.lines) {
          const poLineIds = (await tx.purchaseOrderLine.findMany({ where: { poId: po.id }, select: { id: true } })).map((x) => x.id);
          for (const l of data.lines) if (l.poLineId && !poLineIds.includes(l.poLineId)) throw validationError('Invoice line references a line from another PO');
        }
      }
      if (data.lines) {
        for (const l of data.lines) {
          const p = priceLine({ quantity: l.qty, rate: l.rate, taxRate: l.taxRate ?? 0 });
          l.amount = p.amount;
          l.taxAmount = p.taxAmount;
          l.taxRate = l.taxRate ?? '0';
        }
      }
      const ls = await linesOrExisting(tx, data, existing, 'supplierInvoiceLine', 'invoiceId');
      data.subtotal = money(sum(ls.map((l: any) => l.amount)));
      data.taxAmount = money(sum(ls.map((l: any) => l.taxAmount)));
      data.total = money(D(data.subtotal).plus(D(data.taxAmount)));
      // Soft duplicate check: same supplier, same total, invoice date within ±3 days.
      const date: Date = m.invoiceDate;
      const similar = await tx.supplierInvoice.findFirst({
        where: {
          supplierId: m.supplierId,
          total: data.total,
          invoiceDate: { gte: addDays(date, -3), lte: addDays(date, 3) },
          status: { notIn: ['REJECTED', 'CANCELLED'] },
          ...(existing ? { id: { not: existing.id } } : {}),
        },
        select: { number: true, invoiceNo: true },
      });
      data.duplicateWarning = similar ? `Possible duplicate of ${similar.number} (supplier invoice ${similar.invoiceNo}) — same supplier, amount and date ±3 days` : null;
    },
  },

  payments: {
    include: { allocations: true },
    async prepare(tx, _ctx, scope, data, existing) {
      const direction = data.direction ?? existing?.direction;
      const partyId = data.partyId ?? existing?.partyId;
      const allocs = await linesOrExisting(tx, data, existing, 'paymentAllocation', 'paymentId', 'allocations');
      for (const a of data.allocations ?? []) {
        const targets = ['supplierInvoiceId', 'contractorBillId', 'clientBillId', 'expenseId'].filter((k) => a[k]);
        if (targets.length !== 1) throw validationError('Each allocation must reference exactly one invoice, bill or expense');
        if (direction === 'IN' && !a.clientBillId) throw validationError('Receipts (IN) can only be allocated to client bills');
        if (direction === 'OUT' && a.clientBillId) throw validationError('Payments (OUT) cannot be allocated to client bills');
        if (a.supplierInvoiceId) {
          const inv = await tx.supplierInvoice.findFirst({ where: { id: a.supplierInvoiceId, projectId: scope.projectId! } });
          if (!inv || inv.supplierId !== partyId) throw validationError('Supplier invoice not found for this party/project');
        }
        if (a.contractorBillId) {
          const b = await tx.contractorBill.findFirst({ where: { id: a.contractorBillId, projectId: scope.projectId! } });
          if (!b || b.contractorId !== partyId) throw validationError('Contractor bill not found for this party/project');
        }
        if (a.clientBillId) {
          const b = await tx.clientBill.findFirst({ where: { id: a.clientBillId, projectId: scope.projectId! } });
          if (!b) throw validationError('Client bill not found in this project');
        }
        if (a.expenseId) {
          const ex = await tx.expense.findFirst({ where: { id: a.expenseId, projectId: scope.projectId! } });
          if (!ex) throw validationError('Expense not found in this project');
        }
        a.retentionRelease = a.retentionRelease ?? false;
      }
      data.amount = money(sum(allocs.map((a: any) => a.amount)));
    },
  },

  budgetRevisions: {
    include: { lines: true },
    async prepare(tx, _ctx, _scope, data, existing) {
      const ls = await linesOrExisting(tx, data, existing, 'budgetRevisionLine', 'revisionId');
      const total = sum(ls.map((l: any) => l.delta));
      const type = data.type ?? existing?.type;
      if (type === 'TRANSFER' && !total.isZero()) throw validationError('Transfer lines must net to zero');
      if (type === 'TRANSFER' && ls.length < 2) throw validationError('A transfer needs at least two cost codes');
      data.totalDelta = money(total);
    },
  },

  subcontracts: {
    include: { items: true },
    async prepare(tx, _ctx, _scope, data, existing) {
      if (data.items) for (const i of data.items) i.amount = money(D(i.qty).times(D(i.rate)));
      const items = await linesOrExisting(tx, data, existing, 'subcontractItem', 'subcontractId', 'items');
      data.contractValue = money(sum(items.map((i: any) => i.amount)));
    },
  },

  variations: {
    include: { lines: true },
    async prepare(tx, _ctx, _scope, data, existing) {
      if (data.lines)
        for (const l of data.lines) {
          l.amount = money(D(l.qty).times(D(l.rate)));
          l.costRate = l.costRate ?? '0';
          l.costAmount = money(D(l.qty).times(D(l.costRate)));
        }
      const ls = await linesOrExisting(tx, data, existing, 'variationLine', 'variationId');
      data.revenueImpact = money(sum(ls.map((l: any) => l.amount)));
      data.costImpact = money(sum(ls.map((l: any) => l.costAmount)));
    },
  },

  risks: {
    async prepare(_tx, _ctx, _scope, data, existing) {
      const p = Number(data.probability ?? existing?.probability ?? 1);
      const i = Number(data.impact ?? existing?.impact ?? 1);
      data.score = p * i;
    },
  },

  equipmentLogs: {
    async prepare(tx, ctx, scope, data, existing) {
      const m = { ...existing, ...data };
      const total = D(m.workingHours ?? 0).plus(D(m.idleHours ?? 0)).plus(D(m.breakdownHours ?? 0));
      if (total.gt(24)) throw validationError('Working + idle + breakdown hours cannot exceed 24 per day');
      const eq = await tx.equipment.findFirst({ where: { id: m.equipmentId, orgId: scope.orgId } });
      if (!eq) throw validationError('Equipment not found');
      data.amount = eq.ownership === 'OWNED' ? money(D(m.workingHours ?? 0).times(eq.hourlyRate)) : '0.00';
    },
  },

  stockCounts: {
    include: { lines: true },
    async prepare(tx, _ctx, scope, data, existing) {
      if (!data.lines) return;
      const storeId = data.storeId ?? existing?.storeId;
      const store = await tx.store.findFirst({ where: { id: storeId, projectId: scope.projectId! } });
      if (!store) throw validationError('Store not found');
      for (const l of data.lines) {
        const bal = await stockBalance(tx, storeId, l.materialId);
        l.systemQty = bal.qty.toFixed(4);
        l.varianceQty = D(l.countedQty).minus(bal.qty).toFixed(4);
      }
    },
  },

  materialIssues: {
    include: { lines: true },
    async prepare(tx, _ctx, scope, data, existing) {
      const m = { ...existing, ...data };
      if (['ADJUSTMENT', 'WASTAGE', 'DAMAGE'].includes(m.type) && !m.reason) throw validationError('A reason is required for adjustments, wastage and damage');
      if (m.type === 'TRANSFER') {
        if (!m.toStoreId) throw validationError('Destination store is required for transfers');
        if (m.toStoreId === m.storeId) throw validationError('Destination store must differ from source store');
      }
      if (data.lines) {
        for (const l of data.lines) {
          if (m.type !== 'ADJUSTMENT' && D(l.qty).lte(0)) throw validationError('Quantities must be positive');
          const bal = await stockBalance(tx, m.storeId, l.materialId);
          const unit = bal.qty.isZero() ? D(0) : bal.value.div(bal.qty);
          l.unitCost = unit.toFixed(4);
          l.amount = money(unit.times(D(l.qty).abs()));
        }
      }
      const ls = await linesOrExisting(tx, data, existing, 'materialIssueLine', 'issueId');
      data.totalValue = money(sum(ls.map((l: any) => l.amount)));
    },
  },

  progressEntries: {
    async prepare(tx, _ctx, scope, data, existing) {
      const activityId = data.activityId ?? existing?.activityId;
      const act = await tx.activity.findFirst({ where: { id: activityId, projectId: scope.projectId! } });
      if (!act) throw validationError('Activity not found');
      if (existing) throw businessRule('Progress entries are append-only. Add a correcting entry instead.');
    },
    async afterSave(tx, _ctx, scope, record) {
      const act = await tx.activity.findUniqueOrThrow({ where: { id: record.activityId } });
      const agg = await tx.progressEntry.aggregate({ where: { activityId: act.id }, _sum: { qtyDone: true } });
      const executed = D(agg._sum.qtyDone ?? 0);
      let pct = record.percentComplete !== null && record.percentComplete !== undefined ? D(record.percentComplete) : act.plannedQty && !D(act.plannedQty).isZero() ? executed.div(act.plannedQty).times(100) : D(act.percentComplete);
      if (pct.gt(100)) pct = D(100);
      await tx.activity.update({
        where: { id: act.id },
        data: {
          executedQty: executed.toFixed(4),
          percentComplete: pct.toFixed(4),
          actualStart: act.actualStart ?? record.date,
          actualFinish: pct.gte(100) ? (act.actualFinish ?? record.date) : act.actualFinish,
          status: pct.gte(100) ? 'COMPLETED' : 'IN_PROGRESS',
        },
      });
      if (act.boqItemId) {
        const boqActs = await tx.activity.findMany({ where: { projectId: scope.projectId!, boqItemId: act.boqItemId }, select: { executedQty: true } });
        await tx.boqItem.update({ where: { id: act.boqItemId }, data: { executedQty: sum(boqActs.map((a) => a.executedQty)).toFixed(4) } });
      }
    },
  },

  tasks: {
    include: { contributors: true, dependencies: true, handovers: { orderBy: { createdAt: 'desc' } } },
    async prepare(tx, _ctx, _scope, data, existing) {
      if (data.status === 'COMPLETED' && existing?.status !== 'COMPLETED') {
        const deps = existing ? await tx.taskDependency.findMany({ where: { taskId: existing.id }, include: { dependsOn: { select: { number: true, status: true } } } }) : [];
        const open = deps.filter((d) => !['COMPLETED', 'CANCELLED'].includes(d.dependsOn.status));
        if (open.length) throw businessRule(`Blocked by incomplete dependencies: ${open.map((d) => d.dependsOn.number).join(', ')}`);
        data.completedAt = new Date();
      }
      if (data.status && data.status !== 'COMPLETED') data.completedAt = null;
      if (!existing && !data.status) data.status = data.ownerId ? 'ASSIGNED' : 'BACKLOG';
    },
    async afterSave(tx, ctx, scope, record, existing) {
      if (record.ownerId && record.ownerId !== existing?.ownerId && record.ownerId !== ctx.user.id) {
        await notify(tx, { userIds: [record.ownerId], type: 'TASK_ASSIGNED', title: `Task assigned: ${record.title}`, body: record.dueDate ? `Due ${String(record.dueDate.toISOString()).slice(0, 10)}` : undefined, link: `/tasks/${record.id}`, projectId: scope.projectId, entityType: 'task', entityId: record.id });
      }
      if (record.status === 'IN_REVIEW' && existing?.status !== 'IN_REVIEW' && record.reviewerId) {
        await notify(tx, { userIds: [record.reviewerId], type: 'TASK_REVIEW', title: `Task submitted for review: ${record.title}`, link: `/tasks/${record.id}`, projectId: scope.projectId, entityType: 'task', entityId: record.id });
      }
      if (record.status === 'CHANGES_REQUESTED' && existing?.status !== 'CHANGES_REQUESTED' && record.ownerId) {
        await notify(tx, { userIds: [record.ownerId], type: 'CHANGES_REQUESTED', title: `Changes requested: ${record.title}`, link: `/tasks/${record.id}`, projectId: scope.projectId, entityType: 'task', entityId: record.id });
      }
    },
  },

  contracts: {
    include: { clauses: true, guarantees: true },
    // Saving the form rewrites clause lines; keep the validation of clauses whose wording and
    // interpretation are unchanged. Any change to either requires validating again.
    async prepare(_tx, _ctx, _scope, data, existing) {
      const incoming = lines(data, 'clauses');
      if (!incoming || !existing?.clauses?.length) return;
      for (const c of incoming) {
        const prev = (existing.clauses as any[]).find((x) => x.clauseRef === c.clauseRef && x.sourceText === c.sourceText && (x.interpretation ?? null) === (c.interpretation ?? null));
        if (prev?.validatedAt) Object.assign(c, { validatedById: prev.validatedById, validatedAt: prev.validatedAt });
      }
    },
  },
  documents: { include: { revisions: { orderBy: { createdAt: 'desc' } } } },
  checklistTemplates: {
    include: { items: { orderBy: { lineNo: 'asc' } } },
    async prepare(_tx, _ctx, _scope, data) {
      lines(data, 'items')?.forEach((l, i) => (l.lineNo = i + 1));
    },
  },
  inspections: {
    // The overall result must agree with the checklist (see allowedInspectionResults).
    async prepare(_tx, _ctx, _scope, data, existing) {
      const items = (existing?.checklist ?? []) as ChecklistItem[];
      if (!items.length) return;
      if (data.result !== undefined && data.result !== existing!.result) {
        const allowed = allowedInspectionResults(items);
        if (!allowed.includes(data.result)) throw validationError(`With this checklist the result can only be ${allowed.join(' or ')}`);
      }
      if (data.status === 'CLOSED' && checklistSummary(items).pending) throw businessRule('Record every checklist item before closing the inspection');
    },
  },
  stores: {},
  boqItems: { include: { rateAnalysis: true } },
};

export function hooksFor(key: string): ResourceHooks {
  return HOOKS[key] ?? {};
}

export { toDateOnly };
