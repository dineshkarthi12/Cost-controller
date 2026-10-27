/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/crypto.js';
import { bootstrapOrganisation } from '../src/services/bootstrap.js';

export const app = createApp();
export const PASSWORD = 'Test-Password-1!';
export { prisma };

export interface Res {
  status: number;
  body: any;
}
export interface Client {
  email: string;
  get: (p: string) => Promise<Res>;
  post: (p: string, body?: unknown) => Promise<Res>;
  patch: (p: string, body?: unknown) => Promise<Res>;
  put: (p: string, body?: unknown) => Promise<Res>;
  del: (p: string) => Promise<Res>;
  /** Same calls, but throw unless the response is 2xx; return the body. */
  ok: { get: (p: string) => Promise<any>; post: (p: string, body?: unknown) => Promise<any>; patch: (p: string, body?: unknown) => Promise<any>; put: (p: string, body?: unknown) => Promise<any> };
}

export async function login(email: string, password = PASSWORD): Promise<Client> {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email, password });
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status} ${JSON.stringify(r.body)}`);
  const wrap = (m: 'get' | 'post' | 'patch' | 'put' | 'delete') => async (p: string, body?: unknown): Promise<Res> => {
    let req = agent[m](`/api${p}`).set('X-Requested-With', 'toprock');
    if (body !== undefined) req = req.send(body as object);
    const res = await req;
    return { status: res.status, body: res.body };
  };
  const strict = (fn: (p: string, b?: unknown) => Promise<Res>, label: string) => async (p: string, b?: unknown) => {
    const r = await fn(p, b);
    if (r.status >= 300) throw new Error(`${email} ${label} ${p} → ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const c = { email, get: wrap('get'), post: wrap('post'), patch: wrap('patch'), put: wrap('put'), del: wrap('delete') } as Client;
  c.ok = { get: strict(c.get, 'GET'), post: strict(c.post, 'POST'), patch: strict(c.patch, 'PATCH'), put: strict(c.put, 'PUT') };
  return c;
}

let seq = 0;
const ROLES = {
  admin: ['SUPER_ADMIN'],
  cc: ['COST_CONTROL_LEAD'],
  pm: ['PROJECT_MANAGER'],
  pd: ['PROJECT_DIRECTOR'],
  qs: ['QUANTITY_SURVEYOR'],
  proc: ['PROCUREMENT_OFFICER', 'STOREKEEPER'],
  se: ['SITE_ENGINEER'],
  se2: ['SITE_ENGINEER'],
  fin: ['FINANCE_OFFICER'],
  ap: ['FINANCE_OFFICER'],
  bill: ['BILLING_ENGINEER', 'SUBCONTRACTOR_MANAGER'],
  outsider: ['SITE_ENGINEER'],
  auditor: ['AUDITOR'],
} as const;
export type Who = keyof typeof ROLES;

/** Today shifted by `offset` days, as YYYY-MM-DD (UTC). */
export function day(offset = 0) {
  const t = new Date();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) + offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A fresh organisation with one project, users for every role, masters, cost codes and a baselined budget.
 * Every file gets its own organisation, so tests do not depend on each other.
 */
export async function setupWorld() {
  const tag = `T${process.pid}${Date.now().toString(36)}${seq++}`.toUpperCase();
  const org = await bootstrapOrganisation(prisma, { code: tag, name: `Test org ${tag}` });
  const hash = await hashPassword(PASSWORD);
  const users = {} as Record<Who, { id: string; email: string }>;
  for (const [key, roleCodes] of Object.entries(ROLES) as Array<[Who, readonly string[]]>) {
    const roles = await prisma.role.findMany({ where: { orgId: org.id, code: { in: [...roleCodes] } } });
    users[key] = await prisma.user.create({ data: { orgId: org.id, email: `${key}.${tag.toLowerCase()}@test.example`, name: `${key} ${tag}`, passwordHash: hash, roles: { create: roles.map((r) => ({ roleId: r.id })) } } });
  }
  const c = {} as Record<Who, Client>;
  for (const k of Object.keys(ROLES) as Who[]) c[k] = await login(users[k].email);
  const A = c.admin.ok;
  const supplier = await A.post('/org/r/parties', { code: `SUP-${tag}`, name: 'Test Supplier', kinds: ['SUPPLIER'], isApproved: true });
  const sub = await A.post('/org/r/parties', { code: `SUB-${tag}`, name: 'Test Subcontractor', kinds: ['SUBCONTRACTOR'], isApproved: true });
  const client = await A.post('/org/r/parties', { code: `CLI-${tag}`, name: 'Test Client', kinds: ['CLIENT'], isApproved: true });
  const cement = await A.post('/org/r/materials', { code: `CEM-${tag}`, name: 'Cement', category: 'Cement', unit: 'BAG', standardRate: '400' });
  const project = await A.post('/projects', { code: tag.slice(-8), name: `Project ${tag}`, template: 'NONE', clientId: client.id, contractValue: '20000000', contractType: 'ITEM_RATE', currency: 'INR', taxRate: '0.18', retentionPct: '0.05', startDate: day(-60), plannedCompletionDate: day(300), status: 'ACTIVE' });
  const P = `/projects/${project.id}`;
  for (const k of ['cc', 'pm', 'pd', 'qs', 'proc', 'se', 'se2', 'fin', 'ap', 'bill'] as Who[]) await A.post(`${P}/members`, { userId: users[k].id });
  const material = await A.post(`${P}/r/costCodes`, { code: 'MAT-01', name: 'Materials', category: 'MATERIAL' });
  const subcon = await A.post(`${P}/r/costCodes`, { code: 'SUB-01', name: 'Subcontract works', category: 'SUBCONTRACT' });
  const other = await A.post(`${P}/r/costCodes`, { code: 'OH-01', name: 'Overheads', category: 'OVERHEAD' });
  await c.cc.ok.put(`${P}/budget/lines`, { lines: [{ costCodeId: material.id, originalAmount: '1000000' }, { costCodeId: subcon.id, originalAmount: '3000000' }, { costCodeId: other.id, originalAmount: '500000' }] });
  await c.pd.ok.post(`${P}/budget/baseline`);
  const store = await A.post(`${P}/r/stores`, { code: 'MAIN', name: 'Main store' });
  return { tag, org, users, c, P, project, supplier, sub, client, cement, store, cc: { material, subcon, other } };
}
export type World = Awaited<ReturnType<typeof setupWorld>>;

