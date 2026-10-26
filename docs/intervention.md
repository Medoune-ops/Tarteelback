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

Deux sources, dans cet ordre :
1. la variable d'environnement `FRIENDS_ENABLED=true` (ou `1`) **force** la fonctionnalité (dev/tests). Toute autre valeur, ou son absence, ne force rien ;
2. sinon, c'est l'interrupteur du back-office qui décide : `AppConfig.friendsEnabled` (+ `friendsBetaUserIds` : si la liste n'est pas vide, seuls ces comptes y ont accès).

```sql
SELECT "friendsEnabled", "friendsBetaUserIds" FROM "AppConfig" WHERE id = 'singleton';
```

### 2.2 Couper la fonctionnalité

**Option A — Back-office (recommandé, sans redémarrage) :**
`PATCH /backoffice/config { "friendsEnabled": false }`. Appliqué en 10 s au plus sur chaque instance.

**Option B — En SQL (si le back-office est inaccessible) :**
```sql
UPDATE "AppConfig" SET "friendsEnabled" = false WHERE id = 'singleton';
```
Appliqué en 10 s au plus.

⚠ Si `FRIENDS_ENABLED=true` est défini dans l'environnement du déploiement, il force la fonctionnalité quel que soit le back-office : le retirer et redémarrer.

### 2.2 bis Couper un seul compte

`POST /backoffice/moderation/users/:userId/friends-disable` (ou traiter un signalement avec `disable_friends`). Le compte reçoit `503 FRIENDS_DISABLED` sur toutes les routes amis ; l'apprentissage n'est pas touché. `friends-enable` rétablit l'accès.

### 2.3 Effets de la coupure

Quand `FRIENDS_ENABLED` est `false` :
- `POST /me/friends/*` → `503 FRIENDS_DISABLED`
- `POST /me/challenges/preview`, `POST /me/challenges`, `GET /me/challenges`, `GET /me/challenges/:id` → `503 FRIENDS_DISABLED`
- `POST /me/challenges/:id/accept|decline|leave|cancel` → `503 FRIENDS_DISABLED`
- `POST /me/challenges/:id/nudge` → `503 FRIENDS_DISABLED`
- `POST /me/messages`, `GET /me/messages`, `POST /me/messages/:id/read`, `DELETE /me/messages/:id` → `503 FRIENDS_DISABLED`
- `GET /me/summary` → `challengeInvites: 0`, `activeChallenges: 0`

La réactivation se fait en repassant `friendsEnabled` sur `true` au back-office.

---

## 2 bis. Défis bloqués

- Un défi « pending » dont la date de début est passée démarre (ou est annulé) au prochain passage du job `activate-challenges`, ou dès qu'un participant ouvre ses défis.
- Un défi « active » échu se termine au prochain passage de `finalize-challenges`, ou à la lecture.

```bash
npx tsx src/jobs/maintenance.ts activate-challenges
npx tsx src/jobs/maintenance.ts finalize-challenges
```

Le job de maintenance tourne une fois par heure (DEPLOY-DOKPLOY.md). La file d'événements est aussi traitée juste après chaque action (fin de leçon, création de défi…) ; le job ne sert que de rattrapage.

---

## 3. Liens utiles

- [API Contract](./API_CONTRACT.md) — documentation des endpoints
- [Architecture](./ARCHITECTURE.md) — présentation générale du backend
- [Déploiement Dokploy](./DEPLOY_DOKPLOY.md) — procédure de déploiement