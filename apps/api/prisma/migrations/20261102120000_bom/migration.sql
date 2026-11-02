-- Bill of materials (BOM) per BOQ item.
-- CreateTable
CREATE TABLE "BomItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "sheet" TEXT,
    "section" TEXT,
    "refCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "boqRef" TEXT,
    "boqItemId" TEXT,
    "boqNote" TEXT,
    "takingQty" DECIMAL(18,4),
    "takingUnit" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BomItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomLine" (
    "id" TEXT NOT NULL,
    "bomItemId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "wastagePct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "totalQty" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(18,4),
    "amount" DECIMAL(18,2),
    "remarks" TEXT,

    CONSTRAINT "BomLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BomItem_projectId_idx" ON "BomItem"("projectId");

-- CreateIndex
CREATE INDEX "BomLine_bomItemId_idx" ON "BomLine"("bomItemId");

-- AddForeignKey
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_bomItemId_fkey" FOREIGN KEY ("bomItemId") REFERENCES "BomItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

