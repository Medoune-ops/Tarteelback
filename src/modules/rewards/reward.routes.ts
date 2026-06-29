import type { FastifyInstance } from 'fastify';
import { rewardController } from './reward.controller.js';

/**
 * Rewards & engagement routes (server-authoritative): streak goal, podium
 * rewards, daily chest. Mirrors the front store's reward actions. All authed.
 */
export async function rewardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['rewards'] as const, security: [{ bearerAuth: [] }] };

  // Streak goal
  app.put('/streak-goal', { schema: { ...sec, summary: 'Set/replace the streak goal' } }, rewardController.setStreakGoal);
  app.post('/streak-goal/claim', { schema: { ...sec, summary: 'Claim the streak-goal reward (if reached)' } }, rewardController.claimStreakReward);

  // Podiums
  app.get('/podiums', { schema: { ...sec, summary: 'Podium history (top-3 weeks)' } }, rewardController.listPodiums);
  app.post('/podiums/:ref/claim', { schema: { ...sec, summary: 'Claim a podium reward once' } }, rewardController.claimPodium);

  // Daily chest
  app.get('/daily-chest', { schema: { ...sec, summary: 'Is the daily chest available?' } }, rewardController.dailyChestStatus);
  app.post('/daily-chest/claim', { schema: { ...sec, summary: 'Open the daily chest (1/local day)' } }, rewardController.claimDailyChest);
}
