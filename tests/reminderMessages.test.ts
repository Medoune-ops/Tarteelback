import { describe, it, expect } from 'vitest';
import { dailyReminder, REMINDER_MESSAGES, REMINDER_MESSAGES_EN, REMINDER_TITLE } from '../src/modules/notifications/reminderMessages.js';

describe('reminder messages — user-provided, verbatim', () => {
  it('contains all the provided messages', () => {
    // The full list is used as-is; sanity-check a few exact strings.
    expect(REMINDER_MESSAGES.length).toBeGreaterThanOrEqual(60);
    expect(REMINDER_MESSAGES).toContain('Un verset. Juste un. Ce soir.');
    expect(REMINDER_MESSAGES).toContain('Tu n’as pas besoin d’un plan. Tu as besoin d’une sourate.');
    expect(REMINDER_MESSAGES).toContain('Le Coran ne te manque pas. C’est toi qui lui manques.');
  });

  it('returns the first message for rng=0 (verbatim, untouched)', () => {
    const m = dailyReminder('fr', () => 0);
    expect(m.title).toBe(REMINDER_TITLE);
    expect(m.body).toBe(REMINDER_MESSAGES[0]);
  });

  it('always returns a message taken from the list as-is', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
      const m = dailyReminder('fr', () => r);
      expect(REMINDER_MESSAGES).toContain(m.body);
    }
  });

  it('has one English translation per French message, same order', () => {
    expect(REMINDER_MESSAGES_EN).toHaveLength(REMINDER_MESSAGES.length);
    const i = REMINDER_MESSAGES.indexOf('Un verset. Juste un. Ce soir.');
    expect(REMINDER_MESSAGES_EN[i]).toBe('One verse. Just one. Tonight.');
  });

  it('picks the list matching the user language, English otherwise', () => {
    expect(dailyReminder('en', () => 0).body).toBe(REMINDER_MESSAGES_EN[0]);
    expect(dailyReminder('fr-FR', () => 0).body).toBe(REMINDER_MESSAGES[0]);
    // Langue sans traduction (ar) → DEFAULT_LANG (en).
    expect(dailyReminder('ar', () => 0).body).toBe(REMINDER_MESSAGES_EN[0]);
  });
});
