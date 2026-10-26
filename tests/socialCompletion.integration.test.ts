/**
 * Fonctions entre amis : ce qui manquait au plan (PLAN_SOCIAL.md).
 *  - défis : accepter / refuser / quitter / annuler, démarrage, photo de départ,
 *    progression par la vraie fin de leçon, fin à l'échéance, gemmes créditées ;
 *  - file d'événements : plusieurs traitements par type, bail ;
 *  - réussites : sourate, section, palier de streak, défi gagné, promotion de
 *    ligue, renvoyées par la fin de leçon ; fil et réactions ;
 *  - interrupteur du back-office, coupure par la modération, file de modération ;
 *  - fichiers .well-known.
 *
 *   docker compose up -d
 *   DATABASE_URL=postgresql://tarteel:tarteel@localhost:5432/<base locale> npx prisma migrate deploy
 *   RUN_DB_TESTS=1 FRIENDS_ENABLED=true npx vitest run tests/socialCompletion.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { env } from '../src/config/env.js';
import { claimBatch, drainOutbox, enqueue, registerOutboxHandler } from '../src/core/outbox.js';
import { invalidateFriendsConfig } from '../src/core/friendsConfig.js';
import { activateChallenges, finalizeChallenges } from '../src/jobs/maintenance.js';
import { notificationService } from '../src/modules/notifications/notification.service.js';

const d = DB_TESTS ? describe : describe.skip;

type User = Awaited<ReturnType<typeof registerUser>>;

async function befriend(aId: string, bId: string, hoursAgo = 48) {
  const at = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  await prisma.friendship.create({
    data: {
      userLowId: aId < bId ? aId : bId,
      userHighId: aId < bId ? bId : aId,
      requestedById: aId,
      status: 'accepted',
      source: 'qr',
      createdAt: at,
      acceptedAt: at,
    },
  });
}

let sectionOrdre = 100;
/** Une section avec des leçons taguées sur des sourates (et les sourates). */
async function seedSourates(spec: Record<number, number>) {
  const section = await prisma.section.create({
    data: {
      ordre: sectionOrdre++,
      kicker: 'S',
      titre: { fr: 'Section', en: 'Section' },
      sousTitre: { fr: '', en: '' },
      couleur: '#000',
      degradeStart: '#000',
      degradeEnd: '#111',
      headerIcon: 'x',
    },
  });
  const lessons: Record<number, string[]> = {};
  let ordre = 1;
  for (const [numero, count] of Object.entries(spec).map(([n, c]) => [Number(n), c] as const)) {
    await prisma.sourate.upsert({
      where: { numero },
      create: { numero, nom: `S${numero}`, nomArabe: 'س', nombreVersets: 4, hizb: 60 },
      update: {},
    });
    lessons[numero] = [];
    for (let i = 0; i < count; i++) {
      const l = await prisma.lesson.create({
        data: { sectionId: section.id, ordre: ordre++, titre: { fr: 'L', en: 'L' }, sourateNumero: numero },
      });
      lessons[numero]!.push(l.id);
    }
  }
  return { section, lessons };
}

