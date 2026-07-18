import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { snapshot } from '../../core/hearts.js';
import { isPremiumActive } from '../../core/premium.js';
import { meService, syncUserState } from './me.service.js';
import { userRepository } from './user.repository.js';
import { updateMeSchema, updateSettingsSchema, deleteMeSchema } from './me.schemas.js';

export const meController = {
  /** GET /me — flat shape the RN store hydrates from directly (BACKEND.md). */
  async get(req: FastifyRequest, reply: FastifyReply) {
    const flat = await meService.getFlat(req.auth!.sub);
    return reply.send(flat);
  },

  async update(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(updateMeSchema, req.body);
    await meService.update(req.auth!.sub, input);
    // Return the same flat shape so the front can re-hydrate after a PATCH.
    const flat = await meService.getFlat(req.auth!.sub);
    return reply.send(flat);
  },

  /** PATCH /me/settings — voice toggle / language; returns the flat /me shape. */
  async updateSettings(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(updateSettingsSchema, req.body);
    await meService.updateSettings(req.auth!.sub, input);
    const flat = await meService.getFlat(req.auth!.sub);
    return reply.send(flat);
  },

  /** DELETE /me — suppression définitive du compte (cascade sur toutes les données). */
  async deleteAccount(req: FastifyRequest, reply: FastifyReply) {
    // Le body est optionnel (comptes OAuth-only) mais strictement validé.
    const input = parse(deleteMeSchema, req.body ?? {});
    await meService.deleteAccount(req.auth!.sub, input.password);
    return reply.code(204).send();
  },

  /**
   * GET /me/activity?month=YYYY-MM — exact active days that month (calendar).
   * Defaults to the current UTC month when `month` is missing/invalid.
   */
  async activity(req: FastifyRequest, reply: FastifyReply) {
    const raw = (req.query as { month?: string } | undefined)?.month;
    const month = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 7);
    const days = await meService.getActivityDays(req.auth!.sub, month);
    return reply.send({ month, days });
  },

  /** GET /me/sourates — surahs the user has learned in full (read-only list). */
  async sourates(req: FastifyRequest, reply: FastifyReply) {
    const sourates = await meService.getLearnedSourates(req.auth!.sub);
    return reply.send({ sourates });
  },

  /** POST /me/hearts/sync: recompute regen, persist, return the hearts block. */
  async syncHearts(req: FastifyRequest, reply: FastifyReply) {
    const now = new Date();
    const raw = await userRepository.getOrThrow(req.auth!.sub);
    const user = await syncUserState(raw, now);
    const premium = isPremiumActive(user, now);
    const snap = snapshot(
      { hearts: user.hearts, lastHeartLossAt: user.lastHeartLossAt },
      premium,
      now,
    );
    return reply.send({
      hearts: snap.hearts,
      unlimited: snap.unlimited,
      outOfHearts: snap.outOfHearts,
      msUntilNextHeart: snap.msUntilNextHeart,
    });
  },

  /** POST /me/streak/refresh: recompute freeze/break, return streak fields. */
  async refreshStreak(req: FastifyRequest, reply: FastifyReply) {
    const raw = await userRepository.getOrThrow(req.auth!.sub);
    const user = await syncUserState(raw);
    return reply.send({
      streak: user.streak,
      streakFrozen: user.streakFrozen,
      lastStreakValue: user.lastStreakValue,
    });
  },

  /** GET /me/pending-gift — cadeau admin non vu, pollé par le client. */
  async pendingGift(req: FastifyRequest, reply: FastifyReply) {
    const result = await meService.getPendingGift(req.auth!.sub);
    return reply.send(result);
  },

  /** POST /me/pending-gift/:id/ack — marque le cadeau vu. */
  async ackPendingGift(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    await meService.ackPendingGift(req.auth!.sub, id);
    return reply.code(204).send();
  },
};
