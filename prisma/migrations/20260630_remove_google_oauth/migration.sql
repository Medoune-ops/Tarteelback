-- Revert Sign in with Google: drop the googleId column and its unique index.
-- (Counter-migration to 20260630_google_oauth, which is kept so already-migrated
--  databases stay consistent.)
DROP INDEX IF EXISTS "User_googleId_key";

ALTER TABLE "User" DROP COLUMN IF EXISTS "googleId";
