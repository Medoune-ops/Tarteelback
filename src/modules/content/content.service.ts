import type { LessonState } from '@prisma/client';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { cached } from '../../core/cache.js';
import { contentRepository } from './content.repository.js';
import { serializeSections, serializeLesson } from './content.serializer.js';

export const contentService = {
  /**
   * GET /sections — full parcours, with node states for the given user.
   * The CONTENT (sections/lessons/sourates) is cached in Redis (identical for
   * everyone, near-immutable); only the per-user PROGRESS overlay is fetched
   * fresh and applied on top, so the heavy content query is served from cache.
   */
  async getSections(userId: string | null, lang: string) {
    const sections = await cached('sections', () => contentRepository.listSections());

    const progress = new Map<string, LessonState>();
    if (userId) {
      const lessonIds = sections.flatMap((s) => s.lessons.map((l) => l.id));
      const rows = await contentRepository.progressForUser(userId, lessonIds);
      for (const r of rows) progress.set(r.lessonId, r.etat);
    }
    return serializeSections(sections, progress, lang);
  },

  async getLessonsForSection(sectionId: string, lang: string) {
    return cached(`section:${sectionId}:lessons:${lang}`, async () => {
      const section = await contentRepository.getSection(sectionId);
      if (!section) throw new AppError('NOT_FOUND', 'Section not found');
      const lessons = await contentRepository.listLessonsForSection(sectionId);
      return lessons.map((l) => serializeLesson(l, lang, env.DEFAULT_LANG));
    });
  },

  async getLesson(lessonId: string, lang: string) {
    return cached(`lesson:${lessonId}:${lang}`, async () => {
      const lesson = await contentRepository.getLesson(lessonId);
      if (!lesson) throw new AppError('NOT_FOUND', 'Lesson not found');
      return serializeLesson(lesson, lang, env.DEFAULT_LANG);
    });
  },

  async listSourates() {
    return cached('sourates', async () => {
      const [sourates, teachingOrder] = await Promise.all([
        contentRepository.listSourates(),
        contentRepository.listTeachingOrder(),
      ]);
      const ordreByNumero = new Map(
        teachingOrder.map((l, i) => [l.sourateNumero as number, i]),
      );
      return sourates.map((s) => ({
        ...s,
        // null pour une sourate pas encore enseignée par une leçon (fin du
        // parcours, contenu pas encore généré) — le front la classe en dernier.
        ordreParcours: ordreByNumero.get(s.numero) ?? null,
      }));
    });
  },

  /**
   * GET /sourates/:id/versets?lang=fr — verses with the meaning in the user's
   * language, falling back to DEFAULT_LANG when a translation is missing.
   * `id` may be a cuid or a surah number.
   */
  async getVersets(idOrNumero: string, lang: string) {
    return cached(`versets:${idOrNumero}:${lang}`, () => this._getVersetsUncached(idOrNumero, lang));
  },

  async _getVersetsUncached(idOrNumero: string, lang: string) {
    const sourate = /^\d+$/.test(idOrNumero)
      ? await contentRepository.getSourateByNumero(Number(idOrNumero))
      : await contentRepository.getSourate(idOrNumero);
    if (!sourate) throw new AppError('NOT_FOUND', 'Sourate not found');

    const langs = Array.from(new Set([lang, env.DEFAULT_LANG]));
    const versets = await contentRepository.listVersets(sourate.id, langs);

    const pick = <T extends { langue: string; texte: string; source: string }>(
      rows: T[],
    ) => {
      const exact = rows.find((r) => r.langue === lang);
      const fallback = rows.find((r) => r.langue === env.DEFAULT_LANG);
      const chosen = exact ?? fallback ?? rows[0];
      return chosen
        ? { texte: chosen.texte, langue: chosen.langue, source: chosen.source }
        : null;
    };

    return {
      sourate: {
        id: sourate.id,
        numero: sourate.numero,
        nom: sourate.nom,
        nomArabe: sourate.nomArabe,
        nombreVersets: sourate.nombreVersets,
        hizb: sourate.hizb,
        revelation: sourate.revelation,
      },
      lang,
      versets: versets.map((v) => ({
        id: v.id,
        numero: v.numero,
        texteArabe: v.texteArabe,
        audioUrl: v.audioUrl,
        traduction: pick(v.traductions),
        translitteration: pick(v.translitterations),
        // Word-by-word: each word with its own recitation audio (tappable reader).
        mots: v.mots.map((m) => ({
          position: m.position,
          texteArabe: m.texteArabe,
          audioUrl: m.audioUrl,
        })),
      })),
    };
  },
};
