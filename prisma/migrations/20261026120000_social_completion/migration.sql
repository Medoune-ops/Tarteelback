-- Fonctions entre amis : compléments (démarrage des défis, interrupteur
-- back-office, modération, bail de la file d'événements). Uniquement additif.

-- Back-office : nouveau module de permissions « modération ».
ALTER TYPE "AdminModule" ADD VALUE 'moderation';

-- Réussites : les 4 types prévus au plan (seule « sourate maîtrisée » existait).
ALTER TYPE "AchievementType" ADD VALUE 'streak_milestone';
ALTER TYPE "AchievementType" ADD VALUE 'section_completed';
ALTER TYPE "AchievementType" ADD VALUE 'challenge_won';
ALTER TYPE "AchievementType" ADD VALUE 'league_promoted';

-- Interrupteur et plafonds réglables depuis le back-office.
ALTER TABLE "AppConfig" ADD COLUMN     "friendsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "friendsBetaUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "challengeRewardsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "challengeWinGems" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "challengeCompleteGems" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "challengeRewardedPerWeek" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "messagesPerDayFree" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "messagesPerDayPremium" INTEGER NOT NULL DEFAULT 30;

-- Photo de départ d'un défi sourates (liste, plus seulement un nombre).
ALTER TABLE "ChallengeParticipant" ADD COLUMN     "baselineSourates" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- Bail de traitement d'un événement (deux traitements ne prennent jamais le même).
ALTER TABLE "DomainEvent" ADD COLUMN     "claimedAt" TIMESTAMP(3);

-- Coupure de l'accès aux fonctions entre amis par la modération.
ALTER TABLE "User" ADD COLUMN     "friendsDisabledAt" TIMESTAMP(3);

-- Unicité d'une réussite : déclarée dans le schéma mais absente de la base.
CREATE UNIQUE INDEX "Achievement_userId_type_refKey_key" ON "Achievement"("userId", "type", "refKey");
