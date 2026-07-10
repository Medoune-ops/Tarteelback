-- CreateTable
CREATE TABLE "LettreRevision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "etat" "RevisionState" NOT NULL DEFAULT 'revoir',
    "prochaineRevision" TIMESTAMP(3),
    "derniereRevision" TIMESTAMP(3),
    "intervalleJours" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LettreRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LettreRevision_userId_idx" ON "LettreRevision"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LettreRevision_userId_lessonId_key" ON "LettreRevision"("userId", "lessonId");

-- AddForeignKey
ALTER TABLE "LettreRevision" ADD CONSTRAINT "LettreRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LettreRevision" ADD CONSTRAINT "LettreRevision_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
