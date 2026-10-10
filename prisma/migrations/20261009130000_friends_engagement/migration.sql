-- CreateEnum
CREATE TYPE "FriendActivityType" AS ENUM ('sourate_mastered', 'streak_milestone', 'level_up');

-- CreateEnum
CREATE TYPE "ChallengeMetric" AS ENUM ('xp', 'streak', 'sourates');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('active', 'ended');

-- CreateTable
CREATE TABLE "FriendActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "FriendActivityType" NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FriendActivityCheer" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendActivityCheer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metric" "ChallengeMetric" NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'active',
    "winnerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeParticipant" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "achievedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FriendMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "FriendSendType" NOT NULL,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FriendActivity_createdAt_idx" ON "FriendActivity"("createdAt");

-- CreateIndex
CREATE INDEX "FriendActivity_userId_createdAt_idx" ON "FriendActivity"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FriendActivityCheer_activityId_idx" ON "FriendActivityCheer"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "FriendActivityCheer_activityId_userId_key" ON "FriendActivityCheer"("activityId", "userId");

-- CreateIndex
CREATE INDEX "Challenge_creatorId_createdAt_idx" ON "Challenge"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "Challenge_status_endsAt_idx" ON "Challenge"("status", "endsAt");

-- CreateIndex
CREATE INDEX "ChallengeParticipant_userId_idx" ON "ChallengeParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeParticipant_challengeId_userId_key" ON "ChallengeParticipant"("challengeId", "userId");

-- CreateIndex
CREATE INDEX "FriendMessage_recipientId_createdAt_idx" ON "FriendMessage"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "FriendMessage_senderId_createdAt_idx" ON "FriendMessage"("senderId", "createdAt");

-- AddForeignKey
ALTER TABLE "FriendActivity" ADD CONSTRAINT "FriendActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendActivityCheer" ADD CONSTRAINT "FriendActivityCheer_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "FriendActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendActivityCheer" ADD CONSTRAINT "FriendActivityCheer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendMessage" ADD CONSTRAINT "FriendMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendMessage" ADD CONSTRAINT "FriendMessage_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
