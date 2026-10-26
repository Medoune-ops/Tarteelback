/**
 * Conversion « jour local (YYYY-MM-DD) dans un fuseau » → instant UTC.
 * Sert aux bornes des défis : un défi commence à 00:00 dans le fuseau du
 * créateur, pas à 00:00 UTC (à Auckland, ça fait 13 h d'écart).
 */

/** Décalage du fuseau par rapport à UTC, en ms, à l'instant `at`. */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Instant UTC de 00:00 du jour `dayKey` dans `timeZone` (fuseau invalide → UTC). */
export function zonedDayStart(dayKey: string, timeZone: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  // Deux passes : la seconde corrige un changement d'heure (DST) entre l'instant
  // deviné et le vrai minuit local.
  let instant = guess - offsetMs(new Date(guess), tz);
  instant = guess - offsetMs(new Date(instant), tz);
  return new Date(instant);
}

/** Jour suivant d'une clé YYYY-MM-DD (calendrier, sans fuseau). */
export function addDaysToKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Dernière milliseconde du jour `dayKey` dans `timeZone`. */
export function zonedDayEnd(dayKey: string, timeZone: string): Date {
  return new Date(zonedDayStart(addDaysToKey(dayKey, 1), timeZone).getTime() - 1);
}
