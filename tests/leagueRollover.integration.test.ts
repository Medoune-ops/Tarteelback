import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { runWeeklyRollover } from '../src/modules/leagues/league.cron.js';
import { leagueService } from '../src/modules/leagues/league.service.js';

const d = DB_TESTS ? describe : describe.skip;

/**
 * Diagnostic ciblé : l'utilisateur rapporte que son weeklyXp (~900) et son
 * rang de ligue (23) ne bougent jamais, semaine après semaine. Ce test vérifie
 * que le rollover hebdomadaire clôture bien une semaine EXPIRÉE et remet
 * weeklyXp à 0 — le mécanisme censé produire ce reset chaque semaine.
 */
d('league weekly rollover (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('closes an EXPIRED week and resets weeklyXp for its members', async () => {
    const league = await prisma.league.create({ data: { nom: 'Bronze', niveau: 1, ordre: 1 } });
    const now = new Date();
    // Semaine déjà terminée hier — c'est exactement le cas que le cron doit traiter.
    const expiredWeek = await prisma.leagueWeek.create({
      data: {
        leagueId: league.id,
        numeroSemaine: 1,
        dateDebut: new Date(now.getTime() - 8 * 86400000),
        dateFin: new Date(now.getTime() - 1 * 86400000), // hier
      },
    });

    const u = await registerUser(app);
    await prisma.user.update({ where: { id: u.userId }, data: { weeklyXp: 900 } });
    await prisma.leagueMembership.create({
      data: { userId: u.userId, leagueWeekId: expiredWeek.id, weeklyXp: 900 },
    });

    const result = await runWeeklyRollover(now);
    expect(result.skipped).toBe(false);
    expect(result.closed).toBe(1);

    // La semaine expirée doit être marquée fermée (idempotence du rollover).
    const closed = await prisma.leagueWeek.findUnique({ where: { id: expiredWeek.id } });
    expect(closed?.closedAt).not.toBeNull();

    // Le compteur global de l'utilisateur doit repartir à 0.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(user.weeklyXp).toBe(0);

    // Une NOUVELLE semaine doit exister pour la même ligue (numeroSemaine 2),
    // avec l'adhésion de l'utilisateur remise à 0.
    const nextWeek = await prisma.leagueWeek.findFirst({
      where: { leagueId: league.id, numeroSemaine: 2 },
    });
    expect(nextWeek).not.toBeNull();
    const nextMembership = await prisma.leagueMembership.findUnique({
      where: { userId_leagueWeekId: { userId: u.userId, leagueWeekId: nextWeek!.id } },
    });
    expect(nextMembership?.weeklyXp).toBe(0);
  });

  it('is idempotent: re-running after closure does nothing to an already-closed week', async () => {
    const league = await prisma.league.create({ data: { nom: 'Bronze', niveau: 1, ordre: 1 } });
    const now = new Date();
    const expiredWeek = await prisma.leagueWeek.create({
      data: {
        leagueId: league.id,
        numeroSemaine: 1,
        dateDebut: new Date(now.getTime() - 8 * 86400000),
        dateFin: new Date(now.getTime() - 1 * 86400000),
      },
    });
    const u = await registerUser(app);
    await prisma.leagueMembership.create({
      data: { userId: u.userId, leagueWeekId: expiredWeek.id, weeklyXp: 500 },
    });

    const first = await runWeeklyRollover(now);
    expect(first.closed).toBe(1);
    const second = await runWeeklyRollover(now);
    expect(second.closed).toBe(0); // rien à refaire, la semaine est déjà closedAt
  });

  it('does NOT touch a week that has not ended yet', async () => {
    const league = await prisma.league.create({ data: { nom: 'Bronze', niveau: 1, ordre: 1 } });
    const now = new Date();
    const activeWeek = await prisma.leagueWeek.create({
      data: {
        leagueId: league.id,
        numeroSemaine: 1,
        dateDebut: new Date(now.getTime() - 86400000),
        dateFin: new Date(now.getTime() + 6 * 86400000), // se termine dans 6 jours
      },
    });
    const u = await registerUser(app);
    await prisma.user.update({ where: { id: u.userId }, data: { weeklyXp: 900 } });
    await prisma.leagueMembership.create({
      data: { userId: u.userId, leagueWeekId: activeWeek.id, weeklyXp: 900 },
    });

    const result = await runWeeklyRollover(now);
    expect(result.closed).toBe(0);

    const stillOpen = await prisma.leagueWeek.findUnique({ where: { id: activeWeek.id } });
    expect(stillOpen?.closedAt).toBeNull();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(user.weeklyXp).toBe(900); // inchangé : la semaine n'est pas encore finie
  });
});

