import type { FastifyInstance } from 'fastify';
import { authRoutes } from './modules/auth/auth.routes.js';
import { meRoutes } from './modules/me/me.routes.js';
import { contentRoutes } from './modules/content/content.routes.js';
import { adminRoutes } from './modules/content/admin.routes.js';
import { lessonRoutes } from './modules/lessons/lesson.routes.js';
import { leagueRoutes } from './modules/leagues/league.routes.js';
import { billingRoutes } from './modules/billing/billing.routes.js';
import { notificationRoutes } from './modules/notifications/notification.routes.js';

/** Mounts every feature module. */
export async function registerRoutes(app: FastifyInstance) {
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meRoutes, { prefix: '/me' });
  await app.register(contentRoutes); // /sections, /sourates, /lessons (GET)
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(lessonRoutes, { prefix: '/lessons' });
  await app.register(leagueRoutes, { prefix: '/leagues' });
  await app.register(billingRoutes, { prefix: '/billing' });
  await app.register(notificationRoutes, { prefix: '/me/notifications' });
}
