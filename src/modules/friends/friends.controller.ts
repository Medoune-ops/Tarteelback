import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { friendsService } from './friends.service.js';
import { friendsActivityService } from './friends.activity.js';
import { friendsChallengesService } from './friends.challenges.js';
import { friendsMessagesService } from './friends.messages.js';
import {
  addFriendSchema,
  blockUserSchema,
  reportUserSchema,
  sendMessageSchema,
  createChallengeSchema,
} from './friends.schemas.js';

export const friendsController = {
  // ── Code de partage ─────────────────────────────────────────────────────
  async getCode(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await friendsService.getMyCode(req.auth!.sub));
  },

  async regenerateCode(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await friendsService.regenerateMyCode(req.auth!.sub));
  },

  // ── Liste, ajout, progrès ───────────────────────────────────────────────
  async list(req: FastifyRequest, reply: FastifyReply) {
    return reply.send({ friends: await friendsService.listFriends(req.auth!.sub) });
  },

  async add(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(addFriendSchema, req.body ?? {});
    return reply.send(await friendsService.addByCode(req.auth!.sub, body.code));
  },

  async progress(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.params as { userId: string };
    return reply.send(await friendsService.getFriendProgress(req.auth!.sub, userId));
  },

  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string };
    return reply.send(await friendsService.removeFriend(req.auth!.sub, id));
  },

  // ── Blocage / signalement ───────────────────────────────────────────────
  async block(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(blockUserSchema, { userId: (req.params as { userId: string }).userId });
    return reply.send(await friendsService.blockUser(req.auth!.sub, body.userId));
  },

  async unblock(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.params as { userId: string };
    return reply.send(await friendsService.unblockUser(req.auth!.sub, userId));
  },

  async report(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(reportUserSchema, req.body ?? {});
    return reply.send(await friendsService.reportUser(req.auth!.sub, body.userId, body.reason));
  },

  // ── Classement & fil d'activité (phase 2) ───────────────────────────────
  async leaderboard(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await friendsService.getLeaderboard(req.auth!.sub));
  },

  async activity(req: FastifyRequest, reply: FastifyReply) {
    const limitRaw = (req.query as { limit?: string } | undefined)?.limit;
    const limit = Math.min(50, Math.max(1, Number(limitRaw) || 30));
    return reply.send({ activity: await friendsActivityService.listActivity(req.auth!.sub, limit) });
  },

  async cheer(req: FastifyRequest, reply: FastifyReply) {
    const { activityId } = req.params as { activityId: string };
    return reply.send(await friendsActivityService.toggleCheer(req.auth!.sub, activityId));
  },

  // ── Défis (phase 3) ─────────────────────────────────────────────────────
  async listChallenges(req: FastifyRequest, reply: FastifyReply) {
    return reply.send({ challenges: await friendsChallengesService.list(req.auth!.sub) });
  },

  async createChallenge(req: FastifyRequest, reply: FastifyReply) {
    const body = parse(createChallengeSchema, req.body ?? {});
    return reply.send(await friendsChallengesService.create(req.auth!.sub, body));
  },

  async getChallenge(req: FastifyRequest, reply: FastifyReply) {
    const { challengeId } = req.params as { challengeId: string };
    return reply.send(await friendsChallengesService.get(req.auth!.sub, challengeId));
  },

  async leaveChallenge(req: FastifyRequest, reply: FastifyReply) {
    const { challengeId } = req.params as { challengeId: string };
    return reply.send(await friendsChallengesService.leave(req.auth!.sub, challengeId));
  },

  // ── Envois & boîte de réception (phase 4) ───────────────────────────────
  async inbox(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await friendsMessagesService.inbox(req.auth!.sub));
  },

  async sendQuota(req: FastifyRequest, reply: FastifyReply) {
    return reply.send(await friendsMessagesService.quota(req.auth!.sub));
  },

  async send(req: FastifyRequest, reply: FastifyReply) {
    const { userId } = req.params as { userId: string };
    const body = parse(sendMessageSchema, req.body ?? {});
    const payload: { [k: string]: string | number } = {};
    if (body.collectionId != null) payload.collectionId = body.collectionId;
    if (body.n != null) payload.n = body.n;
    if (body.numero != null) payload.numero = body.numero;
    if (body.text != null) payload.text = body.text;
    if (body.challengeId != null) payload.challengeId = body.challengeId;
    return reply.send(await friendsMessagesService.send(req.auth!.sub, userId, body.type, payload));
  },

  async markMessageRead(req: FastifyRequest, reply: FastifyReply) {
    const { messageId } = req.params as { messageId: string };
    return reply.send(await friendsMessagesService.markRead(req.auth!.sub, messageId));
  },
};
