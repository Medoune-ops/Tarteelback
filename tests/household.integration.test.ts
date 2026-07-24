import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { mockDexpayOk, sendDexpayWebhook } from './helpers/dexpay.js';
import { prisma } from '../src/config/prisma.js';

const d = DB_TESTS ? describe : describe.skip;

d('household: family premium plan (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); vi.restoreAllMocks(); mockDexpayOk(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('full flow: owner subscribes (family plan) -> invites -> member accepts -> both premium', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'member@test.app' });

    // 1. Owner subscribes to the family plan -> creates a pending Transaction + DexPay session.
    const sub = await app.inject({
      method: 'POST', url: '/billing/subscribe',
      headers: authHeader(owner.accessToken), payload: { plan: 'famille_mensuel' },
    });
    expect(sub.statusCode).toBe(200);
    const { reference } = sub.json();

    // Not premium yet — payment hasn't been confirmed.
    const beforeWebhook = await app.inject({ method: 'GET', url: '/me', headers: authHeader(owner.accessToken) });
    expect(beforeWebhook.json().isPremium).toBe(false);

    // 2. Webhook confirms payment -> household created + owner premium.
    const webhook = await sendDexpayWebhook(app, 'checkout.completed', reference);
    expect(webhook.statusCode).toBe(200);

    const ownerAfter = await app.inject({ method: 'GET', url: '/me', headers: authHeader(owner.accessToken) });
    expect(ownerAfter.json().isPremium).toBe(true);

    const household = await prisma.household.findUnique({ where: { ownerId: owner.userId } });
    expect(household).toBeTruthy();
    expect(household?.subscriptionActive).toBe(true);
    expect(household?.subscriptionUntil).toBeTruthy();

    // 3. Owner invites the member.
    const invite = await app.inject({
      method: 'POST', url: '/me/household/invitations',
      headers: authHeader(owner.accessToken), payload: { email: 'member@test.app' },
    });
    expect(invite.statusCode).toBe(200);

    const invitation = await prisma.householdInvitation.findFirst({
      where: { householdId: household!.id, email: 'member@test.app' },
    });
    expect(invitation).toBeTruthy();

    // Member not premium before accepting.
    const memberBefore = await app.inject({ method: 'GET', url: '/me', headers: authHeader(member.accessToken) });
    expect(memberBefore.json().isPremium).toBe(false);

    // 4. Member accepts -> inherits family premium immediately.
    const accept = await app.inject({
      method: 'POST', url: `/me/household/invitations/${invitation!.token}/accept`,
      headers: authHeader(member.accessToken),
    });
    expect(accept.statusCode).toBe(200);

    const memberAfter = await app.inject({ method: 'GET', url: '/me', headers: authHeader(member.accessToken) });
    expect(memberAfter.json().isPremium).toBe(true);
    expect(memberAfter.json().premiumUntil).toBeTruthy();

    // 5. Household view shows both members.
    const mine = await app.inject({ method: 'GET', url: '/me/household', headers: authHeader(owner.accessToken) });
    const body = mine.json();
    expect(body.household.members).toHaveLength(2);
    expect(body.household.subscriptionActive).toBe(true);
  });

  it('removing a member from the household revokes their family premium', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'member2@test.app' });

    const sub = await app.inject({
      method: 'POST', url: '/billing/subscribe',
      headers: authHeader(owner.accessToken), payload: { plan: 'famille_annuel' },
    });
    const { reference } = sub.json();
    await sendDexpayWebhook(app, 'checkout.completed', reference);

    await app.inject({
      method: 'POST', url: '/me/household/invitations',
      headers: authHeader(owner.accessToken), payload: { email: 'member2@test.app' },
    });
    const household = await prisma.household.findUnique({ where: { ownerId: owner.userId } });
    const invitation = await prisma.householdInvitation.findFirst({
      where: { householdId: household!.id, email: 'member2@test.app' },
    });
    await app.inject({
      method: 'POST', url: `/me/household/invitations/${invitation!.token}/accept`,
      headers: authHeader(member.accessToken),
    });

    const memberPremium = await app.inject({ method: 'GET', url: '/me', headers: authHeader(member.accessToken) });
    expect(memberPremium.json().isPremium).toBe(true);

    // Owner removes the member.
    const remove = await app.inject({
      method: 'DELETE', url: `/me/household/members/${member.userId}`,
      headers: authHeader(owner.accessToken),
    });
    expect(remove.statusCode).toBe(200);

    const memberAfterRemove = await app.inject({ method: 'GET', url: '/me', headers: authHeader(member.accessToken) });
    expect(memberAfterRemove.json().isPremium).toBe(false);

    // Owner keeps their own premium (personal to the household subscription).
    const ownerStill = await app.inject({ method: 'GET', url: '/me', headers: authHeader(owner.accessToken) });
    expect(ownerStill.json().isPremium).toBe(true);
  });

  it('rejects a non-owner trying to invite or remove members', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'member3@test.app' });

    const sub = await app.inject({
      method: 'POST', url: '/billing/subscribe',
      headers: authHeader(owner.accessToken), payload: { plan: 'famille_mensuel' },
    });
    const { reference } = sub.json();
    await sendDexpayWebhook(app, 'checkout.completed', reference);

    await app.inject({
      method: 'POST', url: '/me/household/invitations',
      headers: authHeader(owner.accessToken), payload: { email: 'member3@test.app' },
    });
    const household = await prisma.household.findUnique({ where: { ownerId: owner.userId } });
    const invitation = await prisma.householdInvitation.findFirst({
      where: { householdId: household!.id, email: 'member3@test.app' },
    });
    await app.inject({
      method: 'POST', url: `/me/household/invitations/${invitation!.token}/accept`,
      headers: authHeader(member.accessToken),
    });

    // Non-owner member cannot invite.
    const forbiddenInvite = await app.inject({
      method: 'POST', url: '/me/household/invitations',
      headers: authHeader(member.accessToken), payload: { email: 'someone@test.app' },
    });
    expect(forbiddenInvite.statusCode).toBe(403);

    // Non-owner member cannot remove another member (or the owner).
    const forbiddenRemove = await app.inject({
      method: 'DELETE', url: `/me/household/members/${owner.userId}`,
      headers: authHeader(member.accessToken),
    });
    expect(forbiddenRemove.statusCode).toBe(403);
  });
});
