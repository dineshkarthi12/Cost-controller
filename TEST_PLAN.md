# Test Plan

This plan states what is tested automatically, how to run it, what the latest run produced, and what is **not** tested. Results below are from the final run on 2026-10-27 in the development container (Node 22, PostgreSQL 16, Chromium 1243). Nothing here is a claim of certification or of independent security testing.

## 1. How to run

```bash
npm test                 # shared + API + web suites, in sequence
npm run test -w @toprock/shared
npm run test -w @toprock/api      # needs PostgreSQL; uses TEST_DATABASE_URL (*_test) — migrated and truncated each run
npm run test -w @toprock/web
npm run e2e              # Playwright; starts its own API (:4100) and web (:5174) on a freshly seeded *_e2e database
npm run typecheck
```

The API integration tests only accept a test database whose name ends in `_test`, and the e2e setup only accepts one ending in `_e2e`. Neither touches the development or demo database.

## 2. Test layers

| Layer | Tool | Location | Scope |
|---|---|---|---|
| Calculation unit tests | Vitest | `packages/shared/test` | Decimal money, cost position, EAC/ETC, roll-ups, budget availability, RA bills, EVM, measurement formulae and variance, pricing, three-way match, GRN validation, weighted-average stock, labour cost, numbering tokens, resource schemas, role catalogue |
| API integration | Vitest + Supertest against real PostgreSQL | `apps/api/test` | Business flows through HTTP, with assertions on ledger totals, statuses, permissions and audit rows |
| Web components | Vitest + React Testing Library (jsdom) | `apps/web/test` | Dialog, table and badge behaviour, login flow with mocked API, pure UI logic |
| End-to-end | Playwright (Chromium) | `e2e/` | Real browser against the real API and database, desktop and mobile viewports |
| Route smoke test (manual script, not in CI) | Playwright | dev only | All 75 list, tab and admin routes plus 48 record detail and new-record pages loaded as an administrator with zero console errors and zero failed API calls |

## 3. Coverage by requirement

| Requirement | Automated evidence |
|---|---|
| Authentication | Unauthenticated → 401. Wrong password → 401 with a generic message. CSRF header required. HttpOnly + SameSite cookie. No password hash in responses. Lockout after 5 failures. Logout revokes the session server-side. Deactivation revokes live sessions. (`auth.test.ts`) |
| Role-based access (backend) | Non-members cannot read project data. A site engineer can raise MRs but not budgets, PRs or POs. The auditor is read-only. Admin endpoints are refused for non-admins. (`access.test.ts`) |
| Role-based access (frontend) | A site engineer sees permission denied on `/admin/users` and no admin actions, and the API independently returns 403 (`journey.spec.ts`) |
| Data separation | Cross-organisation project reads → 404. Referencing another project's cost code or another organisation's supplier → 422. (`access.test.ts`) |
| Workflow and separation of duties | The submitter cannot approve at any step, and their own items are hidden from their inbox. Return → correct → resubmit keeps both requests and the audit trail. A rejection posts no cost. Amount-banded steps. The approval limit is enforced at the final step, and raising the limit then allows approval. Approved records cannot be edited. (`workflow.test.ts`, `journey.spec.ts`) |
| Document numbering | 12 concurrent creations give 12 unique, consecutive numbers (`workflow.test.ts`) |
| Cost ledger, no double counting | PO → commitment (net of tax). GRN → accrual and commitment relief. Invoice → accrual reversal and actual. Invoice before goods → actual once, and the later GRN posts nothing. Stock issue posts no cost. Subcontract → commitment. Certified RA bill → actual and commitment relief. Budget position = BAC − incurred − commitments, and EAC = incurred + ETC. (`procurement.test.ts`, `billing.test.ts`) |
| Ledger immutability | Database triggers reject UPDATE/DELETE on the cost ledger, stock ledger and audit trail (`procurement.test.ts`) |
| Contract clauses | Validated interpretations survive unrelated contract edits and are cleared when the interpretation changes (`workflow.test.ts`) |
| Three-way match and duplicates | Price above tolerance → `EXCEPTION`. Over-receipt GRN refused. Duplicate supplier invoice number refused. (`procurement.test.ts`) |
| Stock | Receipt increases balance. An issue beyond the balance is refused and rolled back. Issues are valued at weighted average cost. (`procurement.test.ts`) |
| Measurement and billing | The recorder cannot verify their own measurement. Variance is recorded. Certification goes through the workflow. Progress alone is never billable. RA bill amounts are computed on the server (work value, retention, tax, net). The same quantity cannot be billed twice. (`billing.test.ts`) |
| Period close | Cannot close with pending checklist items. A waiver needs a note. Reviewer sign-off closes the period. A posting into the closed period is refused and rolled back. Only `period.reopen` holders can reopen, and only with a reason (≥ 10 characters), which is audited. (`periods.test.ts`) |
| Imports | Preview validates every row (number format, duplicates in file, unknown references) without writing. Commit is refused while errors exist unless the user skips them. A job cannot be committed twice. Error CSV neutralises formulas. Import permission required. (`imports.test.ts`) |
| Reports and exports | CSV, PDF and XLSX exports download from the UI with correctly named, non-empty files (`journey.spec.ts`) |
| Responsive and mobile | Bottom navigation and capture entry are present, with no horizontal overflow on the dashboard, evidence, MR list or manpower pages at Pixel 7 size (`mobile.spec.ts`) |
| Forms | Successful save navigates without a false "unsaved changes" prompt. Required-reason dialogs block empty reasons. (`journey.spec.ts`, `components.test.tsx`) |
| Containers | The API and web images were built and run with Docker. Migrations were applied, health was OK, admin login went through nginx, SPA deep links were served, and security headers were present. This was checked by hand, not in an automated suite. |

