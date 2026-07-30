# Backup — fichiers lib/ du repo mobile Tarteel

Ces fichiers viennent du repo app mobile `Tarteel` (React Native/Expo), où ils
sont gitignorés (voir `.gitignore` de ce repo, qui exclut `/lib/` pour garder
l'intégration backend hors du repo public). Ils n'existaient donc que sur une
seule machine, sans aucune sauvegarde — cette branche sert de filet de
sécurité, isolée de `main` (le vrai code du backend).

Chemins d'origine (relatifs à la racine du repo `Tarteel`) :

- lib/api/config.ts
- lib/api/content.ts
- lib/api/household.ts
- lib/api/leagues.ts
- lib/api/password.ts
- lib/api/referral.ts
- lib/api/revision.ts
- lib/api/swr.ts
- lib/api/tokens.ts
- lib/audio/recorder.ts

Cette branche n'est jamais mergée dans `main` — elle sert uniquement de
sauvegarde consultable.
