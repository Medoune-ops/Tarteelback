import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';

/** Connect to the DB with a short retry/backoff so a brief DB unavailability at
 *  boot doesn't crash the process (it does fail eventually if truly down). */
async function connectWithRetry(attempts = 5): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await prisma.$connect();
      return;
    } catch (err) {
      if (i === attempts) throw err;
      const delay = Math.min(1000 * i, 5000);
      // eslint-disable-next-line no-console
      console.warn(`DB not ready (attempt ${i}/${attempts}), retrying in ${delay}ms…`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function main() {
  const app = await buildApp();

  // Fail fast if the DB is unreachable at boot — don't serve a "healthy" server
  // that 500s on every request.
  await connectWithRetry();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down…`);
    // Bound the drain so the orchestrator never has to SIGKILL us.
    const timer = setTimeout(() => process.exit(1), 10_000);
    try {
      await app.close();
      await prisma.$disconnect();
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
    } finally {
      clearTimeout(timer);
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Last-resort safety nets: log and exit so the orchestrator restarts a clean
  // instance instead of running in an undefined state.
  process.on('unhandledRejection', (reason) => {
    app.log.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'Uncaught exception — exiting');
    void shutdown('uncaughtException');
  });

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Tarteel API ready on :${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
