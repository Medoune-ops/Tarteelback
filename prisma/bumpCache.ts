/**
 * Invalide TOUT le cache contenu (sections, sourates, versets, leçons) en
 * incrémentant `content:version` dans Redis — même mécanisme que le boot du
 * serveur (`bumpContentVersion`). À lancer après une écriture directe de contenu
 * en base (generateLessons / generateAlphabet / fix ciblés) pour que le nouveau
 * contenu soit servi immédiatement, sans attendre un reboot ou l'expiration TTL.
 *
 *   REDIS_URL="rediss://…" npx tsx prisma/bumpCache.ts
 */
import 'dotenv/config';
import Redis from 'ioredis';

const url = process.env.REDIS_URL;
if (!url) {
  console.error('❌ REDIS_URL manquant (donne l\'URL Redis de la cible).');
  process.exit(1);
}

const redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });

(async () => {
  const v = await redis.incr('content:version');
  console.log(`✓ content:version → ${v} — cache contenu invalidé`);
  await redis.quit();
})().catch((e) => {
  console.error('❌', e.message ?? e);
  redis.disconnect();
  process.exit(1);
});
