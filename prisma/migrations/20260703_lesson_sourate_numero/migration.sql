-- Lien optionnel leçon → sourate enseignée (numéro 1–114). Rempli au seed.
-- Sert au "déjà mémorisé" de l'onboarding (skip du point de départ).
ALTER TABLE "Lesson" ADD COLUMN "sourateNumero" INTEGER;
CREATE INDEX "Lesson_sourateNumero_idx" ON "Lesson"("sourateNumero");
