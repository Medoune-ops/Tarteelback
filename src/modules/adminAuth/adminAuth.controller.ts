import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import type { AdminAccessClaims } from '../../plugins/adminAuth.js';
import { adminAuthService, type AdminAuthResult } from './adminAuth.service.js';
import {
  adminLoginSchema,
  adminRefreshSchema,
  adminLogoutSchema,
  adminInviteSchema,
  adminSetPasswordSchema,
  adminChangePasswordSchema,
  adminUpdatePermissionsSchema,
} from './adminAuth.schemas.js';

/** Build the JSON returned by login/refresh. Never include the password hash. */
function authResponse(result: AdminAuthResult) {
  const { passwordHash: _passwordHash, ...admin } = result.admin;
  return {
    admin,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    refreshExpiresAt: result.tokens.refreshExpiresAt.toISOString(),
  };
}

const idParam = (req: FastifyRequest) => (req.params as { id: string }).id;

export const adminAuthController = {
  async login(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(adminLoginSchema, req.body);
    const sign = async (c: AdminAccessClaims) => req.server.signAdminAccessToken(c);
    const result = await adminAuthService.login(input, sign, req.ip ?? null);
    return reply.send(authResponse(result));
  },

  async refresh(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(adminRefreshSchema, req.body);
    const sign = async (c: AdminAccessClaims) => req.server.signAdminAccessToken(c);
    const result = await adminAuthService.refresh(input, sign);
    return reply.send(authResponse(result));
  },

  async logout(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(adminLogoutSchema, req.body ?? {});
    const adminUserId = req.adminAuth?.sub ?? null;
    await adminAuthService.logout(adminUserId, input);
    return reply.status(204).send();
  },

  async invite(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(adminInviteSchema, req.body);
    const admin = await adminAuthService.invite(input, req.adminAuth!.sub);
    const { passwordHash: _passwordHash, ...safe } = admin;
    return reply.status(201).send(safe);
  },

  async setPassword(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(adminSetPasswordSchema, req.body);
    await adminAuthService.setPassword(idParam(req), input.newPassword, req.adminAuth!.sub);
    return reply.send({ ok: true });
  },

  /** A member changes their own password (self-service, current password required). */
  async changePassword(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(adminChangePasswordSchema, req.body);
    await adminAuthService.changeOwnPassword(req.adminAuth!.sub, input.currentPassword, input.newPassword);
    return reply.send({ ok: true });
  },

  async updatePermissions(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(adminUpdatePermissionsSchema, req.body);
    await adminAuthService.updatePermissions(idParam(req), input, req.adminAuth!.sub);
    return reply.send({ ok: true });
  },

  async listTeam(_req: FastifyRequest, reply: FastifyReply) {
    const members = await adminAuthService.listTeam();
    return reply.send({ members });
  },

  async listActivity(req: FastifyRequest, reply: FastifyReply) {
    const query = req.query as { memberId?: string };
    const logs = await adminAuthService.listActivity(query.memberId);
    return reply.send({ logs });
  },
};
