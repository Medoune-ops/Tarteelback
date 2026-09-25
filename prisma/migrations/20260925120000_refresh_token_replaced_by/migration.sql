-- Rotation d'un refresh token : id du jeton qui l'a remplacé (délai de grâce).
ALTER TABLE "RefreshToken" ADD COLUMN "replacedById" TEXT;
