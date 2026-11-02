-- Daily work report for the office QS / estimation team.

-- CreateTable
CREATE TABLE "WorkReport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "totalHours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkReportItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "projectId" TEXT,
    "description" TEXT NOT NULL,
    "output" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DONE',
    "hours" DECIMAL(5,2),
    "targetDate" DATE,
    "carriedFromId" TEXT,

    CONSTRAINT "WorkReportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkReport_orgId_date_idx" ON "WorkReport"("orgId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WorkReport_userId_date_key" ON "WorkReport"("userId", "date");

-- CreateIndex
CREATE INDEX "WorkReportItem_reportId_idx" ON "WorkReportItem"("reportId");

-- AddForeignKey
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkReportItem" ADD CONSTRAINT "WorkReportItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "WorkReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkReportItem" ADD CONSTRAINT "WorkReportItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

