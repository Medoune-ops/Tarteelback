-- Plan familial (Household) : un foyer avec un propriétaire (owner) et jusqu'à
-- 5 membres. Premium PERSONNEL séparé du premium EFFECTIF (isPremium /
-- premiumUntil), pour que tous les membres d'un foyer abonné soient premium
-- sans casser les contrôles existants.

-- 1) Premium personnel sur User (rétro-rempli depuis le premiumUntil existant).
ALTER TABLE "User" ADD COLUMN "personalPremiumUntil" TIMESTAMP(3);
UPDATE "User" SET "personalPremiumUntil" = "premiumUntil" WHERE "premiumUntil" IS NOT NULL;
-- Premium « à vie » (isPremium sans date d'expiration) : préservé via une date
-- lointaine (personalPremiumUntil = source du premium effectif).
UPDATE "User" SET "personalPremiumUntil" = '2999-12-31 00:00:00' WHERE "isPremium" = true AND "premiumUntil" IS NULL;

-- 2) Foyer.
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "subscriptionActive" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionUntil" TIMESTAMP(3),
    "plan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Household_ownerId_key" ON "Household"("ownerId");
ALTER TABLE "Household"
    ADD CONSTRAINT "Household_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) Membres du foyer.
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HouseholdMember_userId_key" ON "HouseholdMember"("userId");
CREATE UNIQUE INDEX "HouseholdMember_householdId_userId_key" ON "HouseholdMember"("householdId", "userId");
CREATE INDEX "HouseholdMember_householdId_idx" ON "HouseholdMember"("householdId");
ALTER TABLE "HouseholdMember"
    ADD CONSTRAINT "HouseholdMember_householdId_fkey"
    FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HouseholdMember"
    ADD CONSTRAINT "HouseholdMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) Invitations.
CREATE TABLE "HouseholdInvitation" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    CONSTRAINT "HouseholdInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HouseholdInvitation_token_key" ON "HouseholdInvitation"("token");
CREATE INDEX "HouseholdInvitation_householdId_idx" ON "HouseholdInvitation"("householdId");
CREATE INDEX "HouseholdInvitation_email_idx" ON "HouseholdInvitation"("email");
CREATE INDEX "HouseholdInvitation_status_idx" ON "HouseholdInvitation"("status");
ALTER TABLE "HouseholdInvitation"
    ADD CONSTRAINT "HouseholdInvitation_householdId_fkey"
    FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HouseholdInvitation"
    ADD CONSTRAINT "HouseholdInvitation_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
