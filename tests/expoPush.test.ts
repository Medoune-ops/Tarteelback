import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  sendPush,
  NOTIF_SOUND,
  NOTIF_CHANNEL_ID,
} from '../src/modules/notifications/expoPush.js';

/** Mock the Expo Push HTTP endpoint so tests never hit the network. */
function mockExpoOk() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const data = (body as unknown[]).map(() => ({ status: 'ok', id: 'ticket' }));
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
}

function sentBody(spy: ReturnType<typeof mockExpoOk>): Record<string, unknown> {
  const init = spy.mock.calls.at(-1)![1] as RequestInit;
  return JSON.parse(String(init.body))[0];
}

describe('expoPush: charge utile envoyee a Expo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('utilise le son Tarteel et le canal Android par defaut', async () => {
    const spy = mockExpoOk();
    await sendPush([{ to: 'ExponentPushToken[AAAA]', title: 'Titre', body: 'Corps' }]);

    const body = sentBody(spy);
    // iOS joue le FICHIER embarque, pas le son systeme.
    expect(body.sound).toBe(NOTIF_SOUND);
    expect(body.channelId).toBe(NOTIF_CHANNEL_ID);
    expect(body.title).toBe('Titre');
  });

  it('respecte un silence demande explicitement (sound: null)', async () => {
    const spy = mockExpoOk();
    await sendPush([
      { to: 'ExponentPushToken[AAAA]', title: 'Titre', body: 'Corps', sound: null },
    ]);

    expect(sentBody(spy).sound).toBeNull();
  });

  it('laisse un son et un canal custom remplacer les valeurs par defaut', async () => {
    const spy = mockExpoOk();
    await sendPush([
      {
        to: 'ExponentPushToken[AAAA]',
        title: 'Titre',
        body: 'Corps',
        sound: 'default',
        channelId: 'autre-canal',
      },
    ]);

    const body = sentBody(spy);
    expect(body.sound).toBe('default');
    expect(body.channelId).toBe('autre-canal');
  });

  it('regroupe les messages par lots de 100', async () => {
    const spy = mockExpoOk();
    const many = Array.from({ length: 150 }, (_, i) => ({
      to: `ExponentPushToken[T${i}]`,
      title: 'T',
      body: 'B',
    }));
    await sendPush(many);

    expect(spy.mock.calls.length).toBe(2);
    const first = JSON.parse(String((spy.mock.calls[0]![1] as RequestInit).body));
    expect(first.length).toBe(100);
  });
});
