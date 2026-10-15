-- CreateEnum
CREATE TYPE "FriendsVisibility" AS ENUM ('friends', 'private');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GemReason" ADD VALUE 'challenge_win';
ALTER TYPE "GemReason" ADD VALUE 'challenge_complete';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "friendsDiscoverable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "friendsVisibility" "FriendsVisibility" NOT NULL DEFAULT 'friends',
ADD COLUMN     "notifFriends" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainEvent_processedAt_createdAt_idx" ON "DomainEvent"("processedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
