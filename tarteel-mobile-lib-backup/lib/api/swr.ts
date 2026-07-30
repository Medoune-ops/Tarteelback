/**
 * Mini-cache mémoire "stale-while-revalidate" pour les lectures API.
 *
 * Objectif : rendre la navigation instantanée. Un écran affiche d'abord la
 * dernière valeur connue (si présente), pendant qu'un fetch en arrière-plan
 * rafraîchit les données. Le backend (Render) peut mettre plusieurs secondes
 * à répondre — sans ce cache, chaque focus d'onglet bloque sur le réseau.
 *
 * Le cache vit le temps de la session (mémoire JS). `clearSwrCache()` doit
 * être appelé au logout pour ne pas montrer les données d'un autre compte.
 */

interface CacheEntry {
  value: unknown;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
/** Requêtes en vol, dédupliquées par clé (2 focus rapprochés = 1 seul fetch). */
const inflight = new Map<string, Promise<unknown>>();

/** Durée pendant laquelle une valeur est servie sans refetch (30 s). */
const FRESH_MS = 30 * 1000;

/** Valeur en cache pour `key`, ou undefined. */
export function getCached<T>(key: string): T | undefined {
  return cache.get(key)?.value as T | undefined;
}

/**
 * Lit `key` façon SWR :
 *  - cache frais (< FRESH_MS)  → renvoie le cache, pas de réseau ;
 *  - cache périmé              → renvoie le cache ET rafraîchit en fond
 *                                (le résultat arrive via `onRefresh`) ;
 *  - pas de cache              → fetch bloquant classique.
 */
export async function swrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  onRefresh?: (fresh: T) => void,
): Promise<T> {
  const entry = cache.get(key);

  if (entry) {
    const isFresh = Date.now() - entry.fetchedAt < FRESH_MS;
    if (!isFresh) {
      // Rafraîchit en arrière-plan sans bloquer l'affichage.
      revalidate(key, fetcher)
        .then((fresh) => onRefresh?.(fresh))
        .catch(() => { /* le cache reste servi ; erreur silencieuse */ });
    }
    return entry.value as T;
  }

  return revalidate(key, fetcher);
}

/** Force un fetch (dédupliqué) et met le cache à jour. */
export async function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = (async () => {
    try {
      const value = await fetcher();
      cache.set(key, { value, fetchedAt: Date.now() });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Invalide une clé (ex: après une leçon complétée, pour re-fetcher /sections). */
export function invalidate(key: string) {
  cache.delete(key);
}

/** Vide tout le cache — à appeler au logout. */
export function clearSwrCache() {
  cache.clear();
  inflight.clear();
}
