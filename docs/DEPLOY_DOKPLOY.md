# Déploiement sur Dokploy

Deux services applicatifs (backend API + microservice ASR) et deux services de
données (PostgreSQL + Redis), tous sur le **réseau interne Docker** de Dokploy.
Seul le backend est exposé publiquement via un domaine ; l'ASR, Postgres et
Redis restent internes.

```
Internet ── (domaine + TLS Traefik) ──> backend (Fastify, :4000)
                                          │ DATABASE_URL   ──> postgres (:5432, interne)
                                          │ REDIS_URL      ──> redis    (:6379, interne)
                                          │ ASR_URL        ──> asr      (:9000, interne)
```

## 1) PostgreSQL

Dokploy → **Create Service → Database → PostgreSQL 16**.

- Nom : `tarteel-postgres`, base `tarteel`, user `tarteel`, mot de passe fort.
- Ne PAS exposer le port publiquement.
- Noter l'URL interne : `postgresql://tarteel:<pwd>@tarteel-postgres:5432/tarteel?schema=public&connection_limit=10&pool_timeout=20`

## 2) Redis

Dokploy → **Create Service → Database → Redis 7** (ou service Docker
`redis:7-alpine` avec `--appendonly yes`).

- Nom : `tarteel-redis`. Interne uniquement.
- URL interne : `redis://tarteel-redis:6379`

## 3) Microservice ASR (Whisper base fine-tuné Coran)

Dokploy → **Create Service → Application**.

- **Source** : ce dépôt Git.
- **Build type** : Dockerfile — **Docker File** : `asr/Dockerfile`, **Docker Context Path** : `asr`.
- Nom du service : `tarteel-asr` (ce nom = hostname interne).
- **Env** : `ASR_API_KEY=<valeur aléatoire>` (la même que côté backend, étape 4).
  Optionnel : `ASR_CPU_THREADS=2` pour borner le CPU.
- **Domains** : AUCUN — le service ne doit pas être exposé publiquement.
- **Ressources** : réserver ~1 Go de RAM. Inférence CPU : ~1–3 s par ayah.

⚠️ **Premier build long** : l'étape de conversion télécharge
`tarteel-ai/whisper-base-ar-quran` depuis Hugging Face (~300 Mo) + torch CPU.
Comptez plusieurs minutes. Les rebuilds suivants réutilisent le cache Docker.
Le modèle est figé DANS l'image : aucun téléchargement au démarrage, les
redéploiements/redémarrages ne dépendent pas de Hugging Face.

Vérification **sans terminal** : le `HEALTHCHECK` embarqué dans l'image appelle
`/health` toutes les 30 s → le service doit s'afficher **healthy** dans Dokploy,
et les logs montrent `Uvicorn running on http://0.0.0.0:9000`.
(Équivalent terminal : `wget -qO- http://tarteel-asr:9000/health` depuis le
conteneur backend.)

## 4) Backend API

Dokploy → **Create Service → Application**.

- **Source** : ce dépôt Git. **Build type** : Dockerfile (le `Dockerfile` à la racine).
- Nom : `tarteel-api`.
- **Domains** : votre domaine (ex. `api.tarteel.app`) → port **4000**, HTTPS via
  Let's Encrypt (Traefik géré par Dokploy).
- **Env** (secrets Dokploy, jamais dans le dépôt) :

```env
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
CORS_ORIGINS=https://votre-front.example        # jamais * en prod (refus au boot)

DATABASE_URL=postgresql://tarteel:<pwd>@tarteel-postgres:5432/tarteel?schema=public&connection_limit=10&pool_timeout=20
REDIS_URL=redis://tarteel-redis:6379

JWT_ACCESS_SECRET=<64+ chars aléatoires>
JWT_REFRESH_SECRET=<64+ chars aléatoires, DIFFÉRENTS>

# ASR — scoring vocal serveur
ASR_URL=http://tarteel-asr:9000
ASR_API_KEY=<la même valeur qu'à l'étape 3>
ASR_TIMEOUT_MS=15000

RESEND_API_KEY=re_xxxxxxxxxxxx
MAIL_FROM=Tarteel <no-reply@votredomaine>
```

Le `CMD` de l'image exécute `prisma migrate deploy` avant de démarrer
(idempotent). Au premier déploiement, lancer les seeds — **une seule fois** —
au choix :

**Sans terminal Dokploy (depuis votre PC)** : dans Dokploy, activer l'**External
Port** de `tarteel-postgres` (ex. 5433), puis en local :

```powershell
$env:DATABASE_URL = "postgresql://tarteel:<pwd>@<ip-serveur>:5433/tarteel?schema=public"
npm run seed:quran   # 114 sourates (long)
npm run seed
```

puis **désactiver l'External Port** aussitôt (la base ne doit pas rester
exposée sur Internet).

**Ou via le terminal du conteneur Dokploy** :

```sh
npx tsx prisma/importQuran.ts   # 114 sourates (long)
npx tsx prisma/seed.ts
```

- **Healthcheck** Dokploy : path `/ready` (503 si la DB est injoignable ; Redis
  et ASR n'y participent pas — ce sont des accélérateurs optionnels).

## 5) Jobs planifiés

Dokploy → onglet **Schedules** du service `tarteel-api` (exécution dans le conteneur) :

| Cron          | Commande                                  | Rôle                                  |
| ------------- | ----------------------------------------- | ------------------------------------- |
| `0 3 * * *`   | `node dist/jobs/maintenance.js`           | purge tokens, downgrade premium       |
| `5 0 * * 1`   | `node dist/jobs/maintenance.js rollover`  | clôture hebdo des ligues              |
| `*/30 * * * *`| `node dist/jobs/maintenance.js reminders` | rappels push (timezone-aware)         |

(Verrous distribués : plusieurs instances peuvent exécuter le cron sans doublon.)

## 6) Notes de dimensionnement

- **Backend** : stateless → plusieurs instances possibles derrière Traefik
  (rate-limit, cache et classements partagés via Redis).
- **ASR** : 1 instance suffit au départ (transcriptions sérialisées, ~1–3 s
  par ayah, la file absorbe les pics). Pour monter en charge : augmenter les
  répliques du service `tarteel-asr` — le backend n'a rien à changer, Docker
  répartit sur le hostname.
- Si l'ASR tombe, l'app reste fonctionnelle : `/answer-voice` répond 503 et le
  front retombe sur le scoring on-device (indulgent, sans cœur en jeu).
