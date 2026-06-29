-- DropIndex
DROP INDEX "Transaction_userId_idx";

-- AlterTable
ALTER TABLE "LeagueWeek" ADD COLUMN     "closedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LeagueWeek_dateDebut_dateFin_idx" ON "LeagueWeek"("dateDebut", "dateFin");

-- CreateIndex
CREATE INDEX "LeagueWeek_dateFin_closedAt_idx" ON "LeagueWeek"("dateFin", "closedAt");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");

