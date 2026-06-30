-- Sign in with Google: store the Google subject id to link/identify accounts.
-- Nullable (email/password users have none); unique so one Google identity maps
-- to at most one account.
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;

CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
