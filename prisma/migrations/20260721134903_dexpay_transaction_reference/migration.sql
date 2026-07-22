-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "reference" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_reference_key" ON "Transaction"("reference");
