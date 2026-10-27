/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Seed script.
 *  • Always: permission catalogue, default roles, document types, units, workflows, admin user.
 *  • Demo (SEED_DEMO !== 'false'): a clearly flagged DEMO organisation dataset created by
 *    driving the real HTTP API as each demo user, so every ledger entry, approval and
 *    audit event comes from the same business rules as production use.
 *
 * Demo passwords come from SEED_PASSWORD (default for local development only).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/crypto.js';
import { bootstrapOrganisation } from '../src/services/bootstrap.js';
import { storageAvailable } from '../src/services/storage.js';
import { createApp } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// The development default must never reach a production database.
if ((process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') && !process.env.SEED_PASSWORD) throw new Error('Set SEED_PASSWORD (min. 12 characters) to seed in production');
// Trim: values pasted into hosting dashboards often carry a trailing space or newline.
const PASSWORD = process.env.SEED_PASSWORD?.trim() || 'Toprock@2025!';
if (process.env.SEED_PASSWORD && process.env.SEED_PASSWORD !== PASSWORD) console.warn('⚠ SEED_PASSWORD had leading/trailing spaces; they were removed.');
if (PASSWORD.length < 12) throw new Error('SEED_PASSWORD must be at least 12 characters');
const DEMO = process.env.SEED_DEMO !== 'false';
const DOMAIN = 'toprock.example';

const today = new Date();
const d = (offset: number) => {
  const x = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) + offset * 86_400_000);
  return x.toISOString().slice(0, 10);
};

const L = (n: number) => String(Math.round(n * 100_000));
const CR = (n: number) => String(Math.round(n * 10_000_000));

const app = createApp();

type Agent = {
  get: (p: string) => Promise<any>;
  post: (p: string, body?: unknown) => Promise<any>;
  patch: (p: string, body?: unknown) => Promise<any>;
  put: (p: string, body?: unknown) => Promise<any>;
  upload: (p: string, files: string[], fields: Record<string, string>) => Promise<any>;
};

const agents = new Map<string, Agent>();

