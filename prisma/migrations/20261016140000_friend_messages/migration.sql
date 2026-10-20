-- CreateEnum
CREATE TYPE "FriendMessageKind" AS ENUM ('hadith', 'achievement', 'encouragement');

-- CreateTable
CREATE TABLE "FriendMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" "FriendMessageKind" NOT NULL,
    "payload" jsonb NOT NULL,
    "note" VARCHAR(140),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    CONSTRAINT "FriendMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FriendMessage_recipientId_createdAt_idx" ON "FriendMessage"("recipientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FriendMessage_recipientId_readAt_idx" ON "FriendMessage"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "FriendMessage_senderId_createdAt_idx" ON "FriendMessage"("senderId", "createdAt");

-- AddForeignKey
ALTER TABLE "FriendMessage" ADD CONSTRAINT "FriendMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendMessage" ADD CONSTRAINT "FriendMessage_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
