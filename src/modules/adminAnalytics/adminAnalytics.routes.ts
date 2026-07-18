import type { FastifyInstance } from 'fastify';
import { adminAnalyticsController } from './adminAnalytics.controller.js';

/**
 * Back-office analytics: read-only KPIs (signups, DAU/WAU, streak, retention
 * proxy) and a signups timeseries for the dashboard chart. Every route
 * requires an authenticated back-office member (app.authenticateAdmin).
 */
export async function adminAnalyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticateAdmin);

  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };

  app.get('/summary', { schema: { ...sec, summary: 'Global analytics KPIs (signups, DAU/WAU, streak, rétention)' } }, adminAnalyticsController.summary);
  app.get('/signups-timeseries', { schema: { ...sec, summary: 'Daily signup counts over the last N days' } }, adminAnalyticsController.signupsTimeseries);
  app.get('/top-streaks', { schema: { ...sec, summary: 'Top users by current streak' } }, adminAnalyticsController.topStreaks);
}