d('league auto-enrolment on XP gain (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  /**
   * Reproduit le symptôme rapporté : l'XP affiché sur l'écran Apprendre
   * (User.weeklyXp) monte à chaque leçon/coffre, mais l'écran Ligue
   * (LeagueMembership.weeklyXp) reste figé si l'utilisateur n'a pas
   * d'adhésion active — `addXpIfMemberTx` faisait un no-op silencieux.
   * Il doit désormais auto-inscrire l'utilisateur dans la ligue la plus
   * basse au lieu de laisser les deux compteurs diverger.
   */
  it('auto-enrols a user with no active membership instead of silently dropping their league XP', async () => {
    const league = await prisma.league.create({ data: { nom: 'Bronze', niveau: 1, ordre: 1 } });
    const now = new Date();
    await prisma.leagueWeek.create({
      data: {
        leagueId: league.id,
        numeroSemaine: 1,
        dateDebut: new Date(now.getTime() - 86400000),
        dateFin: new Date(now.getTime() + 6 * 86400000),
      },
    });

    const u = await registerUser(app);
    // L'utilisateur n'a JAMAIS rejoint de ligue (pas de POST /leagues/join).
    const membershipBefore = await prisma.leagueMembership.findFirst({ where: { userId: u.userId } });
    expect(membershipBefore).toBeNull();

    const result = await prisma.$transaction((tx) => leagueService.addXpIfMemberTx(tx, u.userId, 50));
    expect(result).not.toBeNull();

    const membershipAfter = await prisma.leagueMembership.findFirst({ where: { userId: u.userId } });
    expect(membershipAfter?.weeklyXp).toBe(50);

    // Confirmé via l'API réelle : /leagues/me doit maintenant refléter l'adhésion.
    const me = await app.inject({ method: 'GET', url: '/leagues/me', headers: authHeader(u.accessToken) });
    expect(me.json().joined).toBe(true);
  });

  it('does not double-enrol on repeated XP gains (idempotent membership)', async () => {
    const league = await prisma.league.create({ data: { nom: 'Bronze', niveau: 1, ordre: 1 } });
    const now = new Date();
    await prisma.leagueWeek.create({
      data: {
        leagueId: league.id,
        numeroSemaine: 1,
        dateDebut: new Date(now.getTime() - 86400000),
        dateFin: new Date(now.getTime() + 6 * 86400000),
      },
    });
    const u = await registerUser(app);

    await prisma.$transaction((tx) => leagueService.addXpIfMemberTx(tx, u.userId, 30));
    await prisma.$transaction((tx) => leagueService.addXpIfMemberTx(tx, u.userId, 20));

    const memberships = await prisma.leagueMembership.findMany({ where: { userId: u.userId } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.weeklyXp).toBe(50);
  });
});

