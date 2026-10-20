-- CreateTable
CREATE TABLE "DailyQuota" (
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyQuota_pkey" PRIMARY KEY ("userId", "day")
);

-- CreateTable
CREATE TABLE "DailyRecipientQuota" (
    "userId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyRecipientQuota_pkey" PRIMARY KEY ("userId", "recipientId", "day")
);

-- CreateIndex
CREATE INDEX "DailyQuota_userId_day_idx" ON "DailyQuota"("userId", "day");

-- CreateIndex
CREATE INDEX "DailyRecipientQuota_userId_recipientId_day_idx" ON "DailyRecipientQuota"("userId", "recipientId", "day");

-- AddForeignKey
ALTER TABLE "DailyQuota" ADD CONSTRAINT "DailyQuota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRecipientQuota" ADD CONSTRAINT "DailyRecipientQuota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRecipientQuota" ADD CONSTRAINT "DailyRecipientQuota_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
