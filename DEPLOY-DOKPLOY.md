# Déployer sur Dokploy (ou n'importe quel hôte Docker)

Le repo est auto-suffisant : `Dockerfile` (API seule) + `docker-compose.prod.yml`
(API + Postgres + Redis). Les migrations Prisma s'appliquent toutes seules au
démarrage du conteneur (`prisma migrate deploy`, idempotent).

## Option A — Compose complet (recommandé pour tes tests serveur)

1. Dans Dokploy : **Create → Compose**, branche ce repo Git, fichier
   `docker-compose.prod.yml`.
2. Onglet **Environment**, colle (en générant tes valeurs) :

   ```env
   POSTGRES_PASSWORD=<mot de passe fort>
   JWT_ACCESS_SECRET=<64+ hex>   # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   JWT_REFRESH_SECRET=<64+ hex, DIFFÉRENT>
   CORS_ORIGINS=https://ton-domaine.tld
   # optionnels : RESEND_API_KEY, APP_RESET_URL, API_PORT
   ```

3. Deploy. Puis expose le service `api` (port interne 4000) via le domaine
   Dokploy/Traefik. Healthcheck : `GET /health`.
4. Seed initial (une seule fois, terminal Dokploy du conteneur `api`) :

   ```sh
   npx tsx prisma/importQuran.ts   # contenu du Coran (long)
   npx tsx prisma/seed.ts          # sections/leçons/démo
   ```

5. Cron hebdo des ligues + rappels : ajoute un job planifié Dokploy sur le
   conteneur `api` : `node dist/jobs/maintenance.js` (ou
   `npx tsx src/jobs/maintenance.ts`) une fois par heure.

## Option B — API seule (base de données déjà existante)

**Create → Application (Dockerfile)** sur ce repo, et fournis simplement
`DATABASE_URL`, `REDIS_URL` (optionnel), les deux secrets JWT et `CORS_ORIGINS`.

## En local, pour vérifier exactement l'image de prod

```sh
cp .env.example .env.prod   # puis renseigne POSTGRES_PASSWORD + secrets JWT
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
curl http://localhost:4000/health
```

Le front (Expo) n'a qu'une seule variable à changer :
`EXPO_PUBLIC_API_URL=https://ton-domaine.tld` dans son `.env`.
