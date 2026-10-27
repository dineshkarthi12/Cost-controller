# Database Design

PostgreSQL 16, accessed through Prisma 6 (`apps/api/prisma/schema.prisma`).
The schema has **113 models** and **3 enums**. Migrations live in `apps/api/prisma/migrations`. They are forward-only and applied with `prisma migrate deploy`.

| Migration | Purpose |
|---|---|
| `20261027065858_init` | Full schema: tables, foreign keys, unique constraints, indexes |
| `20261027120000_append_only_guards` | Triggers that reject `UPDATE`/`DELETE` on the cost ledger, stock ledger, audit trail and approval actions |

## 1. Conventions

| Topic | Rule |
|---|---|
| Keys | `cuid()` string primary keys. Every foreign key is declared, normally `onDelete: Restrict`. Line tables use `Cascade` from their header. |
| Money | `Decimal(18,2)`. Never floating point. All arithmetic runs on the server with `decimal.js` (`packages/shared/src/money.ts`). |
| Quantities, rates | `Decimal(18,4)` |
| Ratios (retention, tax, progress fractions) | `Decimal(9,6)` |
| Dates | Business dates are `@db.Date`. Audit timestamps are `timestamptz` (`DateTime`). |
| Status | Workflow statuses are strings validated by the API (`packages/shared/src/statuses.ts`). Ledger kinds, stock movement types and approval status are Postgres enums. |
| Tenancy | Every business row carries `orgId` (organisation-level masters) or `projectId` (project data). The API scopes every query and validates every referenced id against the same organisation or project (`assertRefsInScope`). |
| Soft state | Records are cancelled, closed or deactivated, not deleted, once they carry financial meaning. Drafts may be deleted. |
| Optimistic concurrency | Updates send `expectedUpdatedAt`. A stale write is rejected with HTTP 409. |

## 2. Domains and principal tables

### Identity and access
`Organisation`, `User`, `Role`, `Permission`, `RolePermission`, `UserRole` (organisation-wide or per project), `ProjectMember` (project access and project-level approval limit), `Session` (hashed token, expiry, idle timeout, revocation), `PasswordResetToken`, `Invitation`, `IdempotencyKey`.

### Project structure and budget
`Project`, `WbsNode`, `CostCode`, `BudgetLine` (original amount and contingency per cost code), `BudgetRevision` and `BudgetRevisionLine` (approved deltas and transfers), `CostForecast` (uncommitted ETC per cost code and period), `ReportingPeriod` and `PeriodChecklistItem`, `CashFlowPlan`.

### Cost ledger: the single source of incurred and committed cost
`CostLedgerEntry(kind: COMMITMENT | ACCRUAL | ACTUAL, amount, costCodeId, date, periodId, sourceType, sourceId, reversalOfId)`.

- Only approved documents post to it, through `services/ledger.ts`. Each posting is checked against the period of its date (`assertPeriodOpen`).
- It is append-only, enforced by a database trigger. A correction is a new entry with `reversalOfId`.
- Each cost-code position is derived by summing it. There are no stored running totals that could drift. See `BUSINESS_RULES.md` §2–3.

### Quantities and site
`BoqItem` (contract, estimated, executed, verified and certified quantities), `RateAnalysisLine` (material coefficients used for theoretical consumption), `QuantityTakeoff`, `Measurement` (MB/JMR: dimensions, formula, calculated, submitted and verified quantities, variance) and `MeasurementRevision`, `Activity` and `ActivityDependency`, `ProgressEntry`, `SiteDiary` (unique per project, date and shift), `ManpowerReport` and `ManpowerLine` (unique per project, date, shift and contractor), `Worker`, `AttendanceRecord` (unique per worker, date and shift), `Evidence` (geotag, capture time, links), `FileObject` (checksum, detected MIME type, storage key), `Attachment`, `Comment`.

### Materials, procurement and stock
`Uom`, `Material`, `Store`, `MaterialRequisition` → `PurchaseRequisition` → `Rfq` and `Quotation` (one quotation per supplier per RFQ) → `PurchaseOrder` and `PurchaseOrderLine` (ordered, received and invoiced quantities) and `PoRevision` (amendments) → `Grn` and `GrnLine` (accepted, rejected and invoiced quantities) and `Mir` → `SupplierInvoice` and `SupplierInvoiceLine` (three-way-match result stored on submit).
`StockTransaction` is the append-only stock ledger: signed quantity, unit cost and value, with weighted-average valuation serialised by an advisory lock per store and material. `MaterialIssue` and its lines cover issue, return, transfer, wastage and damage. `StockCount` and its lines post adjustments.

