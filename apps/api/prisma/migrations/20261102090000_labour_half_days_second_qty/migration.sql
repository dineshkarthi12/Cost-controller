-- Daily labour report: half-day masons/helpers and an optional second measurement per gang.
-- AlterTable
ALTER TABLE "DailyLabourGang" ADD COLUMN     "doneQty2" DECIMAL(14,4),
ADD COLUMN     "normId2" TEXT,
ADD COLUMN     "unit2" TEXT,
ALTER COLUMN "masons" SET DEFAULT 0,
ALTER COLUMN "masons" SET DATA TYPE DECIMAL(6,2),
ALTER COLUMN "helpers" SET DEFAULT 0,
ALTER COLUMN "helpers" SET DATA TYPE DECIMAL(6,2);

-- AlterTable
ALTER TABLE "DailyLabourReport" ALTER COLUMN "masonDays" SET DEFAULT 0,
ALTER COLUMN "masonDays" SET DATA TYPE DECIMAL(8,2),
ALTER COLUMN "helperDays" SET DEFAULT 0,
ALTER COLUMN "helperDays" SET DATA TYPE DECIMAL(8,2);

-- AddForeignKey
ALTER TABLE "DailyLabourGang" ADD CONSTRAINT "DailyLabourGang_normId2_fkey" FOREIGN KEY ("normId2") REFERENCES "LabourNorm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

