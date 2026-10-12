import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Règle 4 — verrou statique : plus AUCUN `weeklyXp: { increment: … }` dans le
 * code source. weeklyXp doit toujours être recalculé depuis le registre XpEvent.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('règle 4 — aucun increment de weeklyXp', () => {
  it('le code source ne contient plus weeklyXp: { increment', () => {
    const srcDir = join(process.cwd(), 'src');
    expect(statSync(srcDir).isDirectory()).toBe(true);
    const offenders = walk(srcDir).filter((f) =>
      /weeklyXp\s*:\s*\{\s*increment/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
