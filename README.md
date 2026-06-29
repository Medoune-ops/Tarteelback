# Tarteel — API Backend

Backend maison pour **Tarteel**, une application mobile d'apprentissage du Coran
(style Duolingo). Pas de BaaS : c'est une API construite à la main que tu
contrôles entièrement.

**Stack :** Node + TypeScript · Fastify · PostgreSQL · Prisma · JWT (access court
+ refresh long) · Zod · argon2 · Docker. Architecture en couches
`routes → controllers → services → repositories`. **Toutes les règles du jeu
(cœurs, streak, premium, ligues) sont appliquées côté serveur** — un client
modifié ne peut jamais les contourner.

---

## Démarrage rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Configuration
cp .env.example .env
#    puis générer les secrets JWT :
node -e "console.log('JWT_ACCESS_SECRET='+require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET='+require('crypto').randomBytes(48).toString('hex'))"

# 3. Lancer Postgres + Redis (Docker)
npm run db:up   # démarre postgres ET redis

# 4. Appliquer le schéma
npx prisma migrate deploy        # ou : npm run prisma:migrate  (en dev)
npm run prisma:generate

# 5. Importer le VRAI Coran (114 sourates, 6236 versets, audio + traductions)
npm run seed:quran               # toutes les sourates ; QURAN_IMPORT_LIMIT pour un sous-ensemble
# 6. Peupler le parcours, la leçon démo, les utilisateurs démo+admin, les ligues
npm run seed

