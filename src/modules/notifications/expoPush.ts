/**
 * Minimal Expo Push client (no SDK dependency) — POSTs to the Expo Push API.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * Handles batching (Expo accepts up to 100 messages per request) and surfaces
 * per-message tickets so the caller can disable tokens Expo reports as invalid
 * (DeviceNotRegistered).
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100;

export interface PushMessage {
  to: string; // ExponentPushToken[...]
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
}

export interface PushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Send messages in batches. Returns the flat list of tickets aligned with the
 * input order. Network/HTTP failures for a batch yield 'error' tickets for that
 * batch rather than throwing, so one bad batch never aborts the whole send.
 */
export async function sendPush(messages: PushMessage[]): Promise<PushTicket[]> {
  if (messages.length === 0) return [];
  const tickets: PushTicket[] = [];

  for (const group of chunk(messages, BATCH)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(group.map((m) => ({ sound: 'default', ...m }))),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        for (let i = 0; i < group.length; i++) tickets.push({ status: 'error', message: `HTTP ${res.status}` });
        continue;
      }
      const json = (await res.json()) as { data?: PushTicket[] };
      const data = Array.isArray(json.data) ? json.data : [];
      for (let i = 0; i < group.length; i++) {
        tickets.push(data[i] ?? { status: 'error', message: 'no ticket' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'send failed';
      for (let i = 0; i < group.length; i++) tickets.push({ status: 'error', message });
    }
  }

  return tickets;
}

/** True when a ticket indicates the token should be removed/disabled. */
export function isUnrecoverableToken(ticket: PushTicket): boolean {
  return (
    ticket.status === 'error' &&
    (ticket.details?.error === 'DeviceNotRegistered' ||
      ticket.details?.error === 'InvalidCredentials')
  );
}

/** Basic Expo push token shape check. */
export function isExpoPushToken(token: string): boolean {
  return /^ExponentPushToken\[.+\]$/.test(token) || /^ExpoPushToken\[.+\]$/.test(token);
}
