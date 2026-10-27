# Business Rules & Calculation Definitions

This document is the single reference for how TOPROCK GLOBAL figures are calculated. The pure functions that implement these rules live in `packages/shared/src/calc/` and are unit-tested in `packages/shared/test/`.

## 1. Numeric handling

- Money is stored as `NUMERIC(18,2)`. Quantities, rates and percentages are stored as `NUMERIC(18,4)`.
- All arithmetic uses `decimal.js` (never JS floating point). Values cross the API as **strings**.
- Rounding is **half-up to 2 decimals** for money, applied at line level and then summed. Quantities are rounded to 3 decimals. The rounding mode is configurable in `settings.rounding`.
- The server recomputes every derived amount. Any client-sent totals are discarded.

## 2. The cost ledger

Each project cost event writes one or more `CostLedgerEntry` rows `(project, costCode, date, period, kind, amount, sourceType, sourceId)`. Entries are **append-only**. A correction is a reversal entry (`reversalOfId`), never an update or delete.

| Kind | Meaning |
|---|---|
| `COMMITMENT` | Open (uninvoiced or uncertified) value of approved POs and subcontracts |
| `ACCRUAL` | Value of goods/services received but not yet invoiced (accepted GRN quantities) |
| `ACTUAL` | Cost recognised from an approved invoice, certified bill, approved expense, verified own-labour MPR or approved owned-equipment log |

### Posting rules (amounts exclude tax unless `settings.taxIsCost = true`)

| Event | Posting |
|---|---|
| PO approved | `COMMITMENT +` PO net value (after discount), per line cost code |
| PO amended (approved) | `COMMITMENT ±` delta between new and old open value |
| PO cancelled / short-closed | `COMMITMENT −` remaining open value |
| GRN approved | per accepted qty × PO net rate: `ACCRUAL +v`, `COMMITMENT −v`. Quantity already invoiced ahead of receipt is excluded (it is already in `ACTUAL` and its commitment was relieved by the invoice). |
| Supplier invoice approved (PO-backed) | per matched GRN value `ACCRUAL −v` (FIFO over approved GRN lines). Invoice net value is posted as `ACTUAL +`. Quantity invoiced beyond what was received relieves `COMMITMENT −` instead. Price variance stays in `ACTUAL`. |
| Supplier invoice approved (non-PO) | `ACTUAL +` invoice net |
| Subcontract approved | `COMMITMENT +` contract value |
| Contractor RA bill certified | `ACTUAL +` current gross work value. `COMMITMENT −` min(current value, open commitment). |
| Expense approved (not linked to a PO/invoice) | `ACTUAL +` amount before tax |
| Expense linked to an invoice | No posting (the invoice posts) |
| MPR verified (own labour lines, `chargeable`) | `ACTUAL +` labour cost |
| Equipment log approved (owned) | `ACTUAL +` working hours × internal hourly rate |
| Material issue / transfer | **No cost posting.** Cost was recognised at receipt. Issues drive consumption and reconciliation. |
| Payment | **No cost posting.** Payments affect cash flow and payables only. |

## 3. Budget and forecast definitions (per cost code, rolled up to project)

| Metric | Formula | Notes |
|---|---|---|
| Original Budget (OB) | Σ `BudgetLine.originalAmount` | Frozen once the baseline is approved |
| Approved Revised Budget (BAC) | OB + Σ approved `BudgetRevisionLine.delta` | Transfers net to zero. **Pending revisions and unapproved variations are excluded.** |
| Actual Cost (AC) | Σ ledger `ACTUAL` | |
| Accrued Cost | Σ ledger `ACCRUAL` | |
| Cost Incurred to Date | AC + Accrued | Accounting basis: accrual |
| Open Commitments | Σ ledger `COMMITMENT` | |
| Pending (unapproved) cost | Σ submitted-but-unapproved invoices, bills and expenses | Shown separately. **Never** included in AC. |
| Remaining Budget | BAC − Cost Incurred − Open Commitments | Can be negative (overrun) |
| Uncommitted ETC | Manual forecast entry for the period. Default = max(Remaining Budget, 0) | Method recorded per entry (`MANUAL`, `REMAINING_BUDGET`, `CPI`) |
| Estimate to Complete (ETC) | Open Commitments + Uncommitted ETC | |
| Estimate at Completion (EAC) / Forecast Final Cost | Cost Incurred + ETC | |
| Cost Variance (CV) | BAC − EAC | Positive = saving, negative = overrun |
| CV % | CV ÷ BAC | Shown as “—” when BAC = 0 |
| Pending variation exposure | Σ cost impact of variations in `SUBMITTED` / `PENDING_CLIENT` / `DISPUTED` | Displayed as a risk, not as budget |
| Contingency | Σ `BudgetLine.contingencyAmount` | Part of BAC, shown separately |

### Overrun alerts
- **Warning:** cost incurred + open commitments ≥ 95% of BAC (budget consumption; configurable `settings.alertWarnPct`).
- **Critical:** EAC > BAC, or Remaining Budget < 0.

### Earned value (project level, when activities have baselines and weights)

- Physical % (P) = Σ(activity weight × activity % complete) ÷ Σ weights.
- Planned % at date (PP) = Σ(weight × linear baseline % at the date) ÷ Σ weights.
- PV = BAC × PP, EV = BAC × P, AC = Cost Incurred.
- CPI = EV ÷ AC. SPI = EV ÷ PV.
- **Not calculable** (shown with a reason) when there are no weighted activities, no baseline dates, or AC = 0 (for CPI) or PV = 0 (for SPI).

