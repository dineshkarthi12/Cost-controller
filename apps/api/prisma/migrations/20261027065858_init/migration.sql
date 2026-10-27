-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('COMMITMENT', 'ACCRUAL', 'ACTUAL');

-- CreateEnum
CREATE TYPE "StockTxnType" AS ENUM ('OPENING', 'RECEIPT', 'ISSUE', 'RETURN_TO_STORE', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN_TO_SUPPLIER', 'WASTAGE', 'DAMAGE', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT,
    "designation" TEXT,
    "department" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "approvalLimit" DECIMAL(18,2),
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responsibilities" TEXT,
    "reportingManagerId" TEXT,
    "backupUserId" TEXT,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "code" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionCode")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectRole" TEXT,
    "approvalLimit" DECIMAL(18,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mfaPending" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleCodes" TEXT[],
    "projectIds" TEXT[],
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kinds" TEXT[],
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "registrationNo" TEXT,
    "bankDetails" TEXT,
    "paymentTermsDays" INTEGER,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "rating" DECIMAL(4,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "clientId" TEXT,
    "consultantId" TEXT,
    "location" TEXT,
    "projectManagerId" TEXT,
    "startDate" DATE,
    "plannedCompletionDate" DATE,
    "actualCompletionDate" DATE,
    "contractValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "contractType" TEXT NOT NULL DEFAULT 'LUMP_SUM',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "taxRate" DECIMAL(9,6) NOT NULL DEFAULT 0.18,
    "retentionPct" DECIMAL(9,6) NOT NULL DEFAULT 0.05,
    "advanceReceived" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advanceRecoveryPct" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "reportingPeriod" TEXT NOT NULL DEFAULT 'MONTHLY',
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "closeoutStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "budgetBaselinedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WbsNode" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WbsNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCode" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsNodeId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "costCodeId" TEXT NOT NULL,
    "originalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "contingencyAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "variationId" TEXT,
    "totalDelta" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetRevisionLine" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "costCodeId" TEXT NOT NULL,
    "delta" DECIMAL(18,2) NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "BudgetRevisionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostLedgerEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "costCodeId" TEXT NOT NULL,
    "periodId" TEXT,
    "date" DATE NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "category" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceNumber" TEXT,
    "partyId" TEXT,
    "description" TEXT,
    "reversalOfId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostForecast" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "costCodeId" TEXT NOT NULL,
    "periodCode" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "uncommittedEtc" DECIMAL(18,2) NOT NULL,
    "assumptions" TEXT,
    "eacSnapshot" DECIMAL(18,2),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportingPeriod" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reopenedReason" TEXT,
    "varianceNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodChecklistItem" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "autoCount" INTEGER,
    "note" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PeriodChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashFlowPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "plannedInflow" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "plannedOutflow" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashFlowPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoqItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boqRef" TEXT,
    "itemCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "section" TEXT,
    "wbsNodeId" TEXT,
    "costCodeId" TEXT,
    "unit" TEXT NOT NULL,
    "estimatedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "contractQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "revisedQty" DECIMAL(18,4),
    "revisedRate" DECIMAL(18,4),
    "executedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "verifiedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "certifiedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "isNonBoq" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "drawingRef" TEXT,
    "specification" TEXT,
    "remarks" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoqItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateAnalysisLine" (
    "id" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "materialId" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "coefficient" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "RateAnalysisLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuantityTakeoff" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "location" TEXT,
    "drawingRef" TEXT,
    "description" TEXT,
    "nos" DECIMAL(18,4),
    "length" DECIMAL(18,4),
    "width" DECIMAL(18,4),
    "depth" DECIMAL(18,4),
    "quantity" DECIMAL(18,4) NOT NULL,
    "formula" TEXT,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuantityTakeoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MB',
    "boqItemId" TEXT NOT NULL,
    "contractorId" TEXT,
    "subcontractId" TEXT,
    "activityId" TEXT,
    "location" TEXT,
    "floor" TEXT,
    "grid" TEXT,
    "chainage" TEXT,
    "measuredOn" DATE NOT NULL,
    "nos" DECIMAL(18,4),
    "length" DECIMAL(18,4),
    "width" DECIMAL(18,4),
    "depth" DECIMAL(18,4),
    "formula" TEXT,
    "calculatedQty" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "drawingRef" TEXT,
    "submittedQty" DECIMAL(18,4) NOT NULL,
    "verifiedQty" DECIMAL(18,4),
    "variance" DECIMAL(18,4),
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "remarks" TEXT,
    "verificationNote" TEXT,
    "duplicateReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "certifiedById" TEXT,
    "certifiedAt" TIMESTAMP(3),
    "contractorBillId" TEXT,
    "clientBillId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementRevision" (
    "id" TEXT NOT NULL,
    "measurementId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeasurementRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "wbsNodeId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "boqItemId" TEXT,
    "costCodeId" TEXT,
    "unit" TEXT,
    "plannedQty" DECIMAL(18,4),
    "executedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "percentComplete" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "weight" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "baselineStart" DATE,
    "baselineFinish" DATE,
    "plannedStart" DATE,
    "plannedFinish" DATE,
    "actualStart" DATE,
    "actualFinish" DATE,
    "isMilestone" BOOLEAN NOT NULL DEFAULT false,
    "isHandover" BOOLEAN NOT NULL DEFAULT false,
    "responsibleId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "delayReason" TEXT,
    "delayParty" TEXT,
    "delayCost" DECIMAL(18,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityDependency" (
    "id" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FS',
    "lagDays" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ActivityDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "qtyDone" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "percentComplete" DECIMAL(7,4),
    "remarks" TEXT,
    "delayReason" TEXT,
    "responsibleParty" TEXT,
    "siteDiaryId" TEXT,
    "enteredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDiary" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'DAY',
    "weather" TEXT,
    "workingHours" TEXT,
    "location" TEXT,
    "activitiesPerformed" TEXT,
    "workStoppages" TEXT,
    "delays" TEXT,
    "safetyObservations" TEXT,
    "qualityObservations" TEXT,
    "instructions" TEXT,
    "visitors" TEXT,
    "remarks" TEXT,
    "nextDayPlan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedById" TEXT,
    "reviewedById" TEXT,
    "approvedById" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'DAY',
    "contractorId" TEXT,
    "contractorKey" TEXT NOT NULL,
    "remarks" TEXT,
    "totalWorkers" INTEGER NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedById" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManpowerReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManpowerLine" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'SKILLED',
    "plannedCount" INTEGER NOT NULL DEFAULT 0,
    "actualCount" INTEGER NOT NULL DEFAULT 0,
    "regularHours" DECIMAL(9,2) NOT NULL DEFAULT 8,
    "overtimeHours" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "hourlyRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "overtimeRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "chargeable" BOOLEAN NOT NULL DEFAULT true,
    "location" TEXT,
    "activityId" TEXT,
    "costCodeId" TEXT,
    "supervisor" TEXT,
    "remarks" TEXT,

    CONSTRAINT "ManpowerLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractorId" TEXT,
    "workerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'SKILLED',
    "hourlyRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'DAY',
    "status" TEXT NOT NULL,
    "regularHours" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "correctionReason" TEXT,
    "correctedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientMeta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "caption" TEXT,
    "location" TEXT,
    "activityId" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'NA',
    "pairKey" TEXT,
    "linkedType" TEXT,
    "linkedId" TEXT,
    "claimedTakenAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewComment" TEXT,
    "submittedById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "label" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Uom" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" TEXT NOT NULL DEFAULT 'COUNT',

    CONSTRAINT "Uom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "specification" TEXT,
    "reorderLevel" DECIMAL(18,4),
    "standardRate" DECIMAL(18,4),
    "batchTracked" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "keeperId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransaction" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "StockTxnType" NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "batchNo" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "refNumber" TEXT,
    "costCodeId" TEXT,
    "activityId" TEXT,
    "reason" TEXT,
    "reversalOfId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialIssue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'ISSUE',
    "storeId" TEXT NOT NULL,
    "toStoreId" TEXT,
    "date" DATE NOT NULL,
    "contractorId" TEXT,
    "activityId" TEXT,
    "costCodeId" TEXT,
    "purpose" TEXT,
    "reason" TEXT,
    "totalValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialIssueLine" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "batchNo" TEXT,
    "unitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,

    CONSTRAINT "MaterialIssueLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "countDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "systemQty" DECIMAL(18,4) NOT NULL,
    "countedQty" DECIMAL(18,4) NOT NULL,
    "varianceQty" DECIMAL(18,4) NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequisition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "department" TEXT,
    "requiredBy" DATE NOT NULL,
    "deliveryLocation" TEXT,
    "justification" TEXT,
    "costCodeId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequisitionLine" (
    "id" TEXT NOT NULL,
    "mrId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "specification" TEXT,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "stockAvailable" DECIMAL(18,4),
    "remarks" TEXT,

    CONSTRAINT "MaterialRequisitionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequisition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "mrId" TEXT,
    "requiredBy" DATE NOT NULL,
    "costCodeId" TEXT,
    "justification" TEXT,
    "estimatedTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "budgetCheck" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequisitionLine" (
    "id" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "description" TEXT,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "estimatedRate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "costCodeId" TEXT NOT NULL,
    "suggestedSupplierId" TEXT,

    CONSTRAINT "PurchaseRequisitionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "supplierIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedQuotationId" TEXT,
    "selectionJustification" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quoteRef" TEXT,
    "quotedAt" DATE NOT NULL,
    "deliveryDays" INTEGER,
    "paymentTerms" TEXT,
    "validityDays" INTEGER,
    "taxRate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "technicalScore" DECIMAL(5,2),
    "technicallyAccepted" BOOLEAN NOT NULL DEFAULT true,
    "remarks" TEXT,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "prLineId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "supplierId" TEXT NOT NULL,
    "prId" TEXT,
    "rfqId" TEXT,
    "quotationId" TEXT,
    "orderDate" DATE NOT NULL,
    "deliveryDate" DATE,
    "deliveryAddress" TEXT,
    "paymentTerms" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "terms" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "budgetCheck" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "materialId" TEXT,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "discountPct" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "costCodeId" TEXT NOT NULL,
    "prLineId" TEXT,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "invoicedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoRevision" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "proposed" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grn" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "receivedDate" DATE NOT NULL,
    "deliveryNoteNo" TEXT,
    "vehicleNo" TEXT,
    "inspectionStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "remarks" TEXT,
    "acceptedValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "receivedById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrnLine" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "poLineId" TEXT NOT NULL,
    "materialId" TEXT,
    "receivedQty" DECIMAL(18,4) NOT NULL,
    "acceptedQty" DECIMAL(18,4) NOT NULL,
    "rejectedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "invoicedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "batchNo" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "GrnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mir" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "grnId" TEXT,
    "materialId" TEXT,
    "specification" TEXT,
    "documentsRequired" TEXT,
    "documentsReceived" TEXT,
    "result" TEXT NOT NULL DEFAULT 'PENDING',
    "defects" TEXT,
    "correctiveAction" TEXT,
    "inspectorId" TEXT,
    "inspectedOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mir_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE,
    "poId" TEXT,
    "costCodeId" TEXT,
    "description" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "matchResult" JSONB,
    "duplicateWarning" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "poLineId" TEXT,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "taxRate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL,
    "costCodeId" TEXT NOT NULL,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "costCodeId" TEXT NOT NULL,
    "payeeId" TEXT,
    "payeeName" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4),
    "unitRate" DECIMAL(18,4),
    "amountBeforeTax" DECIMAL(18,2) NOT NULL,
    "taxRate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "poId" TEXT,
    "invoiceId" TEXT,
    "grnId" TEXT,
    "ncrId" TEXT,
    "externalRef" TEXT,
    "accountingRef" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT,
    "contractorBillId" TEXT,
    "clientBillId" TEXT,
    "expenseId" TEXT,
    "retentionRelease" BOOLEAN NOT NULL DEFAULT false,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subcontract" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "contractId" TEXT,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "costCodeId" TEXT NOT NULL,
    "contractValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "retentionPct" DECIMAL(9,6) NOT NULL DEFAULT 0.05,
    "retentionCapPct" DECIMAL(9,6),
    "advanceAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advanceRecoveryPct" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(9,6) NOT NULL DEFAULT 0.18,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "insuranceExpiry" DATE,
    "complianceNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subcontract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubcontractItem" (
    "id" TEXT NOT NULL,
    "subcontractId" TEXT NOT NULL,
    "boqItemId" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "SubcontractItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorBill" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "subcontractId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "billSeq" INTEGER NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "grossToDate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "previousGross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currentWorkValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "variationValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "retention" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advanceRecovery" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deductionNotes" TEXT,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "contractorInvoiceNo" TEXT,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "certifiedById" TEXT,
    "certifiedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorBillLine" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "subcontractItemId" TEXT,
    "boqItemId" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "previousQty" DECIMAL(18,4) NOT NULL,
    "currentQty" DECIMAL(18,4) NOT NULL,
    "cumulativeQty" DECIMAL(18,4) NOT NULL,
    "currentAmount" DECIMAL(18,2) NOT NULL,
    "cumulativeAmount" DECIMAL(18,2) NOT NULL,
    "measurementIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ContractorBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingMilestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dueDate" DATE,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBill" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "billSeq" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'RA',
    "milestoneId" TEXT,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "grossToDate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "previousGross" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currentWorkValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "variationValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "retention" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advanceRecovery" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "certifiedAmount" DECIMAL(18,2),
    "receivedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "invoiceNo" TEXT,
    "invoiceDate" DATE,
    "dueDate" DATE,
    "disputeNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "certifiedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBillLine" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "previousQty" DECIMAL(18,4) NOT NULL,
    "currentQty" DECIMAL(18,4) NOT NULL,
    "cumulativeQty" DECIMAL(18,4) NOT NULL,
    "currentAmount" DECIMAL(18,2) NOT NULL,
    "cumulativeAmount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ClientBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "clientBillId" TEXT,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ownership" TEXT NOT NULL,
    "ownerPartyId" TEXT,
    "hourlyRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rentalRate" DECIMAL(18,4),
    "rentalBasis" TEXT,
    "currentProjectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "registrationNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "operatorName" TEXT,
    "workingHours" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "idleHours" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "breakdownHours" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "fuelLitres" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fuelCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "activityId" TEXT,
    "costCodeId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentMaintenance" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "downtimeHours" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "startDate" DATE,
    "endDate" DATE,
    "retentionPct" DECIMAL(9,6),
    "advanceAmount" DECIMAL(18,2),
    "paymentTerms" TEXT,
    "ldRatePerDay" DECIMAL(18,2),
    "ldCapPct" DECIMAL(9,6),
    "noticePeriodDays" INTEGER,
    "claimsDeadlineDays" INTEGER,
    "eotProvisions" TEXT,
    "variationProcedure" TEXT,
    "complianceNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractClause" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "clauseRef" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "interpretation" TEXT,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),

    CONSTRAINT "ContractClause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guarantee" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "issuer" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "expiryDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Guarantee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scope" TEXT,
    "instructionRef" TEXT,
    "drawingRefs" TEXT,
    "costImpact" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "revenueImpact" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "scheduleImpactDays" INTEGER NOT NULL DEFAULT 0,
    "clientApprovalRef" TEXT,
    "approvedValue" DECIMAL(18,2),
    "costCodeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariationLine" (
    "id" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "boqItemId" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "costRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL,
    "costAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "VariationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "counterpartyId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "eventDate" DATE,
    "noticeDate" DATE,
    "submittedDate" DATE,
    "claimedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "claimedDays" INTEGER NOT NULL DEFAULT 0,
    "approvedAmount" DECIMAL(18,2),
    "approvedDays" INTEGER,
    "response" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Risk" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "probability" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "costExposure" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "mitigation" TEXT,
    "ownerId" TEXT,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "items" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "activityId" TEXT,
    "location" TEXT,
    "requestedDate" DATE NOT NULL,
    "inspectedDate" DATE,
    "inspectorId" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "result" TEXT NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ncr" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "activityId" TEXT,
    "inspectionId" TEXT,
    "contractorId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'MINOR',
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "preventiveAction" TEXT,
    "responsibleId" TEXT,
    "dueDate" DATE,
    "estimatedReworkCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "costCodeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ncr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyIncident" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "location" TEXT,
    "description" TEXT NOT NULL,
    "injuredCount" INTEGER NOT NULL DEFAULT 0,
    "severity" TEXT NOT NULL DEFAULT 'LOW',
    "immediateAction" TEXT,
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "responsibleId" TEXT,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolboxTalk" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "topic" TEXT NOT NULL,
    "conductedBy" TEXT NOT NULL,
    "attendeeCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolboxTalk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "discipline" TEXT,
    "title" TEXT NOT NULL,
    "originator" TEXT,
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "currentRevisionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRevision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "fileId" TEXT,
    "issueDate" DATE,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'FOR_REVIEW',
    "reviewComments" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transmittal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "recipientId" TEXT,
    "recipientName" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "sentDate" DATE,
    "distribution" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revisionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transmittal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfi" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'RFI',
    "subject" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "discipline" TEXT,
    "addressedTo" TEXT,
    "dueDate" DATE,
    "response" TEXT,
    "respondedAt" TIMESTAMP(3),
    "costImpact" BOOLEAN NOT NULL DEFAULT false,
    "scheduleImpact" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rfi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "relatedType" TEXT,
    "relatedId" TEXT,
    "ownerId" TEXT,
    "reviewerId" TEXT,
    "approverId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "startDate" DATE,
    "dueDate" DATE,
    "estimatedHours" DECIMAL(9,2),
    "actualHours" DECIMAL(9,2),
    "status" TEXT NOT NULL DEFAULT 'BACKLOG',
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "completionNote" TEXT,
    "handoverNotes" TEXT,
    "recurrence" TEXT,
    "recurrenceParentId" TEXT,
    "slaHours" INTEGER,
    "completedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskContributor" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TaskContributor_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("taskId","dependsOnId")
);

-- CreateTable
CREATE TABLE "TaskHandover" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskHandover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponsibilityAssignment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "processType" TEXT NOT NULL,
    "responsibleId" TEXT,
    "accountableId" TEXT,
    "reviewerId" TEXT,
    "approverId" TEXT,
    "backupId" TEXT,
    "slaHours" INTEGER,
    "escalationUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResponsibilityAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "docType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStep" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "approverRoleCode" TEXT,
    "approverUserId" TEXT,
    "minAmount" DECIMAL(18,2),
    "maxAmount" DECIMAL(18,2),
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "slaHours" INTEGER NOT NULL DEFAULT 48,
    "escalateToRoleCode" TEXT,

    CONSTRAINT "WorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityNumber" TEXT,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(18,2),
    "definitionId" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "currentStepNo" INTEGER NOT NULL,
    "stepStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "activeKey" TEXT,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalAction" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "onBehalfOfId" TEXT,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delegation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "docTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Delegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentType" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "numberFormat" TEXT NOT NULL,
    "resetPolicy" TEXT NOT NULL DEFAULT 'NEVER',
    "requiredAttachments" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisterEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "docType" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT,
    "ownerId" TEXT,
    "amount" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegisterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "config" JSONB NOT NULL DEFAULT '{}',
    "lastTestAt" TIMESTAMP(3),
    "lastTestResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "rows" JSONB NOT NULL DEFAULT '[]',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Closeout" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "lessonsLearned" TEXT,
    "finalSnapshot" JSONB,
    "approvedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Closeout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloseoutItem" (
    "id" TEXT NOT NULL,
    "closeoutId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ownerId" TEXT,
    "note" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CloseoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_code_key" ON "Organisation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_orgId_idx" ON "User"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_orgId_code_key" ON "Role"("orgId", "code");

-- CreateIndex
CREATE INDEX "UserRole_projectId_idx" ON "UserRole"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_projectId_key" ON "UserRole"("userId", "roleId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_orgId_email_idx" ON "Invitation"("orgId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_key" ON "IdempotencyKey"("userId", "key");

-- CreateIndex
CREATE INDEX "Party_orgId_name_idx" ON "Party"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Party_orgId_code_key" ON "Party"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Project_orgId_code_key" ON "Project"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "WbsNode_projectId_code_key" ON "WbsNode"("projectId", "code");

-- CreateIndex
CREATE INDEX "CostCode_projectId_category_idx" ON "CostCode"("projectId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "CostCode_projectId_code_key" ON "CostCode"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_costCodeId_key" ON "BudgetLine"("costCodeId");

-- CreateIndex
CREATE INDEX "BudgetLine_projectId_idx" ON "BudgetLine"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetRevision_projectId_number_key" ON "BudgetRevision"("projectId", "number");

-- CreateIndex
CREATE INDEX "BudgetRevisionLine_costCodeId_idx" ON "BudgetRevisionLine"("costCodeId");

-- CreateIndex
CREATE INDEX "CostLedgerEntry_projectId_kind_idx" ON "CostLedgerEntry"("projectId", "kind");

-- CreateIndex
CREATE INDEX "CostLedgerEntry_projectId_costCodeId_idx" ON "CostLedgerEntry"("projectId", "costCodeId");

-- CreateIndex
CREATE INDEX "CostLedgerEntry_projectId_date_idx" ON "CostLedgerEntry"("projectId", "date");

-- CreateIndex
CREATE INDEX "CostLedgerEntry_sourceType_sourceId_idx" ON "CostLedgerEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "CostForecast_projectId_periodCode_idx" ON "CostForecast"("projectId", "periodCode");

-- CreateIndex
CREATE UNIQUE INDEX "CostForecast_projectId_costCodeId_periodCode_key" ON "CostForecast"("projectId", "costCodeId", "periodCode");

-- CreateIndex
CREATE UNIQUE INDEX "ReportingPeriod_projectId_code_key" ON "ReportingPeriod"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodChecklistItem_periodId_key_key" ON "PeriodChecklistItem"("periodId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CashFlowPlan_projectId_month_key" ON "CashFlowPlan"("projectId", "month");

-- CreateIndex
CREATE INDEX "BoqItem_projectId_costCodeId_idx" ON "BoqItem"("projectId", "costCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "BoqItem_projectId_itemCode_key" ON "BoqItem"("projectId", "itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "QuantityTakeoff_projectId_number_key" ON "QuantityTakeoff"("projectId", "number");

-- CreateIndex
CREATE INDEX "Measurement_projectId_boqItemId_status_idx" ON "Measurement"("projectId", "boqItemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Measurement_projectId_number_key" ON "Measurement"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementRevision_measurementId_revision_key" ON "MeasurementRevision"("measurementId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_projectId_code_key" ON "Activity"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityDependency_predecessorId_successorId_key" ON "ActivityDependency"("predecessorId", "successorId");

-- CreateIndex
CREATE INDEX "ProgressEntry_projectId_date_idx" ON "ProgressEntry"("projectId", "date");

-- CreateIndex
CREATE INDEX "ProgressEntry_activityId_idx" ON "ProgressEntry"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteDiary_projectId_number_key" ON "SiteDiary"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SiteDiary_projectId_date_shift_key" ON "SiteDiary"("projectId", "date", "shift");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerReport_projectId_number_key" ON "ManpowerReport"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerReport_projectId_date_shift_contractorKey_key" ON "ManpowerReport"("projectId", "date", "shift", "contractorKey");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_projectId_workerCode_key" ON "Worker"("projectId", "workerCode");

-- CreateIndex
CREATE INDEX "AttendanceRecord_projectId_date_idx" ON "AttendanceRecord"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_workerId_date_shift_key" ON "AttendanceRecord"("workerId", "date", "shift");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey");

-- CreateIndex
CREATE INDEX "FileObject_projectId_idx" ON "FileObject"("projectId");

-- CreateIndex
CREATE INDEX "Evidence_projectId_status_idx" ON "Evidence"("projectId", "status");

-- CreateIndex
CREATE INDEX "Evidence_projectId_category_idx" ON "Evidence"("projectId", "category");

-- CreateIndex
CREATE INDEX "Evidence_linkedType_linkedId_idx" ON "Evidence"("linkedType", "linkedId");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_projectId_number_key" ON "Evidence"("projectId", "number");

-- CreateIndex
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Comment_entityType_entityId_idx" ON "Comment"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Uom_orgId_code_key" ON "Uom"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Material_orgId_code_key" ON "Material"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Store_projectId_code_key" ON "Store"("projectId", "code");

-- CreateIndex
CREATE INDEX "StockTransaction_projectId_storeId_materialId_idx" ON "StockTransaction"("projectId", "storeId", "materialId");

-- CreateIndex
CREATE INDEX "StockTransaction_refType_refId_idx" ON "StockTransaction"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialIssue_projectId_number_key" ON "MaterialIssue"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_projectId_number_key" ON "StockCount"("projectId", "number");

-- CreateIndex
CREATE INDEX "MaterialRequisition_projectId_status_idx" ON "MaterialRequisition"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequisition_projectId_number_key" ON "MaterialRequisition"("projectId", "number");

-- CreateIndex
CREATE INDEX "PurchaseRequisition_projectId_status_idx" ON "PurchaseRequisition"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequisition_projectId_number_key" ON "PurchaseRequisition"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_projectId_number_key" ON "Rfq"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_rfqId_supplierId_key" ON "Quotation"("rfqId", "supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_projectId_status_idx" ON "PurchaseOrder"("projectId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_projectId_number_key" ON "PurchaseOrder"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_poId_lineNo_key" ON "PurchaseOrderLine"("poId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "PoRevision_poId_revisionNo_key" ON "PoRevision"("poId", "revisionNo");

-- CreateIndex
CREATE UNIQUE INDEX "PoRevision_projectId_number_key" ON "PoRevision"("projectId", "number");

-- CreateIndex
CREATE INDEX "Grn_poId_idx" ON "Grn"("poId");

-- CreateIndex
CREATE UNIQUE INDEX "Grn_projectId_number_key" ON "Grn"("projectId", "number");

-- CreateIndex
CREATE INDEX "GrnLine_poLineId_idx" ON "GrnLine"("poLineId");

-- CreateIndex
CREATE UNIQUE INDEX "Mir_projectId_number_key" ON "Mir"("projectId", "number");

-- CreateIndex
CREATE INDEX "SupplierInvoice_projectId_status_idx" ON "SupplierInvoice"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_projectId_number_key" ON "SupplierInvoice"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_supplierId_invoiceNo_key" ON "SupplierInvoice"("supplierId", "invoiceNo");

-- CreateIndex
CREATE INDEX "Expense_projectId_status_idx" ON "Expense"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_projectId_number_key" ON "Expense"("projectId", "number");

-- CreateIndex
CREATE INDEX "Payment_projectId_direction_status_idx" ON "Payment"("projectId", "direction", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_projectId_number_key" ON "Payment"("projectId", "number");

-- CreateIndex
CREATE INDEX "PaymentAllocation_supplierInvoiceId_idx" ON "PaymentAllocation"("supplierInvoiceId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_contractorBillId_idx" ON "PaymentAllocation"("contractorBillId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_clientBillId_idx" ON "PaymentAllocation"("clientBillId");

-- CreateIndex
CREATE INDEX "Subcontract_contractorId_idx" ON "Subcontract"("contractorId");

-- CreateIndex
CREATE UNIQUE INDEX "Subcontract_projectId_number_key" ON "Subcontract"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorBill_projectId_number_key" ON "ContractorBill"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorBill_subcontractId_billSeq_key" ON "ContractorBill"("subcontractId", "billSeq");

-- CreateIndex
CREATE INDEX "BillingMilestone_projectId_idx" ON "BillingMilestone"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBill_projectId_number_key" ON "ClientBill"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBill_projectId_billSeq_key" ON "ClientBill"("projectId", "billSeq");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_projectId_number_key" ON "CreditNote"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_orgId_code_key" ON "Equipment"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentLog_projectId_number_key" ON "EquipmentLog"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentLog_equipmentId_date_key" ON "EquipmentLog"("equipmentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_projectId_number_key" ON "Contract"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Variation_projectId_number_key" ON "Variation"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_projectId_number_key" ON "Claim"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Risk_projectId_number_key" ON "Risk"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_projectId_number_key" ON "Inspection"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Ncr_projectId_number_key" ON "Ncr"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyIncident_projectId_number_key" ON "SafetyIncident"("projectId", "number");

-- CreateIndex
CREATE INDEX "ToolboxTalk_projectId_date_idx" ON "ToolboxTalk"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Document_projectId_number_key" ON "Document"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRevision_documentId_revision_key" ON "DocumentRevision"("documentId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "Transmittal_projectId_number_key" ON "Transmittal"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Rfi_projectId_number_key" ON "Rfi"("projectId", "number");

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE INDEX "Task_ownerId_status_idx" ON "Task"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Task_projectId_number_key" ON "Task"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ResponsibilityAssignment_orgId_projectId_processType_key" ON "ResponsibilityAssignment"("orgId", "projectId", "processType");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_orgId_projectId_docType_key" ON "WorkflowDefinition"("orgId", "projectId", "docType");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStep_definitionId_stepNo_key" ON "WorkflowStep"("definitionId", "stepNo");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_activeKey_key" ON "ApprovalRequest"("activeKey");

-- CreateIndex
CREATE INDEX "ApprovalRequest_projectId_status_idx" ON "ApprovalRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_docType_entityId_idx" ON "ApprovalRequest"("docType", "entityId");

-- CreateIndex
CREATE INDEX "ApprovalAction_requestId_idx" ON "ApprovalAction"("requestId");

-- CreateIndex
CREATE INDEX "Delegation_toUserId_idx" ON "Delegation"("toUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_orgId_code_key" ON "DocumentType"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_orgId_docType_scopeKey_key" ON "NumberSequence"("orgId", "docType", "scopeKey");

-- CreateIndex
CREATE INDEX "RegisterEntry_projectId_docType_idx" ON "RegisterEntry"("projectId", "docType");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterEntry_orgId_number_key" ON "RegisterEntry"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterEntry_entityType_entityId_key" ON "RegisterEntry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "NotificationPreference"("userId", "type");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_createdAt_idx" ON "AuditEvent"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_projectId_createdAt_idx" ON "AuditEvent"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConfig_orgId_provider_key" ON "IntegrationConfig"("orgId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "Closeout_projectId_key" ON "Closeout"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CloseoutItem_closeoutId_key_key" ON "CloseoutItem"("closeoutId", "key");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_reportingManagerId_fkey" FOREIGN KEY ("reportingManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_backupUserId_fkey" FOREIGN KEY ("backupUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionCode_fkey" FOREIGN KEY ("permissionCode") REFERENCES "Permission"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WbsNode" ADD CONSTRAINT "WbsNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WbsNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WbsNode" ADD CONSTRAINT "WbsNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCode" ADD CONSTRAINT "CostCode_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WbsNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCode" ADD CONSTRAINT "CostCode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetRevision" ADD CONSTRAINT "BudgetRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetRevision" ADD CONSTRAINT "BudgetRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetRevisionLine" ADD CONSTRAINT "BudgetRevisionLine_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "BudgetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetRevisionLine" ADD CONSTRAINT "BudgetRevisionLine_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLedgerEntry" ADD CONSTRAINT "CostLedgerEntry_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLedgerEntry" ADD CONSTRAINT "CostLedgerEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLedgerEntry" ADD CONSTRAINT "CostLedgerEntry_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLedgerEntry" ADD CONSTRAINT "CostLedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostForecast" ADD CONSTRAINT "CostForecast_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostForecast" ADD CONSTRAINT "CostForecast_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostForecast" ADD CONSTRAINT "CostForecast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportingPeriod" ADD CONSTRAINT "ReportingPeriod_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodChecklistItem" ADD CONSTRAINT "PeriodChecklistItem_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashFlowPlan" ADD CONSTRAINT "CashFlowPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WbsNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateAnalysisLine" ADD CONSTRAINT "RateAnalysisLine_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateAnalysisLine" ADD CONSTRAINT "RateAnalysisLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityTakeoff" ADD CONSTRAINT "QuantityTakeoff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityTakeoff" ADD CONSTRAINT "QuantityTakeoff_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityTakeoff" ADD CONSTRAINT "QuantityTakeoff_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_subcontractId_fkey" FOREIGN KEY ("subcontractId") REFERENCES "Subcontract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_contractorBillId_fkey" FOREIGN KEY ("contractorBillId") REFERENCES "ContractorBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_clientBillId_fkey" FOREIGN KEY ("clientBillId") REFERENCES "ClientBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementRevision" ADD CONSTRAINT "MeasurementRevision_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementRevision" ADD CONSTRAINT "MeasurementRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WbsNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityDependency" ADD CONSTRAINT "ActivityDependency_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityDependency" ADD CONSTRAINT "ActivityDependency_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDiary" ADD CONSTRAINT "SiteDiary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDiary" ADD CONSTRAINT "SiteDiary_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerReport" ADD CONSTRAINT "ManpowerReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerReport" ADD CONSTRAINT "ManpowerReport_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerReport" ADD CONSTRAINT "ManpowerReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerLine" ADD CONSTRAINT "ManpowerLine_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ManpowerReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerLine" ADD CONSTRAINT "ManpowerLine_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerLine" ADD CONSTRAINT "ManpowerLine_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Uom" ADD CONSTRAINT "Uom_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_toStoreId_fkey" FOREIGN KEY ("toStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssue" ADD CONSTRAINT "MaterialIssue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssueLine" ADD CONSTRAINT "MaterialIssueLine_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "MaterialIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialIssueLine" ADD CONSTRAINT "MaterialIssueLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequisition" ADD CONSTRAINT "MaterialRequisition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequisition" ADD CONSTRAINT "MaterialRequisition_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequisition" ADD CONSTRAINT "MaterialRequisition_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequisitionLine" ADD CONSTRAINT "MaterialRequisitionLine_mrId_fkey" FOREIGN KEY ("mrId") REFERENCES "MaterialRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequisitionLine" ADD CONSTRAINT "MaterialRequisitionLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_mrId_fkey" FOREIGN KEY ("mrId") REFERENCES "MaterialRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PurchaseRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PurchaseRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PurchaseRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoRevision" ADD CONSTRAINT "PoRevision_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoRevision" ADD CONSTRAINT "PoRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoRevision" ADD CONSTRAINT "PoRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnLine" ADD CONSTRAINT "GrnLine_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "Grn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnLine" ADD CONSTRAINT "GrnLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnLine" ADD CONSTRAINT "GrnLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mir" ADD CONSTRAINT "Mir_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mir" ADD CONSTRAINT "Mir_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "Grn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mir" ADD CONSTRAINT "Mir_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mir" ADD CONSTRAINT "Mir_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "Grn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_contractorBillId_fkey" FOREIGN KEY ("contractorBillId") REFERENCES "ContractorBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_clientBillId_fkey" FOREIGN KEY ("clientBillId") REFERENCES "ClientBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcontract" ADD CONSTRAINT "Subcontract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractItem" ADD CONSTRAINT "SubcontractItem_subcontractId_fkey" FOREIGN KEY ("subcontractId") REFERENCES "Subcontract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractItem" ADD CONSTRAINT "SubcontractItem_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorBill" ADD CONSTRAINT "ContractorBill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorBill" ADD CONSTRAINT "ContractorBill_subcontractId_fkey" FOREIGN KEY ("subcontractId") REFERENCES "Subcontract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorBill" ADD CONSTRAINT "ContractorBill_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorBill" ADD CONSTRAINT "ContractorBill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorBillLine" ADD CONSTRAINT "ContractorBillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ContractorBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorBillLine" ADD CONSTRAINT "ContractorBillLine_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingMilestone" ADD CONSTRAINT "BillingMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBill" ADD CONSTRAINT "ClientBill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBill" ADD CONSTRAINT "ClientBill_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "BillingMilestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBill" ADD CONSTRAINT "ClientBill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBillLine" ADD CONSTRAINT "ClientBillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ClientBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBillLine" ADD CONSTRAINT "ClientBillLine_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_clientBillId_fkey" FOREIGN KEY ("clientBillId") REFERENCES "ClientBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentLog" ADD CONSTRAINT "EquipmentLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentLog" ADD CONSTRAINT "EquipmentLog_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentLog" ADD CONSTRAINT "EquipmentLog_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentLog" ADD CONSTRAINT "EquipmentLog_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentLog" ADD CONSTRAINT "EquipmentLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenance" ADD CONSTRAINT "EquipmentMaintenance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenance" ADD CONSTRAINT "EquipmentMaintenance_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentMaintenance" ADD CONSTRAINT "EquipmentMaintenance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractClause" ADD CONSTRAINT "ContractClause_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guarantee" ADD CONSTRAINT "Guarantee_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variation" ADD CONSTRAINT "Variation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variation" ADD CONSTRAINT "Variation_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variation" ADD CONSTRAINT "Variation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariationLine" ADD CONSTRAINT "VariationLine_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "Variation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariationLine" ADD CONSTRAINT "VariationLine_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ncr" ADD CONSTRAINT "Ncr_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ncr" ADD CONSTRAINT "Ncr_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ncr" ADD CONSTRAINT "Ncr_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ncr" ADD CONSTRAINT "Ncr_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ncr" ADD CONSTRAINT "Ncr_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolboxTalk" ADD CONSTRAINT "ToolboxTalk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolboxTalk" ADD CONSTRAINT "ToolboxTalk_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transmittal" ADD CONSTRAINT "Transmittal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transmittal" ADD CONSTRAINT "Transmittal_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transmittal" ADD CONSTRAINT "Transmittal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskContributor" ADD CONSTRAINT "TaskContributor_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskHandover" ADD CONSTRAINT "TaskHandover_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskHandover" ADD CONSTRAINT "TaskHandover_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityAssignment" ADD CONSTRAINT "ResponsibilityAssignment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityAssignment" ADD CONSTRAINT "ResponsibilityAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStep" ADD CONSTRAINT "WorkflowStep_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAction" ADD CONSTRAINT "ApprovalAction_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentType" ADD CONSTRAINT "DocumentType_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConfig" ADD CONSTRAINT "IntegrationConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Closeout" ADD CONSTRAINT "Closeout_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Closeout" ADD CONSTRAINT "Closeout_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutItem" ADD CONSTRAINT "CloseoutItem_closeoutId_fkey" FOREIGN KEY ("closeoutId") REFERENCES "Closeout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutItem" ADD CONSTRAINT "CloseoutItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
