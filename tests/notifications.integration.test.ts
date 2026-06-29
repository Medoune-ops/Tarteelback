import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { notificationService } from '../src/modules/notifications/notification.service.js';
import { sendDueDailyReminders, sendDueStreakAlerts } from '../src/modules/notifications/reminders.js';

const d = DB_TESTS ? describe : describe.skip;

const TOKEN_A = 'ExponentPushToken[AAAAAAAAAAAAAAAAAAAAAA]';
const TOKEN_B = 'ExponentPushToken[BBBBBBBBBBBBBBBBBBBBBB]';

/** Mock the Expo Push HTTP endpoint so tests never hit the network. */
function mockExpoOk() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const data = (body as unknown[]).map(() => ({ status: 'ok', id: 'ticket' }));
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
}

d('notifications: tokens & preferences (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); vi.restoreAllMocks(); });
  // Restore the global fetch mock after EACH test so it never leaks to other
  // test files (they all share one fork in DB mode).
  afterEach(() => { vi.restoreAllMocks(); });

  it('registers a token, rejects a malformed one', async () => {
    const u = await registerUser(app);
    const ok = await app.inject({
      method: 'POST', url: '/me/notifications/tokens',
      headers: authHeader(u.accessToken), payload: { token: TOKEN_A, deviceId: 'dev1', platform: 'ios' },
    });
    expect(ok.statusCode).toBe(201);

    const bad = await app.inject({
      method: 'POST', url: '/me/notifications/tokens',
      headers: authHeader(u.accessToken), payload: { token: 'not-a-token', deviceId: 'dev1' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('a token belongs to its registering user only', async () => {
    const a = await registerUser(app, { email: 'na@test.app' });
    const b = await registerUser(app, { email: 'nb@test.app' });
    await app.inject({ method: 'POST', url: '/me/notifications/tokens', headers: authHeader(a.accessToken), payload: { token: TOKEN_A, deviceId: 'd' } });

    const aTokens = await prisma.deviceToken.findMany({ where: { userId: a.userId } });
    const bTokens = await prisma.deviceToken.findMany({ where: { userId: b.userId } });
    expect(aTokens).toHaveLength(1);
    expect(bTokens).toHaveLength(0);
  });

  it('updates and reads preferences', async () => {
    const u = await registerUser(app);
    const upd = await app.inject({
      method: 'PATCH', url: '/me/notifications/preferences',
      headers: authHeader(u.accessToken), payload: { notifDailyReminder: false, reminderHour: 8 },
    });
    expect(upd.json()).toMatchObject({ notifDailyReminder: false, reminderHour: 8 });
    const get = await app.inject({ method: 'GET', url: '/me/notifications/preferences', headers: authHeader(u.accessToken) });
    expect(get.json().notifDailyReminder).toBe(false);
  });

  it('sendToUser disables tokens Expo reports as unregistered', async () => {
    const u = await registerUser(app);
    await notificationService.registerToken(u.userId, { token: TOKEN_A, deviceId: 'd' });
    await notificationService.registerToken(u.userId, { token: TOKEN_B, deviceId: 'd2' });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ data: [
        { status: 'ok', id: 't1' },
        { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } },
      ] }), { status: 200 }),
    );

    const res = await notificationService.sendToUser(u.userId, { title: 'Hi', body: 'There' });
    expect(res.sent).toBe(1);
    expect(res.disabled).toBe(1);
    const active = await prisma.deviceToken.findMany({ where: { userId: u.userId, disabledAt: null } });
    expect(active).toHaveLength(1);
  });
});

d('notifications: reminders (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); vi.restoreAllMocks(); });
  // Restore the global fetch mock after EACH test so it never leaks to other
  // test files (they all share one fork in DB mode).
  afterEach(() => { vi.restoreAllMocks(); });

  it('sends a daily reminder only to opted-in users who have a token and have not practised today', async () => {
    const spy = mockExpoOk();
    const u = await registerUser(app);
    await notificationService.registerToken(u.userId, { token: TOKEN_A, deviceId: 'd' });
    // 19:00 UTC, reminderHour default 19, no activity, opted in.
    await prisma.user.update({ where: { id: u.userId }, data: { timezone: 'UTC', reminderHour: 19, lastActivityDate: null } });

    const at19 = new Date('2026-06-28T19:30:00Z');
    const r = await sendDueDailyReminders(at19);
    expect(r.sent).toBe(1);
    expect(spy).toHaveBeenCalled();

    // Running again the same local day does NOT re-send (idempotent).
    const again = await sendDueDailyReminders(at19);
    expect(again.sent).toBe(0);
  });

  it('does not remind before the preferred hour', async () => {
    mockExpoOk();
    const u = await registerUser(app);
    await notificationService.registerToken(u.userId, { token: TOKEN_A, deviceId: 'd' });
    await prisma.user.update({ where: { id: u.userId }, data: { timezone: 'UTC', reminderHour: 19 } });

    const at10 = new Date('2026-06-28T10:00:00Z');
    const r = await sendDueDailyReminders(at10);
    expect(r.sent).toBe(0);
  });

  it('sends a streak alert when the streak is frozen, once per day', async () => {
    mockExpoOk();
    const u = await registerUser(app);
    await notificationService.registerToken(u.userId, { token: TOKEN_A, deviceId: 'd' });
    await prisma.user.update({ where: { id: u.userId }, data: { streak: 7, streakFrozen: true } });

    const now = new Date('2026-06-28T12:00:00Z');
    const r = await sendDueStreakAlerts(now);
    expect(r.sent).toBe(1);
    const again = await sendDueStreakAlerts(now);
    expect(again.sent).toBe(0);
  });
});
