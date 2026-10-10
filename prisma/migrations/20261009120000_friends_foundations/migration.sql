-- CreateEnum
CREATE TYPE "FriendSendType" AS ENUM ('hadith', 'success', 'encouragement', 'reminder');

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "user1Id" TEXT NOT NULL,
    "user2Id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FriendCode" (
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FriendCode_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "FriendBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FriendReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FriendSendLog" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "type" "FriendSendType" NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Friendship_user2Id_idx" ON "Friendship"("user2Id");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_user1Id_user2Id_key" ON "Friendship"("user1Id", "user2Id");

-- CreateIndex
CREATE UNIQUE INDEX "FriendCode_code_key" ON "FriendCode"("code");

-- CreateIndex
CREATE INDEX "FriendCode_code_idx" ON "FriendCode"("code");

-- CreateIndex
CREATE INDEX "FriendBlock_blockedId_idx" ON "FriendBlock"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "FriendBlock_blockerId_blockedId_key" ON "FriendBlock"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "FriendReport_reportedId_createdAt_idx" ON "FriendReport"("reportedId", "createdAt");

-- CreateIndex
CREATE INDEX "FriendSendLog_senderId_day_idx" ON "FriendSendLog"("senderId", "day");

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_user1Id_fkey" FOREIGN KEY ("user1Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_user2Id_fkey" FOREIGN KEY ("user2Id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendCode" ADD CONSTRAINT "FriendCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendBlock" ADD CONSTRAINT "FriendBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendBlock" ADD CONSTRAINT "FriendBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendReport" ADD CONSTRAINT "FriendReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendReport" ADD CONSTRAINT "FriendReport_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendSendLog" ADD CONSTRAINT "FriendSendLog_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

