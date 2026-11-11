-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "workWeek" TEXT NOT NULL DEFAULT '1111110';

-- CreateTable
CREATE TABLE "ProjectHoliday" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectHoliday_projectId_date_key" ON "ProjectHoliday"("projectId", "date");

-- AddForeignKey
ALTER TABLE "ProjectHoliday" ADD CONSTRAINT "ProjectHoliday_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing projects keep the seven-day calendar their schedules were planned on; new projects start with Sunday off.
UPDATE "Project" SET "workWeek" = '1111111';
