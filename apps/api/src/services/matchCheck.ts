/**
 * Match check for purchase documents (MR, PR, PO).
 *
 * Before an approver approves a material requisition, purchase requisition or purchase order, every line is
 * compared with what the project already agreed: the BOM quantity and rate, the MR or PR it came from, the
 * awarded quotation and the remaining budget. The approver sees one answer ("everything matches" or
 * "2 differences") with the figures behind it.
 *
 * With the organisation setting `purchaseMatchCheck` = ENFORCE (the default):
 *  - a material that is not in the project's BOM cannot be approved (reject it or add it to the BOM first);
 *  - any other difference beyond the tolerance needs a reason AND a supporting document attached to the record.
 * With WARN the check is shown but never blocks.
 *
 * Tolerances: rate = `priceTolerancePct` (2 % by default, also used by the invoice three-way match),
 * quantity = `qtyTolerancePct` (5 % by default). Only a higher rate or a larger quantity is a difference:
 * buying cheaper or less than agreed is never held up.
 */
import { D, unitFactor } from '@toprock/shared';
import type { Db } from '../lib/prisma.js';
import { businessRule } from '../lib/errors.js';
import { getOrgSettings } from './settings.js';
import { netLineRate, PURCHASED_PO_STATUSES } from './materialRates.js';

export const MATCH_DOC_TYPES = ['MR', 'PR', 'PO'] as const;
export type MatchDocType = (typeof MATCH_DOC_TYPES)[number];
export const isMatchDocType = (t: string): t is MatchDocType => (MATCH_DOC_TYPES as readonly string[]).includes(t);

/** Record type used for attachments of each document type. */
export const MATCH_ENTITY_TYPE: Record<MatchDocType, 'materialRequisition' | 'purchaseRequisition' | 'purchaseOrder'> = { MR: 'materialRequisition', PR: 'purchaseRequisition', PO: 'purchaseOrder' };

export type CheckStatus = 'ok' | 'diff' | 'block' | 'info';
export interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  /** What the document says. */
  actual?: string;
  /** What it is compared with. */
  expected?: string;
  /** (actual − expected) / expected, as a fraction. */
  diffPct?: string;
  note: string;
}
export interface MatchLine {
  lineNo: number;
  material: { id: string; code: string; name: string; unit: string } | null;
  description: string;
  qty: string;
  unit: string;
  rate: string | null;
  status: CheckStatus;
  checks: Check[];
}
export interface MatchResult {
  docType: MatchDocType;
  entityId: string;
  number: string;
  mode: 'ENFORCE' | 'WARN';
  tolerances: { ratePct: string; qtyPct: string };
  /** MATCH: nothing to look at. DIFF: differences beyond tolerance. BLOCKED: material outside the BOM. */
  status: 'MATCH' | 'DIFF' | 'BLOCKED';
  summary: string;
  lines: MatchLine[];
  /** Checks on the document as a whole (budget: a warning only, see the budget check setting). */
  documentChecks: Check[];
  counts: { ok: number; diff: number; block: number };
  attachments: number;
  /** What approving needs under the current mode. */
  approval: { allowed: boolean; needsReason: boolean; needsAttachment: boolean; message: string };
}

const q = (v: ReturnType<typeof D>) => v.toDecimalPlaces(4).toString();
const pct = (actual: ReturnType<typeof D>, expected: ReturnType<typeof D>) => (expected.isZero() ? null : actual.minus(expected).div(expected));
const fmtPct = (f: ReturnType<typeof D>) => `${f.times(100).toDecimalPlaces(1).toString()}%`;

/** Statuses of an MR that still claim quantity (not drafts, returned, rejected or cancelled ones). */
const INACTIVE_MR = ['DRAFT', 'RETURNED', 'REJECTED', 'CANCELLED'];
/** POs that already order quantity, approved or awaiting approval. */
const ORDERING_PO = [...PURCHASED_PO_STATUSES, 'SUBMITTED'];

interface BomFacts {
  /** Required quantity in the material's unit (BOM total incl. wastage). */
  required: ReturnType<typeof D>;
  /** BOM rate per material unit, when every BOM line of the material is priced. */
  rate: ReturnType<typeof D> | null;
  refs: string[];
  unitIssue: boolean;
}

