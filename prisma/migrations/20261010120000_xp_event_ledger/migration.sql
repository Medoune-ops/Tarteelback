-- Ticket 0.B4 (règle 4) — registre XP append-only : on RECALCULE weeklyXp à
-- partir des événements, on ne l'incrémente plus. Migration strictement
-- additive (règle 7) : aucune colonne/table supprimée.

-- 1) XP crédité pour une leçon (auditable, figé à la 1re complétion).
ALTER TABLE "LessonProgress" ADD COLUMN "xpAwarded" INTEGER NOT NULL DEFAULT 0;

-- 2) Registre XpEvent.
CREATE TABLE "XpEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leagueWeekId" TEXT,
    "amount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "ref" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XpEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "XpEvent_userId_leagueWeekId_idx" ON "XpEvent"("userId", "leagueWeekId");
CREATE INDEX "XpEvent_leagueWeekId_idx" ON "XpEvent"("leagueWeekId");

ALTER TABLE "XpEvent"
    ADD CONSTRAINT "XpEvent_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "XpEvent"
    ADD CONSTRAINT "XpEvent_leagueWeekId_fkey" FOREIGN KEY ("leagueWeekId")
    REFERENCES "LeagueWeek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Backfill : ne pas perdre le weeklyXp courant. Une ligne « carryover » par
--    utilisateur ayant déjà de l'XP, rattachée à sa semaine de ligue active.
INSERT INTO "XpEvent" ("id", "userId", "leagueWeekId", "amount", "source", "ref", "createdAt")
SELECT
    gen_random_uuid()::text,
    u."id",
    active."leagueWeekId",
    u."weeklyXp",
    'carryover',
    NULL,
    now()
FROM "User" u
LEFT JOIN LATERAL (
    SELECT lm."leagueWeekId"
    FROM "LeagueMembership" lm
    JOIN "LeagueWeek" lw ON lw."id" = lm."leagueWeekId"
    WHERE lm."userId" = u."id" AND lw."dateDebut" <= now() AND lw."dateFin" > now()
    ORDER BY lw."dateDebut" DESC
    LIMIT 1
) active ON true
WHERE u."weeklyXp" > 0;
