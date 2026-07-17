-- SRS par SEGMENT plutôt que par sourate entière : ajoute segmentIndex
-- (0-based, bloc de SEGMENT_SIZE versets consécutifs — cf. core/revision.ts).
-- Les lignes existantes deviennent segmentIndex = 0 (le progrès déjà suivi
-- redevient celui du 1er bloc ; les blocs suivants démarrent neufs — c'est le
-- rebaseline attendu puisque le suivi par segment est une nouvelle dimension).
ALTER TABLE "SourateRevision" ADD COLUMN "segmentIndex" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "SourateRevision_userId_sourateId_key";

CREATE UNIQUE INDEX "SourateRevision_userId_sourateId_segmentIndex_key"
  ON "SourateRevision"("userId", "sourateId", "segmentIndex");

CREATE INDEX "SourateRevision_sourateId_idx" ON "SourateRevision"("sourateId");
