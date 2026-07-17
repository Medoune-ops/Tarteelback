-- CreateTable
CREATE TABLE "PendingGift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "PendingGift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingGift_userId_seenAt_idx" ON "PendingGift"("userId", "seenAt");

-- CreateIndex
CREATE INDEX "LessonProgress_lessonId_etat_idx" ON "LessonProgress"("lessonId", "etat");

-- AddForeignKey
ALTER TABLE "PendingGift" ADD CONSTRAINT "PendingGift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