/** Approves the pending request for an entity through each listed approver in turn. */
export async function approveAll(w: World, entityId: string, approvers: Who[], comment = 'ok') {
  for (const who of approvers) {
    const inbox: any[] = await w.c[who].ok.get('/approvals/inbox');
    const r = inbox.find((x) => x.entityId === entityId);
    if (!r) throw new Error(`${who} has no pending approval for ${entityId}; inbox=${JSON.stringify(inbox.map((x) => x.entityId))}`);
    await w.c[who].ok.post(`/approvals/${r.id}/approve`, { comment });
  }
}

/** Sum of ledger entries by kind, optionally for one cost code. */
export async function ledger(projectId: string, costCodeId?: string) {
  const rows = await prisma.costLedgerEntry.groupBy({ by: ['kind'], where: { projectId, ...(costCodeId ? { costCodeId } : {}) }, _sum: { amount: true } });
  const out: Record<string, string> = { COMMITMENT: '0.00', ACCRUAL: '0.00', ACTUAL: '0.00' };
  for (const r of rows) out[r.kind] = Number(r._sum.amount ?? 0).toFixed(2);
  return out;
}

/** MR → PR → PO with one line, approved. Returns the approved PO (with lines). */
export async function approvedPo(w: World, opts: { qty: string; rate: string; taxRate?: string }) {
  const { c, P } = w;
  const mr = await c.se.ok.post(`${P}/r/mrs`, { department: 'Site', requiredBy: day(10), priority: 'MEDIUM', costCodeId: w.cc.material.id, justification: 'Test', lines: [{ materialId: w.cement.id, qty: opts.qty, unit: 'BAG' }] });
  await c.se.ok.post(`${P}/r/mrs/${mr.id}/submit`);
  await approveAll(w, mr.id, ['pm']);
  const pr = await c.proc.ok.post(`${P}/procurement/pr-from-mr/${mr.id}`, { costCodeId: w.cc.material.id });
  await c.proc.ok.post(`${P}/r/prs/${pr.id}/submit`);
  const prApprovers: Who[] = Number(opts.qty) * Number(opts.rate) >= 500000 ? ['pm', 'cc'] : ['pm'];
  await approveAll(w, pr.id, prApprovers);
  const po = await c.proc.ok.post(`${P}/procurement/po-from-pr/${pr.id}`, { supplierId: w.supplier.id });
  const full = await c.proc.ok.get(`${P}/r/purchaseOrders/${po.id}`);
  await c.proc.ok.patch(`${P}/r/purchaseOrders/${po.id}`, { orderDate: day(0), lines: full.lines.map((l: any) => ({ materialId: l.materialId, description: l.description, qty: l.qty, unit: l.unit, rate: opts.rate, discountPct: '0', taxRate: opts.taxRate ?? '0.18', costCodeId: l.costCodeId, prLineId: l.prLineId })) });
  await c.proc.ok.post(`${P}/r/purchaseOrders/${po.id}/submit`);
  const net = Number(opts.qty) * Number(opts.rate);
  await approveAll(w, po.id, net >= 10_000_000 ? ['pm', 'cc', 'pd'] : net >= 1_000_000 ? ['pm', 'cc'] : ['pm']);
  return c.proc.ok.get(`${P}/r/purchaseOrders/${po.id}`);
}
