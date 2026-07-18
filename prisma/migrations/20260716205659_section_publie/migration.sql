-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "publie" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Section_publie_idx" ON "Section"("publie");
