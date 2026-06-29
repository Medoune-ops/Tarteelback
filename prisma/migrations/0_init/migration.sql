-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "UserLevel" AS ENUM ('debutant', 'alphabet', 'lent', 'fluent');

-- CreateEnum
CREATE TYPE "Objectif" AS ENUM ('lire', 'hifz', 'tafsir', 'complet');

-- CreateEnum
CREATE TYPE "LessonState" AS ENUM ('locked', 'active', 'completed');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('discovery', 'written', 'voice');

-- CreateEnum
CREATE TYPE "RevisionState" AS ENUM ('maitrise', 'revoir', 'difficile');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('premium_subscription', 'streak_repair');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'success', 'failed', 'refunded');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarInitials" TEXT NOT NULL DEFAULT '',
    "role" "Role" NOT NULL DEFAULT 'user',
    "level" "UserLevel" NOT NULL DEFAULT 'debutant',
    "objectif" "Objectif" NOT NULL DEFAULT 'lire',
    "dailyMinutes" INTEGER NOT NULL DEFAULT 10,
    "onboardingDone" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "language" TEXT NOT NULL DEFAULT 'en',
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "premiumUntil" TIMESTAMP(3),
    "xp" INTEGER NOT NULL DEFAULT 0,
    "weeklyXp" INTEGER NOT NULL DEFAULT 0,
    "hearts" INTEGER NOT NULL DEFAULT 5,
    "lastHeartLossAt" TIMESTAMP(3),
    "streak" INTEGER NOT NULL DEFAULT 0,
    "streakFrozen" BOOLEAN NOT NULL DEFAULT false,
    "lastStreakValue" INTEGER NOT NULL DEFAULT 0,
    "lastActivityDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL,
    "hizb" INTEGER,
    "kicker" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "sousTitre" TEXT NOT NULL,
    "couleur" TEXT NOT NULL,
    "degradeStart" TEXT NOT NULL,
    "degradeEnd" TEXT NOT NULL,
    "headerIcon" TEXT NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionSourate" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "sourateId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL,

    CONSTRAINT "SectionSourate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL,
    "titre" TEXT NOT NULL,
    "iconType" TEXT NOT NULL DEFAULT 'star',

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonStep" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL,
    "type" "StepType" NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "LessonStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sourate" (
    "id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "nomArabe" TEXT NOT NULL,
    "nombreVersets" INTEGER NOT NULL,
    "hizb" INTEGER NOT NULL,
    "revelation" TEXT,

    CONSTRAINT "Sourate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verset" (
    "id" TEXT NOT NULL,
    "sourateId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "texteArabe" TEXT NOT NULL,
    "audioUrl" TEXT,

    CONSTRAINT "Verset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersetTraduction" (
    "id" TEXT NOT NULL,
    "versetId" TEXT NOT NULL,
    "langue" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "VersetTraduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersetTranslitteration" (
    "id" TEXT NOT NULL,
    "versetId" TEXT NOT NULL,
    "langue" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "VersetTranslitteration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "etat" "LessonState" NOT NULL DEFAULT 'locked',
    "score" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourateRevision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourateId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "etat" "RevisionState" NOT NULL DEFAULT 'revoir',
    "prochaineRevision" TIMESTAMP(3),
    "derniereRevision" TIMESTAMP(3),
    "intervalleJours" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SourateRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "niveau" INTEGER NOT NULL,
    "ordre" INTEGER NOT NULL,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueWeek" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "numeroSemaine" INTEGER NOT NULL,
    "dateDebut" TIMESTAMP(3) NOT NULL,
    "dateFin" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leagueWeekId" TEXT NOT NULL,
    "weeklyXp" INTEGER NOT NULL DEFAULT 0,
    "rang" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "montant" DECIMAL(10,2) NOT NULL,
    "devise" TEXT NOT NULL DEFAULT 'EUR',
    "statut" "TransactionStatus" NOT NULL DEFAULT 'pending',
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_weeklyXp_idx" ON "User"("weeklyXp");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_deviceId_idx" ON "RefreshToken"("userId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Section_ordre_key" ON "Section"("ordre");

-- CreateIndex
CREATE INDEX "Section_hizb_idx" ON "Section"("hizb");

-- CreateIndex
CREATE INDEX "SectionSourate_sectionId_idx" ON "SectionSourate"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "SectionSourate_sectionId_sourateId_key" ON "SectionSourate"("sectionId", "sourateId");

-- CreateIndex
CREATE INDEX "Lesson_sectionId_idx" ON "Lesson"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_sectionId_ordre_key" ON "Lesson"("sectionId", "ordre");

-- CreateIndex
CREATE INDEX "LessonStep_lessonId_idx" ON "LessonStep"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonStep_lessonId_ordre_key" ON "LessonStep"("lessonId", "ordre");

-- CreateIndex
CREATE UNIQUE INDEX "Sourate_numero_key" ON "Sourate"("numero");

-- CreateIndex
CREATE INDEX "Sourate_hizb_idx" ON "Sourate"("hizb");

-- CreateIndex
CREATE INDEX "Verset_sourateId_idx" ON "Verset"("sourateId");

-- CreateIndex
CREATE UNIQUE INDEX "Verset_sourateId_numero_key" ON "Verset"("sourateId", "numero");

-- CreateIndex
CREATE INDEX "VersetTraduction_langue_idx" ON "VersetTraduction"("langue");

-- CreateIndex
CREATE UNIQUE INDEX "VersetTraduction_versetId_langue_key" ON "VersetTraduction"("versetId", "langue");

-- CreateIndex
CREATE INDEX "VersetTranslitteration_langue_idx" ON "VersetTranslitteration"("langue");

-- CreateIndex
CREATE UNIQUE INDEX "VersetTranslitteration_versetId_langue_key" ON "VersetTranslitteration"("versetId", "langue");

-- CreateIndex
CREATE INDEX "LessonProgress_userId_idx" ON "LessonProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonProgress_userId_lessonId_key" ON "LessonProgress"("userId", "lessonId");

-- CreateIndex
CREATE INDEX "SourateRevision_userId_idx" ON "SourateRevision"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SourateRevision_userId_sourateId_key" ON "SourateRevision"("userId", "sourateId");

-- CreateIndex
CREATE UNIQUE INDEX "League_ordre_key" ON "League"("ordre");

-- CreateIndex
CREATE INDEX "LeagueWeek_leagueId_idx" ON "LeagueWeek"("leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueWeek_leagueId_numeroSemaine_key" ON "LeagueWeek"("leagueId", "numeroSemaine");

-- CreateIndex
CREATE INDEX "LeagueMembership_leagueWeekId_weeklyXp_idx" ON "LeagueMembership"("leagueWeekId", "weeklyXp");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMembership_userId_leagueWeekId_key" ON "LeagueMembership"("userId", "leagueWeekId");

-- CreateIndex
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionSourate" ADD CONSTRAINT "SectionSourate_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionSourate" ADD CONSTRAINT "SectionSourate_sourateId_fkey" FOREIGN KEY ("sourateId") REFERENCES "Sourate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonStep" ADD CONSTRAINT "LessonStep_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verset" ADD CONSTRAINT "Verset_sourateId_fkey" FOREIGN KEY ("sourateId") REFERENCES "Sourate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersetTraduction" ADD CONSTRAINT "VersetTraduction_versetId_fkey" FOREIGN KEY ("versetId") REFERENCES "Verset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersetTranslitteration" ADD CONSTRAINT "VersetTranslitteration_versetId_fkey" FOREIGN KEY ("versetId") REFERENCES "Verset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourateRevision" ADD CONSTRAINT "SourateRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourateRevision" ADD CONSTRAINT "SourateRevision_sourateId_fkey" FOREIGN KEY ("sourateId") REFERENCES "Sourate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueWeek" ADD CONSTRAINT "LeagueWeek_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMembership" ADD CONSTRAINT "LeagueMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMembership" ADD CONSTRAINT "LeagueMembership_leagueWeekId_fkey" FOREIGN KEY ("leagueWeekId") REFERENCES "LeagueWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

