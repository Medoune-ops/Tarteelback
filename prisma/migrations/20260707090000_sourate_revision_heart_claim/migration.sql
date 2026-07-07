-- Anti-triche "reviser pour regagner" : marque la derniere derniereRevision
-- deja recompensee par un coeur, pour qu'une meme session completee ne
-- puisse pas etre rejouee plusieurs fois.
ALTER TABLE "SourateRevision" ADD COLUMN "derniereRecompenseCoeur" TIMESTAMP(3);
