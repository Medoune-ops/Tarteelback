# Guide d'intervention — Tarteel backend

Ce document explique comment intervenir en cas d'incident sur le backend Tarteel, en particulier pour la file d'événements et la fonctionnalité "amis" (FRIENDS_ENABLED).

## 1. File d'événements (DomainEvent / outbox)

### 1.1 Repérer les événements bloqués

Les événements sont stockés dans la table `DomainEvent`. Un événement est considéré comme **bloqué** s'il remplit l'une de ces conditions :

- `processedAt IS NULL` : jamais traité (en attente)
- `lastError IS NOT NULL` : a échoué au moins une fois (dernière erreur enregistrée)

Requête SQL pour lister les événements bloqués :

```sql
-- Événements jamais traités (en attente)
SELECT id, type, userId, createdAt, attempts, lastError
FROM "DomainEvent"
WHERE "processedAt" IS NULL
ORDER BY "createdAt" ASC;

-- Événements en erreur (dernière tentative échouée)
SELECT id, type, userId, createdAt, attempts, lastError
FROM "DomainEvent"
WHERE "lastError" IS NOT NULL
ORDER BY "createdAt" DESC;

-- Tous les événements non finalisés (attente ou erreur)
SELECT id, type, userId, createdAt, attempts, lastError
FROM "DomainEvent"
WHERE "processedAt" IS NULL OR "lastError" IS NOT NULL
ORDER BY "createdAt" ASC;
```

### 1.2 Relancer les événements bloqués

La file d'événements est drainée automatiquement par le job `processOutbox` (maintenance). Pour forcer une relance immédiate :

**Via la CLI :**
```bash
npx tsx src/jobs/maintenance.ts process-outbox
```

**Ou directement en SQL (marquer comme à traiter à nouveau) :**
```sql
-- Remettre à zéro les tentatives et effacer l'erreur pour relancer
UPDATE "DomainEvent"
SET "attempts" = 0, "lastError" = NULL, "processedAt" = NULL
WHERE "processedAt" IS NULL OR "lastError" IS NOT NULL;
```
Puis relancer le job `process-outbox`.

### 1.3 Vérifier qu'un événement a été traité

```sql
SELECT id, type, userId, "processedAt", "lastError", attempts
FROM "DomainEvent"
WHERE id = 'ID_DE_L_EVENEMENT';
```
- `processedAt IS NOT NULL` et `lastError IS NULL` → traité avec succès.

---

## 2. Couper la fonctionnalité "amis" (FRIENDS_ENABLED)

La fonctionnalité "amis" (création d'amitié, défis, messages, etc.) est pilotée par le flag d'application `FRIENDS_ENABLED`. Lorsqu'il est désactivé, les endpoints amis retournent `503 FRIENDS_DISABLED`.

### 2.1 Vérifier l'état actuel

Le flag est lu via la configuration back-office (`AppConfig`) ou une variable d'environnement selon le déploiement. Vérifiez dans le back-office (section Config) ou dans les variables d'environnement du déploiement.

### 2.2 Désactiver FRIENDS_ENABLED

**Option A — Variable d'environnement (redémarrage requis) :**
Définissez `FRIENDS_ENABLED=false` dans le fichier `.env` ou les variables d'environnement du déploiement, puis redémarrez le service.

**Option B — Back-office (si disponible) :**
Dans la section Configuration du back-office, passez le flag `friendsEnabled` sur `false` et sauvegardez. Le changement est pris en compte sans redémarrage (lu à chaud).

### 2.3 Effets de la coupure

Quand `FRIENDS_ENABLED` est `false` :
- `POST /me/friends/*` → `503 FRIENDS_DISABLED`
- `POST /me/challenges/preview`, `POST /me/challenges`, `GET /me/challenges`, `GET /me/challenges/:id` → `503 FRIENDS_DISABLED`
- `POST /me/challenges/:id/accept|decline|leave|cancel` → `503 FRIENDS_DISABLED`
- `POST /me/challenges/:id/nudge` → `503 FRIENDS_DISABLED`
- `POST /me/messages`, `GET /me/messages`, `POST /me/messages/:id/read`, `DELETE /me/messages/:id` → `503 FRIENDS_DISABLED`
- `GET /me/summary` → `challengeInvites: 0`, `activeChallenges: 0`

La réactivation se fait en repassant `FRIENDS_ENABLED` sur `true`.

---

## 3. Liens utiles

- [API Contract](./API_CONTRACT.md) — documentation des endpoints
- [Architecture](./ARCHITECTURE.md) — présentation générale du backend
- [Déploiement Dokploy](./DEPLOY_DOKPLOY.md) — procédure de déploiement