import type { FastifyInstance } from 'fastify';
import { authRoutes } from './modules/auth/auth.routes.js';
import { meRoutes } from './modules/me/me.routes.js';
import { contentRoutes } from './modules/content/content.routes.js';
import { adminRoutes } from './modules/content/admin.routes.js';
import { lessonRoutes, lessonFlatRoutes } from './modules/lessons/lesson.routes.js';
import { leagueRoutes } from './modules/leagues/league.routes.js';
import { billingRoutes } from './modules/billing/billing.routes.js';
import { notificationRoutes } from './modules/notifications/notification.routes.js';
import { rewardRoutes } from './modules/rewards/reward.routes.js';
import { gemRoutes } from './modules/gems/gem.routes.js';
import { revisionRoutes } from './modules/revision/revision.routes.js';

/** Mounts every feature module. */
export async function registerRoutes(app: FastifyInstance) {
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meRoutes, { prefix: '/me' });
  await app.register(contentRoutes); // /sections, /sourates, /lessons (GET)
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(lessonRoutes, { prefix: '/lessons' });
  await app.register(lessonFlatRoutes, { prefix: '/lesson' });
  await app.register(leagueRoutes, { prefix: '/leagues' });
  await app.register(billingRoutes, { prefix: '/billing' });
  await app.register(notificationRoutes, { prefix: '/me/notifications' });
  // Rewards mounted under /me so the front's GET /me/podiums etc. line up.
  await app.register(rewardRoutes, { prefix: '/me' });
  // Gem economy (balance, heart refill, streak freezes, double XP, review gate).
  await app.register(gemRoutes, { prefix: '/me' });
  // SRS des sourates apprises (score, prochaine révision).
  await app.register(revisionRoutes, { prefix: '/me' });
}
