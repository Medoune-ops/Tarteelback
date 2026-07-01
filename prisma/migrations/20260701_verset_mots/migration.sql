-- Word-by-word audio: one row per word of a verse, with its own recitation
-- audio, so the UI can play exactly the word shown.
CREATE TABLE "VersetMot" (
    "id" TEXT NOT NULL,
    "versetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "texteArabe" TEXT NOT NULL,
    "audioUrl" TEXT,
    CONSTRAINT "VersetMot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VersetMot_versetId_position_key" ON "VersetMot"("versetId", "position");
CREATE INDEX "VersetMot_versetId_idx" ON "VersetMot"("versetId");

ALTER TABLE "VersetMot"
    ADD CONSTRAINT "VersetMot_versetId_fkey"
    FOREIGN KEY ("versetId") REFERENCES "Verset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
