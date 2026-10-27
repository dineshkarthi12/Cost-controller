# Implementation Status

As of 2026-10-27. Status words have fixed meanings:

| Status | Meaning |
|---|---|
| **Working** | Backend rules, UI, permissions and audit in place, and exercised end to end (demo seed through the real API, or browser) |
| **Working · tested** | As above, plus automated tests that assert its behaviour (see `TEST_PLAN.md`) |
| **Partial** | Usable, but a listed part of the specification is missing |
| **Interface only** | Configuration screens and adapters exist, but nothing connects to an external system |
| **Not started** | Not implemented |

All 48 modules open a real page backed by the API. No screen is a static mock-up.

Many registers use the shared **resource framework**: field metadata in `packages/shared/src/resources` drives server-side Zod validation, scoping, numbering, workflow and audit, as well as the web list, form and detail pages. The framework gives each register filters, search, sorting, pagination, CSV export, comments, attachments, evidence links, approval timeline and history. Modules with specialised behaviour add their own pages or detail-page extensions.

## Modules

| # | Module | Status | What exists | Gaps |
|---|---|---|---|---|
| 1 | Dashboard | Working | Cost KPIs from the ledger (BAC, incurred, committed, remaining, EAC, CV, CPI/SPI), progress by WBS, cost trend, distribution, alerts, operations widgets, approvals, date filter | Portfolio view is basic |
| 2 | Projects | Working | Create/edit with optional standard template (WBS, cost codes, main store), members, project roles, project-level approval limits, status, demo flag | — |
| 3 | Approvals & Workflow | Working · tested | Inbox, history, approve/return/reject/withdraw, delegation, SLA/overdue, escalation job, SoD, final-step approval limit | Escalation job not covered by tests |
| 4 | Tasks & Issues | Working | My tasks, Kanban (drag and drop), list, calendar, contributors, dependencies, handover, recurring tasks, overdue alerts | No automated tests |
| 5 | Team Management | Working | Workload chart, RACI matrix, profiles (skills, backup, manager), responsibility templates | — |
| 6 | Notifications | Working · tested | In-app notifications with links, read state and preferences. Email alerts (approvals, returns, rejections, task assignments by default; others opt-in), sent only after the change commits | Email needs SMTP settings in the hosting environment |
| 7 | Manpower | Working | MPR with workflow (verified own labour posts ACTUAL), attendance register with audited corrections, MPR from attendance, workers | Payroll export not implemented |
| 8 | Daily Site Diary | Working | DPR with workflow, weather, stoppages, links to same-day registers | — |
| 9 | Work Progress | Working | Weighted physical progress, planned vs actual, progress entries (never billable) | — |
| 10 | Planning & Schedule | Working · tested | Activities, baselines, dependencies (FS/SS/FF/SF with lag, loops refused), critical path (CPM) forecast from the data date with total and free float, forecast vs planned finish, Gantt with critical activities highlighted, 3-week look-ahead, milestones, delays. Import from Microsoft Project XML and Primavera P6 XER with preview (activities matched by code, links replaced) | Calendar days only (no working-day or holiday calendars); no resource levelling |
| 11 | Site Evidence & Photos | Working | Camera capture on mobile, multi-upload, offline upload queue (IndexedDB), magic-byte validation, geotag and capture time, review, links to records | Offline queue not covered by tests |
| 12 | Equipment & Machinery | Working | Register, daily logs with workflow (owned equipment posts ACTUAL), maintenance, utilisation analysis | Rental invoicing is via supplier invoices |
| 13 | WBS & Cost Codes | Working · tested | WBS, cost codes, import with preview | — |
| 14 | BOQ & Estimation | Working · tested | BOQ items, quantities (contract, executed, verified, certified), rate analysis lines, import | Rate analysis is edited via seed/API, not a dedicated editor |
| 15 | Quantity Takeoff | Working | Takeoff sheets with formulae | — |
| 16 | Measurement Book | Working · tested | MB/JMR, dimension formulae, duplicate detection with reason, certification workflow | — |
| 17 | Measurement Verification | Working · tested | Queue, verify (SoD), variance, return for correction | — |
| 18 | Material Management | Working | Materials, units, stores, suppliers and parties, imports | — |
| 19 | Material Requisition | Working · tested | MR with workflow and its own `requisition` permission | — |
| 20 | Purchase Requisition | Working | PR from MR, budget check (warn/block setting), workflow | — |
| 21 | RFQ & Quotations | Working | RFQ from PR, quotations, comparison, award to PO | No automated tests |
| 22 | Purchase Orders | Working · tested | PO from PR or award, workflow, PDF, amendments (workflow), short-close, reconciliation | Amendment/short-close not covered by tests |
| 23 | Goods Receipt | Working · tested | GRN against PO lines, over-receipt control, accrual posting, stock receipt | — |
| 24 | Material Inspection | Working | MIR with workflow updating GRN inspection status | — |
| 25 | Material Issue & Consumption | Working · tested | Issue, return, transfer, wastage and damage with workflow, WAC valuation, insufficient-stock guard | — |
| 26 | Inventory & Reconciliation | Working · tested | Balances, stock ledger, opening stock (form and import), physical counts, theoretical vs actual consumption | — |
| 27 | Cost & Expenses | Working · tested | Expenses with banded workflow, ACTUAL posting | — |
| 28 | Budget Control | Working · tested | Original budget, baseline lock, revisions and transfers (workflow), cost-code positions, cost ledger drill-down | — |
| 29 | Cost Forecasting | Working | Manual or remaining-budget ETC per cost code and period, history | No statistical forecasting |
| 30 | Cash Flow | Working | Planned vs actual in/out, cumulative, plan register | — |
| 31 | Accounts Payable & Payments | Working · tested (invoices) | Supplier invoices with three-way match, duplicate guard, aging, payments with allocations (invoices, bills, expenses, retention release) | Payments not covered by tests |
| 32 | Month-End Closing | Working · tested | Checklist with live counts, waive with note, sign-off workflow, posting lock, audited reopen | — |
| 33 | Subcontractor Management | Working · tested (commitment) | Subcontracts with items, compliance and insurance expiry, reconciliation | — |
| 34 | Subcontractor Billing | Working · tested | RA bills from certified quantities, retention, advance recovery, tax, certification workflow, PDF, payments | — |
| 35 | Client Billing & Receivables | Working | IPC from certified quantities, client certification, disputes, receipts, AR aging, milestones, credit/debit notes | **Not covered by automated tests** |
| 36 | Contract Administration | Working · tested (clauses) | Contracts, key terms, source clauses with unofficial interpretation and validation (kept across unrelated edits), guarantees and insurance | No automatic obligation extraction (deliberately) |
| 37 | Change Orders & Variations | Working | Variations with workflow; approved cost impact creates a budget revision (setting) | Not covered by tests |
| 38 | Risks & Claims | Working | Risk register (score, exposure), claims and EOT | — |
| 39 | Quality & Rework | Working · tested | Inspections, ITP / checklist templates (hold, witness and review points with acceptance criteria and references), template applied to an inspection, per-item pass / fail / N/A with remarks, hold points released only by quality approvers before later checks, overall result driven by the checklist, NCR raised from a failed check (pre-filled), NCR with root cause, corrective action and estimated rework cost | Actual rework cost is entered as an expense. Checklist photos are attached to the inspection, not to individual checks |
| 40 | Safety & Inspections | Working | Incidents and observations, toolbox talks | No permit-to-work |
| 41 | Drawing & Document Control | Working | Register, revisions with approval workflow, confidentiality | No file viewer or markup |
| 42 | Transmittals & RFIs | Working | Transmittals (send, acknowledge), RFIs | — |
| 43 | Reports & Analytics | Working · tested (export) | 55 server-computed reports (the catalogue is filtered by each user's permissions); CSV, XLSX and branded PDF export (audited, demo-flagged) | No scheduled or emailed reports |
| 44 | Project Closeout | Working | Checklist, live open-item indicators, final cost, lessons learned, approval, archive | — |
| 45 | Users, Roles & Permissions | Working · tested | Invite by email (one-time link shown to the admin if email is not set up), edit, deactivate (revokes sessions), role/permission matrix, reset to defaults | — |
| 46 | Audit Trail | Working · tested | Append-only (database-enforced), filters, before/after diff | — |
| 47 | Integrations | Working (email) · Interface only (others) | Email (SMTP) status and "send test email". Accounting/ERP catalogue (Tally, SAP, Zoho Books, payroll, S3, Primavera, MS Project) with non-secret configuration; import history. Primavera and MS Project schedules are imported as files on the Schedule page, not through a live connection | **No accounting/ERP connector is active, and TOPROCK confirmed none is needed now.** |
| 48 | Settings | Working | Business rules, visible modules, document numbering, workflow designer | — |

## Cross-cutting capabilities

| Capability | Status | Notes |
|---|---|---|
| Authentication | Working · tested | Cookie sessions (hashed tokens, TTL plus idle timeout), scrypt hashing, lockout, password reset, invitations, TOTP MFA. MFA and reset are not covered by automated tests. |
| RBAC | Working · tested | 34 areas × view/manage/approve plus 9 special permissions (111 in total), 21 default roles, project-scoped roles. Enforced by the API; the UI only hides what you cannot do. |
| Data separation | Working · tested | Organisation and project scoping, with every referenced id validated |
| Cost ledger | Working · tested | Commitment / accrual / actual, append-only, period-locked |
| Numbering | Working · tested | Database sequences, configurable formats and reset policies |
| Imports | Working · tested | BOQ, cost codes, materials, suppliers, opening stock: preview, mapping, error report, commit |
| Exports | Working · tested | CSV, XLSX, PDF |
| Mobile and responsive | Working · tested (layout) | Bottom navigation, camera capture, drawer, card lists, no horizontal overflow on tested pages |
| Offline | Partial | Form drafts (localStorage) and a photo upload queue (IndexedDB) with sync status. **Other data entry is not available offline.** |
| File storage | Working (local); Vercel Blob implemented | Local disk adapter. Vercel Blob adapter (private access) is used automatically when `BLOB_READ_WRITE_TOKEN` is set; it has not been tested against a real Blob store. The S3 adapter is an interface only and not active. |
| Email | Working · tested | SMTP via nodemailer (Gmail, Microsoft 365 or any SMTP). Tested with real SMTP delivery to a local test server; delivery through Gmail has not been tested here (needs your app password). |
| Containers | Working | API and web images built and run (`docker-compose.yml`). See `docs/OPERATIONS.md`. |
| Vercel hosting | Configured, not yet deployed | `vercel.json`, a serverless function and a build script that migrates and seeds. Daily cron for jobs. Browser photo shrinking for the 4.5 MB request limit. The build, function bundle and handler were verified locally (`docs/DEPLOY_VERCEL.md`); a real Vercel deployment has not been done. |

## Known limitations and decisions to confirm

1. When no project has been chosen yet, the current project defaults to the user's first project in alphabetical order, and the choice is remembered once the user switches.
2. A new RA bill does not include quantities from an earlier bill that is still in approval; prepare bills one at a time.
3. Client billing, variations → budget, PO amendments, payments and MFA run correctly in the seeded demo but lack automated assertions (`TEST_PLAN.md` §5).
4. No security penetration test, accessibility audit or load test has been performed. No compliance certification is claimed.
5. TOPROCK confirmed A1 (GST excluded from cost), A6 (retention on each bill's work value), A12 (Gmail first, company mail later) and that no accounting integration is needed now. The other assumptions in `PROJECT_PLAN.md` §4 keep their defaults.
