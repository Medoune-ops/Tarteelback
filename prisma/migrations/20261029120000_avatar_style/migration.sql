-- Avatar composé dans l'app (écran « Mon avatar »), visible par les amis.
-- Uniquement additif : null = avatar par défaut.
ALTER TABLE "User" ADD COLUMN "avatarStyle" JSONB;
