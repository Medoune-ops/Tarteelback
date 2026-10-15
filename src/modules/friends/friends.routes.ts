import type { FastifyInstance } from 'fastify';
import { requireFriendsEnabled } from '../../core/friends.js';

/**
 * Amis (ticket 0.B4) �?" routes prot?g?es. Mont?es sous /me/friends.
 * Quand FRIENDS_ENABLED est coup?, la garde r?pond 503 FRIENDS_DISABLED.
 */
export async function friendsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  const sec = { tags: ['friends'] as const, security: [{ bearerAuth: [] }] };

  app.get(
    '/',
    { schema: { ...sec, summary: 'Sant? de la fonctionnalit? amis (garde)' } },
    async (req, reply) => {
      requireFriendsEnabled(req.auth!.sub);
      return reply.send({ ok: true, friendsEnabled: true });
    },
  );
}