async function as(user: string): Promise<Agent> {
  if (agents.has(user)) return agents.get(user)!;
  const agent = request.agent(app);
  const email = `${user}@${DOMAIN}`;
  const r = await agent.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  const check = (method: string, p: string) => (res: request.Response) => {
    if (res.status >= 300) throw new Error(`${user} ${method} ${p} → ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const a: Agent = {
    get: (p) => agent.get(`/api${p}`).set('X-Requested-With', 'toprock').then(check('GET', p)),
    post: (p, body) => agent.post(`/api${p}`).set('X-Requested-With', 'toprock').send((body ?? {}) as object).then(check('POST', p)),
    patch: (p, body) => agent.patch(`/api${p}`).set('X-Requested-With', 'toprock').send((body ?? {}) as object).then(check('PATCH', p)),
    put: (p, body) => agent.put(`/api${p}`).set('X-Requested-With', 'toprock').send((body ?? {}) as object).then(check('PUT', p)),
    upload: (p, files, fields) => {
      let req = agent.post(`/api${p}`).set('X-Requested-With', 'toprock');
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      for (const f of files) req = req.attach('files', f);
      return req.then(check('UPLOAD', p));
    },
  };
  agents.set(user, a);
  return a;
}

/** Walks an approval request through its steps with the given approvers (in order). */
async function approve(entityId: string, approvers: string[], comment = 'Approved') {
  for (const u of approvers) {
    const inbox: any[] = await (await as(u)).get('/approvals/inbox');
    const r = inbox.find((x) => x.entityId === entityId);
    if (r) await (await as(u)).post(`/approvals/${r.id}/approve`, { comment });
  }
}

async function createUser(orgId: string, u: { key: string; email?: string; name: string; designation: string; department: string; roles: string[]; employeeId: string; approvalLimit?: string | null; skills?: string[]; responsibilities?: string }) {
  const roles = await prisma.role.findMany({ where: { orgId, code: { in: u.roles } } });
  const email = u.email ?? `${u.key}@${DOMAIN}`;
  return prisma.user.upsert({
    where: { email },
    create: {
      orgId,
      email,
      name: u.name,
      designation: u.designation,
      department: u.department,
      employeeId: u.employeeId,
      passwordHash: await hashPassword(PASSWORD),
      approvalLimit: u.approvalLimit ?? null,
      skills: u.skills ?? [],
      responsibilities: u.responsibilities ?? null,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
    update: {},
  });
}

async function main() {
  const org = await bootstrapOrganisation(prisma, { code: 'TOPROCK', name: 'TOPROCK GLOBAL', isDemo: DEMO });
  const admin = await createUser(org.id, { key: 'admin', name: 'System Administrator', designation: 'Administrator', department: 'IT', roles: ['SUPER_ADMIN'], employeeId: 'TRG-0001' });
  console.log(`✔ Reference data ready (org ${org.code}). Admin: ${admin.email}`);
  // Optional: your own administrator login (same password). Existing users are never modified.
  const ownEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (ownEmail && ownEmail !== admin.email) {
    if (!/^\S+@\S+\.\S+$/.test(ownEmail)) throw new Error('ADMIN_EMAIL is not a valid email address');
    const own = await createUser(org.id, { key: 'owner', email: ownEmail, name: process.env.ADMIN_NAME?.trim() || 'Administrator', designation: 'Administrator', department: 'Management', roles: ['SUPER_ADMIN'], employeeId: 'TRG-0000' });
    console.log(`✔ Administrator: ${own.email}`);
  }
  // Recovery: RESET_ADMIN_PASSWORD=true sets the administrators' password to SEED_PASSWORD, unlocks
  // them and signs them out everywhere. Remove the variable after use.
  if (/^(true|1|yes)$/i.test(process.env.RESET_ADMIN_PASSWORD?.trim() ?? '')) {
    const emails = [admin.email, ...(ownEmail ? [ownEmail] : [])];
    const hash = await hashPassword(PASSWORD);
    for (const email of emails) {
      const u = await prisma.user.update({ where: { email }, data: { passwordHash: hash, failedLogins: 0, lockedUntil: null, status: 'ACTIVE', passwordChangedAt: new Date() } });
      await prisma.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await prisma.auditEvent.create({ data: { orgId: org.id, actorId: null, action: 'ADMIN_PASSWORD_RESET', entityType: 'user', entityId: u.id, summary: `${email}: password reset and account unlocked by deployment setting RESET_ADMIN_PASSWORD` } });
      console.log(`✔ Password reset and account unlocked: ${email} (password length ${PASSWORD.length})`);
    }
  }
  if (!DEMO) return;
  if (await prisma.project.count({ where: { orgId: org.id } })) {
    console.log('Demo data already present — skipping. Run `npm run db:reset` to rebuild.');
    return;
  }

  // ───────── People (responsibility templates from the brief) ─────────
  const people = [
    { key: 'dinesh.kumar', name: 'Dinesh Kumar', designation: 'Cost Control Lead', department: 'Cost Control', roles: ['COST_CONTROL_LEAD'], employeeId: 'TRG-1001', skills: ['Budgeting', 'Forecasting', 'EVM'], responsibilities: 'Overall project cost, budget & forecast, variance, management reporting, final review of cost reports' },
    { key: 'arun.prakash', name: 'Arun Prakash', designation: 'BOQ & Measurement Coordinator', department: 'Cost Control', roles: ['QUANTITY_SURVEYOR'], employeeId: 'TRG-1002', skills: ['BOQ', 'Quantity takeoff', 'Measurement'], responsibilities: 'BOQ, quantity takeoff, MB/JMR, measurement verification, progress quantities, evidence linkage' },
    { key: 'priya.natarajan', name: 'Priya Natarajan', designation: 'Material & Procurement Coordinator', department: 'Cost Control', roles: ['PROCUREMENT_OFFICER', 'STOREKEEPER'], employeeId: 'TRG-1003', skills: ['Procurement', 'Inventory'], responsibilities: 'MR/PR, PO follow-up, GRN, material inspection, stock & consumption, supplier reconciliation' },
    { key: 'suresh.babu', name: 'Suresh Babu', designation: 'Manpower & Daily Reporting Coordinator', department: 'Cost Control', roles: ['HR_COORDINATOR', 'SITE_SUPERVISOR'], employeeId: 'TRG-1004', skills: ['MPR', 'Attendance', 'DPR'], responsibilities: 'MPR, attendance, labour cost, daily site diary, DPR, manpower evidence' },
    { key: 'meena.ramesh', name: 'Meena Ramesh', designation: 'Billing & Commercial Coordinator', department: 'Cost Control', roles: ['BILLING_ENGINEER', 'SUBCONTRACTOR_MANAGER', 'COST_CONTROLLER', 'FINANCE_OFFICER'], employeeId: 'TRG-1005', approvalLimit: L(10), skills: ['RA bills', 'Receivables'], responsibilities: 'Contractor bills, client bills, invoices, retention, payment tracking, cash flow & receivables' },
    { key: 'rajesh.iyer', name: 'Rajesh Iyer', designation: 'Project Manager', department: 'Projects', roles: ['PROJECT_MANAGER'], employeeId: 'TRG-2001' },
    { key: 'vikram.shah', name: 'Vikram Shah', designation: 'Project Director', department: 'Management', roles: ['PROJECT_DIRECTOR'], employeeId: 'TRG-2002' },
    { key: 'karthik.s', name: 'Karthik Subramanian', designation: 'Site Engineer', department: 'Site', roles: ['SITE_ENGINEER'], employeeId: 'TRG-3001' },
    { key: 'farhan.ali', name: 'Farhan Ali', designation: 'Site Engineer (MEP)', department: 'Site', roles: ['SITE_ENGINEER'], employeeId: 'TRG-3002' },
    { key: 'anita.desai', name: 'Anita Desai', designation: 'Finance Officer', department: 'Finance', roles: ['FINANCE_OFFICER'], employeeId: 'TRG-4001' },
    { key: 'lakshmi.n', name: 'Lakshmi Narayanan', designation: 'QA/QC & Safety Engineer', department: 'Quality', roles: ['QUALITY_ENGINEER', 'SAFETY_OFFICER'], employeeId: 'TRG-5001' },
    { key: 'ravi.kumar', name: 'Ravi Kumar', designation: 'Document Controller', department: 'Projects', roles: ['DOCUMENT_CONTROLLER'], employeeId: 'TRG-5002' },
    { key: 'auditor', name: 'Internal Auditor', designation: 'Auditor', department: 'Audit', roles: ['AUDITOR'], employeeId: 'TRG-9001' },
  ];
  const users: Record<string, any> = {};
  for (const p of people) users[p.key] = await createUser(org.id, p);
  await prisma.user.update({ where: { id: users['arun.prakash'].id }, data: { reportingManagerId: users['dinesh.kumar'].id, backupUserId: users['meena.ramesh'].id } });
  await prisma.user.update({ where: { id: users['priya.natarajan'].id }, data: { reportingManagerId: users['dinesh.kumar'].id, backupUserId: users['suresh.babu'].id } });
  await prisma.user.update({ where: { id: users['suresh.babu'].id }, data: { reportingManagerId: users['dinesh.kumar'].id, backupUserId: users['priya.natarajan'].id } });
  await prisma.user.update({ where: { id: users['meena.ramesh'].id }, data: { reportingManagerId: users['dinesh.kumar'].id, backupUserId: users['arun.prakash'].id } });
  await prisma.user.update({ where: { id: users['dinesh.kumar'].id }, data: { reportingManagerId: users['vikram.shah'].id, backupUserId: users['meena.ramesh'].id } });
  console.log(`✔ ${people.length} demo users`);

  const A = await as('admin');

  // ───────── Masters ─────────
  const parties: Record<string, any> = {};
  for (const [code, name, kinds, contact] of [
    ['CL-GD', 'Greenfield Developers Pvt Ltd', ['CLIENT'], 'Anand Rao'],
    ['CS-ARC', 'Archon Design Consultants', ['CONSULTANT'], 'Neha Kapoor'],
    ['SP-ULT', 'UltraTech Cement Ltd', ['SUPPLIER'], 'Sales Desk'],
    ['SP-SRS', 'Sree Steel Traders', ['SUPPLIER'], 'Mohan Das'],
    ['SP-BLD', 'BuildMart RMC', ['SUPPLIER'], 'Rakesh Jain'],
    ['SP-CTY', 'City Tiles & Sanitaryware', ['SUPPLIER'], 'Imran Khan'],
    ['SP-JCB', 'Southern Earthmovers (Equipment hire)', ['SUPPLIER'], 'Venkat'],
    ['SC-KMR', 'Kumar Constructions', ['SUBCONTRACTOR'], 'S. Kumar'],
    ['SC-BHT', 'Bharat Enterprises', ['SUBCONTRACTOR', 'SUPPLIER'], 'Bharat Patel'],
    ['SC-SKY', 'Skyline MEP Contractors', ['SUBCONTRACTOR'], 'Joseph Mathew'],
  ] as const) {
    parties[code] = await A.post('/org/r/parties', { code, name, kinds: [...kinds], contactName: contact, email: `${code.toLowerCase()}@example.com`, phone: '+91 44 0000 0000', isApproved: true, paymentTermsDays: 30, taxId: `33ABCDE${code.length}123F1Z5` });
  }
  const mats: Record<string, any> = {};
  for (const [code, name, category, unit, rate, reorder] of [
    ['CEM-OPC53', 'OPC 53 grade cement', 'Cement', 'BAG', '380', '2000'],
    ['STL-FE500', 'TMT steel Fe500D (8–32 mm)', 'Steel', 'MT', '59000', '40'],
    ['RMC-M30', 'Ready-mix concrete M30', 'Concrete', 'CUM', '5200', null],
    ['AGG-20', 'Coarse aggregate 20 mm', 'Aggregates', 'CUM', '1450', '100'],
    ['SND-MS', 'M-sand', 'Aggregates', 'CUM', '1250', '100'],
    ['BLK-AAC', 'AAC blocks 200 mm', 'Masonry', 'NOS', '68', '5000'],
    ['TIL-VT600', 'Vitrified tiles 600×600', 'Finishes', 'SQM', '720', '500'],
    ['ELE-CND25', 'PVC conduit 25 mm', 'Electrical', 'RM', '38', '1000'],
    ['DSL-HSD', 'Diesel (HSD)', 'Fuel', 'LTR', '92', '500'],
  ] as const) {
    mats[code] = await A.post('/org/r/materials', { code, name, category, unit, standardRate: rate, reorderLevel: reorder ?? undefined });
  }
  const equipment: Record<string, any> = {};
  for (const [code, name, type, ownership, rate, owner] of [
    ['EQ-TC01', 'Tower crane TC-6013', 'Tower crane', 'OWNED', '2800', null],
    ['EQ-EX01', 'Excavator CAT 320', 'Excavator', 'RENTED', '0', 'SP-JCB'],
    ['EQ-DG01', 'DG set 250 kVA', 'Generator', 'OWNED', '650', null],
    ['EQ-TM01', 'Transit mixer 7 cum', 'Transit mixer', 'OWNED', '900', null],
  ] as const) {
    equipment[code] = await A.post('/org/r/equipment', { code, name, type, ownership, hourlyRate: rate, ownerPartyId: owner ? parties[owner].id : undefined, rentalRate: ownership === 'RENTED' ? '2200' : undefined, rentalBasis: ownership === 'RENTED' ? 'HOUR' : undefined, status: 'DEPLOYED' });
  }
  console.log('✔ Parties, materials, equipment');

  // ───────── Project ─────────
  const startDate = d(-330);
  const RH = await A.post('/projects', {
    code: 'RH',
    name: 'Riverside Heights',
    description: 'G+18 residential towers (A & B) with basement parking and amenities. DEMO DATA.',
    template: 'NONE',
    clientId: parties['CL-GD'].id,
    consultantId: parties['CS-ARC'].id,
    location: 'Chennai, Tamil Nadu',
    projectManagerId: users['rajesh.iyer'].id,
    startDate,
    plannedCompletionDate: d(400),
    contractValue: CR(55),
    contractType: 'ITEM_RATE',
    currency: 'INR',
    taxRate: '0.18',
    retentionPct: '0.05',
    advanceReceived: CR(2.75),
    advanceRecoveryPct: '0.05',
    status: 'ACTIVE',
  });
  await prisma.project.update({ where: { id: RH.id }, data: { isDemo: true } });
  const P = `/projects/${RH.id}`;
  const limits: Record<string, string | null> = { 'rajesh.iyer': CR(1), 'dinesh.kumar': CR(5), 'vikram.shah': null, 'anita.desai': CR(5), 'meena.ramesh': L(10), 'karthik.s': L(25), 'farhan.ali': L(25) };
  for (const p of people) {
    if (p.key === 'auditor') continue;
    await A.post(`${P}/members`, { userId: users[p.key].id, projectRole: p.designation, approvalLimit: limits[p.key] ?? undefined });
  }

  // WBS & cost codes with original budget (₹50 Cr)
  const wbs: Record<string, any> = {};
  for (const [code, name] of [
    ['01', 'Preliminaries & general'],
    ['02', 'Substructure'],
    ['03', 'Superstructure'],
    ['04', 'MEP services'],
    ['05', 'Finishes'],
    ['06', 'Direct labour & plant'],
  ]) wbs[code] = await A.post(`${P}/r/wbsNodes`, { code, name, level: 1 });
  const ccDefs: Array<[string, string, string, string, number, number]> = [
    ['01-100', 'Preliminaries & site establishment', 'OVERHEAD', '01', 3.0, 0.5],
    ['01-200', 'Site staff & overheads', 'OVERHEAD', '01', 2.0, 0],
    ['02-100', 'Excavation & earthwork', 'SUBCONTRACT', '02', 2.5, 0],
    ['02-200', 'Foundations & substructure', 'SUBCONTRACT', '02', 5.5, 0],
    ['03-100', 'RCC frame — labour', 'SUBCONTRACT', '03', 7.0, 0],
    ['03-200', 'Cement & concrete materials', 'MATERIAL', '03', 6.0, 0],
    ['03-300', 'Reinforcement steel', 'MATERIAL', '03', 7.5, 0],
    ['03-400', 'Masonry & plaster', 'SUBCONTRACT', '03', 3.0, 0],
    ['04-100', 'MEP services', 'SUBCONTRACT', '04', 6.5, 0],
    ['05-100', 'Finishes materials', 'MATERIAL', '05', 4.0, 0],
    ['06-100', 'Own labour', 'LABOUR', '06', 1.5, 0],
    ['06-200', 'Plant & equipment', 'EQUIPMENT', '06', 1.5, 0],
  ];
  const cc: Record<string, any> = {};
  for (const [code, name, category, w] of ccDefs) cc[code] = await A.post(`${P}/r/costCodes`, { code, name, category, wbsNodeId: wbs[w].id });
  const D = await as('dinesh.kumar');
  await D.put(`${P}/budget/lines`, { lines: ccDefs.map(([code, , , , amt, cont]) => ({ costCodeId: cc[code].id, originalAmount: CR(amt), contingencyAmount: CR(cont) })) });
  await (await as('vikram.shah')).post(`${P}/budget/baseline`);
  const stores = { main: await A.post(`${P}/r/stores`, { code: 'MAIN', name: 'Main site store', location: 'Gate 2', keeperId: users['priya.natarajan'].id }), towerB: await A.post(`${P}/r/stores`, { code: 'TWB', name: 'Tower B satellite store', location: 'Tower B podium' }) };
  console.log('✔ Project, WBS, cost codes, baselined budget');

  // ───────── BOQ & activities ─────────
  const QS = await as('arun.prakash');
  const boqDefs: Array<[string, string, string, string, number, number, string]> = [
    ['B-101', 'Earthwork excavation in all soils incl. disposal', 'Substructure', 'CUM', 18000, 450, '02-100'],
    ['B-102', 'PCC M15 below foundations', 'Substructure', 'CUM', 900, 6200, '02-100'],
    ['B-201', 'RCC M30 in raft & foundations (incl. formwork)', 'Substructure', 'CUM', 4200, 9800, '02-200'],
    ['B-301', 'RCC M30 in columns, beams & slabs', 'Superstructure', 'CUM', 9500, 11200, '03-100'],
    ['B-302', 'Reinforcement steel Fe500D — cut, bend & fix', 'Superstructure', 'MT', 1900, 78000, '03-300'],
    ['B-401', 'AAC block masonry 200 mm', 'Superstructure', 'SQM', 38000, 1350, '03-400'],
    ['B-402', 'Internal plaster 12 mm', 'Finishes', 'SQM', 76000, 420, '03-400'],
    ['B-501', 'Electrical conduiting & wiring', 'MEP', 'RM', 120000, 260, '04-100'],
    ['B-502', 'Plumbing & sanitary fixtures per apartment', 'MEP', 'NOS', 480, 42000, '04-100'],
    ['B-601', 'Vitrified tile flooring 600×600', 'Finishes', 'SQM', 42000, 1650, '05-100'],
    ['B-602', 'Terrace waterproofing', 'Finishes', 'SQM', 6500, 950, '05-100'],
  ];
  const boq: Record<string, any> = {};
  for (const [itemCode, description, section, unit, q, rate, code] of boqDefs) boq[itemCode] = await QS.post(`${P}/r/boqItems`, { itemCode, description, section, unit, contractQty: String(q), estimatedQty: String(q), unitRate: String(rate), costCodeId: cc[code].id, drawingRef: `RH-STR-${itemCode}` });
  // Rate analysis coefficients for theoretical consumption
  await prisma.rateAnalysisLine.createMany({
    data: [
      { boqItemId: boq['B-301'].id, component: 'MATERIAL', materialId: mats['RMC-M30'].id, description: 'RMC M30 incl. 2% wastage', unit: 'CUM', coefficient: '1.02', rate: '5200', amount: '5304' },
      { boqItemId: boq['B-201'].id, component: 'MATERIAL', materialId: mats['RMC-M30'].id, description: 'RMC M30 incl. 2% wastage', unit: 'CUM', coefficient: '1.02', rate: '5200', amount: '5304' },
      { boqItemId: boq['B-302'].id, component: 'MATERIAL', materialId: mats['STL-FE500'].id, description: 'Steel incl. 3% wastage', unit: 'MT', coefficient: '1.03', rate: '59000', amount: '60770' },
      { boqItemId: boq['B-102'].id, component: 'MATERIAL', materialId: mats['CEM-OPC53'].id, description: 'Cement 5.5 bags/cum', unit: 'BAG', coefficient: '5.5', rate: '380', amount: '2090' },
    ],
  });
  const actDefs: Array<[string, string, string, string | null, number, number, number, number, number]> = [
    // code, name, wbs, boq, weight, startOffset, durationDays, percent, plannedQty
    ['A-100', 'Site mobilisation & enabling works', '01', null, 2, -330, 45, 100, 0],
    ['A-200', 'Excavation & shoring', '02', 'B-101', 5, -300, 90, 100, 18000],
    ['A-210', 'PCC below foundations', '02', 'B-102', 2, -240, 45, 100, 900],
    ['A-220', 'Raft & foundations', '02', 'B-201', 10, -220, 110, 100, 4200],
    ['A-300', 'RCC superstructure — Tower A', '03', 'B-301', 18, -120, 260, 42, 4750],
    ['A-310', 'RCC superstructure — Tower B', '03', null, 18, -60, 260, 18, 4750],
    ['A-320', 'Reinforcement fixing', '03', 'B-302', 8, -200, 380, 40, 1900],
    ['A-400', 'Block masonry', '03', 'B-401', 8, -40, 240, 24, 38000],
    ['A-500', 'MEP first fix', '04', 'B-501', 10, -50, 280, 25, 120000],
    ['A-600', 'Flooring & finishes', '05', 'B-601', 12, 60, 300, 0, 42000],
    ['A-610', 'Terrace waterproofing', '05', 'B-602', 3, 250, 60, 0, 6500],
    ['A-900', 'Handover — Tower A', '05', null, 4, 330, 30, 0, 0],
  ];
  const acts: Record<string, any> = {};
  const K = await as('karthik.s');
  for (const [code, name, w, b, weight, start, dur, , q] of actDefs) {
    acts[code] = await A.post(`${P}/r/activities`, {
      code,
      name,
      wbsNodeId: wbs[w].id,
      boqItemId: b ? boq[b].id : undefined,
      costCodeId: b ? boq[b].costCodeId : undefined,
      unit: b ? boq[b].unit : undefined,
      plannedQty: q ? String(q) : undefined,
      weight: String(weight),
      baselineStart: d(start),
      baselineFinish: d(start + dur),
      plannedStart: d(start),
      plannedFinish: d(start + dur + (code === 'A-300' ? 20 : 0)),
      isMilestone: code === 'A-900' || code === 'A-220',
      isHandover: code === 'A-900',
      responsibleId: users['karthik.s'].id,
      sortOrder: Number(code.slice(2)),
      delayReason: code === 'A-300' ? 'Late steel deliveries in month 7; labour shortage during festival week' : undefined,
      delayParty: code === 'A-300' ? 'SUPPLIER' : undefined,
    });
  }
  for (const [code, , , b, , start, dur, pct, q] of actDefs) {
    if (!pct) continue;
    const entries = pct === 100 ? 2 : 3;
    for (let i = 0; i < entries; i++) {
      const qty = q ? ((q * pct) / 100 / entries).toFixed(2) : '0';
      await K.post(`${P}/r/progressEntries`, { date: d(Math.min(-1, start + Math.round(((i + 1) * Math.min(dur, -start)) / entries))), activityId: acts[code].id, qtyDone: qty, percentComplete: !q || i === entries - 1 ? String(pct) : undefined, remarks: `Progress update ${i + 1}`, delayReason: code === 'A-300' && i === 1 ? 'Steel delivery delayed by 6 days' : undefined, responsibleParty: code === 'A-300' && i === 1 ? 'Sree Steel Traders' : undefined });
      void b;
    }
  }
  // Schedule logic (drives the critical path)
  for (const [pred, succ, type, lag] of [
    ['A-100', 'A-200', 'FS', 0], ['A-200', 'A-210', 'SS', 30], ['A-210', 'A-220', 'FS', 0], ['A-220', 'A-300', 'SS', 100],
    ['A-300', 'A-310', 'SS', 60], ['A-220', 'A-320', 'SS', 20], ['A-300', 'A-400', 'SS', 80], ['A-400', 'A-500', 'SS', 10],
    ['A-400', 'A-600', 'SS', 100], ['A-600', 'A-610', 'SS', 190], ['A-610', 'A-900', 'FS', 0], ['A-310', 'A-900', 'FS', 0],
  ] as const) await A.post(`${P}/schedule/dependencies`, { predecessorId: acts[pred].id, successorId: acts[succ].id, type, lagDays: lag });
  console.log('✔ BOQ, activities, progress');

  // ───────── Subcontracts ─────────
  const M = await as('meena.ramesh');
  const chain3 = ['rajesh.iyer', 'dinesh.kumar', 'vikram.shah'];
  const subDefs: Array<[string, string, string, string, Array<[string, number, number]>, string, string]> = [
    ['WO-EXC', 'SC-KMR', 'Excavation, shoring & PCC', '02-100', [['B-101', 18000, 320], ['B-102', 900, 4800]], '0', '0'],
    ['WO-RCC', 'SC-BHT', 'RCC frame labour (labour-only)', '03-100', [['B-201', 4200, 3200], ['B-301', 9500, 3800]], CR(0.4), '0.08'],
    ['WO-MEP', 'SC-SKY', 'MEP installation', '04-100', [['B-501', 120000, 190], ['B-502', 480, 31000]], '0', '0'],
    ['WO-MAS', 'SC-KMR', 'Block masonry & plaster', '03-400', [['B-401', 38000, 520], ['B-402', 76000, 130]], '0', '0'],
  ];
  const subs: Record<string, any> = {};
  for (const [key, party, title, code, items, adv, advPct] of subDefs) {
    const s = await M.post(`${P}/r/subcontracts`, { contractorId: parties[party].id, title, scope: `${title} as per drawings and specifications`, startDate: d(key === 'WO-EXC' ? -310 : key === 'WO-RCC' ? -230 : -60), endDate: d(300), costCodeId: cc[code].id, retentionPct: '0.05', retentionCapPct: '0.05', advanceAmount: adv, advanceRecoveryPct: advPct, taxRate: '0.18', paymentTermsDays: 30, insuranceExpiry: d(key === 'WO-MEP' ? 20 : 200), complianceNotes: 'CAR policy, labour licence, PF/ESI registration verified', items: items.map(([b, q, r]) => ({ boqItemId: boq[b].id, description: boq[b].description, unit: boq[b].unit, qty: String(q), rate: String(r) })) });
    await M.post(`${P}/r/subcontracts/${s.id}/submit`);
    await approve(s.id, chain3);
    subs[key] = s;
  }
  console.log('✔ Subcontracts approved (commitments posted)');

  // ───────── Measurements → verification → certification → RA bills ─────────
  const F = await as('farhan.ali');
  async function measure(sub: string, b: string, qty: number, offset: number, loc: string, verifier: Agent, verifiedDelta = 0, certify = true) {
    const m = await QS.post(`${P}/r/measurements`, { type: 'JMR', boqItemId: boq[b].id, contractorId: subs[sub].contractorId, subcontractId: subs[sub].id, measuredOn: d(offset), location: loc, floor: loc.includes('Level') ? loc.split('Level ')[1] : undefined, grid: `G${Math.abs(offset) % 12}`, nos: '1', length: String(qty), participants: ['Arun Prakash (QS)', 'Contractor representative'], remarks: 'Joint measurement with contractor' });
    await QS.post(`${P}/measurements/${m.id}/submit-for-verification`);
    await verifier.post(`${P}/measurements/${m.id}/verify`, { verifiedQty: String(qty - verifiedDelta), note: verifiedDelta ? `Reduced by ${verifiedDelta} — overlap at grid boundary` : 'Verified on site' });
    if (certify) {
      await QS.post(`${P}/r/measurements/${m.id}/submit`);
      await approve(m.id, ['rajesh.iyer']);
    }
    return m;
  }
  async function raBill(sub: string, from: number, to: number, certify = true) {
    const b = await M.post(`${P}/billing/contractor-bills`, { subcontractId: subs[sub].id, periodFrom: d(from), periodTo: d(to), contractorInvoiceNo: `INV-${sub}-${Math.abs(to)}` });
    await M.post(`${P}/billing/contractor-bills/${b.id}/submit`);
    if (certify) await approve(b.id, ['rajesh.iyer', 'dinesh.kumar']);
    return b;
  }
  await measure('WO-EXC', 'B-101', 4000, -280, 'Basement zone A', K);
  await measure('WO-EXC', 'B-101', 4000, -265, 'Basement zone B', K);
  await measure('WO-EXC', 'B-101', 4120, -250, 'Basement zone C', K, 120);
  await measure('WO-EXC', 'B-102', 600, -235, 'Tower A footprint', K);
  const raExc1 = await raBill('WO-EXC', -300, -230);
  await measure('WO-EXC', 'B-101', 5500, -215, 'Ramp & services trench', K);
  await measure('WO-EXC', 'B-102', 300, -205, 'Tower B footprint', K);
  await raBill('WO-EXC', -229, -200);
  await measure('WO-RCC', 'B-201', 1500, -190, 'Raft pour 1', K);
  await measure('WO-RCC', 'B-201', 1500, -170, 'Raft pour 2', K);
  await raBill('WO-RCC', -230, -160);
  await measure('WO-RCC', 'B-201', 1200, -140, 'Raft pour 3 & pedestals', K);
  await measure('WO-RCC', 'B-301', 1000, -95, 'Tower A — Level 1–3', K);
  await measure('WO-RCC', 'B-301', 1000, -70, 'Tower A — Level 4–6', K);
  await measure('WO-RCC', 'B-301', 1000, -45, 'Tower A — Level 7–9', K, 25);
  await raBill('WO-RCC', -159, -40);
  await measure('WO-RCC', 'B-301', 900, -20, 'Tower A — Level 10–12', K);
  await measure('WO-RCC', 'B-301', 900, -8, 'Tower B — Level 1–3', K);
  await raBill('WO-RCC', -39, -5, false); // awaiting certification
  await measure('WO-MEP', 'B-501', 30000, -30, 'Tower A — Level 1–9 conduits', K);
  await measure('WO-MEP', 'B-502', 60, -25, 'Tower A — Level 1–5 apartments', F);
  await raBill('WO-MEP', -60, -20);
  await measure('WO-MAS', 'B-401', 9000, -15, 'Tower A — Level 1–6', K);
  await raBill('WO-MAS', -40, -12);
  await measure('WO-MAS', 'B-401', 2200, -3, 'Tower A — Level 7–8', K, 0, false); // verified, not yet certified
  const pendingM = await QS.post(`${P}/r/measurements`, { type: 'MB', boqItemId: boq['B-402'].id, contractorId: subs['WO-MAS'].contractorId, subcontractId: subs['WO-MAS'].id, measuredOn: d(-1), location: 'Tower A — Level 1 corridors', nos: '1', length: '1800', remarks: 'Internal plaster measurement' });
  await QS.post(`${P}/measurements/${pendingM.id}/submit-for-verification`);
  console.log('✔ Measurements & contractor RA bills');

  // ───────── Procurement: MR → PR → PO → GRN → invoice → payment ─────────
  const PR = await as('priya.natarajan');
  async function procure(o: { mat: string; qty: number; rate: number; supplier: string; code: string; offset: number; receive?: Array<[number, number, number]>; invoice?: Array<[number, number, number]>; approvePo?: boolean; mrOnly?: boolean; prOnly?: boolean }) {
    const mr = await F.post(`${P}/r/mrs`, { department: 'Site execution', requiredBy: d(o.offset + 14), priority: 'HIGH', deliveryLocation: 'Main store', costCodeId: cc[o.code].id, justification: `Material for ${o.code}`, lines: [{ materialId: mats[o.mat].id, qty: String(o.qty), unit: mats[o.mat].unit, specification: mats[o.mat].name }] });
    await prisma.materialRequisition.update({ where: { id: mr.id }, data: { createdAt: new Date(d(o.offset)) } });
    await F.post(`${P}/r/mrs/${mr.id}/submit`);
    if (o.mrOnly) return { mr };
    await approve(mr.id, ['rajesh.iyer']);
    const pr = await PR.post(`${P}/procurement/pr-from-mr/${mr.id}`, { costCodeId: cc[o.code].id });
    await PR.patch(`${P}/r/prs/${pr.id}`, { lines: [{ materialId: mats[o.mat].id, qty: String(o.qty), unit: mats[o.mat].unit, estimatedRate: String(o.rate), costCodeId: cc[o.code].id, suggestedSupplierId: parties[o.supplier].id }] });
    await PR.post(`${P}/r/prs/${pr.id}/submit`);
    if (o.prOnly) return { mr, pr };
    await approve(pr.id, ['rajesh.iyer', 'dinesh.kumar']);
    const po = await PR.post(`${P}/procurement/po-from-pr/${pr.id}`, { supplierId: parties[o.supplier].id });
    await PR.patch(`${P}/r/purchaseOrders/${po.id}`, { orderDate: d(o.offset + 3), deliveryDate: d(o.offset + 20), paymentTerms: '30 days from invoice', deliveryAddress: 'Riverside Heights, Gate 2' });
    await PR.post(`${P}/r/purchaseOrders/${po.id}/submit`);
    if (o.approvePo === false) return { mr, pr, po };
    await approve(po.id, chain3);
    const full = await PR.get(`${P}/r/purchaseOrders/${po.id}`);
    for (const [rq, rej, off] of o.receive ?? []) {
      const grn = await PR.post(`${P}/r/grns`, { poId: po.id, storeId: stores.main.id, receivedDate: d(off), deliveryNoteNo: `DN-${Math.abs(off)}`, vehicleNo: 'TN 09 AB 1234', inspectionStatus: 'PASSED', lines: [{ poLineId: full.lines[0].id, receivedQty: String(rq), acceptedQty: String(rq - rej), rejectedQty: String(rej), rejectionReason: rej ? 'Damaged in transit' : undefined, batchNo: `LOT-${Math.abs(off)}` }] });
      await PR.post(`${P}/r/grns/${grn.id}/submit`);
      await approve(grn.id, ['karthik.s']);
    }
    for (const [iq, rate, off] of o.invoice ?? []) {
      const inv = await M.post(`${P}/r/supplierInvoices`, { supplierId: parties[o.supplier].id, invoiceNo: `${o.supplier}-${Math.abs(off)}`, invoiceDate: d(off), dueDate: d(off + 30), poId: po.id, lines: [{ poLineId: full.lines[0].id, description: full.lines[0].description, qty: String(iq), rate: String(rate), taxRate: '0.18', costCodeId: cc[o.code].id }] });
      await M.post(`${P}/r/supplierInvoices/${inv.id}/submit`);
      await approve(inv.id, ['dinesh.kumar', 'anita.desai']);
    }
    return { mr, pr, po };
  }
  const steel1 = await procure({ mat: 'STL-FE500', qty: 600, rate: 58000, supplier: 'SP-SRS', code: '03-300', offset: -230, receive: [[300, 0, -205], [300, 0, -175]], invoice: [[300, 58000, -200], [300, 58000, -170]] });
  await procure({ mat: 'STL-FE500', qty: 400, rate: 59500, supplier: 'SP-SRS', code: '03-300', offset: -70, receive: [[250, 0, -40]], invoice: [] });
  const cement = await procure({ mat: 'CEM-OPC53', qty: 40000, rate: 380, supplier: 'SP-ULT', code: '03-200', offset: -260, receive: [[15000, 0, -240], [15200, 200, -150]], invoice: [[15000, 380, -235], [10000, 380, -140]] });
  await procure({ mat: 'RMC-M30', qty: 9000, rate: 5200, supplier: 'SP-BLD', code: '03-200', offset: -200, receive: [[3000, 0, -170], [2500, 0, -60]], invoice: [[3000, 5200, -165], [2000, 5200, -55]] });
  await procure({ mat: 'TIL-VT600', qty: 20000, rate: 720, supplier: 'SP-CTY', code: '05-100', offset: -20, receive: [], invoice: [] });
  await procure({ mat: 'BLK-AAC', qty: 60000, rate: 68, supplier: 'SC-BHT', code: '03-400', offset: -10, approvePo: false });
  await procure({ mat: 'ELE-CND25', qty: 15000, rate: 38, supplier: 'SP-CTY', code: '04-100', offset: -6, prOnly: true });
  await procure({ mat: 'AGG-20', qty: 300, rate: 1450, supplier: 'SP-BLD', code: '03-200', offset: -2, mrOnly: true });
  // Exception invoice: billed above received quantity and above PO rate → three-way match exception, pending.
  const steel2 = (await prisma.purchaseOrder.findMany({ where: { projectId: RH.id, supplierId: parties['SP-SRS'].id }, orderBy: { createdAt: 'desc' }, include: { lines: true } }))[0];
  const exc = await M.post(`${P}/r/supplierInvoices`, { supplierId: parties['SP-SRS'].id, invoiceNo: 'SRS-EXC-77', invoiceDate: d(-30), dueDate: d(0), poId: steel2.id, lines: [{ poLineId: steel2.lines[0].id, description: steel2.lines[0].description, qty: '280', rate: '61500', taxRate: '0.18', costCodeId: cc['03-300'].id }] });
  await M.post(`${P}/r/supplierInvoices/${exc.id}/submit`);
  // MIR for cement GRN
  const cementGrn = await prisma.grn.findFirst({ where: { poId: cement.po!.id }, orderBy: { receivedDate: 'desc' } });
  const mir = await PR.post(`${P}/r/mirs`, { grnId: cementGrn!.id, materialId: mats['CEM-OPC53'].id, specification: 'IS 12269 OPC 53', documentsRequired: 'Mill test certificate, delivery challan', documentsReceived: 'Both received', inspectedOn: d(-149), inspectorId: users['lakshmi.n'].id, result: 'CONDITIONAL', defects: '200 bags with torn packaging rejected', correctiveAction: 'Supplier to replace rejected bags' });
  await PR.post(`${P}/r/mirs/${mir.id}/submit`);
  await approve(mir.id, ['lakshmi.n']);
  // Material issues to site
  for (const [off, q, act] of [[-160, 9000, 'A-220'], [-90, 12000, 'A-300'], [-30, 6000, 'A-300']] as const) {
    const iss = await PR.post(`${P}/r/materialIssues`, { type: 'ISSUE', storeId: stores.main.id, date: d(off), contractorId: parties['SC-BHT'].id, activityId: acts[act].id, costCodeId: cc['03-200'].id, purpose: 'Concrete works', lines: [{ materialId: mats['CEM-OPC53'].id, qty: String(q) }] });
    await PR.post(`${P}/r/materialIssues/${iss.id}/submit`);
    await approve(iss.id, ['karthik.s']);
  }
  for (const [off, q] of [[-170, 280], [-100, 250]] as const) {
    const iss = await PR.post(`${P}/r/materialIssues`, { type: 'ISSUE', storeId: stores.main.id, date: d(off), contractorId: parties['SC-BHT'].id, activityId: acts['A-320'].id, costCodeId: cc['03-300'].id, purpose: 'Reinforcement fixing', lines: [{ materialId: mats['STL-FE500'].id, qty: String(q) }] });
    await PR.post(`${P}/r/materialIssues/${iss.id}/submit`);
    await approve(iss.id, ['karthik.s']);
  }
  const wst = await PR.post(`${P}/r/materialIssues`, { type: 'WASTAGE', storeId: stores.main.id, date: d(-25), reason: 'Cement bags hardened due to water ingress in store', lines: [{ materialId: mats['CEM-OPC53'].id, qty: '120' }] });
  await PR.post(`${P}/r/materialIssues/${wst.id}/submit`);
  await approve(wst.id, ['karthik.s']);
  const trf = await PR.post(`${P}/r/materialIssues`, { type: 'TRANSFER', storeId: stores.main.id, toStoreId: stores.towerB.id, date: d(-18), purpose: 'Tower B buffer stock', lines: [{ materialId: mats['CEM-OPC53'].id, qty: '1500' }] });
  await PR.post(`${P}/r/materialIssues/${trf.id}/submit`);
  await approve(trf.id, ['karthik.s']);
  void steel1;
  console.log('✔ Procurement chain, stock movements, invoices');

  // ───────── Payments ─────────
  const paidInv = await prisma.supplierInvoice.findMany({ where: { projectId: RH.id, status: 'APPROVED' }, orderBy: { invoiceDate: 'asc' }, take: 4 });
  for (const inv of paidInv) {
    const pay = await M.post(`${P}/r/payments`, { direction: 'OUT', partyId: inv.supplierId, date: d(Math.min(-1, Math.round((inv.invoiceDate.getTime() - today.getTime()) / 86_400_000) + 28)), method: 'BANK_TRANSFER', reference: `NEFT-${inv.number}`, allocations: [{ supplierInvoiceId: inv.id, amount: inv.total.toString() }] });
    await M.post(`${P}/r/payments/${pay.id}/submit`);
    await approve(pay.id, ['anita.desai', 'vikram.shah']);
  }
  const certBills = await prisma.contractorBill.findMany({ where: { projectId: RH.id, status: 'CERTIFIED' }, orderBy: { createdAt: 'asc' }, take: 3 });
  for (const b of certBills) {
    const pay = await M.post(`${P}/r/payments`, { direction: 'OUT', partyId: b.contractorId, date: d(-10), reference: `RTGS-${b.number}`, allocations: [{ contractorBillId: b.id, amount: b.netPayable.toString() }] });
    await M.post(`${P}/r/payments/${pay.id}/submit`);
    await approve(pay.id, ['anita.desai', 'vikram.shah']);
  }
  void raExc1;
  console.log('✔ Payments');

  // ───────── Expenses ─────────
  const months = [-300, -270, -240, -210, -180, -150, -120, -90, -60, -30, -5];
  for (const off of months) {
    const e = await M.post(`${P}/r/expenses`, { date: d(off), category: 'SITE_OVERHEAD', costCodeId: cc['01-200'].id, payeeName: 'Site staff payroll', description: `Site staff salaries — ${d(off).slice(0, 7)}`, amountBeforeTax: L(17.5), taxRate: '0' });
    await M.post(`${P}/r/expenses/${e.id}/submit`);
    await approve(e.id, ['rajesh.iyer', 'dinesh.kumar']);
    const u = await M.post(`${P}/r/expenses`, { date: d(off + 2), category: 'UTILITIES', costCodeId: cc['01-100'].id, payeeName: 'TANGEDCO', description: `Construction power — ${d(off).slice(0, 7)}`, amountBeforeTax: L(2.4 + (off % 3) * 0.1), taxRate: '0.18', externalRef: `EB-${Math.abs(off)}` });
    await M.post(`${P}/r/expenses/${u.id}/submit`);
    await approve(u.id, ['rajesh.iyer', 'dinesh.kumar']);
  }
  for (const [off, cat, code, desc, amt] of [
    [-320, 'SITE_OVERHEAD', '01-100', 'Site office, fencing & hoarding', 85],
    [-310, 'INSURANCE_PERMITS', '01-100', 'CAR insurance premium & building permits', 42],
    [-200, 'TRANSPORT', '01-100', 'Debris disposal transport', 6.5],
    [-120, 'CONSULTANCY', '01-100', 'Third-party structural audit', 4.8],
    [-45, 'PLANT_HIRE', '06-200', 'Excavator hire — Southern Earthmovers', 9.6],
  ] as const) {
    const e = await M.post(`${P}/r/expenses`, { date: d(off), category: cat, costCodeId: cc[code].id, payeeName: desc.includes('Excavator') ? undefined : 'Various', payeeId: desc.includes('Excavator') ? parties['SP-JCB'].id : undefined, description: desc, amountBeforeTax: L(amt), taxRate: '0.18' });
    await M.post(`${P}/r/expenses/${e.id}/submit`);
    await approve(e.id, ['rajesh.iyer', 'dinesh.kumar']);
  }
  const pendingExp = await M.post(`${P}/r/expenses`, { date: d(-2), category: 'TRANSPORT', costCodeId: cc['01-100'].id, payeeName: 'Sri Murugan Transports', description: 'Shuttering material shifting', amountBeforeTax: '68000', taxRate: '0.05' });
  await M.post(`${P}/r/expenses/${pendingExp.id}/submit`);
  console.log('✔ Expenses');

  // ───────── Manpower, attendance, equipment, site diary ─────────
  const S = await as('suresh.babu');
  const trades: Array<[string, string, number, number]> = [
    ['Mason', 'SKILLED', 30, 95],
    ['Helper', 'UNSKILLED', 50, 65],
    ['Carpenter', 'SKILLED', 22, 100],
    ['Bar bender', 'SKILLED', 18, 105],
    ['Electrician', 'SKILLED', 12, 110],
  ];
  for (let i = 22; i >= 1; i--) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    if (day.getUTCDay() === 0) continue;
    const mpr = await S.post(`${P}/r/manpowerReports`, {
      date: d(-i),
      shift: 'DAY',
      remarks: 'Own labour gang',
      lines: trades.map(([trade, category, planned, rate], j) => ({ trade, category, plannedCount: planned, actualCount: Math.max(0, planned - ((i + j) % 6)), regularHours: '8', overtimeHours: (i + j) % 4 === 0 ? '2' : '0', hourlyRate: String(rate), overtimeRate: String(rate * 1.5), chargeable: true, location: j < 2 ? 'Tower A' : 'Tower B', activityId: acts[j < 3 ? 'A-300' : j === 3 ? 'A-320' : 'A-500'].id, costCodeId: cc['06-100'].id, supervisor: 'Suresh Babu' })),
    });
    await S.post(`${P}/r/manpowerReports/${mpr.id}/submit`);
    if (i > 1) await approve(mpr.id, ['karthik.s']);
    const sub = await S.post(`${P}/r/manpowerReports`, { date: d(-i), shift: 'DAY', contractorId: parties['SC-BHT'].id, remarks: 'Bharat Enterprises RCC gang', lines: [{ trade: 'Mason', category: 'SKILLED', plannedCount: 40, actualCount: 36 + (i % 5), regularHours: '8', overtimeHours: '0', hourlyRate: '95', overtimeRate: '140', activityId: acts['A-300'].id }, { trade: 'Helper', category: 'UNSKILLED', plannedCount: 60, actualCount: 55 + (i % 4), regularHours: '8', overtimeHours: '0', hourlyRate: '65', overtimeRate: '95', activityId: acts['A-300'].id }] });
    await S.post(`${P}/r/manpowerReports/${sub.id}/submit`);
    if (i > 1) await approve(sub.id, ['karthik.s']);
  }
  // Attendance register for own workers (last 3 days)
  const workers = [];
  for (let i = 1; i <= 12; i++) {
    const [trade, category, , rate] = trades[i % trades.length];
    workers.push(await S.post(`${P}/r/workers`, { workerCode: `W-${String(i).padStart(3, '0')}`, name: ['Murugan', 'Senthil', 'Ramesh', 'Ganesh', 'Vijay', 'Selvam', 'Karthi', 'Bala', 'Mani', 'Raja', 'Kumar', 'Prakash'][i - 1] + ' ' + String.fromCharCode(64 + i), trade, category, hourlyRate: String(rate) }));
  }
  for (const off of [-3, -2, -1]) {
    await S.post(`${P}/manpower/attendance`, { date: d(off), shift: 'DAY', records: workers.map((w, j) => ({ workerId: w.id, status: (j + off) % 7 === 0 ? 'ABSENT' : 'PRESENT', regularHours: (j + off) % 7 === 0 ? '0' : '8', overtimeHours: j % 5 === 0 ? '2' : '0' })) });
  }
  await S.post(`${P}/manpower/attendance`, { date: d(-1), shift: 'DAY', correctionReason: 'Worker W-002 arrived late — half day as per gate register', records: [{ workerId: workers[1].id, status: 'HALF_DAY', regularHours: '4', overtimeHours: '0' }] });
  // Equipment logs (owned equipment posts cost)
  for (let i = 14; i >= 1; i -= 1) {
    for (const code of ['EQ-TC01', 'EQ-DG01']) {
      const log = await K.post(`${P}/r/equipmentLogs`, { equipmentId: equipment[code].id, date: d(-i), operatorName: code === 'EQ-TC01' ? 'Ranjit Singh' : 'Paul D', workingHours: code === 'EQ-TC01' ? String(8 + (i % 3)) : '6', idleHours: String(i % 2), breakdownHours: i === 6 && code === 'EQ-TC01' ? '3' : '0', fuelLitres: code === 'EQ-DG01' ? '110' : '0', fuelCost: code === 'EQ-DG01' ? '10120' : '0', activityId: acts['A-300'].id, costCodeId: cc['06-200'].id });
      await K.post(`${P}/r/equipmentLogs/${log.id}/submit`);
      if (i > 2) await approve(log.id, ['farhan.ali']);
    }
  }
  await K.post(`${P}/r/equipmentMaintenance`, { equipmentId: equipment['EQ-TC01'].id, date: d(-6), type: 'BREAKDOWN', description: 'Hoist rope replacement', cost: '48000', downtimeHours: '3' });
  for (const off of [-3, -2, -1]) {
    const dpr = await K.post(`${P}/r/siteDiaries`, { date: d(off), shift: 'DAY', weather: off === -2 ? 'RAIN' : 'CLEAR', workingHours: '08:00–18:00', location: 'Tower A & B', activitiesPerformed: 'Tower A L12 slab reinforcement & shuttering (55%); Tower B L3 column casting 42 cum; block masonry L7 Tower A 260 sqm', workStoppages: off === -2 ? 'Rain 14:00–15:30, concreting paused' : '', delays: off === -2 ? 'Concrete pour postponed by 2 hours' : '', safetyObservations: 'Edge protection checked on L12; 2 workers without harness counselled', qualityObservations: 'Cover blocks verified before L12 pour', instructions: 'Consultant instructed additional chairs at cantilever slab', visitors: off === -1 ? 'Client PMC weekly walkthrough' : '', remarks: 'Productivity normal', nextDayPlan: 'L12 slab pour Tower A (210 cum)' });
    await K.post(`${P}/r/siteDiaries/${dpr.id}/submit`);
    if (off < -1) await approve(dpr.id, ['rajesh.iyer']);
  }
  console.log('✔ Manpower, attendance, equipment, site diary');

  // ───────── Site evidence (needs file storage) ─────────
  if (storageAvailable) {
    const photos = Array.from({ length: 10 }, (_, i) => path.join(here, 'demo-assets', `site-${String(i + 1).padStart(2, '0')}.jpg`));
    const evid: any[] = [];
    const evDefs: Array<[number, string, string, string, string]> = [
      [0, 'WORK_COMPLETION', 'Tower A — Level 12 slab reinforcement', 'Tower A L12', 'karthik.s'],
      [1, 'WORK_COMPLETION', 'Block B — brickwork progress', 'Tower B L3', 'suresh.babu'],
      [2, 'EQUIPMENT', 'M&E installation — riser shaft', 'Tower A core', 'farhan.ali'],
      [3, 'MEASUREMENT', 'Concrete pouring — raft pour 3', 'Raft', 'karthik.s'],
      [4, 'WORK_COMPLETION', 'Terrace waterproofing trial', 'Tower A roof', 'karthik.s'],
      [5, 'QUALITY', 'Rebar inspection before pour', 'Tower A L11', 'lakshmi.n'],
      [6, 'MATERIAL_RECEIPT', 'Cement receipt — GRN', 'Main store', 'priya.natarajan'],
      [7, 'SAFETY', 'Scaffolding safety check', 'Tower B façade', 'lakshmi.n'],
      [8, 'WORK_COMPLETION', 'Excavation — basement', 'Basement', 'karthik.s'],
      [9, 'MANPOWER', 'Morning muster — own labour', 'Gate 2', 'suresh.babu'],
    ];
    for (const [i, category, caption, location, user] of evDefs) {
      const linked = category === 'MATERIAL_RECEIPT' ? { linkedType: 'grn', linkedId: cementGrn!.id } : category === 'MEASUREMENT' ? { linkedType: 'measurement', linkedId: (await prisma.measurement.findFirst({ where: { projectId: RH.id, location: 'Raft pour 3 & pedestals' } }))!.id } : {};
      const fields: Record<string, string> = { category, caption, location, phase: i === 4 ? 'BEFORE' : 'NA', claimedTakenAt: new Date(Date.now() - (10 - i) * 86_400_000).toISOString(), ...(linked as Record<string, string>) };
      if (i === 4) fields.pairKey = 'TERRACE-WP';
      const r = await (await as(user)).upload(`${P}/evidence`, [photos[i]], fields);
      evid.push(r[0]);
    }
    for (const [i, status, comment] of [[0, 'VERIFIED', ''], [1, 'CORRECTION_REQUIRED', 'Caption says Block B; photo shows Tower B — please correct the location'], [2, 'VERIFIED', ''], [3, 'VERIFIED', ''], [6, 'VERIFIED', ''], [8, 'VERIFIED', '']] as const) {
      const reviewer = evDefs[i][4] === 'karthik.s' ? 'farhan.ali' : 'karthik.s';
      await (await as(reviewer)).post(`${P}/evidence/${evid[i].id}/review`, { status, comment: comment || undefined });
    }
    console.log('✔ Site evidence');
  } else console.log('… Site evidence skipped: no file storage configured');

  // ───────── Variations, claims, risks, contracts ─────────
  const vo1 = await QS.post(`${P}/r/variations`, { title: 'Additional basement waterproofing (client instruction)', origin: 'CLIENT', reason: 'Higher water table found during excavation', scope: 'Crystalline waterproofing to basement retaining walls', instructionRef: 'CI-014', costCodeId: cc['02-200'].id, scheduleImpactDays: 7, clientApprovalRef: 'GD/RH/VO/014', lines: [{ boqItemId: boq['B-602'].id, description: 'Crystalline waterproofing to retaining walls', unit: 'SQM', qty: '4200', rate: '1150', costRate: '820' }] });
  await QS.post(`${P}/r/variations/${vo1.id}/submit`);
  await approve(vo1.id, chain3);
  const br = await prisma.budgetRevision.findFirst({ where: { projectId: RH.id, variationId: vo1.id } });
  if (br) {
    await D.post(`${P}/r/budgetRevisions/${br.id}/submit`);
    await approve(br.id, ['rajesh.iyer', 'vikram.shah']);
  }
  const vo2 = await QS.post(`${P}/r/variations`, { title: 'Upgrade lobby flooring to Italian marble', origin: 'CLIENT', reason: 'Client design change request', costCodeId: cc['05-100'].id, scheduleImpactDays: 12, lines: [{ description: 'Italian marble flooring in lobbies (net extra over vitrified)', unit: 'SQM', qty: '1800', rate: '3400', costRate: '2600' }] });
  await QS.post(`${P}/r/variations/${vo2.id}/submit`);
  const transfer = await D.post(`${P}/r/budgetRevisions`, { type: 'TRANSFER', title: 'Transfer contingency to steel', reason: 'Steel price escalation (+3%) absorbed from preliminaries contingency', lines: [{ costCodeId: cc['01-100'].id, delta: '-2500000', remarks: 'Contingency release' }, { costCodeId: cc['03-300'].id, delta: '2500000', remarks: 'Price escalation' }] });
  await D.post(`${P}/r/budgetRevisions/${transfer.id}/submit`);
  await D.post(`${P}/r/claims`, { type: 'EOT', direction: 'BY_US', counterpartyId: parties['CL-GD'].id, title: 'EOT for delayed drawings release (Tower B)', description: 'Structural drawings for Tower B L4–L8 released 21 days late', eventDate: d(-80), noticeDate: d(-75), submittedDate: d(-60), claimedAmount: L(38), claimedDays: 21, status: 'UNDER_REVIEW' });
  await D.post(`${P}/r/claims`, { type: 'COST', direction: 'AGAINST_US', counterpartyId: parties['SC-BHT'].id, title: 'Idle labour claim by RCC subcontractor', description: 'Claim for idle gang during steel shortage', eventDate: d(-110), submittedDate: d(-95), claimedAmount: L(6.2), claimedDays: 0, status: 'DISPUTED' });
  for (const [title, category, p, i, exp, mitigation] of [
    ['Steel price escalation beyond budget', 'COST', 4, 4, L(85), 'Lock rates for balance 300 MT; evaluate alternative supplier'],
    ['Monsoon delay to Tower B frame', 'SCHEDULE', 3, 4, L(40), 'Advance pours, add second shift in pre-monsoon window'],
    ['MEP subcontractor insurance expiring', 'REGULATORY', 3, 3, '0', 'Obtain renewed CAR certificate before expiry'],
    ['Client delay in tile selection', 'DESIGN', 2, 3, L(12), 'Freeze sample by month-end via RFI'],
  ] as const) await D.post(`${P}/r/risks`, { title, category, probability: p, impact: i, costExposure: exp, mitigation, ownerId: users['dinesh.kumar'].id, dueDate: d(30), status: p * i >= 16 ? 'ESCALATED' : 'OPEN' });
  const R = await as('rajesh.iyer');
  await R.post(`${P}/r/contracts`, {
    title: 'Main contract — Riverside Heights',
    type: 'MAIN',
    counterpartyId: parties['CL-GD'].id,
    value: CR(55),
    startDate,
    endDate: d(400),
    retentionPct: '0.05',
    advanceAmount: CR(2.75),
    paymentTerms: 'Monthly RA bills; payment within 30 days of certification',
    ldRatePerDay: L(2.5),
    ldCapPct: '0.05',
    noticePeriodDays: 28,
    claimsDeadlineDays: 28,
    status: 'ACTIVE',
    clauses: [
      { clauseRef: '14.7', category: 'PAYMENT', sourceText: 'The Employer shall pay the amount certified in each Interim Payment Certificate within 30 days after the Engineer receives the Statement and supporting documents.', interpretation: 'Client payment due 30 days after certification of each RA bill.' },
      { clauseRef: '8.7', category: 'LD', sourceText: 'Delay damages shall be 0.05% of the Contract Price per day, subject to a maximum of 5% of the Contract Price.' },
      { clauseRef: '20.1', category: 'CLAIMS', sourceText: 'The Contractor shall give notice to the Engineer not later than 28 days after becoming aware of the event or circumstance.', interpretation: 'Claims notice must be issued within 28 days of the event.' },
    ],
    guarantees: [
      { type: 'PERFORMANCE_BOND', reference: 'BG/PB/2024/118', issuer: 'State Bank of India', amount: CR(5.5), expiryDate: d(500), status: 'ACTIVE' },
      { type: 'ADVANCE_GUARANTEE', reference: 'BG/AG/2024/119', issuer: 'State Bank of India', amount: CR(2.75), expiryDate: d(25), status: 'ACTIVE' },
    ],
  });
  console.log('✔ Variations, budget revisions, claims, risks, contracts');

  // ───────── Client billing ─────────
  await M.post(`${P}/r/billingMilestones`, { name: 'Raft completion', dueDate: d(-150), amount: CR(1), status: 'BILLED' });
  await M.post(`${P}/r/billingMilestones`, { name: 'Tower A topping out', dueDate: d(120), amount: CR(1.5), status: 'PLANNED' });
  const cb = await M.post(`${P}/billing/client-bills`, { periodFrom: startDate, periodTo: d(-1), type: 'RA' });
  await M.post(`${P}/billing/client-bills/${cb.id}/submit`);
  await approve(cb.id, chain3);
  const cbFull = await prisma.clientBill.findUniqueOrThrow({ where: { id: cb.id } });
  const certified = (Number(cbFull.netAmount) * 0.97).toFixed(2);
  await M.post(`${P}/billing/client-bills/${cb.id}/client-certification`, { certifiedAmount: certified, invoiceNo: 'TRG/RH/INV/001', invoiceDate: d(-1), dueDate: d(29), notes: 'Client reduced claim by 3% pending quality documentation' });
  const rcp = await M.post(`${P}/r/payments`, { direction: 'IN', partyId: parties['CL-GD'].id, date: d(-1), reference: 'Client RTGS 88213', allocations: [{ clientBillId: cb.id, amount: (Number(certified) * 0.6).toFixed(2) }] });
  await M.post(`${P}/r/payments/${rcp.id}/submit`);
  await approve(rcp.id, ['anita.desai', 'vikram.shah']);
  const months12 = Array.from({ length: 14 }, (_, i) => {
    const dt = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 10 + i, 1));
    return dt.toISOString().slice(0, 7);
  });
  for (const [i, month] of months12.entries()) await M.post(`${P}/r/cashFlowPlans`, { month, plannedInflow: CR(i < 3 ? 1.2 : 3.6), plannedOutflow: CR(i < 3 ? 1.5 : 3.2), notes: 'Baseline cash flow plan' });
  console.log('✔ Client billing & cash flow');

  // ───────── Forecast ─────────
  await D.post(`${P}/forecast`, {
    entries: [
      { costCodeId: cc['03-300'].id, method: 'MANUAL', uncommittedEtc: CR(1.95), assumptions: 'Balance 300 MT steel at ₹61,000/MT (current market) + 3% wastage; PO-2 balance 150 MT already committed' },
      { costCodeId: cc['03-200'].id, method: 'MANUAL', uncommittedEtc: CR(0.4), assumptions: 'RMC balance covered by PO; additional cement for plaster 1,000 bags' },
      { costCodeId: cc['01-200'].id, method: 'MANUAL', uncommittedEtc: CR(0.35), assumptions: 'Site staff for 14 more months at ₹17.5 L/month, partially absorbed by overhead savings' },
      { costCodeId: cc['04-100'].id, method: 'REMAINING_BUDGET', assumptions: 'MEP within subcontract value' },
    ],
  });
  console.log('✔ Forecast');

  // ───────── Quality, safety, documents, RFIs ─────────
  const Q = await as('lakshmi.n');
  await Q.post(`${P}/r/inspections`, { type: 'WIR', title: 'Tower A L12 slab reinforcement', activityId: acts['A-300'].id, location: 'Tower A L12', requestedDate: d(-2), inspectedDate: d(-1), inspectorId: users['lakshmi.n'].id, result: 'PASS', remarks: 'Cover and lap lengths as per drawing', status: 'CLOSED' });
  await Q.post(`${P}/r/inspections`, { type: 'QUALITY', title: 'Block masonry alignment L7', activityId: acts['A-400'].id, location: 'Tower A L7', requestedDate: d(-4), inspectedDate: d(-3), result: 'FAIL', remarks: 'Out of plumb > 5 mm in 3 locations', status: 'INSPECTED' });
  const ins = await prisma.inspection.findFirst({ where: { projectId: RH.id, result: 'FAIL' } });
  await Q.post(`${P}/r/ncrs`, { title: 'Masonry out of plumb — Tower A L7', severity: 'MAJOR', description: 'Masonry walls out of plumb beyond tolerance at 3 locations', activityId: acts['A-400'].id, inspectionId: ins!.id, contractorId: parties['SC-KMR'].id, rootCause: 'Inadequate line & level checks by gang', correctiveAction: 'Dismantle and rebuild affected panels', preventiveAction: 'Daily plumb checks by supervisor', responsibleId: users['karthik.s'].id, dueDate: d(5), estimatedReworkCost: '85000', costCodeId: cc['03-400'].id, status: 'IN_PROGRESS' });
  // ITP templates (sample content for the demo; each company maintains its own)
  const slabItp = await Q.post('/org/r/checklistTemplates', {
    name: 'RCC slab / beam — concreting ITP',
    type: 'ITP',
    description: 'Sample inspection and test plan for a cast-in-situ slab pour (demo content)',
    items: [
      { stage: 'Before work', description: 'Approved for-construction drawings and BBS available at site', reference: 'Document register', pointType: 'REVIEW' },
      { stage: 'Before work', description: 'Shuttering line, level and propping checked', acceptanceCriteria: 'Level ±5 mm; props at designed spacing', pointType: 'WITNESS' },
      { stage: 'Before concreting', description: 'Reinforcement checked against drawing and BBS', acceptanceCriteria: 'Bar dia, spacing, laps and cover as per drawing', reference: 'IS 456 cl. 26', pointType: 'HOLD' },
      { stage: 'Before concreting', description: 'Embedded MEP sleeves and conduits in position', pointType: 'WITNESS' },
      { stage: 'During concreting', description: 'RMC delivery tickets checked (grade, time since batching)', acceptanceCriteria: 'Correct grade; within 90 minutes of batching', pointType: 'REVIEW' },
      { stage: 'During concreting', description: 'Slump test at point of placing', acceptanceCriteria: '100 ± 25 mm or as per mix design', reference: 'IS 1199', pointType: 'WITNESS' },
      { stage: 'During concreting', description: 'Cube samples taken', acceptanceCriteria: 'Sampling frequency per IS 456 cl. 15.2', pointType: 'REVIEW' },
      { stage: 'After concreting', description: 'Curing started and maintained', acceptanceCriteria: 'Minimum 7 days moist curing', pointType: 'REVIEW' },
    ],
  });
  await Q.post('/org/r/checklistTemplates', {
    name: 'Block masonry ITP',
    type: 'ITP',
    description: 'Sample checklist for block masonry (demo content)',
    items: [
      { description: 'Block test certificates reviewed', reference: 'IS 2185', pointType: 'REVIEW' },
      { description: 'Setting out of walls checked against drawing', pointType: 'HOLD' },
      { description: 'Mortar mix proportion', acceptanceCriteria: '1:6 cement-sand unless specified', pointType: 'WITNESS' },
      { description: 'Plumb and alignment', acceptanceCriteria: 'Within 5 mm per storey height', pointType: 'WITNESS' },
      { description: 'Lintels and sill bands provided', pointType: 'REVIEW' },
    ],
  });
  const itp = await Q.post(`${P}/r/inspections`, { type: 'ITP', title: 'Tower A L13 slab pour', activityId: acts['A-300'].id, location: 'Tower A L13', requestedDate: d(0) });
  const applied = await Q.post(`${P}/inspections/${itp.id}/checklist/template`, { templateId: slabItp.id });
  const chk = (applied.checklist as Array<{ id: string }>).slice(0, 3);
  for (const [i, remarks] of ['FC drawings Rev C at site', 'Checked with auto level', 'Cover blocks 25 mm verified'].entries()) {
    await Q.put(`${P}/inspections/${itp.id}/checklist/${chk[i].id}`, { result: 'PASS', remarks });
  }
  for (const [type, desc, sev] of [
    ['INSPECTION', 'Weekly scaffolding inspection — Tower B façade', 'LOW'],
    ['NEAR_MISS', 'Unsecured shuttering plank fell from L10 (no injury)', 'HIGH'],
    ['FIRST_AID', 'Minor cut to helper hand while handling rebar', 'MEDIUM'],
  ] as const) await Q.post(`${P}/r/safetyIncidents`, { type, date: d(-5 + desc.length % 4), location: 'Tower A/B', description: desc, injuredCount: type === 'FIRST_AID' ? 1 : 0, severity: sev, immediateAction: 'Area cordoned, toolbox talk held', correctiveAction: 'Toe boards installed on all working platforms', responsibleId: users['lakshmi.n'].id, dueDate: d(3), status: type === 'INSPECTION' ? 'CLOSED' : 'ACTION_IN_PROGRESS' });
  await Q.post(`${P}/r/toolboxTalks`, { date: d(-1), topic: 'Working at height & harness use', conductedBy: 'Lakshmi Narayanan', attendeeCount: 86, notes: 'Harness inspection demonstrated' });
  const DC = await as('ravi.kumar');
  const docDefs: Array<[string, string, string]> = [
    ['DRAWING', 'STRUCTURAL', 'Tower A — L10 to L14 slab reinforcement'],
    ['DRAWING', 'ARCHITECTURAL', 'Typical floor plan — Tower B'],
    ['SPECIFICATION', 'MEP', 'Electrical specification v2'],
  ];
  if (storageAvailable) {
    for (const [docType, discipline, title] of docDefs) {
      const doc = await DC.post(`${P}/r/documents`, { docType, discipline, title, originator: 'Archon Design Consultants' });
      for (const rev of ['A', 'B']) {
        const { renderPdf } = await import('../src/services/pdf.js');
        const buf = await renderPdf({ title: `${title} — rev ${rev}`, subtitle: 'DEMO DRAWING PLACEHOLDER', meta: [['Document', title], ['Revision', rev]], columns: [{ key: 'n', label: 'Note', width: 1 }], rows: [{ n: 'Placeholder document generated for demo data. Not a real drawing.' }] });
        const tmp = path.join(here, 'demo-assets', `.tmp-${rev}.pdf`);
        const fs = await import('node:fs/promises');
        await fs.writeFile(tmp, buf);
        const agent = request.agent(app);
        await agent.post('/api/auth/login').set('X-Requested-With', 'toprock').send({ email: `ravi.kumar@${DOMAIN}`, password: PASSWORD });
        const up = await agent.post(`/api${P}/documents/${doc.id}/revisions`).set('X-Requested-With', 'toprock').field('revision', rev).field('description', rev === 'A' ? 'Issued for review' : 'Issued for construction').attach('file', tmp);
        await fs.unlink(tmp);
        if (up.status >= 300) throw new Error(JSON.stringify(up.body));
        await DC.post(`${P}/document-revisions/${up.body.id}/submit`);
        if (rev === 'A' || title.includes('Tower A')) await approve(up.body.id, ['rajesh.iyer']);
      }
    }
    const tr = await DC.post(`${P}/r/transmittals`, { recipientId: parties['SC-BHT'].id, recipientName: 'Bharat Enterprises', subject: 'IFC drawings — Tower A L10–L14', purpose: 'FOR_CONSTRUCTION', distribution: ['site@bharat.example'] });
    const approvedRevs = await prisma.documentRevision.findMany({ where: { projectId: RH.id, status: 'APPROVED' }, take: 2 });
    await DC.post(`${P}/transmittals/${tr.id}/send`, { revisionIds: approvedRevs.map((r) => r.id) });
  } else console.log('… Document revisions and transmittal skipped: no file storage configured');
  await K.post(`${P}/r/rfis`, { kind: 'RFI', subject: 'Cantilever slab reinforcement detail at grid C/7', question: 'Drawing shows conflicting top reinforcement at cantilever. Please confirm bar diameter.', discipline: 'Structural', addressedTo: 'Archon Design Consultants', dueDate: d(3), costImpact: false, scheduleImpact: true });
  await K.post(`${P}/r/rfis`, { kind: 'TECHNICAL_QUERY', subject: 'Tile layout start point in lobby', question: 'Confirm whether tile layout starts from lift lobby centre line.', discipline: 'Architectural', addressedTo: 'Client PMC', dueDate: d(-2), response: 'Start from lift lobby centre line.', status: 'ANSWERED' });
  console.log('✔ Quality, safety, documents, RFIs');

  // ───────── Tasks & responsibility matrix ─────────
  const taskDefs: Array<[string, string, string, string, string, number, string]> = [
    ['Monthly cost report — current month', 'COST_REPORT', 'dinesh.kumar', 'HIGH', 'IN_PROGRESS', 4, 'vikram.shah'],
    ['MPR – Week 43 consolidation', 'MANPOWER', 'suresh.babu', 'MEDIUM', 'IN_PROGRESS', 2, 'dinesh.kumar'],
    ['PO & GRN reconciliation — steel', 'RECONCILIATION', 'priya.natarajan', 'HIGH', 'ASSIGNED', -1, 'dinesh.kumar'],
    ['Measurement verification — Tower A plaster', 'MEASUREMENT', 'arun.prakash', 'HIGH', 'IN_PROGRESS', 1, 'dinesh.kumar'],
    ['Subcontractor bill review — WO-RCC RA-4', 'BILLING', 'meena.ramesh', 'CRITICAL', 'IN_REVIEW', 0, 'dinesh.kumar'],
    ['Update EAC for steel after price escalation', 'BUDGET', 'dinesh.kumar', 'HIGH', 'COMPLETED', -3, 'vikram.shah'],
    ['Chase client for RA-1 payment balance', 'BILLING', 'meena.ramesh', 'MEDIUM', 'WAITING_INFO', 10, 'dinesh.kumar'],
    ['Stock count — main store', 'RECONCILIATION', 'priya.natarajan', 'MEDIUM', 'BLOCKED', -4, 'dinesh.kumar'],
    ['Reconcile exception invoice SRS-EXC-77', 'RECONCILIATION', 'priya.natarajan', 'HIGH', 'ASSIGNED', -2, 'dinesh.kumar'],
    ['Labour productivity analysis — RCC gang', 'MANPOWER', 'suresh.babu', 'LOW', 'BACKLOG', 14, 'dinesh.kumar'],
    ['Prepare month-end checklist', 'MONTH_END', 'meena.ramesh', 'HIGH', 'ASSIGNED', 4, 'dinesh.kumar'],
    ['Quantity takeoff — Tower B finishes', 'MEASUREMENT', 'arun.prakash', 'MEDIUM', 'ASSIGNED', 7, 'dinesh.kumar'],
  ];
  const taskIds: string[] = [];
  for (const [title, category, owner, priority, status, due, reviewer] of taskDefs) {
    const t = await D.post(`${P}/r/tasks`, { title, category, ownerId: users[owner].id, reviewerId: users[reviewer].id, priority, status: status === 'COMPLETED' ? 'IN_PROGRESS' : status, startDate: d(due - 5), dueDate: d(due), estimatedHours: '6', recurrence: title.startsWith('Monthly') ? 'MONTHLY' : undefined, description: `${title}. Linked to project controls.` });
    if (status === 'COMPLETED') await D.patch(`${P}/r/tasks/${t.id}`, { status: 'COMPLETED', actualHours: '5', completionNote: 'EAC updated in forecast for current period' });
    taskIds.push(t.id);
  }
  await D.post(`${P}/tasks/${taskIds[8]}/dependencies`, { dependsOnIds: [taskIds[2]] });
  await D.post(`${P}/tasks/${taskIds[0]}/contributors`, { userIds: [users['meena.ramesh'].id, users['arun.prakash'].id] });
  for (const [processType, resp, acc, rev, appr, backup, sla] of [
    ['MPR', 'suresh.babu', 'dinesh.kumar', 'karthik.s', 'karthik.s', 'priya.natarajan', 24],
    ['DPR', 'suresh.babu', 'dinesh.kumar', 'karthik.s', 'rajesh.iyer', 'priya.natarajan', 24],
    ['MR', 'priya.natarajan', 'dinesh.kumar', 'karthik.s', 'rajesh.iyer', 'suresh.babu', 24],
    ['PO', 'priya.natarajan', 'dinesh.kumar', 'dinesh.kumar', 'rajesh.iyer', 'suresh.babu', 48],
    ['GRN', 'priya.natarajan', 'dinesh.kumar', 'karthik.s', 'karthik.s', 'suresh.babu', 24],
    ['MB', 'arun.prakash', 'dinesh.kumar', 'karthik.s', 'rajesh.iyer', 'meena.ramesh', 48],
    ['CONTRACTOR_BILL', 'meena.ramesh', 'dinesh.kumar', 'rajesh.iyer', 'dinesh.kumar', 'arun.prakash', 72],
    ['CLIENT_BILL', 'meena.ramesh', 'dinesh.kumar', 'rajesh.iyer', 'vikram.shah', 'arun.prakash', 72],
    ['COST_REPORT', 'dinesh.kumar', 'vikram.shah', 'rajesh.iyer', 'vikram.shah', 'meena.ramesh', 120],
    ['PERIOD_CLOSE', 'meena.ramesh', 'dinesh.kumar', 'dinesh.kumar', 'vikram.shah', 'arun.prakash', 72],
  ] as const) {
    await A.put('/admin/responsibility', { projectId: RH.id, processType, responsibleId: users[resp].id, accountableId: users[acc].id, reviewerId: users[rev].id, approverId: users[appr].id, backupId: users[backup].id, slaHours: sla, escalationUserId: users['vikram.shah'].id });
  }
  console.log('✔ Tasks & responsibility matrix');

  // ───────── Physical stock count & oldest period close ─────────
  const cnt = await PR.post(`${P}/r/stockCounts`, { storeId: stores.main.id, countDate: d(-1), remarks: 'Monthly physical verification', lines: [{ materialId: mats['CEM-OPC53'].id, countedQty: '1350' }, { materialId: mats['STL-FE500'].id, countedQty: '318.5' }] });
  await PR.post(`${P}/stock/counts/${cnt.id}/post`);
  const periods: any[] = await D.get(`${P}/periods`);
  const oldest = periods[periods.length - 1];
  for (const item of oldest.checklist) await D.post(`${P}/periods/${oldest.id}/checklist/${item.key}`, ['stock_reconciliation', 'forecast_updated', 'variance_analysis'].includes(item.key) ? { status: 'WAIVED', note: 'Mobilisation month — not applicable' } : { status: 'DONE' });
  await D.post(`${P}/periods/${oldest.id}/close`);
  await approve(oldest.id, ['vikram.shah']);
  console.log(`✔ Stock count posted; period ${oldest.code} closed`);

  // ───────── Second, smaller project (data separation demo) ─────────
  const LV = await A.post('/projects', { code: 'LV', name: 'Lakeview Apartments', description: 'G+7 residential block. DEMO DATA.', template: 'STANDARD', clientId: parties['CL-GD'].id, location: 'Coimbatore', projectManagerId: users['rajesh.iyer'].id, startDate: d(-60), plannedCompletionDate: d(540), contractValue: CR(18), status: 'ACTIVE' });
  await prisma.project.update({ where: { id: LV.id }, data: { isDemo: true } });
  for (const k of ['dinesh.kumar', 'meena.ramesh', 'vikram.shah']) await A.post(`/projects/${LV.id}/members`, { userId: users[k].id, projectRole: 'Project controls' });
  const lvCodes = await prisma.costCode.findMany({ where: { projectId: LV.id } });
  await D.put(`/projects/${LV.id}/budget/lines`, { lines: lvCodes.map((c, i) => ({ costCodeId: c.id, originalAmount: CR([1.2, 3.5, 5.0, 3.2, 3.1][i] ?? 1) })) });
  console.log('✔ Second project (Lakeview Apartments)');

  console.log('\nDemo data complete. All demo users share the password from SEED_PASSWORD (default for local development).');
  console.log('Sign in as dinesh.kumar@toprock.example (Cost Control Lead) or admin@toprock.example.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
