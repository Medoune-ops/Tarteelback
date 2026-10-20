-- CreateEnum
CREATE TYPE "AchievementType" AS ENUM ('sourate_mastered');

-- CreateEnum
CREATE TYPE "AchievementReactionKind" AS ENUM ('mashaallah', 'barakallah', 'dua', 'bravo');

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AchievementType" NOT NULL,
    "refKey" TEXT NOT NULL,
    "payload" jsonb NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AchievementReaction" (
    "achievementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AchievementReactionKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AchievementReaction_pkey" PRIMARY KEY ("achievementId","userId")
);

-- CreateIndex
CREATE INDEX "Achievement_userId_createdAt_idx" ON "Achievement"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AchievementReaction_achievementId_createdAt_idx" ON "AchievementReaction"("achievementId", "createdAt");

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementReaction" ADD CONSTRAINT "AchievementReaction_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementReaction" ADD CONSTRAINT "AchievementReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