async function completeLesson(app: FastifyInstance, user: User, lessonId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/lessons/${lessonId}/complete`,
    headers: authHeader(user.accessToken),
    payload: {},
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function createChallenge(app: FastifyInstance, me: User, invitees: User[], payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/me/challenges',
    headers: authHeader(me.accessToken),
    payload: { durationDays: 7, inviteeIds: invitees.map((u) => u.userId), ...payload },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

function act(app: FastifyInstance, user: User, id: string, action: string) {
  return app.inject({ method: 'POST', url: `/me/challenges/${id}/${action}`, headers: authHeader(user.accessToken), payload: {} });
}

/** Avance le début (et éventuellement la fin) d'un défi dans le passé. */
async function startNow(id: string) {
  await prisma.challenge.update({ where: { id }, data: { startsAt: new Date(Date.now() - 60_000) } });
}

d('défis : cycle de vie complet', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb();
  });

  it('création → invitation → accepter → démarrage → progression → échéance → gagnant payé', async () => {
    const me = await registerUser(app);
    const friend = await registerUser(app);
    await befriend(me.userId, friend.userId);
    const { lessons } = await seedSourates({ 112: 2, 113: 1 });

    // L'ami maîtrisait déjà la 113 avant le défi : elle ne comptera pas pour lui.
    await prisma.lessonProgress.create({
      data: { userId: friend.userId, lessonId: lessons[113]![0]!, etat: 'completed', completedAt: new Date(Date.now() - 86400000) },
    });

    const id = await createChallenge(app, me, [friend], { type: 'sourates', goal: { sourateNumeros: [112, 113] } });
    const created = await prisma.challenge.findUnique({ where: { id } });
    expect(created!.status).toBe('pending');
    // Invitation : un événement push pour l'ami.
    expect(await prisma.domainEvent.count({ where: { type: 'challenge_invite', userId: friend.userId } })).toBe(1);

    const accepted = await act(app, friend, id, 'accept');
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe('accepted');
    // Idempotent.
    expect((await act(app, friend, id, 'accept')).statusCode).toBe(200);

    // Le début arrive : la lecture démarre le défi sans attendre le job.
    await startNow(id);
    const list = await app.inject({ method: 'GET', url: '/me/challenges', headers: authHeader(me.accessToken) });
    expect(list.statusCode).toBe(200);
    expect((await prisma.challenge.findUnique({ where: { id } }))!.status).toBe('active');
    const friendPart = await prisma.challengeParticipant.findUnique({
      where: { challengeId_userId: { challengeId: id, userId: friend.userId } },
    });
    expect(friendPart!.baselineSourates).toEqual([113]);
    expect(await prisma.domainEvent.count({ where: { type: 'challenge_started' } })).toBe(2);

    // Je maîtrise la 112 (2 leçons) par la vraie fin de leçon.
    await completeLesson(app, me, lessons[112]![0]!);
    const last112 = await completeLesson(app, me, lessons[112]![1]!);
    expect(last112.achievements.map((a: { type: string }) => a.type)).toContain('sourate_mastered');

    let mePart = await prisma.challengeParticipant.findUnique({
      where: { challengeId_userId: { challengeId: id, userId: me.userId } },
    });
    expect(mePart!.progress).toBe(1);

    // L'ami fait la 112 : 1/2 (sa 113 d'avant ne compte pas).
    await completeLesson(app, friend, lessons[112]![0]!);
    await completeLesson(app, friend, lessons[112]![1]!);

    // Je fais la 113 : objectif atteint, mais le défi continue (l'ami n'a pas fini).
    await completeLesson(app, me, lessons[113]![0]!);
    mePart = await prisma.challengeParticipant.findUnique({
      where: { challengeId_userId: { challengeId: id, userId: me.userId } },
    });
    expect(mePart!.progress).toBe(2);
    expect(mePart!.reachedAt).not.toBeNull();
    expect((await prisma.challenge.findUnique({ where: { id } }))!.status).toBe('active');

    // Détail en direct.
    const detail = await app.inject({ method: 'GET', url: `/me/challenges/${id}`, headers: authHeader(friend.accessToken) });
    const parts = detail.json().participants as Array<{ userId: string; progress: number; rank: number }>;
    expect(parts[0]!.userId).toBe(me.userId);
    expect(parts.find((p) => p.userId === friend.userId)!.progress).toBe(1);

    // Échéance : le job termine, je gagne, mon solde est crédité.
    const gemsBefore = (await prisma.user.findUnique({ where: { id: me.userId } }))!.gems;
    await prisma.challenge.update({ where: { id }, data: { endsAt: new Date(Date.now() - 1000) } });
    expect((await finalizeChallenges(new Date()))!.finalized).toBe(1);

    const done = await prisma.challenge.findUnique({ where: { id } });
    expect(done!.status).toBe('completed');
    expect(done!.winnerIds).toEqual([me.userId]);
    expect((await prisma.user.findUnique({ where: { id: me.userId } }))!.gems).toBe(gemsBefore + 50);
    expect(await prisma.gemTransaction.count({ where: { ref: id } })).toBe(1); // l'ami n'a pas atteint l'objectif
    expect(
      await prisma.achievement.count({ where: { userId: me.userId, type: 'challenge_won', refKey: id } }),
    ).toBe(1);
    const ranks = await prisma.challengeParticipant.findMany({ where: { challengeId: id }, orderBy: { rank: 'asc' } });
    expect(ranks.map((r) => [r.userId, r.rank])).toEqual([
      [me.userId, 1],
      [friend.userId, 2],
    ]);

    // Relancer le job : aucun effet, aucun second paiement.
    expect((await finalizeChallenges(new Date()))!.finalized).toBe(0);
    expect(await prisma.gemTransaction.count({ where: { ref: id } })).toBe(1);
  });

  it('début sans au moins 2 acceptés → annulé, invitations expirées', async () => {
    const me = await registerUser(app);
    const friend = await registerUser(app);
    await befriend(me.userId, friend.userId);
    const id = await createChallenge(app, me, [friend], { type: 'streak', goal: { days: 3 } });
    await startNow(id);

    expect((await activateChallenges(new Date()))!.cancelled).toBe(1);
    expect((await prisma.challenge.findUnique({ where: { id } }))!.status).toBe('cancelled');
    const p = await prisma.challengeParticipant.findUnique({
      where: { challengeId_userId: { challengeId: id, userId: friend.userId } },
    });
    expect(p!.status).toBe('expired');
    expect((await activateChallenges(new Date()))!.cancelled).toBe(0);
  });

  it('accepter après le début → CHALLENGE_CLOSED ; refuser ; 404 pour un non-participant', async () => {
    const me = await registerUser(app);
    const a = await registerUser(app);
    const b = await registerUser(app);
    const stranger = await registerUser(app);
    await befriend(me.userId, a.userId);
    await befriend(me.userId, b.userId);
    const id = await createChallenge(app, me, [a, b], { type: 'streak', goal: { days: 3 } });

    const declined = await act(app, b, id, 'decline');
    expect(declined.json().status).toBe('declined');
    expect((await act(app, stranger, id, 'accept')).statusCode).toBe(404);

    await startNow(id);
    const late = await act(app, a, id, 'accept');
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('CHALLENGE_CLOSED');
  });

  it('annuler : créateur seulement, avant le début', async () => {
    const me = await registerUser(app);
    const friend = await registerUser(app);
    await befriend(me.userId, friend.userId);
    const id = await createChallenge(app, me, [friend], { type: 'streak', goal: { days: 3 } });

    expect((await act(app, friend, id, 'cancel')).statusCode).toBe(403);
    const cancelled = await act(app, me, id, 'cancel');
    expect(cancelled.json().status).toBe('cancelled');
    expect((await prisma.challenge.findUnique({ where: { id } }))!.status).toBe('cancelled');
    expect(await prisma.domainEvent.count({ where: { type: 'challenge_cancelled', userId: friend.userId } })).toBe(1);
  });

  it('quitter un défi en cours à 2 → défi annulé, sans récompense', async () => {
    const me = await registerUser(app);
    const friend = await registerUser(app);
    await befriend(me.userId, friend.userId);
    const id = await createChallenge(app, me, [friend], { type: 'streak', goal: { days: 3 } });
    await act(app, friend, id, 'accept');
    await startNow(id);
    await activateChallenges(new Date());

    const left = await act(app, friend, id, 'leave');
    expect(left.json().status).toBe('left');
    expect((await prisma.challenge.findUnique({ where: { id } }))!.status).toBe('cancelled');
    expect(await prisma.gemTransaction.count({ where: { ref: id } })).toBe(0);
  });

  it('le début est à 00:00 dans le fuseau du créateur', async () => {
    const me = await registerUser(app);
    const friend = await registerUser(app);
    await prisma.user.update({ where: { id: me.userId }, data: { timezone: 'Pacific/Auckland' } });
    await befriend(me.userId, friend.userId);
    const id = await createChallenge(app, me, [friend], { type: 'streak', goal: { days: 3 } });
    const c = await prisma.challenge.findUnique({ where: { id } });
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Pacific/Auckland',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(c!.startsAt);
    expect(local).toBe('00:00');
    expect(c!.endsAt.getTime() - c!.startsAt.getTime()).toBeGreaterThan(6.9 * 86400000);
  });
});

d('file d’événements', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('plusieurs traitements pour un même type, et un événement pris n’est pas repris', async () => {
    const [u] = await prisma.$transaction(async (tx) => [
      await tx.user.create({ data: { email: `o${Date.now()}@t.app`, displayName: 'O', avatarInitials: 'O', passwordHash: 'x' } }),
    ]);
    const calls: string[] = [];
    registerOutboxHandler('test.multi', async () => void calls.push('a'));
    registerOutboxHandler('test.multi', async () => void calls.push('b'));
    await prisma.$transaction((tx) => enqueue(tx, { type: 'test.multi', userId: u!.id, payload: {} }));

    const first = await claimBatch(10);
    expect(first).toHaveLength(1);
    // Pendant qu'il est pris, un second passage ne le voit pas.
    expect(await claimBatch(10)).toHaveLength(0);

    await prisma.domainEvent.update({ where: { id: first[0]!.id }, data: { claimedAt: null } });
    await drainOutbox();
    expect(calls.sort()).toEqual(['a', 'b']);
    expect((await prisma.domainEvent.findUnique({ where: { id: first[0]!.id } }))!.processedAt).not.toBeNull();
  });
});

d('réussites', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb();
  });

  it('section terminée et palier de streak, renvoyés par la fin de leçon', async () => {
    const me = await registerUser(app);
    const { section, lessons } = await seedSourates({ 108: 1 });
    await prisma.user.update({ where: { id: me.userId }, data: { streak: 7, lastActivityDate: new Date() } });

    const res = await completeLesson(app, me, lessons[108]![0]!);
    const types = (res.achievements as Array<{ type: string; refKey: string }>).map((a) => `${a.type}:${a.refKey}`);
    expect(types).toContain('sourate_mastered:108');
    expect(types).toContain(`section_completed:${section.id}`);
    expect(types).toContain('streak_milestone:d7');

    // Refaire la leçon ne recrée rien.
    await completeLesson(app, me, lessons[108]![0]!);
    expect(await prisma.achievement.count({ where: { userId: me.userId } })).toBe(3);
  });

  it('promotion de ligue (événement league.promoted)', async () => {
    const me = await registerUser(app);
    const league = await prisma.league.create({ data: { nom: 'Argent', niveau: 2, ordre: 2 } });
    await prisma.$transaction((tx) =>
      enqueue(tx, { type: 'league.promoted', userId: me.userId, payload: { weekId: 'w-1', toLeagueId: league.id, semaine: 12 } }),
    );
    await drainOutbox();
    const a = await prisma.achievement.findFirst({ where: { userId: me.userId, type: 'league_promoted' } });
    expect(a!.payload).toMatchObject({ league: 'Argent', semaine: 12 });
  });

  it('fil : visibilité « private » respectée ; réagir à un inconnu → 404 ; changer de réaction', async () => {
    const me = await registerUser(app);
    const friend = await registerUser(app);
    const shy = await registerUser(app);
    const stranger = await registerUser(app);
    await befriend(me.userId, friend.userId);
    await befriend(me.userId, shy.userId);
    await prisma.user.update({ where: { id: shy.userId }, data: { friendsVisibility: 'private' } });
    const mk = (userId: string) =>
      prisma.achievement.create({ data: { userId, type: 'streak_milestone', refKey: 'd7', payload: { days: 7 } } });
    const fa = await mk(friend.userId);
    await mk(shy.userId);
    const sa = await mk(stranger.userId);

    const feed = await app.inject({ method: 'GET', url: '/me/achievements/feed', headers: authHeader(me.accessToken) });
    expect(feed.json().items.map((i: { id: string }) => i.id)).toEqual([fa.id]);

    const react = (id: string, kind: string) =>
      app.inject({ method: 'PUT', url: `/me/achievements/${id}/reaction`, headers: authHeader(me.accessToken), payload: { kind } });
    expect((await react(sa.id, 'bravo')).statusCode).toBe(404);
    expect((await react(fa.id, 'bravo')).statusCode).toBe(200);
    expect((await react(fa.id, 'dua')).statusCode).toBe(200);
    const r = await prisma.achievementReaction.findUnique({
      where: { achievementId_userId: { achievementId: fa.id, userId: me.userId } },
    });
    expect(r!.kind).toBe('dua');
  });
});

d('interrupteur du back-office, coupure et modération', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
  beforeAll(async () => {
    app = await makeApp();
    const admin = await prisma.adminUser.create({
      data: { email: `mod_${Date.now()}@test.app`, passwordHash: 'x', displayName: 'Mod', isOwner: true },
    });
    adminId = admin.id;
    adminToken = app.signAdminAccessToken({ sub: admin.id, isOwner: true });
  });
  afterAll(async () => {
    await prisma.adminActivityLog.deleteMany({ where: { adminUserId: adminId } });
    await prisma.adminUser.deleteMany({ where: { id: adminId } });
    await app.close();
  });
  beforeEach(async () => {
    await resetDb();
    await prisma.appConfig.deleteMany();
    invalidateFriendsConfig();
  });

  it('sans forçage env, c’est AppConfig.friendsEnabled qui décide (et la liste bêta)', async () => {
    const forced = env.FRIENDS_ENABLED;
    (env as { FRIENDS_ENABLED: boolean }).FRIENDS_ENABLED = false;
    try {
      const me = await registerUser(app);
      const other = await registerUser(app);
      const get = () => app.inject({ method: 'GET', url: '/me/friends', headers: authHeader(me.accessToken) });
      expect((await get()).statusCode).toBe(503);

      await prisma.appConfig.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', friendsEnabled: true }, update: { friendsEnabled: true } });
      invalidateFriendsConfig();
      expect((await get()).statusCode).toBe(200);

      await prisma.appConfig.update({ where: { id: 'singleton' }, data: { friendsBetaUserIds: [other.userId] } });
      invalidateFriendsConfig();
      expect((await get()).statusCode).toBe(503);
    } finally {
      (env as { FRIENDS_ENABLED: boolean }).FRIENDS_ENABLED = forced;
      invalidateFriendsConfig();
    }
  });

  it('PATCH /backoffice/config règle les plafonds ; les messages les appliquent', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/backoffice/config',
      headers: authHeader(adminToken),
      payload: { messagesPerDayFree: 1 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().friends.messagesPerDayFree).toBe(1);

    const me = await registerUser(app);
    const f1 = await registerUser(app);
    await befriend(me.userId, f1.userId);
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/me/messages',
        headers: authHeader(me.accessToken),
        payload: { recipientIds: [f1.userId], kind: 'encouragement', payload: { key: 'keep_going' } },
      });
    expect((await send()).statusCode).toBe(201);
    expect((await send()).statusCode).toBe(429);
  });

  it('signalement → couper les amis : 503 FRIENDS_DISABLED, journalisé', async () => {
    const me = await registerUser(app);
    const troll = await registerUser(app);
    await befriend(me.userId, troll.userId);
    const report = await app.inject({
      method: 'POST',
      url: '/me/reports',
      headers: authHeader(me.accessToken),
      payload: { targetUserId: troll.userId, targetKind: 'user', targetRef: troll.userId, reason: 'harassment' },
    });
    expect(report.statusCode).toBeLessThan(300);

    const queue = await app.inject({ method: 'GET', url: '/backoffice/moderation/reports?status=open', headers: authHeader(adminToken) });
    expect(queue.statusCode).toBe(200);
    const item = queue.json().items[0];
    expect(item.targetUser.id).toBe(troll.userId);

    const resolved = await app.inject({
      method: 'POST',
      url: `/backoffice/moderation/reports/${item.id}/resolve`,
      headers: authHeader(adminToken),
      payload: { action: 'disable_friends' },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().status).toBe('actioned');

    const blocked = await app.inject({ method: 'GET', url: '/me/friends', headers: authHeader(troll.accessToken) });
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json().error.code).toBe('FRIENDS_DISABLED');
    expect(await prisma.adminActivityLog.count({ where: { adminUserId: adminId, action: 'moderation.disable_friends' } })).toBe(1);

    const summary = await app.inject({ method: 'GET', url: '/backoffice/moderation/summary', headers: authHeader(adminToken) });
    expect(summary.json().open).toBe(0);
  });
});

d('.well-known', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('404 tant que non configuré, puis les bons fichiers', async () => {
    const e = env as { APPLE_TEAM_ID: string; ANDROID_SHA256_FINGERPRINTS: string[] };
    const saved = { team: e.APPLE_TEAM_ID, fp: e.ANDROID_SHA256_FINGERPRINTS };
    try {
      e.APPLE_TEAM_ID = '';
      e.ANDROID_SHA256_FINGERPRINTS = [];
      expect((await app.inject({ method: 'GET', url: '/.well-known/apple-app-site-association' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/.well-known/assetlinks.json' })).statusCode).toBe(404);

      e.APPLE_TEAM_ID = 'ABCDE12345';
      e.ANDROID_SHA256_FINGERPRINTS = ['AA:BB'];
      const ios = await app.inject({ method: 'GET', url: '/.well-known/apple-app-site-association' });
      expect(ios.json().applinks.details[0].appIDs).toEqual([`ABCDE12345.${env.IOS_BUNDLE_ID}`]);
      const android = await app.inject({ method: 'GET', url: '/.well-known/assetlinks.json' });
      expect(android.json()[0].target).toMatchObject({ package_name: env.ANDROID_PACKAGE, sha256_cert_fingerprints: ['AA:BB'] });
    } finally {
      e.APPLE_TEAM_ID = saved.team;
      e.ANDROID_SHA256_FINGERPRINTS = saved.fp;
    }
  });
});

// Les push partent vers Expo : on les neutralise pour ces tests.
vi.spyOn(notificationService, 'sendToUser').mockResolvedValue({ sent: 0, disabled: 0 } as never);