### Progress
- **Physical progress** = weighted activity % complete (above).
- **Financial progress** = Cost Incurred ÷ BAC.
- Reported progress **never** becomes certified quantity automatically. Certification goes through measurement verification.

## 4. Measurement rules

- Calculated qty = nos × length × width × depth/height, using only the dimensions entered (blank = 1, at least one dimension or `nos` required), or count for `NOS` units. A custom formula is recorded but the server recomputes from dimensions.
- Lifecycle: `DRAFT → SUBMITTED → VERIFIED (or RETURNED) → [approval] → CERTIFIED`. Also `REJECTED` and `CANCELLED`.
- Variance = verified qty − submitted qty.
- **Duplicate check:** same BOQ item + location + floor + grid/chainage and an identical calculated qty in an active state. The server blocks it unless the user supplies `duplicateReason`, which is audited.
- Only `CERTIFIED` measurements not yet billed can be pulled into a contractor or client RA bill. Billing them sets `billedOn…Id` so they cannot be billed twice.
- A verified evidence photo **does not** verify or certify a measurement.

## 5. Subcontractor & client RA bill calculation

For bill *n* of a contract:

```
lineAmount_i        = round2(cumulativeQty_i × rate_i)
grossToDate         = Σ lineAmount_i + approvedVariationsToDate
previousGross       = grossToDate of the last certified bill (0 if none)
currentWorkValue    = grossToDate − previousGross
retention           = round2(currentWorkValue × retentionPct)      (capped so cumulative
                                                                    retention ≤ retentionCapPct × contractValue)
advanceRecovery     = min(round2(currentWorkValue × advanceRecoveryPct), advanceOutstanding)
tax                 = round2(currentWorkValue × taxRate)
netPayable          = currentWorkValue + tax − retention − advanceRecovery − otherDeductions
```

- Submission **never** certifies. Certification requires the workflow approval.
- Certified, invoiced and paid amounts are tracked separately (`certifiedAmount`, invoice, payment allocations).
- Retention payable/receivable = Σ retention of certified bills − Σ retention released.

## 6. Procurement rules

- MR → PR → (RFQ/quotations) → PO → GRN (+MIR) → Supplier invoice → Payment. Each step references its predecessor.
- **Budget check on PR/PO submit:** Remaining Budget of each cost code minus the document value. A negative result flags `budgetExceeded`. Configurable `settings.budgetCheckMode = WARN | BLOCK`.
- **GRN:** accepted + rejected = received. Cumulative accepted ≤ ordered qty × (1 + `settings.overReceiptTolerancePct`).
- **Three-way match** (per invoice line): invoiced qty ≤ accepted (GRN) qty − previously invoiced qty, and invoice rate within `settings.priceTolerancePct` of the PO rate. Failure sets invoice status `EXCEPTION` with reasons. An approver may still approve with a comment (audited).
- **Duplicate invoice detection:** hard DB unique on (supplier, invoice number). Soft warning for the same supplier + amount + date within ±3 days.
- Issuing a PO is not cost. Approving an invoice is not payment. A payment is not an invoice.

## 7. Stock rules

- Every movement is a `StockTransaction` with a signed quantity. Balance = Σ qty per (store, material).
- Valuation uses the **weighted average cost** per (store, material), recalculated on each receipt. Issues are valued at the current weighted average.
- An issue cannot exceed available stock (row lock on store/material during posting).
- Corrections use `ADJUSTMENT` or `REVERSAL` transactions with a reason. They never update or delete existing rows.
- Theoretical consumption = Σ (executed qty × material coefficient from rate analysis). Variance = actual issues − theoretical.

## 8. Approvals & separation of duties

- Controlled documents change status **only** via the workflow engine.
- A user may not approve a request they submitted unless the workflow definition sets `allowSelfApproval`.
- A step applies only if the document amount is within the step's `[minAmount, maxAmount]`.
- An approver's `approvalLimit` (project membership, falling back to user; blank = no limit) must be ≥ the document amount for financial document types. The limit is checked for the approver who completes the **final** step (final authorisation). Earlier steps are recommendations.
- Delegations are honoured only within their date range, and only if the delegate holds the approve permission for the module.
- Approval inboxes never list a user's own submissions unless self-approval is allowed for that workflow.
- Material requisitions (`requisition.*`) are separate from purchasing (`procurement.*`): site engineers and storekeepers raise MRs; only procurement roles create PRs, RFQs and POs.
- Completing a task **never** approves the linked document.

## 9. Periods

- Posting dates fall in a reporting period. Posting into a `CLOSED` period is rejected.
- Close requires all checklist items to be complete or explicitly waived with a note, plus reviewer sign-off.
- Reopening requires the `period.reopen` permission and a reason (audited).

## 10. Document numbering

Default format: `{PROJECT}-{ABBR}-{SEQ:4}`. Tokens: `{PROJECT}`, `{ABBR}`, `{YYYY}`, `{YY}`, `{MM}`, `{SEQ:n}`. The sequence scope resets per project and, optionally, per year or month. Uniqueness is enforced in the database.

## 11. Data display rules

- Missing data is shown as “—” with an explanation tooltip, never as 0, unless 0 is the true value.
- Every KPI card states its basis (for example, “excl. tax, accrual basis”).
- Demo data is visibly flagged with a **DEMO DATA** banner (`Project.isDemo`).
