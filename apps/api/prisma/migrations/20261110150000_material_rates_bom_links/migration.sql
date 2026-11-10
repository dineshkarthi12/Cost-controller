-- AlterTable
ALTER TABLE "BomLine" ADD COLUMN     "materialId" TEXT,
ADD COLUMN     "rateSource" TEXT;

-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "avgPurchaseRate" DECIMAL(18,4),
ADD COLUMN     "lastPurchaseDate" DATE,
ADD COLUMN     "lastPurchaseRate" DECIMAL(18,4),
ADD COLUMN     "lastPurchaseRef" TEXT;

-- CreateIndex
CREATE INDEX "BomLine_materialId_idx" ON "BomLine"("materialId");

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Rates already on BOM lines were imported or typed before sources were recorded. Treat them as typed
-- by hand so "Refresh rates" never overwrites them unless the user asks it to.
UPDATE "BomLine" SET "rateSource" = 'MANUAL' WHERE "rate" IS NOT NULL;
