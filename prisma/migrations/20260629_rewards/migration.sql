-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastChestDay" TEXT,
ADD COLUMN     "streakGoal" INTEGER;

-- CreateTable
CREATE TABLE "PodiumReward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "semaine" INTEGER NOT NULL,
    "ligue" TEXT NOT NULL,
    "rang" INTEGER NOT NULL,
    "xp" INTEGER NOT NULL,
    "reward" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PodiumReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PodiumReward_userId_idx" ON "PodiumReward"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PodiumReward_userId_ref_key" ON "PodiumReward"("userId", "ref");

-- AddForeignKey
ALTER TABLE "PodiumReward" ADD CONSTRAINT "PodiumReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

