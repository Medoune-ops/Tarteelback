import { describe, it, expect, vi } from 'vitest';
import { recomputeGemsTx } from '../src/modules/gems/gem.ledger.js';

/**
 * Règle 4 — le solde de gemmes est la SOMME SIGNÉE du registre GemTransaction,
 * écrite en valeur absolue (jamais un increment/decrement).
 */
function makeTx(sum: number | null) {
  const aggregate = vi.fn().mockResolvedValue({ _sum: { amount: sum } });
  const update = vi.fn().mockResolvedValue({});
  return { aggregate, update, tx: { gemTransaction: { aggregate }, user: { update } } };
}

describe('recomputeGemsTx (règle 4)', () => {
  it('écrit le solde recalculé (somme signée du registre)', async () => {
    const { tx, aggregate, update } = makeTx(275);
    const total = await recomputeGemsTx(tx as never, 'u1');
    expect(aggregate).toHaveBeenCalledWith({ _sum: { amount: true }, where: { userId: 'u1' } });
    expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { gems: 275 } });
    expect(total).toBe(275);
  });

  it('registre vide → solde 0', async () => {
    const { tx, update } = makeTx(null);
    const total = await recomputeGemsTx(tx as never, 'u1');
    expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { gems: 0 } });
    expect(total).toBe(0);
  });
});