# 7. Démarrer
npm run dev                      # http://localhost:4000  ·  docs sur /docs
```

### Comptes de démo (après le seed)

| Rôle  | Email               | Mot de passe |
|-------|---------------------|--------------|
| user  | `demo@tarteel.app`  | `demo1234`   |
| admin | `admin@tarteel.app` | `admin1234`  |

---

## Import des données du Coran

Les données réelles viennent de l'**API Quran.com v4** (publique, sans clé).
Configure les éditions dans `.env` :

- `QURAN_TRANSLATION_IDS` / `QURAN_TRANSLATION_LANGS` — les ressources de
  traduction et le code langue associé à chacune (par défaut `131:en,136:fr`).
  **Ajoute-en ici pour gérer plus de langues** — l'app affiche le sens du verset
  dans la langue de l'utilisateur.
- `QURAN_TRANSLITERATION_ID` — ressource de translittération latine (par défaut `57`).
- `QURAN_RECITATION_ID` — récitateur pour l'audio par verset (par défaut `7`, Al-Afasy).
- `QURAN_IMPORT_LIMIT` — n'importer que les N dernières sourates (Juz Amma
  d'abord) pour un dev rapide ; laisser vide pour les 114.

L'import est **idempotent** (upserts), tu peux donc le relancer pour ajouter des
langues.

### i18n (sens multilingues)

Le sens d'un verset est stocké **par langue** dans `VersetTraduction`
(`langue` = `en`, `fr`, …) plutôt que dans une seule colonne. Le client demande
une langue via `?lang=fr` ou l'en-tête `Accept-Language` sur
`GET /sourates/:id/versets` ; l'API retombe sur `DEFAULT_LANG` quand une
traduction manque.

---

## Tests

```bash
npm test                 # tests purs des règles du jeu (hors-ligne, toujours exécutés)
# Les tests d'intégration ont besoin de Postgres (+ Redis) :
npm run db:up
npx prisma migrate deploy
RUN_DB_TESTS=1 npm test  # exécute aussi les tests HTTP auth/leçon/billing/ligue/redis
```

Couvert : perte de cœur sur mauvaise réponse, blocage à 0, **régén 1/4h** ;
premium (cœurs illimités + XP×2) ; streak gel/cassure/reprise/**réparation
payante** ; jugement `written` & `voice` (seuil indulgent) ; rang de ligue ;
session refresh/rotation, révocation au logout, nouvel appareil = pas de session ;
sécurité (isolation par compte, anti-triche, anti-escalade) ; couche Redis
(cache, sorted sets, verrou distribué).

---

## Scripts

| Script | Rôle |
|--------|------|
| `npm run dev` | Démarrer l'API avec rechargement à chaud |
| `npm run build` / `npm start` | Compiler dans `dist/` et exécuter |
| `npm run db:up` / `db:down` | Démarrer/arrêter Postgres + Redis (Docker) |
| `npm run prisma:migrate` | Créer & appliquer une migration de dev |
| `npm run prisma:deploy` | Appliquer les migrations (CI/prod) |
| `npm run seed:quran` | Importer le Coran depuis Quran.com |
| `npm run seed` | Peupler parcours, leçon démo, utilisateurs, ligues |
| `npm test` | Lancer les tests |
| `npm run jobs:maintenance` | Purge tokens + downgrade premium + rollover ligue + rappels (verrou distribué) |
| `npm run jobs:rollover` | Rollover hebdomadaire des ligues seulement |
| `npm run jobs:reminders` | Envoyer les rappels push dus (apprentissage + streak) |

## Mise à l'échelle (scaling)

Conçu pour tourner en **N instances sans état** derrière un load balancer.
**Redis est optionnel** (`REDIS_URL`) : il ajoute un rate-limit distribué, un
cache de contenu, le classement des ligues via sorted sets, et des verrous
distribués — et retombe proprement sur des fallbacks SQL/en-mémoire quand il est
absent. Voir **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** pour l'architecture
cible complète (PgBouncer, réplicas de lecture, CDN, jobs).

---

## Notifications push

Partie **backend** des notifications (les sons/animations de feedback, eux, sont
gérés côté app). Le backend :

- stocke un **token Expo par appareil** (`DeviceToken`, lié au compte) ;
- expose des endpoints pour **enregistrer/supprimer** un token et régler les
  **préférences** (rappel quotidien, alerte streak) ;
- envoie les notifications via l'**API Expo Push** (`src/modules/notifications`) ;
- propose des **jobs** de rappel (apprentissage quotidien, « ton streak va
  expirer »), conscients du fuseau horaire et protégés par verrou distribué :
  `npm run jobs:reminders`.

Voir le détail dans **[docs/API_CONTRACT.md](docs/API_CONTRACT.md)**.

---

## Architecture

```
src/
  config/        env (validé par zod), client prisma, client redis
  core/          logique indépendante du framework (cœurs, streak, premium,
                 jugement leçon, mot de passe, tokens, cache, verrou) — testée à l'unité
  plugins/       auth (JWT + gardes), gestion d'erreurs
  modules/
    auth/        register/login/refresh/logout, sessions
    me/          GET/PATCH /me, hearts/sync, streak/refresh, sérialiseur user
    content/     sections, leçons, sourates, versets (lecture) + CRUD admin
    lessons/     moteur de leçon : jugement des réponses, complétion
    leagues/     join, classement, rollover hebdo + sorted sets Redis
    billing/     subscribe, status, repair-streak (provider mock)
    notifications/ tokens d'appareil, préférences, envoi Expo Push
  jobs/          tâches de maintenance idempotentes (rollover, purge, rappels)
  app.ts         construit l'app Fastify (réutilisée par les tests)
  server.ts      point d'entrée du process
prisma/
  schema.prisma  modèle de données
  importQuran.ts import depuis Quran.com
  seed.ts        parcours + données de démo
```

Voir **[docs/API_CONTRACT.md](docs/API_CONTRACT.md)** pour le contrat complet des
endpoints et comment le brancher au front React Native.

---

## Billing (paiement)

Le billing est un **mock documenté** (pas de vrai Stripe). `POST /billing/subscribe`
active le premium immédiatement et enregistre une `Transaction` `success` avec un
`providerRef` simulé. Le contrat d'API correspond à celui d'un vrai provider :
passer à Stripe plus tard ne touchera que `billing.service.ts#charge()`.

---

## Sécurité

Mots de passe argon2id, JWT signés (HS256, iss/aud), refresh tokens hashés &
rotés liés à l'appareil, rate-limiting (renforcé sur l'auth), validation stricte
de toutes les entrées (Zod `.strict()`, anti mass-assignment), isolation totale
par compte (anti-IDOR), règles de jeu 100 % côté serveur, headers de sécurité
(Helmet), CORS verrouillé en prod, `npm audit` propre. En production, le serveur
**refuse de démarrer** avec des secrets par défaut ou un CORS `*`.
```
