-- Exact daily activity: one row per local day the user completed a lesson, so
-- the profile calendar can mark exactly the days studied (idempotent per day).
CREATE TABLE "ActivityDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActivityDay_userId_day_key" ON "ActivityDay"("userId", "day");
CREATE INDEX "ActivityDay_userId_day_idx" ON "ActivityDay"("userId", "day");

ALTER TABLE "ActivityDay"
    ADD CONSTRAINT "ActivityDay_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
