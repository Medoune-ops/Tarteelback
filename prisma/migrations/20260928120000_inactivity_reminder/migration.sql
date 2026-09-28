-- Relance d'inactivité : dernière ouverture de l'app + palier de rappel envoyé.
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3),
ADD COLUMN "inactivityReminderStage" INTEGER NOT NULL DEFAULT 0;

-- Rétro-remplissage : meilleure approximation de la dernière ouverture = le
-- refresh token le plus récent (émis à chaque rotation), sinon la dernière
-- leçon, sinon la création du compte. Sans ça, tous les comptes existants
-- seraient vus comme inactifs depuis toujours.
UPDATE "User" u SET "lastSeenAt" = GREATEST(
  (SELECT MAX(rt."createdAt") FROM "RefreshToken" rt WHERE rt."userId" = u."id"),
  u."lastActivityDate",
  u."createdAt"
);

