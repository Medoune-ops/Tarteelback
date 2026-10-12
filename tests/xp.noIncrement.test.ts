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

const FORBIDDEN = [
  /weeklyXp\s*:\s*\{\s*increment/,
  /gems\s*:\s*\{\s*increment/,
  /gems\s*:\s*\{\s*decrement/,
];

describe('règle 4 — aucun increment de weeklyXp ni de gems', () => {
  it('weeklyXp et gems sont toujours recalculés, jamais incrémentés/décrémentés', () => {
    const srcDir = join(process.cwd(), 'src');
    expect(statSync(srcDir).isDirectory()).toBe(true);
    const offenders = walk(srcDir).filter((f) => {
      const content = readFileSync(f, 'utf8');
      return FORBIDDEN.some((re) => re.test(content));
    });
    expect(offenders).toEqual([]);
  });
});
