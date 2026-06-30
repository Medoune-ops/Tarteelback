import type { FastifyInstance } from 'fastify';
import { isTest } from '../../config/env.js';
import { authController } from './auth.controller.js';

/**
 * Auth & session routes. Auth endpoints get a tighter rate limit to blunt
 * credential-stuffing / brute force (relaxed in tests so the suite isn't
 * throttled on a single IP).
 */
export async function authRoutes(app: FastifyInstance) {
  const authLimit = {
    config: { rateLimit: { max: isTest ? 100_000 : 20, timeWindow: '1 minute' } },
  };

  app.post(
    '/register',
    { ...authLimit, schema: { tags: ['auth'], summary: 'Create an account and start a session' } },
    authController.register,
  );

  app.post(
    '/login',
    { ...authLimit, schema: { tags: ['auth'], summary: 'Sign in and start a session' } },
    authController.login,
  );

  app.post(
    '/refresh',
    { ...authLimit, schema: { tags: ['auth'], summary: 'Rotate the refresh token (silent re-login)' } },
    authController.refresh,
  );

  app.post(
    '/oauth',
    { ...authLimit, schema: { tags: ['auth'], summary: 'Sign in with Google (native id_token flow)' } },
    authController.oauth,
  );

  app.post(
    '/logout',
    { schema: { tags: ['auth'], summary: 'Revoke the current session (or all)' } },
    authController.logout,
  );

  app.get(
    '/sessions',
    {
      preHandler: app.authenticate,
      schema: { tags: ['auth'], summary: 'List active sessions', security: [{ bearerAuth: [] }] },
    },
    authController.sessions,
  );

  app.post(
    '/change-password',
    {
      preHandler: app.authenticate,
      schema: { tags: ['auth'], summary: 'Change password (revokes other sessions)', security: [{ bearerAuth: [] }] },
    },
    authController.changePassword,
  );

  app.post(
    '/reset-password/request',
    { ...authLimit, schema: { tags: ['auth'], summary: 'Request a password-reset email' } },
    authController.requestPasswordReset,
  );

  app.post(
    '/reset-password/confirm',
    { ...authLimit, schema: { tags: ['auth'], summary: 'Confirm a password reset with the emailed token' } },
    authController.confirmPasswordReset,
  );
}
