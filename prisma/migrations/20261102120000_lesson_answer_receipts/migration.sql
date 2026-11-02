-- Verdicts déjà rendus sur une étape de leçon : une réponse renvoyée après une
-- coupure réseau rejoue le verdict au lieu de coûter un deuxième cœur.
-- Uniquement additif. Purgé par le job de maintenance après 7 jours.
CREATE TABLE "LessonAnswerReceipt" (
    "userId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "score" INTEGER,
    "transcription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonAnswerReceipt_pkey" PRIMARY KEY ("userId","stepId","key")
);

CREATE INDEX "LessonAnswerReceipt_createdAt_idx" ON "LessonAnswerReceipt"("createdAt");

ALTER TABLE "LessonAnswerReceipt" ADD CONSTRAINT "LessonAnswerReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
