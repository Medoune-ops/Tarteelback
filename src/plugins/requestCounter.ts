import fp from 'fastify-plugin';
import { prisma } from '../config/prisma.js';

/**
 * Compte les requêtes HTTP reçues, agrégées par jour (UTC), pour le dashboard
 * back-office (Analytique). En prod le logging par requête est désactivé
 * (coûteux à haut volume, cf. app.ts `disableRequestLogging`), donc sans ce
 * hook aucun volume de trafic n'est nulle part observable.
 *
 * Accumule EN MÉMOIRE (pas d'écriture DB par requête — trop coûteux à haut
 * débit) et flush par un upsert incrémental toutes les FLUSH_INTERVAL_MS.
 * Un crash entre deux flush perd au plus l'intervalle courant — acceptable
 * pour une métrique de dashboard, pas une donnée métier.
 */
const FLUSH_INTERVAL_MS = 10_000;

let pendingCount = 0;

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function flush() {
  if (pendingCount === 0) return;
  const count = pendingCount;
  pendingCount = 0;
  const day = todayUtc();
  try {
    await prisma.requestCount.upsert({
      where: { day },
      create: { day, count },
      update: { count: { increment: count } },
    });
  } catch {
    // DB indisponible : on renonce à ce lot plutôt que de bloquer/planter le
    // serveur pour une métrique non critique.
  }
}

// Probes internes (load balancer, healthcheck) — pas du vrai trafic app,
// exclues pour ne pas gonfler artificiellement le compteur.
const EXCLUDED_PATHS = new Set(['/health', '/ready']);

export default fp(async (app) => {
  app.addHook('onResponse', (req, _reply, done) => {
    if (!EXCLUDED_PATHS.has(req.routeOptions?.url ?? req.url)) {
      pendingCount += 1;
    }
    done();
  });

  const interval = setInterval(flush, FLUSH_INTERVAL_MS);
  app.addHook('onClose', async () => {
    clearInterval(interval);
    await flush();
  });
});
