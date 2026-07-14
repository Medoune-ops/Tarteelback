-- Convert Section.titre/sousTitre and Lesson.titre from String to Json,
-- WITHOUT dropping data: each existing string value is wrapped as
-- {"fr": value, "en": value} so nothing regresses to blank/null before the
-- content generators are re-run with real per-language translations.

ALTER TABLE "Section"
  ALTER COLUMN "titre" TYPE JSONB
  USING jsonb_build_object('fr', "titre", 'en', "titre");

ALTER TABLE "Section"
  ALTER COLUMN "sousTitre" TYPE JSONB
  USING jsonb_build_object('fr', "sousTitre", 'en', "sousTitre");

ALTER TABLE "Lesson"
  ALTER COLUMN "titre" TYPE JSONB
  USING jsonb_build_object('fr', "titre", 'en', "titre");
