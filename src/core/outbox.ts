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

const handlers = new Map<string, OutboxHandler>();

export function registerOutboxHandler(type: string, handler: OutboxHandler): void {
  handlers.set(type, handler);
}

/** Écrit un DomainEvent dans la transaction donnée (jamais d'appel hors tx). */
export async function enqueue(tx: Tx, event: OutboxEventInput): Promise<unknown> {
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
    data: { processedAt: new Date(), lastError: null },
  });
}

/** Journalise un échec (sans incrémenter : le claim l'a déjà fait). */
export async function markFailed(id: string, error: unknown): Promise<void> {
  await prisma.domainEvent.update({
    where: { id },
    data: { lastError: String(error instanceof Error ? error.message : error) },
  });
}

/** Prend en charge un lot d'événements : verrouillage ligne par ligne. */
export async function claimBatch(limit = 20): Promise<OutboxEvent[]> {
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 200);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<OutboxEvent[]>`
      SELECT "id", "type", "userId", "payload", "createdAt", "processedAt", "attempts", "lastError"
      FROM "DomainEvent"
      WHERE "processedAt" IS NULL AND "attempts" < 5
      ORDER BY "createdAt" ASC
      LIMIT ${safeLimit}
      FOR UPDATE SKIP LOCKED
    `;
    for (const row of rows) {
      await tx.$executeRaw`
        UPDATE "DomainEvent"
        SET "attempts" = "attempts" + 1
        WHERE "id" = ${row.id}
      `;
    }
    return rows;
  });
}

export async function processEvent(event: OutboxEvent): Promise<void> {
  const handler = handlers.get(event.type);
  if (handler) await handler(event);
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
      try {
        await processEvent(event);
        await markDone(event.id);
        processed += 1;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[outbox] event failed', event.id, event.type, error);
        try {
          await markFailed(event.id, error);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[outbox] markFailed failed', event.id, e);
        }
        failed += 1;
      }
    }
  }
  return { processed, failed };
}

/** Déclenchement non bloquant juste après une transaction. */
export function scheduleOutboxDrain(): void {
  void drainOutbox().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[outbox] background drain failed', error);
  });
}

/** Job periodic (maintenance). */
export async function processOutbox(): Promise<{ processed: number; failed: number }> {
  return drainOutbox();
}
