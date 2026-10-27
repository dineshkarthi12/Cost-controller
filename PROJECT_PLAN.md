# TOPROCK GLOBAL — Construction Cost Control Management System
## Project Plan

### 1. Repository inspection (Phase 0 findings)

| Item | Finding |
|---|---|
| Existing code | None. The repository was empty (no commits) when work started. |
| Existing stack | None, so the recommended stack from the brief is adopted unchanged. |
| Brand assets | The TOPROCK GLOBAL logo was supplied as an image attachment. It is stored unmodified at `assets/brand/toprock-logo-original.png`. Web copies in `apps/web/public/brand/` are **cropped to remove surrounding whitespace and scaled proportionally**. They are not redrawn, recoloured or distorted. |
| UI reference | The supplied dashboard/mobile collage is used as visual direction only. Each screen is built as a real page from reusable components. |
| Runtime available | Node 22, npm 10, PostgreSQL 16 and Chromium + Playwright 1.63. |

### 2. Architecture

```
/
├─ apps/
│  ├─ api/            Express 5 + TypeScript REST API, Prisma ORM, PostgreSQL
│  │  ├─ prisma/      schema.prisma, migrations/, seed (demo data, clearly flagged)
│  │  └─ src/
│  │     ├─ lib/          prisma client, logger, errors, http helpers, decimal utils
│  │     ├─ middleware/   auth (cookie session), RBAC, project scope, validation, rate limits
│  │     ├─ services/     business logic (no Express types): numbering, workflow, ledger,
│  │     │                budget/forecast, procurement, stock, measurement, billing, periods…
│  │     ├─ resources/    declarative CRUD resource registry (generic list/get/create/update)
│  │     └─ routes/       thin HTTP adapters per module
│  └─ web/            React 19 + Vite + TypeScript + Tailwind CSS 4
│     └─ src/
│        ├─ components/   ui kit (accessible primitives), layout shell, data table, forms
│        ├─ features/     one folder per module (pages + hooks)
│        └─ lib/          API client, auth context, query client, offline queue, drafts
├─ packages/
│  └─ shared/         Code shared by API and web: navigation/module registry, permission
│                     catalogue and default roles, resource field metadata, status
│                     vocabularies, decimal-safe money helpers and pure calculation
│                     functions (budget, EAC/ETC, EVM, bills, measurements, matching)
├─ e2e/               Playwright end-to-end scenarios
└─ docker/, docker-compose.yml
```

**Key design decisions**

1. **One cost ledger.** Every module that affects cost posts typed entries (`COMMITMENT`, `ACCRUAL`, `ACTUAL`) to a single `CostLedgerEntry` table through `ledgerService`. Dashboards, budget control, forecasts and reports read from that ledger, so they cannot disagree and nothing is double-counted (see `BUSINESS_RULES.md`).
2. **Declarative resources and custom services.** Simple registers (risks, RFIs, toolbox talks, equipment and similar) use a metadata-driven resource framework. The same field definitions in `packages/shared` drive server-side Zod validation and the client-side forms and tables. Financially sensitive flows (PO, GRN, invoices, bills, measurements, stock, budgets, periods) have hand-written services with database transactions.
3. **Workflow engine.** Status changes for controlled documents happen only through `/approvals` endpoints, never through generic `PATCH`. The engine supports configurable steps, amount thresholds, parallel approval counts, delegation, separation of duties, return for correction, escalation and full history.
4. **Database-enforced numbering.** `NumberSequence` rows are incremented atomically (`UPDATE … RETURNING`) inside the creating transaction. Each document table also has a unique constraint on its number.
5. **Server-side truth.** All amounts are recalculated on the server with `decimal.js` and stored as `NUMERIC(18,2)` (money) or `NUMERIC(18,4)` (quantities and rates). Totals sent by the client are ignored.
6. **Security.** Sessions use HttpOnly cookies with a server-side session table (revocable), scrypt password hashing, optional TOTP MFA, and rate limits on authentication. Mutating requests require a custom header as CSRF defence. Permissions are checked on both the backend and the frontend, and every query is filtered by project membership.

### 3. Milestones

