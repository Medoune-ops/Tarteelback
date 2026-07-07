-- Nouveau type de transaction : achat direct de cœurs avec de l'argent.
-- Isolé dans sa propre migration : PostgreSQL interdit d'utiliser une valeur
-- d'enum fraîchement ajoutée dans la même transaction que son ajout.
ALTER TYPE "TransactionType" ADD VALUE 'heart_pack';