### Finance and commercial
`Expense`, `Payment` and `PaymentAllocation` (each allocation targets an invoice, contractor bill, client bill or expense; retention release is flagged), `Subcontract` and `SubcontractItem`, `ContractorBill` and `ContractorBillLine` (previous, current and cumulative quantities, retention, advance recovery, tax, net payable), `BillingMilestone`, `ClientBill` and `ClientBillLine` (client certification), `CreditNote`, `Contract`, `ContractClause`, `Guarantee`, `Variation` and `VariationLine`, `Claim`, `Risk`.

### Quality, safety, documents and collaboration
`ChecklistTemplate`, `Inspection`, `Ncr`, `SafetyIncident`, `ToolboxTalk`, `Document` and `DocumentRevision`, `Transmittal`, `Rfi`, `Task`, `TaskContributor`, `TaskDependency`, `TaskHandover`, `ResponsibilityAssignment` (RACI), `Notification`, `NotificationPreference`.

### Workflow, numbering, audit and administration
`WorkflowDefinition` and `WorkflowStep` (approver role or user, amount band, required approvals, SLA, escalation), `ApprovalRequest` (steps resolved at submission; `activeKey` is unique, so a document can have only one pending request) and `ApprovalAction` (append-only), `Delegation`, `DocumentType` (format, reset policy, required attachments), `NumberSequence`, `RegisterEntry` (cross-module document register), `AuditEvent` (append-only: actor, action, entity, before/after JSON, reason, IP), `IntegrationConfig` (non-secret settings only), `ImportJob` (preview rows, mapping, summary), `Closeout` and `CloseoutItem`.

## 3. Integrity guarantees enforced by the database

| Guarantee | Mechanism |
|---|---|
| Document numbers never collide | `NumberSequence` is incremented with `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the creating transaction. Every numbered table also has `@@unique([projectId, number])`. Concurrency is tested (12 simultaneous creations give 12 consecutive numbers). |
| No duplicate supplier invoice | `@@unique([supplierId, invoiceNo])` on `SupplierInvoice` |
| One MPR / diary per project, date and shift | `@@unique([projectId, date, shift, contractorKey])`, `@@unique([projectId, date, shift])` |
| One attendance record per worker, date and shift | `@@unique([workerId, date, shift])` |
| One pending approval per document | `ApprovalRequest.activeKey @unique` |
| Unique RA bill sequence per subcontract | `@@unique([subcontractId, billSeq])` |
| Codes unique per scope | Cost code, WBS, BOQ item, activity, store, worker per project. Material, party, unit and role per organisation. |
| Append-only ledgers and audit trail | `toprock_reject_mutation()` triggers on `CostLedgerEntry`, `StockTransaction`, `AuditEvent`, `ApprovalAction` |
| Referential integrity | Every relation has a declared foreign key, generated by `scripts/add-relations.py` and reviewed. Restrict on delete for anything financial. |

## 4. Indexing

There are 53 secondary indexes. Each one follows a real access path:

- `(projectId, status)` on documents for registers and queues
- `(projectId, kind)`, `(projectId, costCodeId)`, `(projectId, date)` and `(sourceType, sourceId)` on the ledger
- `(projectId, materialId, storeId)` on stock transactions
- `(userId, readAt)` on notifications
- `(orgId, createdAt)` and `(entityType, entityId)` on audit events
- `(docType, entityId)` on approval requests

## 5. Transactions and concurrency

- Every business operation that writes more than one row runs in a single interactive transaction (`transaction()` in `lib/prisma.ts`, 30 s timeout). This covers workflow decisions together with their postings, stock movements, bill creation, imports and period close.
- Stock valuation takes `pg_advisory_xact_lock(hash(store, material))` before computing the weighted average, so concurrent receipts and issues cannot corrupt the average cost.
- A failure in any posting, such as a closed period, insufficient stock or an exceeded approval limit, rolls back the whole approval.

## 6. Data lifecycle

| Data | Retention |
|---|---|
| Transactions, ledgers, audit, approvals | Kept for `settings.dataRetentionYears` (default 10). No purge job is implemented, so nothing is deleted automatically. |
| Files | Stored by the storage adapter (local disk by default) under random keys `org/project/YYYY-MM/uuid.ext`. Metadata, detected MIME type and checksum are in `FileObject`. Files are served only through the API after an access check. |
| Sessions | Expire on TTL or idle timeout; they are revoked on logout, password change and deactivation. Expired session rows are not purged automatically yet. |

## 7. Environments

| Database | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | Application | Production or development data |
| `TEST_DATABASE_URL` (name must end `_test`) | API integration tests | Migrated and **truncated** at the start of every test run. The setup refuses any other name. |
| `E2E_DATABASE_URL` (name must end `_e2e`) | Playwright | Migrated, truncated and re-seeded before every e2e run. The setup refuses any other name. |

Demo data (`npm run db:seed`) is created by driving the real HTTP API as each demo user, so every posting, approval and audit event follows production rules. The organisation and projects are flagged `isDemo`, and the UI shows a DEMO DATA banner.
