import { describe, it, expect } from 'vitest';
import { computeChainStep, type ChainLesson } from '../src/core/revisionChain.js';

/** 5 leçons couvrant une sourate de 9 versets : 2,2,2,2,1 (dernier verset seul, ex. très long). */
const LESSONS: ChainLesson[] = [
  { ordre: 1, versetDebut: 1, versetFin: 2 },
  { ordre: 2, versetDebut: 3, versetFin: 4 },
  { ordre: 3, versetDebut: 5, versetFin: 6 },
  { ordre: 4, versetDebut: 7, versetFin: 8 },
  { ordre: 5, versetDebut: 9, versetFin: 9 },
];

describe('computeChainStep', () => {
  it('first cycle: no consolidated block yet, teaches the first lesson\'s verses', () => {
    const chain = computeChainStep(LESSONS, 0);
    expect(chain.terminee).toBe(false);
    expect(chain.lessonsConsolidees).toBe(0);
    expect(chain.step).toEqual({
      blocConsolide: null,
      nouveauxVersets: { debut: 1, fin: 2 },
      blocAssemble: { debut: 1, fin: 2 },
      lessonIndex: 0,
    });
  });

  it('second cycle: reviews verses 1-2, learns 3-4, assembles into 1-4', () => {
    const chain = computeChainStep(LESSONS, 1);
    expect(chain.step).toEqual({
      blocConsolide: { debut: 1, fin: 2 },
      nouveauxVersets: { debut: 3, fin: 4 },
      blocAssemble: { debut: 1, fin: 4 },
      lessonIndex: 1,
    });
  });

  it('grows the assembled block cumulatively at each cycle', () => {
    const chain = computeChainStep(LESSONS, 3);
    expect(chain.step).toEqual({
      blocConsolide: { debut: 1, fin: 6 },
      nouveauxVersets: { debut: 7, fin: 8 },
      blocAssemble: { debut: 1, fin: 8 },
      lessonIndex: 3,
    });
  });

  it('handles a single-verse lesson (long verse taught alone) as the new block', () => {
    const chain = computeChainStep(LESSONS, 4);
    expect(chain.step).toEqual({
      blocConsolide: { debut: 1, fin: 8 },
      nouveauxVersets: { debut: 9, fin: 9 },
      blocAssemble: { debut: 1, fin: 9 },
      lessonIndex: 4,
    });
  });

  it('is "terminee" once every lesson has been consolidated', () => {
    const chain = computeChainStep(LESSONS, 5);
    expect(chain.terminee).toBe(true);
    expect(chain.step).toBeNull();
    expect(chain.lessonsConsolidees).toBe(5);
  });

  it('clamps an out-of-range lessonsConsolidees instead of throwing', () => {
    const over = computeChainStep(LESSONS, 999);
    expect(over.terminee).toBe(true);
    expect(over.lessonsConsolidees).toBe(5);

    const negative = computeChainStep(LESSONS, -3);
    expect(negative.lessonsConsolidees).toBe(0);
    expect(negative.step?.blocConsolide).toBeNull();
  });

  it('a single-lesson sourate (e.g. very short) finishes in one cycle', () => {
    const single: ChainLesson[] = [{ ordre: 1, versetDebut: 1, versetFin: 7 }];
    const first = computeChainStep(single, 0);
    expect(first.step).toEqual({
      blocConsolide: null,
      nouveauxVersets: { debut: 1, fin: 7 },
      blocAssemble: { debut: 1, fin: 7 },
      lessonIndex: 0,
    });
    const done = computeChainStep(single, 1);
    expect(done.terminee).toBe(true);
  });
});
