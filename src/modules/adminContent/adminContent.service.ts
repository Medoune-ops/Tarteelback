import { AppError } from '../../core/errors.js';
import { adminContentRepository } from './adminContent.repository.js';

function pctOr(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

export const adminContentService = {
  /**
   * One row per Section (the back-office's unit of "content"), with a
   * completion % derived from LessonProgress across every lesson in that
   * section, and "apprenants actifs" = distinct users with any progress on
   * it. Sourate/hizb are read from the section's first linked sourate, since
   * a Section maps to a hizb-range in the real teaching order (see
   * schema.prisma's Section doc comment).
   */
  async listSections() {
    const sections = await adminContentRepository.listSectionsWithLessons();
    const allLessonIds = sections.flatMap((s) => s.lessons.map((l) => l.id));
    const { completedByLesson, touchedByLesson } = await adminContentRepository.progressCountsForLessons(allLessonIds);

    const rows = await Promise.all(
      sections.map(async (section) => {
        const lessonIds = section.lessons.map((l) => l.id);
        const completedSum = lessonIds.reduce((sum, id) => sum + (completedByLesson.get(id) ?? 0), 0);
        const touchedSum = lessonIds.reduce((sum, id) => sum + (touchedByLesson.get(id) ?? 0), 0);
        const learners = await adminContentRepository.countDistinctLearners(lessonIds);
        const firstSourate = section.sourateLinks[0]?.sourate ?? null;

        return {
          id: section.id,
          ordre: section.ordre,
          hizb: section.hizb,
          name: firstSourate?.nom ?? section.kicker,
          nameArabic: firstSourate?.nomArabe ?? null,
          lessonCount: section.lessons.length,
          activeLearners: learners,
          // Completion rate: completed rows / total progress rows touched
          // across the section's lessons (0 when nobody has started it yet).
          completionPct: pctOr(completedSum, touchedSum),
          published: section.publie,
        };
      }),
    );

    return rows;
  },

  async setPublished(sectionId: string, publie: boolean) {
    try {
      return await adminContentRepository.setPublished(sectionId, publie);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') throw new AppError('NOT_FOUND', 'Section not found');
      throw e;
    }
  },

  async summary() {
    const [sourateCount, lessonCount, draftSections, sections] = await Promise.all([
      adminContentRepository.countSourates(),
      adminContentRepository.countLessons(),
      adminContentRepository.countDraftSections(),
      this.listSections(),
    ]);
    const withActivity = sections.filter((s) => s.activeLearners > 0);
    const avgCompletion = withActivity.length
      ? Math.round(withActivity.reduce((sum, s) => sum + s.completionPct, 0) / withActivity.length)
      : 0;

    return {
      sourateCount,
      lessonCount,
      avgCompletionPct: avgCompletion,
      draftSections,
    };
  },
};
