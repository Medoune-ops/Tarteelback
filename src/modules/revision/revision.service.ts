import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { scoreRecitation } from '../../core/arabic.js';
import { transcribeAudio } from '../lessons/asr.client.js';

// En dessous de ce score, le verset est jugé "manqué" (aide affichée côté
// front). Plus permissif que le seuil des leçons (70) : une session de
// révision libre porte sur un verset entier, pas un mot isolé.
const FLUENT_THRESHOLD = 60;

export const revisionService = {
  /**
   * Récitation d'un verset en contexte de révision (pas de leçon, pas de
   * cœur en jeu — la révision ne fait JAMAIS perdre de cœur). Transcrit
   * l'audio via l'ASR serveur et score contre le texte du verset.
   */
  async reciteVerset(versetId: string, audio: Buffer, filename: string, mimetype: string) {
    const verset = await prisma.verset.findUnique({
      where: { id: versetId },
      select: { texteArabe: true },
    });
    if (!verset) throw new AppError('NOT_FOUND', 'Verset not found');

    const transcription = await transcribeAudio(audio, filename, mimetype);
    const score = scoreRecitation(verset.texteArabe, transcription);
    return { score, transcription, fluide: score >= FLUENT_THRESHOLD };
  },
};
