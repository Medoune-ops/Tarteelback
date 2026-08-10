import type { FastifyInstance } from 'fastify';
import { adminAnalyticsController } from './adminAnalytics.controller.js';

/**
 * Back-office analytics: read-only KPIs (signups, DAU/WAU, streak, retention
 * proxy) and a signups timeseries for the dashboard chart. Requires 'view' on
 * the 'analytics' module (this module is read-only, so there is no 'edit' tier).
 */
export async function adminAnalyticsRoutes(app: FastifyInstance) {
  const sec = { tags: ['backoffice'] as const, security: [{ bearerAuth: [] }] };
  const view = app.requireAdminPermission('analytics', 'view');

  app.get('/summary', { preHandler: view, schema: { ...sec, summary: 'Global analytics KPIs (signups, DAU/WAU, streak, rétention)' } }, adminAnalyticsController.summary);
  app.get('/signups-timeseries', { preHandler: view, schema: { ...sec, summary: 'Daily signup counts over the last N days' } }, adminAnalyticsController.signupsTimeseries);
  app.get('/requests-timeseries', { preHandler: view, schema: { ...sec, summary: 'Daily HTTP request counts over the last N days' } }, adminAnalyticsController.requestsTimeseries);
  app.get('/requests-monthly', { preHandler: view, schema: { ...sec, summary: 'Monthly HTTP request counts over the last N months' } }, adminAnalyticsController.requestsMonthly);
  app.get('/top-streaks', { preHandler: view, schema: { ...sec, summary: 'Top users by current streak' } }, adminAnalyticsController.topStreaks);
}
