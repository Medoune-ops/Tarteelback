-- CreateEnum
CREATE TYPE "GemReason" AS ENUM ('lesson_complete', 'lesson_perfect', 'daily_streak', 'streak_bonus', 'league_promotion', 'pack_purchase', 'heart_refill', 'streak_freeze', 'double_xp');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'gem_pack';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "doubleXpUntil" TIMESTAMP(3),
ADD COLUMN     "gems" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reviewHeartsDay" TEXT,
ADD COLUMN     "reviewHeartsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "streakFreezes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "GemTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "GemReason" NOT NULL,
    "ref" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GemTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GemTransaction_userId_createdAt_idx" ON "GemTransaction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "GemTransaction" ADD CONSTRAINT "GemTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
