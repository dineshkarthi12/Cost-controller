# TOPROCK GLOBAL — Construction Cost Control Management System

A web application for controlling construction project cost: budgets, commitments, accruals and actuals in one cost ledger, from site measurement to procurement, subcontract and client billing, month-end close and project closeout. It covers 48 modules and runs on desktop, tablet and mobile.

> **Status:** see [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) for what is working, partial or interface-only, and [`TEST_PLAN.md`](TEST_PLAN.md) for test results and known gaps. No external integration is active, and no security or compliance certification is claimed.

## Documentation

| Document | Contents |
|---|---|
| [`PROJECT_PLAN.md`](PROJECT_PLAN.md) | Architecture, milestones, assumptions awaiting business confirmation |
| [`BUSINESS_RULES.md`](BUSINESS_RULES.md) | Cost ledger postings, budget/EAC formulas, billing, procurement, stock, approvals, periods |
| [`DATABASE_DESIGN.md`](DATABASE_DESIGN.md) | Schema, integrity guarantees, indexes, environments |
| [`TEST_PLAN.md`](TEST_PLAN.md) | Test layers, coverage, latest results, untested areas |
| [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) | Status of every module and capability |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Deployment, configuration, backup and recovery, security checklist |

## Stack

| Layer | Technology |
|---|---|
| Web | React 19, Vite 7, TypeScript, Tailwind CSS 4, React Router 7, TanStack Query, React Hook Form + Zod, Recharts, Radix UI, Lucide |
| API | Node 22, Express 5, TypeScript, Prisma 6, PostgreSQL 16, pdfkit, exceljs |
| Shared | `packages/shared`: decimal-safe calculations, permissions, modules, statuses, document types, resource metadata |
| Tests | Vitest, Supertest, React Testing Library, Playwright |

```
apps/api        Express API, Prisma schema & migrations, seed, integration tests
apps/web        React single-page app, component tests
packages/shared Calculations and metadata used by both (unit tests)
e2e             Playwright journeys
```

## Local setup

Requirements: Node 22+, npm 10+, PostgreSQL 16.

```bash
cp .env.example .env            # adjust DATABASE_URL etc.
npm install
createdb toprock                # or create it in your PostgreSQL tool
npm run db:migrate              # prisma migrate deploy
npm run db:seed                 # reference data + admin; demo data unless SEED_DEMO=false
npm run dev                     # API on :4000, web on :5173 (proxying /api)
```

Open http://localhost:5173 and sign in as `admin@toprock.example`.

### Demo data

With `SEED_DEMO` left at its default, the seed creates a **clearly flagged demo organisation**: two projects (Riverside Heights, Lakeview Apartments), 13 demo users and a year of activity. It produces this data by calling the real API as each demo user, so every figure follows the same business rules as live use. Every page of a demo project shows a **DEMO DATA** banner, and exported reports are marked the same way.

Demo sign-ins use `<user>@toprock.example` with the password from `SEED_PASSWORD`. The development default is only for local use, and seeding refuses to run in production without an explicit `SEED_PASSWORD`. Useful demo users:

| User | Role |
|---|---|
| `dinesh.kumar` | Cost Control Lead |
| `rajesh.iyer` | Project Manager |
| `vikram.shah` | Project Director |
| `arun.prakash` | Quantity Surveyor |
| `priya.natarajan` | Procurement Officer / Storekeeper |
| `karthik.s` | Site Engineer |
| `meena.ramesh` | Billing & Commercial |
| `anita.desai` | Finance Officer |
| `auditor` | Read-only auditor |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | API and web in watch mode |
| `npm run build` | Production builds (`apps/api/dist`, `apps/web/dist`) |
| `npm run typecheck` | TypeScript across all workspaces |
| `npm test` | Shared unit, API integration (needs `TEST_DATABASE_URL`) and web component tests |
| `npm run e2e` | Playwright end-to-end tests (needs PostgreSQL; uses `E2E_DATABASE_URL`) |
| `npm run db:migrate` | Apply migrations (forward-only) |
| `npm run db:seed` | Seed reference data, the admin user and optional demo data (idempotent) |
| `npm run db:reset` | **Destructive:** drop and recreate the database, then seed. Development only. |

## Docker

```bash
POSTGRES_PASSWORD=change-me docker compose up -d --build
# optional demo data:
docker compose exec -e SEED_PASSWORD='a-long-demo-password' api npm run db:seed
```

The web app is served on http://localhost:8080; nginx proxies `/api` to the API container. See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for production settings (HTTPS, `COOKIE_SECURE`, backups).

## Security model, in brief

- Cookie sessions: HttpOnly, SameSite=Lax, hashed server-side, with TTL and idle timeout. Passwords are hashed with scrypt. Accounts lock after failed sign-ins. Optional TOTP MFA.
- A CSRF header is required on every state-changing request. Helmet headers and a CORS allow-list are applied.
- Permissions are checked by the API on every request. Project membership scopes all data, and every referenced id is validated to belong to the same project or organisation.
- Approvals enforce separation of duties and approval limits.
- The cost ledger, stock ledger, audit trail and approval actions are append-only, enforced by database triggers.
- Uploads are validated by content (magic bytes) and size, and served only after an access check.
- Secrets live in environment variables, never in the database.