async function bomFacts(db: Db, projectId: string, materials: Array<{ id: string; unit: string }>): Promise<Map<string, BomFacts>> {
  const ids = materials.map((m) => m.id);
  const lines = ids.length ? await db.bomLine.findMany({ where: { bomItem: { projectId }, kind: 'MATERIAL', materialId: { in: ids } }, select: { materialId: true, totalQty: true, unit: true, amount: true, bomItem: { select: { refCode: true } } } }) : [];
  const out = new Map<string, BomFacts>();
  for (const m of materials) {
    const mine = lines.filter((l) => l.materialId === m.id);
    if (!mine.length) continue;
    let required = D(0);
    let amount = D(0);
    let priced = 0;
    let unitIssue = false;
    for (const l of mine) {
      const f = unitFactor(l.unit, m.unit);
      if (!f) {
        unitIssue = true;
        continue;
      }
      required = required.plus(D(l.totalQty).times(f));
      if (l.amount !== null) {
        amount = amount.plus(D(l.amount));
        priced++;
      }
    }
    const fullyPriced = !unitIssue && priced === mine.length;
    out.set(m.id, { required, rate: fullyPriced && !required.isZero() ? amount.div(required) : null, refs: [...new Set(mine.map((l) => l.bomItem.refCode))], unitIssue });
  }
  return out;
}

/** Quantity of each material (in its own unit) already claimed by other MRs and by POs of the project. */
async function alreadyClaimed(db: Db, projectId: string, materials: Array<{ id: string; unit: string }>, exclude: { mrId?: string; poId?: string }) {
  const ids = materials.map((m) => m.id);
  const unitOf = new Map(materials.map((m) => [m.id, m.unit]));
  const [mrLines, poLines] = ids.length
    ? await Promise.all([
        db.materialRequisitionLine.findMany({ where: { materialId: { in: ids }, mr: { projectId, status: { notIn: INACTIVE_MR }, ...(exclude.mrId ? { id: { not: exclude.mrId } } : {}) } }, select: { materialId: true, qty: true, unit: true } }),
        db.purchaseOrderLine.findMany({ where: { materialId: { in: ids }, po: { projectId, status: { in: ORDERING_PO }, ...(exclude.poId ? { id: { not: exclude.poId } } : {}) } }, select: { materialId: true, qty: true, unit: true } }),
      ])
    : [[], []];
  const sum = (rows: Array<{ materialId: string | null; qty: unknown; unit: string }>) => {
    const m = new Map<string, ReturnType<typeof D>>();
    for (const r of rows) {
      if (!r.materialId) continue;
      const f = unitFactor(r.unit, unitOf.get(r.materialId)) ?? D(1);
      m.set(r.materialId, (m.get(r.materialId) ?? D(0)).plus(D(r.qty as string).times(f)));
    }
    return m;
  };
  const byMr = sum(mrLines);
  const byPo = sum(poLines);
  // Requests flow MR → PR → PO, so the same quantity can appear on an MR and on a PO: take the larger of the two.
  return new Map(ids.map((id) => {
    const a = byMr.get(id) ?? D(0);
    const b = byPo.get(id) ?? D(0);
    return [id, { qty: a.gt(b) ? a : b, onMrs: a, onPos: b }];
  }));
}

function worst(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('block')) return 'block';
  if (statuses.includes('diff')) return 'diff';
  return 'ok';
}

type BudgetCheck = { exceeded: boolean; lines: Array<{ costCode: string; available: string; requested: string; after: string; exceeded: boolean }> };

interface RawLine {
  lineNo: number;
  materialId: string | null;
  description: string;
  qty: string;
  unit: string;
  rate: string | null;
  /** Source quantity to compare with (MR qty for a PR line, PR line qty for a PO line), in the line's unit. */
  sourceQty?: { qty: string; unit: string; label: string } | null;
  /** Awarded quotation rate for a PO line, in the line's unit. */
  quotedRate?: { rate: string; unit: string; label: string } | null;
}