d('league rollover: promotion and relegation (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  /**
   * Vérifie que le rollover promeut/relègue réellement, et jamais ne
   * "reconduit" quelqu'un dans sa ligue d'origine par erreur : top 3 → ligue
   * du dessus, bottom 5 (avec >5 membres) → ligue du dessous, le reste reste
   * sur place. Valable pour n'importe quelle paire de ligues consécutives,
   * pas seulement Bronze → Argent.
   */
  it('promotes the top 3 to the league above and relegates the bottom 5 to the league below', async () => {
    const bronze = await prisma.league.create({ data: { nom: 'Bronze', niveau: 1, ordre: 1 } });
    const argent = await prisma.league.create({ data: { nom: 'Argent', niveau: 2, ordre: 2 } });
    const or_ = await prisma.league.create({ data: { nom: 'Or', niveau: 3, ordre: 3 } });

    const now = new Date();
    const dateDebut = new Date(now.getTime() - 8 * 86400000);
    const dateFin = new Date(now.getTime() - 1 * 86400000); // expirée hier

    const bronzeWeek = await prisma.leagueWeek.create({
      data: { leagueId: bronze.id, numeroSemaine: 1, dateDebut, dateFin },
    });
    const argentWeek = await prisma.leagueWeek.create({
      data: { leagueId: argent.id, numeroSemaine: 1, dateDebut, dateFin },
    });

    // 8 membres en Bronze : rangs 1-3 promus, rangs 4-8... mais RELEGATION=5
    // et total(8) > 5, donc rangs > (8-5)=3 seraient rélégués — pour isoler
    // proprement promotion vs "reste sur place" ici, on teste sur Argent avec
    // exactement assez de membres pour n'avoir NI promotion top ni relégation
    // (voir test dédié plus bas pour la relégation).
    const bronzeUsers = await Promise.all(
      [900, 800, 700, 600, 500, 400, 300, 200].map(async (xp) => {
        const u = await registerUser(app);
        await prisma.leagueMembership.create({
          data: { userId: u.userId, leagueWeekId: bronzeWeek.id, weeklyXp: xp },
        });
        return { ...u, xp };
      }),
    );

    // En Argent (ligue du milieu) : 1 seul membre, top 3 -> promu vers Or,
    // sans relégation possible (total=1, pas > RELEGATION).
    const argentUser = await registerUser(app);
    await prisma.leagueMembership.create({
      data: { userId: argentUser.userId, leagueWeekId: argentWeek.id, weeklyXp: 1000 },
    });

    await runWeeklyRollover(now);

    // Bronze : rangs 1-3 (900, 800, 700) promus en Argent semaine 2.
    const argentWeek2 = await prisma.leagueWeek.findFirstOrThrow({
      where: { leagueId: argent.id, numeroSemaine: 2 },
    });
    for (const u of bronzeUsers.slice(0, 3)) {
      const m = await prisma.leagueMembership.findUnique({
        where: { userId_leagueWeekId: { userId: u.userId, leagueWeekId: argentWeek2.id } },
      });
      expect(m).not.toBeNull(); // promu — jamais reconduit en Bronze
      expect(m?.weeklyXp).toBe(0); // repart à 0 dans la nouvelle ligue
    }

    // Rangs 4-8 (total=8 > RELEGATION=5, rangs > 8-5=3 sont rang 4..8) sont
    // dans la zone de relégation — mais Bronze est la ligue la PLUS BASSE
    // (ordre=1, pas de ligue en dessous) : ils restent donc en Bronze semaine
    // 2, comme un top-3 déjà au sommet reste au sommet (rien plus bas où aller).
    const bronzeWeek2 = await prisma.leagueWeek.findFirstOrThrow({
      where: { leagueId: bronze.id, numeroSemaine: 2 },
    });
    for (const u of bronzeUsers.slice(3)) {
      const m = await prisma.leagueMembership.findUnique({
        where: { userId_leagueWeekId: { userId: u.userId, leagueWeekId: bronzeWeek2.id } },
      });
      expect(m).not.toBeNull(); // déjà tout en bas — reste en Bronze, pas "perdu"
      expect(m?.weeklyXp).toBe(0);
    }

    // Argent : seul membre, top 3 -> promu en Or, jamais reconduit en Argent.
    const orWeek2 = await prisma.leagueWeek.findFirstOrThrow({
      where: { leagueId: or_.id, numeroSemaine: 2 },
    });
    const argentPromoted = await prisma.leagueMembership.findUnique({
      where: { userId_leagueWeekId: { userId: argentUser.userId, leagueWeekId: orWeek2.id } },
    });
    expect(argentPromoted).not.toBeNull();
    expect(argentPromoted?.weeklyXp).toBe(0);
  });

  it('keeps a top-3 finisher already in the HIGHEST league in that same league (nowhere higher to go)', async () => {
    const or_ = await prisma.league.create({ data: { nom: 'Or', niveau: 3, ordre: 1 } }); // seule ligue existante
    const now = new Date();
    const week = await prisma.leagueWeek.create({
      data: {
        leagueId: or_.id, numeroSemaine: 1,
        dateDebut: new Date(now.getTime() - 8 * 86400000),
        dateFin: new Date(now.getTime() - 1 * 86400000),
      },
    });
    const u = await registerUser(app);
    await prisma.leagueMembership.create({ data: { userId: u.userId, leagueWeekId: week.id, weeklyXp: 999 } });

    await runWeeklyRollover(now);

    const nextWeek = await prisma.leagueWeek.findFirstOrThrow({
      where: { leagueId: or_.id, numeroSemaine: 2 },
    });
    const membership = await prisma.leagueMembership.findUnique({
      where: { userId_leagueWeekId: { userId: u.userId, leagueWeekId: nextWeek.id } },
    });
    expect(membership).not.toBeNull(); // reste dans la même ligue (déjà au sommet)
    expect(membership?.weeklyXp).toBe(0);
  });
});
