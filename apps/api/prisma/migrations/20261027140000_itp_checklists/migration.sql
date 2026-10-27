-- ITP / checklist templates: structured items (hold, witness and review points) and a link from inspections.

-- CreateTable
CREATE TABLE "ChecklistTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "stage" TEXT,
    "description" TEXT NOT NULL,
    "acceptanceCriteria" TEXT,
    "reference" TEXT,
    "pointType" TEXT NOT NULL DEFAULT 'REVIEW',

    CONSTRAINT "ChecklistTemplateItem_pkey" PRIMARY KEY ("id")
);

-- Keep any items stored in the old text-array column.
INSERT INTO "ChecklistTemplateItem" ("id", "templateId", "lineNo", "description")
SELECT t."id" || '-' || i.n, t."id", i.n::int, i.item
FROM "ChecklistTemplate" t, unnest(t."items") WITH ORDINALITY AS i(item, n);

-- AlterTable
ALTER TABLE "ChecklistTemplate" DROP COLUMN "items",
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "templateId" TEXT;

-- CreateIndex
CREATE INDEX "ChecklistTemplateItem_templateId_idx" ON "ChecklistTemplateItem"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistTemplate_orgId_name_key" ON "ChecklistTemplate"("orgId", "name");

-- AddForeignKey
ALTER TABLE "ChecklistTemplateItem" ADD CONSTRAINT "ChecklistTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
