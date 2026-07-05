-- Pseudo public (ligues/classements). Optionnel: les comptes existants
-- retombent sur displayName a l'affichage.
ALTER TABLE "User" ADD COLUMN "username" TEXT;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
