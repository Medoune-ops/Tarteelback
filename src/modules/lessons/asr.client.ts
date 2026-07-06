import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';

/**
 * Client HTTP du microservice ASR (asr/ — Whisper base fine-tuné Coran).
 * Le service tourne sur le réseau interne (Dokploy/compose) et n'est jamais
 * exposé publiquement ; le backend est son seul appelant.
 */

/** L'ASR serveur est-il configuré ? (sinon: chemin voice client, indulgent) */
export function asrEnabled(): boolean {
  return Boolean(env.ASR_URL);
}

/**
 * Transcrit un enregistrement audio (m4a/wav/mp3…) en texte arabe.
 * Toute indisponibilité (non configuré, timeout, 5xx) devient un 503
 * SERVICE_UNAVAILABLE : le front retombe alors sur le scoring on-device.
 */
export async function transcribeAudio(
  audio: Buffer,
  filename: string,
  mimetype: string,
): Promise<string> {
  if (!env.ASR_URL) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Server-side voice scoring is not enabled');
  }

  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(audio)], { type: mimetype }), filename);

  let res: Response;
  try {
    res = await fetch(`${env.ASR_URL}/transcribe`, {
      method: 'POST',
      body: form,
      headers: env.ASR_API_KEY ? { 'x-api-key': env.ASR_API_KEY } : {},
      signal: AbortSignal.timeout(env.ASR_TIMEOUT_MS),
    });
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 'Voice scoring service unreachable');
  }

  if (res.status === 400 || res.status === 413) {
    // Audio illisible ou trop gros — faute du client, pas du service.
    throw new AppError('VALIDATION_ERROR', 'Unreadable or oversized audio recording');
  }
  if (!res.ok) {
    throw new AppError('SERVICE_UNAVAILABLE', `Voice scoring service error (${res.status})`);
  }

  const data = (await res.json()) as { text?: unknown };
  return typeof data.text === 'string' ? data.text : '';
}