## 4. Latest results

| Suite | Result |
|---|---|
| `@toprock/shared` unit | **25 / 25 passed** |
| `@toprock/api` integration | **50 / 50 passed** (7 files) |
| `@toprock/web` components | **11 / 11 passed** (3 files) |
| Playwright e2e | **5 / 5 passed** (4 desktop journeys, 1 mobile) |
| Typecheck (shared, api, web with `noUnusedLocals`) | **passing** |
| Production build (`vite build`, `tsup`) | **passing** |

Defects found by these tests and fixed during this phase:
1. Cost was double-counted when an invoice was approved before the goods receipt.
2. Site engineers could create purchase orders; MR rights are now a separate `requisition` permission.
3. Approval inboxes listed the user's own submissions.
4. A false "unsaved changes" dialog appeared after saving.
5. nginx dropped the security headers on SPA routes.
6. An empty `SEED_PASSWORD` produced blank demo passwords.

## 5. Not tested (known gaps)

These have **not** been verified by an automated test:

- **MFA (TOTP)** enrol, verify and disable flows, password reset and invitation acceptance (implemented; exercised only manually).
- **Client billing**, receipts, retention release, credit notes, variations → budget revision, claims, PO amendment and short-close, RFQ comparison and award, equipment log costing, MPR own-labour costing. All of these run during the demo seed through the real API, but no assertions check their numbers.
- **Offline mode**: draft persistence and the IndexedDB photo queue are untested in automation.
- **File uploads**: magic-byte rejection, size limits and evidence geotag handling have no dedicated tests.
- **Escalation and recurring-task jobs** (time-based) are untested.
- **Load, performance and concurrency** beyond the numbering test are untested. There is no soak testing.
- **Security**: no penetration test, dependency audit sign-off or OWASP ASVS assessment has been performed. The controls listed in section 3 are functional tests of intended behaviour, not a security certification.
- **Accessibility**: labels, roles and keyboard use are applied throughout and used by the e2e locators, but there has been no axe or screen-reader audit.
- **Browsers**: only Chromium has been tested; Safari and Firefox have not.
- **Integrations**: none is implemented, so there is nothing to test end to end. The "Test" button always reports "not implemented".

## 6. Recommended next tests

1. Client bill → client certification → receipt → AR aging, asserting amounts.
2. Variation approval creating a budget revision, and the BAC change.
3. PO amendment and short-close commitment deltas.
4. File upload rejection (spoofed extension, oversize) and evidence access across projects.
5. MFA enrolment, then a login challenge.
6. Axe accessibility scan on the top 20 pages.
7. A k6 load test on dashboard, budget and ledger endpoints with a realistic data volume.
