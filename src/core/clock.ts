/**
 * Horloge injectable (ticket 0.B8) — permet aux services (et aux tests) de
 * dépendre du temps sans appeler `new Date()` directement. Par défaut : Date.now().
 */
export type Clock = () => Date;

let current: Clock = () => new Date();

export function now(): Date {
  return current();
}

export function setClock(clock: Clock | null): void {
  current = clock ?? (() => new Date());
}

export function useInjectedClock(initial?: Date): { now: () => Date; set: (d: Date) => void } {
  let value = initial ?? new Date();
  const clock: Clock = () => value;
  setClock(clock);
  return {
    now: () => value,
    set: (d: Date) => {
      value = d;
    },
  };
}

export function resetClock(): void {
  setClock(null);
}
