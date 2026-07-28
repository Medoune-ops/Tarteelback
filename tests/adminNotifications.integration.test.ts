import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { notificationService } from '../src/modules/notifications/notification.service.js';

const d = DB_TESTS ? describe : describe.skip;

const TOKEN_FREE = 'ExponentPushToken[FREEFREEFREEFREEFREE]';
const TOKEN_PREMIUM = 'ExponentPushToken[PREMIUMPREMIUMPREMIU]';
const TOKEN_DEAD = 'ExponentPushToken[DEADDEADDEADDEADDEAD]';

/** Mock the Expo Push HTTP endpoint so tests never hit the network. */
function mockExpo(perTicket: (i: number) => { status: 'ok' | 'error'; details?: { error: string } }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const data = (body as unknown[]).map((_, i) => perTicket(i));
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
}

d('adminNotifications: broadcast + history (integration)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminUserId: string;

  beforeAll(async () => {
    app = await makeApp();
    const admin = await prisma.adminUser.create({
      data: {
        email: `admin_${Date.now()}@test.app`,
        passwordHash: 'unused-in-this-test',
        displayName: 'Test Admin',
        isOwner: true,
      },
    });
    adminUserId = admin.id;
    adminToken = app.signAdminAccessToken({ sub: admin.id, isOwner: true });
  });
  afterAll(async () => {
    await prisma.adminActivityLog.deleteMany({ where: { adminUserId } });
    await prisma.adminUser.deleteMany({ where: { id: adminUserId } });
    await app.close();
  });
  beforeEach(async () => { await resetDb(); vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('rejects an unauthenticated broadcast', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/backoffice/notifications/broadcast',
      payload: { type: 'info', title: 'Salut', message: 'Un message', audience: 'all' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('validates the payload (missing title)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/backoffice/notifications/broadcast',
      headers: authHeader(adminToken),
      payload: { type: 'info', message: 'Un message', audience: 'all' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('targets only the requested audience segment and persists a real history entry', async () => {
    mockExpo(() => ({ status: 'ok' }));

    const free = await registerUser(app, { email: 'free@test.app' });
    await notificationService.registerToken(free.userId, { token: TOKEN_FREE, deviceId: 'd-free' });
    await prisma.user.update({ where: { id: free.userId }, data: { isPremium: false } });

    const premium = await registerUser(app, { email: 'premium@test.app' });
    await notificationService.registerToken(premium.userId, { token: TOKEN_PREMIUM, deviceId: 'd-premium' });
    await prisma.user.update({ where: { id: premium.userId }, data: { isPremium: true } });

    const res = await app.inject({
      method: 'POST',
      url: '/backoffice/notifications/broadcast',
      headers: authHeader(adminToken),
      payload: { type: 'feature', title: 'Nouveau', message: 'Une fonctionnalité arrive', audience: 'premium' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ targeted: 1, sent: 1, disabled: 0 });

    const history = await app.inject({
      method: 'GET',
      url: '/backoffice/notifications/history',
      headers: authHeader(adminToken),
    });
    expect(history.statusCode).toBe(200);
    expect(history.json()[0]).toMatchObject({
      title: 'Nouveau',
      message: 'Une fonctionnalité arrive',
      audience: 'premium',
      targeted: 1,
      sent: 1,
    });
  });

  it('disables tokens Expo reports as no longer registered', async () => {
    mockExpo(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } }));

    const u = await registerUser(app, { email: 'deadtoken@test.app' });
    await notificationService.registerToken(u.userId, { token: TOKEN_DEAD, deviceId: 'd-dead' });

    const res = await app.inject({
      method: 'POST',
      url: '/backoffice/notifications/broadcast',
      headers: authHeader(adminToken),
      payload: { type: 'info', title: 'Test', message: 'Ping', audience: 'all' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ targeted: 1, sent: 0, disabled: 1 });

    const token = await prisma.deviceToken.findUnique({ where: { token: TOKEN_DEAD } });
    expect(token?.disabledAt).not.toBeNull();
  });
});
