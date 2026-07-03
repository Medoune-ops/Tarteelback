# =============================================================================
# Tarteel backend — image de production (Fastify + Prisma, Node 22)
# -----------------------------------------------------------------------------
# Build multi-étapes :
#   1) build   : installe TOUTES les deps, compile argon2 (natif), génère le
#                client Prisma, compile le TypeScript -> dist/.
#   2) runtime : même base Debian (binaires natifs + moteurs Prisma compatibles),
#                on recopie node_modules + dist + prisma, puis au démarrage on
#                applique les migrations (idempotent) avant de lancer l'API.
#
# Base Debian bookworm-slim : openssl 3 -> cible Prisma "debian-openssl-3.0.x"
# identique entre build et runtime (aucun mismatch de moteur).
# =============================================================================

# ---- 1) Build ---------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Outils pour compiler argon2 si aucun binaire pré-compilé n'est dispo + openssl (Prisma).
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Deps d'abord (cache Docker) — le schéma Prisma est requis par `prisma generate`.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Le reste du code, puis génération client Prisma + compilation TS.
COPY . .
RUN npx prisma generate && npm run build

# ---- 2) Runtime -------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# openssl requis à l'exécution par les moteurs Prisma.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# node_modules du build = client Prisma généré + moteurs + argon2 compilé + CLI
# Prisma (pour `migrate deploy`) + tsx (pour lancer les seeds depuis le conteneur).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

# Port interne de l'API (src/config/env.ts : PORT par défaut 4000, HOST 0.0.0.0).
EXPOSE 4000

# Applique les migrations (crée/maj les tables, sans toucher aux données) puis
# démarre. `migrate deploy` est idempotent : sûr à chaque redémarrage.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
