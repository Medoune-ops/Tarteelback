-- AlterTable
ALTER TABLE "SupportMessage" ADD COLUMN     "fromAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "SupportMessage_userId_createdAt_idx" ON "SupportMessage"("userId", "createdAt");
