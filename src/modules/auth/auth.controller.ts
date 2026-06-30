import type { FastifyReply, FastifyRequest } from 'fastify';
import { parse } from '../../core/validate.js';
import { serializeUser } from '../me/user.serializer.js';
import type { AccessClaims } from '../../plugins/auth.js';
import { authService, type AuthResult } from './auth.service.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  oauthSchema,
  logoutSchema,
  changePasswordSchema,
  resetRequestSchema,
  resetConfirmSchema,
} from './auth.schemas.js';

/** Build the JSON returned by register/login/refresh. */
function authResponse(result: AuthResult) {
  return {
    user: serializeUser(result.user),
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    refreshExpiresAt: result.tokens.refreshExpiresAt.toISOString(),
  };
}

export const authController = {
  async register(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(registerSchema, req.body);
    const sign = (c: AccessClaims) => req.server.jwt.sign(c);
    const result = await authService.register(input, sign);
    return reply.status(201).send(authResponse(result));
  },

  async login(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(loginSchema, req.body);
    const sign = (c: AccessClaims) => req.server.jwt.sign(c);
    const result = await authService.login(input, sign);
    return reply.send(authResponse(result));
  },

  async refresh(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(refreshSchema, req.body);
    const sign = (c: AccessClaims) => req.server.jwt.sign(c);
    const result = await authService.refresh(input, sign);
    return reply.send(authResponse(result));
  },

  /** POST /auth/oauth — social sign-in (Google). Same response as login. */
  async oauth(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(oauthSchema, req.body);
    const sign = (c: AccessClaims) => req.server.jwt.sign(c);
    const result = await authService.oauthLogin(input, sign);
    return reply.send(authResponse(result));
  },

  async logout(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(logoutSchema, req.body ?? {});
    // userId is known only when the access token is still valid; logout works
    // either way (token-based revoke needs no auth).
    const userId = req.auth?.sub ?? null;
    await authService.logout(userId, input);
    return reply.status(204).send();
  },

  async sessions(req: FastifyRequest, reply: FastifyReply) {
    const sessions = await authService.listSessions(req.auth!.sub);
    return reply.send({ sessions });
  },

  async changePassword(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(changePasswordSchema, req.body);
    await authService.changePassword(req.auth!.sub, input);
    return reply.send({ ok: true });
  },

  async requestPasswordReset(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(resetRequestSchema, req.body);
    await authService.requestPasswordReset(input);
    // Always 200 {ok:true} regardless of whether the email exists.
    return reply.send({ ok: true });
  },

  async confirmPasswordReset(req: FastifyRequest, reply: FastifyReply) {
    const input = parse(resetConfirmSchema, req.body);
    await authService.confirmPasswordReset(input);
    return reply.send({ ok: true });
  },
};