/** Runs the match check for one MR, PR or PO. */
export async function matchCheck(db: Db, orgId: string, docType: MatchDocType, entityId: string): Promise<MatchResult> {
  const settings = await getOrgSettings(db, orgId);
  const rateTol = D(settings.priceTolerancePct);
  const qtyTol = D(settings.qtyTolerancePct);
  let projectId: string;
  let number: string;
  let raw: RawLine[] = [];
  let budgetCheck = null as BudgetCheck | null;
  const exclude: { mrId?: string; poId?: string } = {};

  if (docType === 'MR') {
    const mr = await db.materialRequisition.findUniqueOrThrow({ where: { id: entityId }, include: { lines: true } });
    projectId = mr.projectId;
    number = mr.number;
    exclude.mrId = mr.id;
    raw = mr.lines.map((l, i) => ({ lineNo: i + 1, materialId: l.materialId, description: l.specification ?? '', qty: l.qty.toString(), unit: l.unit, rate: null }));
  } else if (docType === 'PR') {
    const pr = await db.purchaseRequisition.findUniqueOrThrow({ where: { id: entityId }, include: { lines: true, mr: { include: { lines: true } } } });
    projectId = pr.projectId;
    number = pr.number;
    budgetCheck = pr.budgetCheck as BudgetCheck | null;
    // The PR's own MR is the source of its quantity; it must not count against the BOM a second time.
    if (pr.mrId) exclude.mrId = pr.mrId;
    raw = pr.lines.map((l, i) => {
      const src = pr.mr?.lines.filter((m) => m.materialId === l.materialId) ?? [];
      const srcQty = src.reduce((a, m) => a.plus(D(m.qty).times(unitFactor(m.unit, l.unit) ?? D(1))), D(0));
      return { lineNo: i + 1, materialId: l.materialId, description: l.description ?? '', qty: l.qty.toString(), unit: l.unit, rate: l.estimatedRate.toString(), sourceQty: pr.mr ? { qty: q(srcQty), unit: l.unit, label: `MR ${pr.mr.number}` } : null };
    });
  } else {
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: entityId }, include: { lines: { orderBy: { lineNo: 'asc' } }, pr: { include: { lines: true } } } });
    projectId = po.projectId;
    number = po.number;
    budgetCheck = po.budgetCheck as BudgetCheck | null;
    exclude.poId = po.id;
    if (po.pr?.mrId) exclude.mrId = po.pr.mrId;
    const quotation = po.quotationId ? await db.quotation.findUnique({ where: { id: po.quotationId }, include: { lines: true, supplier: { select: { name: true } } } }) : null;
    raw = po.lines.map((l) => {
      const prLine = l.prLineId ? po.pr?.lines.find((p) => p.id === l.prLineId) : undefined;
      const qLine = quotation?.lines.find((x) => (l.prLineId && x.prLineId === l.prLineId) || (!l.prLineId && x.materialId === l.materialId));
      const prUnit = prLine ? unitFactor(prLine.unit, l.unit) ?? D(1) : D(1);
      return {
        lineNo: l.lineNo,
        materialId: l.materialId,
        description: l.description,
        qty: l.qty.toString(),
        unit: l.unit,
        rate: q(netLineRate(l)),
        sourceQty: prLine ? { qty: q(D(prLine.qty).times(prUnit)), unit: l.unit, label: `PR ${po.pr!.number}` } : null,
        // Quotation lines carry the PR line's unit.
        quotedRate: qLine ? { rate: q(D(qLine.rate).div(prLine ? prUnit : D(1))), unit: l.unit, label: `quotation of ${quotation!.supplier.name}` } : null,
      };
    });
  }

  const materialIds = [...new Set(raw.map((l) => l.materialId).filter((x): x is string => !!x))];
  const materials = materialIds.length ? await db.material.findMany({ where: { id: { in: materialIds } }, select: { id: true, code: true, name: true, unit: true } }) : [];
  const matById = new Map(materials.map((m) => [m.id, m]));
  const [bom, claimed, stock, bomCount] = await Promise.all([
    bomFacts(db, projectId, materials),
    alreadyClaimed(db, projectId, materials, exclude),
    docType === 'MR' && materialIds.length ? db.stockTransaction.groupBy({ by: ['materialId'], where: { projectId, materialId: { in: materialIds } }, _sum: { qty: true } }) : Promise.resolve([]),
    db.bomItem.count({ where: { projectId } }),
  ]);
  const stockOf = new Map(stock.map((s) => [s.materialId, D(s._sum.qty ?? 0)]));
  // The same material can sit on several lines of one document; the BOM balance check uses their total.
  const thisDocQty = new Map<string, ReturnType<typeof D>>();
  for (const l of raw) {
    const m = l.materialId ? matById.get(l.materialId) : undefined;
    if (!m) continue;
    thisDocQty.set(m.id, (thisDocQty.get(m.id) ?? D(0)).plus(D(l.qty).times(unitFactor(l.unit, m.unit) ?? D(1))));
  }

  const lines: MatchLine[] = raw.map((l) => {
    const m = l.materialId ? matById.get(l.materialId) ?? null : null;
    const checks: Check[] = [];
    const facts = m ? bom.get(m.id) : undefined;
    if (!m) {
      checks.push({ key: 'bom', label: 'In BOM', status: 'block', note: 'This line has no material from the material list, so it cannot be checked against the BOM. Pick the material on the line.' });
    } else if (!facts) {
      checks.push({ key: 'bom', label: 'In BOM', status: 'block', note: bomCount ? `${m.code} is not in this project's BOM. Add it to the BOM (BOQ → BOM) or reject this line.` : "This project has no BOM yet. Import the BOM (BOQ → BOM) before purchase documents can be approved." });
    } else {
      checks.push({ key: 'bom', label: 'In BOM', status: 'ok', note: `BOM ${facts.refs.slice(0, 4).join(', ')}${facts.refs.length > 4 ? '…' : ''}` });
      const f = unitFactor(l.unit, m.unit);
      if (!f) {
        checks.push({ key: 'unit', label: 'Unit', status: 'diff', actual: l.unit, expected: m.unit, note: `Unit ${l.unit} cannot be compared with the material unit ${m.unit}.` });
      } else {
        // Quantity against the BOM: everything already requested or ordered plus this document.
        const before = claimed.get(m.id)?.qty ?? D(0);
        const total = before.plus(thisDocQty.get(m.id) ?? D(0));
        const over = pct(total, facts.required);
        const balance = facts.required.minus(before);
        const qtyNote = `BOM ${q(facts.required)} ${m.unit}; already requested/ordered ${q(before)}; balance ${q(balance.isNegative() ? D(0) : balance)}.`;
        if (facts.unitIssue) checks.push({ key: 'bomQty', label: 'BOM quantity', status: 'diff', note: `Some BOM lines of ${m.code} use a unit that cannot be converted to ${m.unit}; check them on the BOM.` });
        else if (over !== null && over.gt(qtyTol)) checks.push({ key: 'bomQty', label: 'BOM quantity', status: 'diff', actual: q(total), expected: q(facts.required), diffPct: q(over), note: `Total ${q(total)} ${m.unit} is ${fmtPct(over)} above the BOM. ${qtyNote}` });
        else checks.push({ key: 'bomQty', label: 'BOM quantity', status: 'ok', actual: q(total), expected: q(facts.required), note: qtyNote });

        if (l.rate !== null) {
          if (facts.rate) {
            const ref = facts.rate.times(f); // per line unit
            const d = pct(D(l.rate), ref)!;
            if (d.gt(rateTol)) checks.push({ key: 'bomRate', label: 'BOM rate', status: 'diff', actual: l.rate, expected: q(ref), diffPct: q(d), note: `Rate ${l.rate} is ${fmtPct(d)} above the BOM rate ${q(ref)} per ${l.unit}.` });
            else checks.push({ key: 'bomRate', label: 'BOM rate', status: 'ok', actual: l.rate, expected: q(ref), diffPct: q(d), note: d.isNegative() ? `Below the BOM rate by ${fmtPct(d.negated())}.` : 'Within the BOM rate.' });
          } else {
            checks.push({ key: 'bomRate', label: 'BOM rate', status: 'info', note: 'The BOM has no rate for this material, so the rate is not compared with it.' });
          }
        }
      }
      if (docType === 'MR') {
        const s = stockOf.get(m.id);
        if (s && s.gt(0)) checks.push({ key: 'stock', label: 'Store stock', status: 'info', actual: q(s), note: `Stores of this project hold ${q(s)} ${m.unit} already.` });
      }
    }
    if (l.sourceQty) {
      const d = pct(D(l.qty), D(l.sourceQty.qty));
      if (d === null || d.gt(qtyTol)) checks.push({ key: 'sourceQty', label: `Qty vs ${l.sourceQty.label.split(' ')[0]}`, status: 'diff', actual: l.qty, expected: l.sourceQty.qty, diffPct: d ? q(d) : undefined, note: `Qty ${l.qty} ${l.unit} is ${d ? `${fmtPct(d)} above` : 'not on'} ${l.sourceQty.label} (${l.sourceQty.qty}).` });
      else checks.push({ key: 'sourceQty', label: `Qty vs ${l.sourceQty.label.split(' ')[0]}`, status: 'ok', actual: l.qty, expected: l.sourceQty.qty, note: `Matches ${l.sourceQty.label}.` });
    }
    if (l.quotedRate && l.rate !== null) {
      const d = pct(D(l.rate), D(l.quotedRate.rate))!;
      if (d.gt(rateTol)) checks.push({ key: 'quoteRate', label: 'Quotation rate', status: 'diff', actual: l.rate, expected: l.quotedRate.rate, diffPct: q(d), note: `Rate ${l.rate} is ${fmtPct(d)} above the awarded ${l.quotedRate.label} (${l.quotedRate.rate}).` });
      else checks.push({ key: 'quoteRate', label: 'Quotation rate', status: 'ok', actual: l.rate, expected: l.quotedRate.rate, diffPct: q(d), note: `Matches the ${l.quotedRate.label}.` });
    }
    return { lineNo: l.lineNo, material: m, description: l.description || m?.name || '', qty: l.qty, unit: l.unit, rate: l.rate, status: worst(checks.map((c) => c.status)), checks };
  });

  const documentChecks: Check[] = [];
  if (budgetCheck) {
    const over = budgetCheck.lines.filter((b) => b.exceeded);
    // Budget has its own rule (Settings → budget check: warn or block at submission), so here it is a warning
    // for the approver and never a second gate.
    documentChecks.push(over.length ? { key: 'budget', label: 'Budget', status: 'info', note: `Exceeds the remaining budget on ${over.map((b) => b.costCode).join(', ')} (budget check setting: ${settings.budgetCheckMode.toLowerCase()}).` } : { key: 'budget', label: 'Budget', status: 'ok', note: 'Within the remaining budget.' });
  }

  const all = [...lines.map((l) => l.status), ...documentChecks.map((c) => c.status)];
  const counts = { ok: lines.filter((l) => l.status === 'ok').length, diff: all.filter((s) => s === 'diff').length, block: all.filter((s) => s === 'block').length };
  const status: MatchResult['status'] = counts.block ? 'BLOCKED' : counts.diff ? 'DIFF' : 'MATCH';
  const attachments = await db.attachment.count({ where: { entityType: MATCH_ENTITY_TYPE[docType], entityId } });
  const mode = settings.purchaseMatchCheck;
  const overBudget = documentChecks.some((c) => c.key === 'budget' && c.status === 'info');
  const summary =
    (status === 'MATCH'
      ? 'Everything matches the BOM, source document and quotation'
      : status === 'BLOCKED'
        ? `${counts.block} line${counts.block === 1 ? '' : 's'} not in the BOM`
        : `${counts.diff} difference${counts.diff === 1 ? '' : 's'} beyond tolerance`) + (overBudget ? '; over the remaining budget.' : '.');
  let approval: MatchResult['approval'];
  if (mode === 'WARN' || status === 'MATCH') approval = { allowed: true, needsReason: false, needsAttachment: false, message: status === 'MATCH' ? 'Everything matches. You can approve.' : 'Differences are shown for information only (setting: warn).' };
  else if (status === 'BLOCKED') approval = { allowed: false, needsReason: false, needsAttachment: false, message: 'Materials outside the BOM cannot be approved. Reject the document, or add the material to the BOM first.' };
  else approval = { allowed: true, needsReason: true, needsAttachment: attachments === 0, message: attachments ? 'Approving needs a reason for the differences.' : 'Approving needs a reason for the differences and a supporting document attached to this record.' };

  return { docType, entityId, number, mode, tolerances: { ratePct: rateTol.toString(), qtyPct: qtyTol.toString() }, status, summary, lines, documentChecks, counts, attachments, approval };
}

