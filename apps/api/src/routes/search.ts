import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ctxOf } from '../middleware/auth.js';
import { accessibleProjectIds } from '../services/access.js';

export const searchRouter = Router();

const PATHS: Record<string, string> = {
  purchaseOrder: '/procurement/po',
  materialRequisition: '/procurement/mr',
  purchaseRequisition: '/procurement/pr',
  grn: '/procurement/grn',
  mir: '/procurement/mir',
  rfq: '/procurement/rfq',
  supplierInvoice: '/payables/invoices',
  payment: '/payables/payments',
  expense: '/expenses',
  measurement: '/measurements',
  manpowerReport: '/manpower',
  siteDiary: '/site-diary',
  subcontract: '/subcontractors/contracts',
  contractorBill: '/subcontractor-bills',
  clientBill: '/client-billing/bills',
  variation: '/variations',
  claim: '/risks/claims',
  risk: '/risks',
  task: '/tasks',
  document: '/documents',
  transmittal: '/transmittals',
  rfi: '/transmittals/rfis',
  ncr: '/quality/ncrs',
  inspection: '/quality',
  safetyIncident: '/safety',
  budgetRevision: '/budget/revisions',
  materialIssue: '/stock/issues',
  stockCount: '/stock/counts',
  equipmentLog: '/equipment/logs',
  contract: '/contracts',
  quantityTakeoff: '/takeoff',
  evidence: '/evidence',
  poRevision: '/procurement/po',
  creditNote: '/client-billing/notes',
};

/** Global search across the document register, projects and parties the user may see. */
searchRouter.get('/', async (req, res) => {
  const ctx = ctxOf(req);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) return res.json([]);
  const ids = await accessibleProjectIds(prisma, ctx);
  const [docs, projects, parties] = await Promise.all([
    prisma.registerEntry.findMany({ where: { orgId: ctx.orgId, projectId: { in: ids }, OR: [{ number: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }] }, take: 20, orderBy: { updatedAt: 'desc' } }),
    prisma.project.findMany({ where: { id: { in: ids }, OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] }, take: 5 }),
    prisma.party.findMany({ where: { orgId: ctx.orgId, OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] }, take: 5 }),
  ]);
  res.json([
    ...projects.map((p) => ({ type: 'Project', label: `${p.code} — ${p.name}`, link: `/projects/${p.id}`, projectId: p.id })),
    ...docs.map((d) => ({ type: d.docType, label: `${d.number}${d.title ? ' — ' + d.title : ''}`, status: d.status, link: d.entityType === 'poRevision' ? `/procurement/po` : `${PATHS[d.entityType] ?? '/'}/${d.entityType === 'poRevision' ? '' : d.entityId}`, projectId: d.projectId })),
    ...parties.map((p) => ({ type: 'Party', label: p.name, link: `/materials/parties/${p.id}`, projectId: null })),
  ]);
});
