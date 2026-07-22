-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "versetDebut" INTEGER,
ADD COLUMN     "versetFin" INTEGER;

-- CreateTable
CREATE TABLE "SourateChainProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourateId" TEXT NOT NULL,
    "lessonsConsolidees" INTEGER NOT NULL DEFAULT 0,
    "terminee" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourateChainProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourateChainProgress_userId_idx" ON "SourateChainProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SourateChainProgress_userId_sourateId_key" ON "SourateChainProgress"("userId", "sourateId");

-- AddForeignKey
ALTER TABLE "SourateChainProgress" ADD CONSTRAINT "SourateChainProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourateChainProgress" ADD CONSTRAINT "SourateChainProgress_sourateId_fkey" FOREIGN KEY ("sourateId") REFERENCES "Sourate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
