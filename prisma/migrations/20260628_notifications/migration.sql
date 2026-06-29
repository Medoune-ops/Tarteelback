-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastDailyReminderOn" TEXT,
ADD COLUMN     "lastStreakAlertOn" TEXT,
ADD COLUMN     "notifDailyReminder" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifStreakAlert" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reminderHour" INTEGER NOT NULL DEFAULT 19;

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

