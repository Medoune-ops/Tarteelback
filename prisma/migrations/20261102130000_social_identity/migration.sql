-- Connexion avec Google / Apple : relie le compte du fournisseur à un utilisateur.
-- Uniquement additif.
CREATE TYPE "SocialProvider" AS ENUM ('google', 'apple');

CREATE TABLE "SocialIdentity" (
    "provider" "SocialProvider" NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialIdentity_pkey" PRIMARY KEY ("provider","subject")
);

CREATE INDEX "SocialIdentity_userId_idx" ON "SocialIdentity"("userId");

ALTER TABLE "SocialIdentity" ADD CONSTRAINT "SocialIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
