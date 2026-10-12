import { describe, it, expect, vi, afterEach } from 'vitest';
import { xpService } from '../src/modules/xp/xp.service.js';
import { leagueService } from '../src/modules/leagues/league.service.js';

/**
 * Règle 4 — « recalculer, jamais incrémenter ». On vérifie qu'un gain écrit un
 * événement append-only puis RECALCULE weeklyXp (valeur absolue), et que les
 * deux projections (User + LeagueMembership) reçoivent la somme recalculée.
 */
function makeTx(sum: number) {
  const aggregate = vi.fn().mockResolvedValue({ _sum: { amount: sum } });
  const create = vi.fn().mockResolvedValue({});
  const userUpdate = vi.fn().mockResolvedValue({});
  const membershipUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  return {
    aggregate,
    create,
    userUpdate,
    membershipUpdateMany,
    tx: {
      xpEvent: { aggregate, create },
      user: { update: userUpdate },
      leagueMembership: { updateMany: membershipUpdateMany },
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('xpService (ticket 0.B4, règle 4)', () => {
  it('grantTx écrit un événement puis recalcule les deux projections', async () => {
    vi.spyOn(leagueService, 'ensureWeekMembershipTx').mockResolvedValue('week1');
    const { tx, aggregate, create, userUpdate, membershipUpdateMany } = makeTx(120);

    const res = await xpService.grantTx(tx as never, 'u1', 50, 'lesson', 'lesson-9');

    expect(create).toHaveBeenCalledWith({
      data: { userId: 'u1', leagueWeekId: 'week1', amount: 50, source: 'lesson', ref: 'lesson-9' },
    });
    expect(aggregate).toHaveBeenCalledWith({
      _sum: { amount: true },
      where: { userId: 'u1', leagueWeekId: 'week1' },
    });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { weeklyXp: 120 } });
    expect(membershipUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', leagueWeekId: 'week1' },
      data: { weeklyXp: 120 },
    });
    expect(res).toEqual({ weekId: 'week1', weeklyXp: 120, amount: 50 });
  });

  it('recomputeWeeklyXpTx écrit une valeur absolue (idempotent)', async () => {
    const { tx, userUpdate, membershipUpdateMany } = makeTx(123);
    const total = await xpService.recomputeWeeklyXpTx(tx as never, 'u1', 'week1');
    expect(total).toBe(123);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { weeklyXp: 123 } });
    expect(membershipUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', leagueWeekId: 'week1' },
      data: { weeklyXp: 123 },
    });
  });

  it('sans semaine de ligue, agrège sur leagueWeekId null et ne touche pas de membership', async () => {
    vi.spyOn(leagueService, 'ensureWeekMembershipTx').mockResolvedValue(null);
    const { tx, aggregate, membershipUpdateMany } = makeTx(15);

    const res = await xpService.grantTx(tx as never, 'u1', 15, 'daily_chest');

    expect(aggregate).toHaveBeenCalledWith({
      _sum: { amount: true },
      where: { userId: 'u1', leagueWeekId: null },
    });
    expect(membershipUpdateMany).not.toHaveBeenCalled();
    expect(res).toEqual({ weekId: null, weeklyXp: 15, amount: 15 });
  });

  it('un gain nul est un no-op', async () => {
    const { tx, create } = makeTx(0);
    expect(await xpService.grantTx(tx as never, 'u1', 0, 'lesson')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
