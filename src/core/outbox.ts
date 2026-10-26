import { prisma } from '../config/prisma.js';
import { Prisma } from '@prisma/client';

export type OutboxEventInput = {
  type: string;
  userId: string;
  payload: unknown;
};

export type OutboxEvent = {
  id: string;
  type: string;
  userId: string;
  payload: unknown;
  createdAt: Date;
  processedAt: Date | null;
  attempts: number;
  lastError: string | null;
};

type Tx = Prisma.TransactionClient;

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

// Plusieurs traitements par type : `lesson.completed` alimente à la fois les
// réussites et les défis. Un Map type → handler unique faisait écraser l'un
// par l'autre (le dernier module importé gagnait).
const handlers = new Map<string, OutboxHandler[]>();

export function registerOutboxHandler(type: string, handler: OutboxHandler): void {
  const list = handlers.get(type) ?? [];
  if (!list.includes(handler)) list.push(handler);
  handlers.set(type, list);
}

/** Durée du bail : un événement pris mais jamais terminé (processus planté)
 *  redevient disponible après ce délai. */
export const CLAIM_LEASE_MS = 5 * 60 * 1000;

/** Écrit un DomainEvent dans la transaction donnée (jamais d'appel hors tx). */
export async function enqueue(tx: Tx, event: OutboxEventInput): Promise<{ id: string }> {
  return tx.domainEvent.create({
    data: {
      type: event.type,
      userId: event.userId,
      payload: event.payload as never,
    },
  });
}

/** Marque un événement comme traité (idempotent : rejouer ne fait rien de plus). */
export async function markDone(id: string): Promise<void> {
  await prisma.domainEvent.update({
    where: { id },
    data: { processedAt: new Date(), lastError: null, claimedAt: null },
  });
}

/** Journalise un échec (sans incrémenter : le claim l'a déjà fait) et libère
 *  le bail pour qu'un prochain passage puisse retenter. */
export async function markFailed(id: string, error: unknown): Promise<void> {
  await prisma.domainEvent.update({
    where: { id },
    data: { lastError: String(error instanceof Error ? error.message : error), claimedAt: null },
  });
}

/**
 * Prend en charge un lot d'événements. Le verrou `FOR UPDATE SKIP LOCKED` ne
 * dure que le temps de la transaction de prise : c'est le bail `claimedAt`,
 * posé dans cette même transaction, qui empêche un autre traitement de
 * reprendre l'événement pendant qu'il est traité.
 */
export async function claimBatch(limit = 20, onlyId?: string): Promise<OutboxEvent[]> {
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 200);
  const leaseCutoff = new Date(Date.now() - CLAIM_LEASE_MS);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const rows = onlyId
      ? await tx.$queryRaw<OutboxEvent[]>`
          SELECT "id", "type", "userId", "payload", "createdAt", "processedAt", "attempts", "lastError"
          FROM "DomainEvent"
          WHERE "id" = ${onlyId} AND "processedAt" IS NULL AND "attempts" < 5
            AND ("claimedAt" IS NULL OR "claimedAt" < ${leaseCutoff})
          FOR UPDATE SKIP LOCKED
        `
      : await tx.$queryRaw<OutboxEvent[]>`
          SELECT "id", "type", "userId", "payload", "createdAt", "processedAt", "attempts", "lastError"
          FROM "DomainEvent"
          WHERE "processedAt" IS NULL AND "attempts" < 5
            AND ("claimedAt" IS NULL OR "claimedAt" < ${leaseCutoff})
          ORDER BY "createdAt" ASC
          LIMIT ${safeLimit}
          FOR UPDATE SKIP LOCKED
        `;
    for (const row of rows) {
      await tx.$executeRaw`
        UPDATE "DomainEvent"
        SET "attempts" = "attempts" + 1, "claimedAt" = ${now}
        WHERE "id" = ${row.id}
      `;
    }
    return rows;
  });
}

/** Exécute tous les traitements de l'événement. Ils sont idempotents : en cas
 *  d'échec de l'un, l'événement est retenté en entier. */
export async function processEvent(event: OutboxEvent): Promise<void> {
  for (const handler of handlers.get(event.type) ?? []) {
    await handler(event);
  }
}

async function runClaimed(event: OutboxEvent): Promise<boolean> {
  try {
    await processEvent(event);
    await markDone(event.id);
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[outbox] event failed', event.id, event.type, error);
    try {
      await markFailed(event.id, error);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[outbox] markFailed failed', event.id, e);
    }
    return false;
  }
}

/** Traite UN événement précis tout de suite (ex. : juste après une fin de
 *  leçon, pour renvoyer les réussites dans la réponse). Sans effet s'il est
 *  déjà pris ou traité. Ne lève jamais. */
export async function processEventNow(id: string): Promise<boolean> {
  try {
    const [event] = await claimBatch(1, id);
    if (!event) return false;
    return await runClaimed(event);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[outbox] processEventNow failed', id, error);
    return false;
  }
}

/** Traite tout ce qui est en attente, en idempotence. */
export async function drainOutbox(): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  // protection contre les boucles infinies si de nouveaux événements arrivent.
  let rounds = 0;
  while (rounds < 100) {
    rounds += 1;
    const batch = await claimBatch(20);
    if (batch.length === 0) break;
    for (const event of batch) {
      if (await runClaimed(event)) processed += 1;
      else failed += 1;
    }
  }
  return { processed, failed };
}

/** Déclenchement non bloquant juste après une transaction. Désactivé en test :
 *  un traitement en arrière-plan qui déborde sur le test suivant (base vidée
 *  entre-temps) mélangerait les données ; les tests appellent drainOutbox(). */
export function scheduleOutboxDrain(): void {
  if (process.env.NODE_ENV === 'test') return;
  void drainOutbox().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[outbox] background drain failed', error);
  });
}

/** Job periodic (maintenance). */
export async function processOutbox(): Promise<{ processed: number; failed: number }> {
  return drainOutbox();
}
