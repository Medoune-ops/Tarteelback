# Architecture & scaling — Tarteel backend

This backend is built to scale horizontally to millions of users. Redis is
**optional**: every Redis-backed feature degrades to a SQL/in-memory fallback,
so the app runs identically (just slower at extreme scale) without it.

## Components

```
                 ┌── CDN (optional) ──┐  cache /sourates, /versets, audio
Mobile ──HTTPS──►│   Load Balancer    │  health=/health (liveness)
                 └─────────┬──────────┘  routing readiness=/ready (DB ping)
        ┌─────────┬────────┴────────┬─────────┐
     API #1    API #2            API #N   ...  (stateless, autoscaled)
        │         │                 │
        ├─────────┴──── Redis ──────┴─────────┤
        │  • distributed rate-limit            │
        │  • content cache (versioned)         │
        │  • league ranking (sorted sets)      │
        │  • distributed locks (rollover/jobs) │
        │                                      │
        └──── (PgBouncer, recommended) ────────┤
                       │                        │
                  Postgres PRIMARY ──repl──► Read replica(s)
                       ▲
        Maintenance worker (cron): rollover, purge tokens, downgrade premium
```

## Statelessness

API instances hold **no per-request state in memory**. Auth is a stateless
access JWT + DB-backed refresh tokens. So you can run N instances behind a load
balancer and autoscale freely. The only "run-once" work (weekly league rollover,
maintenance jobs) is guarded by a **distributed lock** (`src/core/lock.ts`):
Redis `SET NX PX` when Redis is present, Postgres advisory lock otherwise.

## Redis layer (`src/config/redis.ts`)

`REDIS_URL` enables it. `withRedis(op, fallback)` runs a Redis op and falls back
on any error or when Redis is absent. Features:

| Feature | Key pattern | Fallback |
|---------|-------------|----------|
| Rate-limit | `@fastify/rate-limit` store | in-memory (per instance) |
| Content cache | `content:v{N}:{key}` | no cache (query each time) |
| League ranking | `league:rank:{weekId}` (sorted set) | SQL `COUNT`/`LIMIT`/`OFFSET` (index-backed) |
| Locks | `lock:{name}` | `pg_advisory_lock` |

### Content cache & invalidation
Near-immutable content (`/sections`, `/sourates`, `/sourates/:id/versets`,
`/lessons/:id`) is cached in Redis. Each key embeds a global **content version**;
any admin write bumps the version (`content:version` `INCR`) via an `onResponse`
hook on the admin routes, instantly invalidating every cached key — no key
tracking needed. `/sections` caches only the shared content; the per-user
progress overlay is always fetched fresh and merged on top.

### League ranking at scale
`weeklyXp` lives in Postgres (source of truth, atomic increments). After each
commit it's mirrored into a Redis **sorted set** per week. Reads use
`ZCARD`/`ZREVRANK`/`ZREVRANGE` — O(log n), serving rank/podium/neighbours without
ever loading the whole league. If Redis is cold/absent, the same data is served
by index-backed SQL (`@@index([leagueWeekId, weeklyXp])`).

## Concurrency & correctness

- **Heart loss** is a single conditional SQL `UPDATE ... WHERE hearts > 0` — no
  read-modify-write race.
- **Lesson completion** runs in a transaction with `SELECT ... FOR UPDATE` on the
  user row and is **idempotent** (XP/streak/league credited only on first
  completion). League XP increments in the same DB transaction; the Redis mirror
  happens after commit (best-effort, DB remains truth).
- **Rollover** is idempotent (`closedAt` flag), locked, and per-week transactional.

## Maintenance jobs (`src/jobs/maintenance.ts`)

Idempotent, lock-guarded, schedulable from cron / k8s CronJob:

```bash
npm run jobs:maintenance        # purge tokens + downgrade premium + rollover
npm run jobs:rollover           # weekly league rollover only
tsx src/jobs/maintenance.ts purge-tokens
tsx src/jobs/maintenance.ts downgrade-premium
```

## Production checklist for high scale

1. **Set `REDIS_URL`** (managed Redis / cluster) — enables all of the above.
2. **PgBouncer** in transaction mode in front of Postgres; bound the per-instance
   pool: `DATABASE_URL=...&connection_limit=10&pool_timeout=20` so
   `instances × connection_limit ≤ pooler max`.
3. **Read replica(s)** for content/ranking reads (Prisma `readReplicas` or route
   read-only endpoints to a replica DSN).
4. **Load balancer**: liveness `/health`, readiness `/ready` (checks the DB).
5. **Schedule** `npm run jobs:maintenance` (e.g. every 10 min) on ONE schedule;
   the distributed lock makes concurrent runs safe.
6. Real **secrets** (`JWT_*`), explicit **`CORS_ORIGINS`** (no `*`), and Swagger
   stays disabled in prod automatically.
7. **CDN** in front of `/sourates*` (public, language-keyed, cacheable) and the
   audio URLs.
8. Observability: add metrics (e.g. `prom-client`) and ship structured logs.
```
