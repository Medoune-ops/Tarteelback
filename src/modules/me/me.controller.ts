import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { snapshot } from '../../core/hearts.js';
import { isPremiumActive } from '../../core/premium.js';
import { meService, syncUserState } from './me.service.js';
import { userRepository } from './user.repository.js';
import { updateMeSchema, updateSettingsSchema } from './me.schemas.js';

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
};
