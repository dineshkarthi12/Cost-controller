-- Daily labour report (morning allocation + evening measurement) and per-day labour norms.
-- CreateTable
CREATE TABLE "LabourNorm" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "outputPerDay" DECIMAL(14,4) NOT NULL,
    "masonsPerCrew" INTEGER NOT NULL DEFAULT 1,
    "helpersPerCrew" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabourNorm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLabourReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "masonRate" DECIMAL(12,2) NOT NULL,
    "helperRate" DECIMAL(12,2) NOT NULL,
    "remarks" TEXT,
    "masonDays" INTEGER NOT NULL DEFAULT 0,
    "helperDays" INTEGER NOT NULL DEFAULT 0,
    "labourCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outputPct" DECIMAL(9,4),
    "profitLoss" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyLabourReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLabourGang" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "work" TEXT NOT NULL,
    "workers" TEXT[],
    "masons" INTEGER NOT NULL DEFAULT 0,
    "helpers" INTEGER NOT NULL DEFAULT 0,
    "normId" TEXT,
    "doneQty" DECIMAL(14,4),
    "unit" TEXT,
    "progress" TEXT NOT NULL DEFAULT 'PLANNED',
    "outcome" TEXT,
    "labourCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outputPct" DECIMAL(9,4),
    "masonsNeeded" DECIMAL(10,4),
    "helpersNeeded" DECIMAL(10,4),
    "result" TEXT NOT NULL DEFAULT 'NOT_MEASURED',
    "profitLoss" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "DailyLabourGang_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LabourNorm_orgId_code_key" ON "LabourNorm"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLabourReport_projectId_date_key" ON "DailyLabourReport"("projectId", "date");

-- CreateIndex
CREATE INDEX "DailyLabourGang_reportId_idx" ON "DailyLabourGang"("reportId");

-- AddForeignKey
ALTER TABLE "LabourNorm" ADD CONSTRAINT "LabourNorm_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLabourReport" ADD CONSTRAINT "DailyLabourReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLabourGang" ADD CONSTRAINT "DailyLabourGang_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyLabourReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLabourGang" ADD CONSTRAINT "DailyLabourGang_normId_fkey" FOREIGN KEY ("normId") REFERENCES "LabourNorm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

