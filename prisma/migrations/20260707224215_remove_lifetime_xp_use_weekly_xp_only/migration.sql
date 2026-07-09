-- Merge the lifetime "xp" total into "weeklyXp" before dropping the column,
-- so no existing progress is silently lost. From now on there is a single XP
-- counter that resets every week alongside the league rollover.
UPDATE "User" SET "weeklyXp" = "weeklyXp" + "xp";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "xp";