| Phase | Scope | Exit criteria |
|---|---|---|
| 0 | Inspection, plan, database design, business rules, test plan | Documents committed |
| 1 | Monorepo, brand system, app shell, auth, RBAC, organisation/projects, schema + migrations, audit, numbering, API conventions | Login works, project-scoped access is enforced, tests pass |
| 2 | Dashboard, WBS/cost codes, BOQ, budget control, expenses, forecast (EAC/ETC/EVM), core reports | Ledger-driven KPIs are correct under test |
| 3 | Manpower, site diary, work progress, schedule, quantity takeoff, measurement book/verification, site evidence | Measurement-to-certification flow is tested |
| 4 | Materials, MR, PR, RFQ, PO, GRN, MIR, stock ledger, issues, reconciliation | MR→PR→PO→GRN→invoice three-way match is tested |
| 5 | Subcontracts and RA bills, client billing, AP/AR, payments, retention, cash flow, variations, contracts, claims | Bill calculations and certification are tested |
| 6 | Team/RACI, tasks (board/list/calendar), approvals inbox, documents/revisions, transmittals, RFIs, notifications, audit views | Reject/resubmit flow is tested |
| 7 | Quality/NCR, safety, equipment, month-end close, closeout, imports/exports, PDF, integration interfaces | Period close blocks posting; import preview works |
| 8 | Unit, integration and E2E tests, accessibility, responsive and security review, deployment docs | `npm test` and `npm run e2e` are green |

`IMPLEMENTATION_STATUS.md` records the honest state of each module.

### 4. Assumptions and unresolved business decisions

Each item is documented here and made configurable where practical (Settings → Organisation, or workflow configuration).

| # | Decision | Assumption taken | Configurable? |
|---|---|---|---|
| A1 | Is non-recoverable tax part of cost? | **Confirmed by TOPROCK (27 Oct 2026):** GST is claimed as input tax credit, so tax is **excluded** from cost | Yes (`settings.taxIsCost`) |
| A2 | When is material cost recognised? | Accrual on accepted GRN quantity, then actual on approved supplier invoice. Material issues do not re-post cost. | Documented. Changing it would need a migration of rules. |
| A3 | Direct labour cost | Verified MPR lines for **own labour** post actual cost. Subcontractor labour is costed through their RA bills only, to avoid double counting. | Per-line `chargeable` flag |
| A4 | Owned equipment cost | Approved equipment logs post actual cost at the internal hourly rate. Rented equipment is costed via supplier invoice or expense. | Per-equipment ownership |
| A5 | Manpower uniqueness | One report per project + date + shift + contractor | Yes (`settings.manpowerUniqueness`) |
| A6 | Retention / advance | **Confirmed by TOPROCK (27 Oct 2026):** retention % applies to each bill's current gross work value, stopping at the cap. Advance recovery % applies to current gross work value, capped at the outstanding advance. | Per subcontract / project |
| A7 | Financial periods | Monthly calendar periods per project | Period table allows custom ranges |
| A8 | Currency | Single base currency per project (default INR, ₹). Multi-currency is stored per document but not revalued. | Per project |
| A9 | Document abbreviations | Seeded defaults (MR, PR, PO, GRN, MIR, MB, JMR, RA…) | Yes (Document Types) |
| A10 | Approval chains | Seeded sensible defaults per document type with amount thresholds | Yes (Workflow settings) |
| A11 | Storage | Local disk adapter in development. An S3-compatible adapter interface is defined but **not active**. | `STORAGE_DRIVER` env |
| A12 | Email | SMTP email is implemented (invitations, password resets, approval and task alerts). TOPROCK will start with a personal Gmail and move to the official company mailbox after MD approval; only environment variables change. | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` |
| A13 | Photo authenticity | Upload time and uploader are recorded by the server. Client-supplied capture time and GPS are stored as *unverified claims*. | n/a |

### 5. Out of scope / not claimed

- No external accounting, ERP, payroll or scheduling integration is active. **Confirmed by TOPROCK (27 Oct 2026): none is needed now**; data moves through Excel/CSV import and report exports.
- No security certification or penetration test has been performed.
- Docker files are provided, but Docker was not exercised in the build environment unless stated in `IMPLEMENTATION_STATUS.md`.
