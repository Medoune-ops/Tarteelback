import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { userRepository } from '../me/user.repository.js';
import { notificationService } from './notification.service.js';
import { registerTokenSchema, removeTokenSchema, prefsSchema } from './notification.schemas.js';

export const notificationController = {
  async registerToken(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(registerTokenSchema, req.body);
    const result = await notificationService.registerToken(req.auth!.sub, input);
    return reply.status(201).send(result);
  },

  async removeToken(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(removeTokenSchema, req.body);
    const result = await notificationService.removeToken(req.auth!.sub, input.token);
    return reply.send(result);
  },

  async getPrefs(req: FastifyRequest, reply: FastifyReply) {
    const u = await userRepository.getOrThrow(req.auth!.sub);
    return reply.send({
      notifDailyReminder: u.notifDailyReminder,
      notifStreakAlert: u.notifStreakAlert,
      reminderHour: u.reminderHour,
    });
  },

  async updatePrefs(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(prefsSchema, req.body);
    const u = await userRepository.update(req.auth!.sub, input);
    return reply.send({
      notifDailyReminder: u.notifDailyReminder,
      notifStreakAlert: u.notifStreakAlert,
      reminderHour: u.reminderHour,
    });
  },
};
