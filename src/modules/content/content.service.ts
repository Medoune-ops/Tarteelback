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
  async getSections(userId: string | null) {
    const sections = await cached('sections', () => contentRepository.listSections());

    const progress = new Map<string, LessonState>();
    if (userId) {
      const lessonIds = sections.flatMap((s) => s.lessons.map((l) => l.id));
      const rows = await contentRepository.progressForUser(userId, lessonIds);
      for (const r of rows) progress.set(r.lessonId, r.etat);
    }
    return serializeSections(sections, progress);
  },

  async getLessonsForSection(sectionId: string) {
    return cached(`section:${sectionId}:lessons`, async () => {
      const section = await contentRepository.getSection(sectionId);
      if (!section) throw new AppError('NOT_FOUND', 'Section not found');
      const lessons = await contentRepository.listLessonsForSection(sectionId);
      return lessons.map(serializeLesson);
    });
  },

  async getLesson(lessonId: string) {
    return cached(`lesson:${lessonId}`, async () => {
      const lesson = await contentRepository.getLesson(lessonId);
      if (!lesson) throw new AppError('NOT_FOUND', 'Lesson not found');
      return serializeLesson(lesson);
    });
  },

  async listSourates() {
    return cached('sourates', () => contentRepository.listSourates());
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
      })),
    };
  },
};
