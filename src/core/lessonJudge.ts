/**
 * Lesson step payloads + judging — pure logic. The server is the only judge:
 * the client submits an answer, the server decides correct/incorrect and whether
 * a heart is at stake. Pedagogical rule: `discovery` never costs a heart.
 */

export interface DiscoveryPayload {
  arabe: string;
  translitteration: string;
  traduction: string;
  audioUrl?: string | null;
}

export interface WrittenOption {
  id: string;
  text: string;
}

export interface WrittenPayload {
  consigne: string;
  arabe: string;
  translitteration?: string;
  options: WrittenOption[];
  /** id of the correct option. */
  bonneReponse: string;
}

export interface VoicePayload {
  arabe: string;
  translitteration: string;
  traduction: string;
  audioUrl?: string | null;
  /** 0–100 pass threshold; lenient (e.g. 70). */
  seuilReussite: number;
}

export type StepType = 'discovery' | 'written' | 'voice';

/** The answer body a client may send. */
export interface AnswerInput {
  /** written: chosen option id. */
  optionId?: string;
  /** voice: recognition score 0–100. */
  score?: number;
  /** voice: optional transcript (informational). */
  transcription?: string;
}

export interface Judgement {
  correct: boolean;
  /** whether this judgement may cost a heart on failure. */
  heartAtStake: boolean;
}

/**
 * Judge a single step.
 *  - `discovery` always passes, no heart at stake.
 *  - `written` requires the exact correct option (server-authoritative).
 *  - `voice` is lenient AND never costs a heart: the recognition `score` is
 *    produced by on-device ASR, so the server cannot trust it. We therefore do
 *    NOT make hearts/XP depend on a client-supplied voice score — cheating it
 *    gains nothing, and a flaky ASR never wrongly penalises an honest user.
 *    (When a server-side ASR/scoring service exists, set `heartAtStake: true`
 *    for voice and score it server-side.)
 *
 * Payloads come from a JSON column, so they're defensively guarded: a
 * malformed/incomplete payload fails closed instead of throwing.
 */
function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function judgeStep(
  type: StepType,
  payload: unknown,
  answer: AnswerInput,
): Judgement {
  switch (type) {
    case 'discovery':
      return { correct: true, heartAtStake: false };

    case 'written': {
      const p = asObject(payload);
      if (!p || typeof p.bonneReponse !== 'string') {
        // Malformed step content — fail closed, but don't punish the user.
        return { correct: false, heartAtStake: false };
      }
      const correct = answer.optionId === p.bonneReponse;
      return { correct, heartAtStake: true };
    }

    case 'voice': {
      const p = asObject(payload);
      const seuil = p && typeof p.seuilReussite === 'number' ? p.seuilReussite : 70;
      const score = typeof answer.score === 'number' ? answer.score : 0;
      // Lenient AND never heart-at-stake (client score is untrusted).
      return { correct: score >= seuil, heartAtStake: false };
    }

    default:
      return { correct: false, heartAtStake: false };
  }
}