/** Enforces the match check when an approver approves; returns the result for the audit trail (null when not applicable). */
export async function assertMatchApprovable(db: Db, orgId: string, docType: string, entityId: string, comment: string | undefined) {
  if (!isMatchDocType(docType)) return null;
  const r = await matchCheck(db, orgId, docType, entityId);
  if (r.mode === 'WARN' || r.status === 'MATCH') return r;
  const issues = r.lines.flatMap((l) => l.checks.filter((c) => c.status === 'diff' || c.status === 'block').map((c) => `Line ${l.lineNo}${l.material ? ` ${l.material.code}` : ''}: ${c.note}`));
  const docIssues = r.documentChecks.filter((c) => c.status === 'diff' || c.status === 'info').map((c) => c.note);
  if (r.status === 'BLOCKED') throw businessRule(`Cannot approve ${r.number}: ${r.approval.message}`, { matchCheck: { status: r.status, issues: [...issues, ...docIssues] } });
  const missing = [!comment?.trim() || comment.trim().length < 5 ? 'a reason (comment)' : null, r.attachments === 0 ? 'a supporting document attached to the record' : null].filter(Boolean);
  if (missing.length) throw businessRule(`${r.number} does not match the BOM / source document / quotation (${r.summary.replace(/\.$/, '').toLowerCase()}). To approve, give ${missing.join(' and ')}; otherwise reject it or leave it pending.`, { matchCheck: { status: r.status, issues: [...issues, ...docIssues] } });
  return r;
}
