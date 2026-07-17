import { prisma } from '../../config/prisma.js';

export const adminContentRepository = {
  listSectionsWithLessons() {
    return prisma.section.findMany({
      orderBy: { ordre: 'asc' },
      include: {
        lessons: { select: { id: true }, orderBy: { ordre: 'asc' } },
        sourateLinks: {
          orderBy: { ordre: 'asc' },
          take: 1,
          include: { sourate: { select: { nom: true, nomArabe: true, hizb: true } } },
        },
      },
    });
  },

  /**
   * For a set of lesson ids: how many DISTINCT users have a `completed`
   * LessonProgress row, and how many distinct users have touched the lesson
   * at all (any state) — used to derive "apprenants actifs" and a completion
   * rate per section without loading every progress row into memory.
   */
  async progressCountsForLessons(lessonIds: string[]) {
    if (lessonIds.length === 0) return { completedByLesson: new Map(), touchedByLesson: new Map() };

    const [completed, touched] = await Promise.all([
      prisma.lessonProgress.groupBy({
        by: ['lessonId'],
        where: { lessonId: { in: lessonIds }, etat: 'completed' },
        _count: { userId: true },
      }),
      prisma.lessonProgress.groupBy({
        by: ['lessonId'],
        where: { lessonId: { in: lessonIds } },
        _count: { userId: true },
      }),
    ]);

    return {
      completedByLesson: new Map(completed.map((r) => [r.lessonId, r._count.userId])),
      touchedByLesson: new Map(touched.map((r) => [r.lessonId, r._count.userId])),
    };
  },

  /** Distinct users who have ANY progress row on ANY lesson of the given section's lessons. */
  countDistinctLearners(lessonIds: string[]) {
    if (lessonIds.length === 0) return Promise.resolve(0);
    return prisma.lessonProgress
      .findMany({ where: { lessonId: { in: lessonIds } }, distinct: ['userId'], select: { userId: true } })
      .then((rows) => rows.length);
  },

  setPublished(sectionId: string, publie: boolean) {
    return prisma.section.update({ where: { id: sectionId }, data: { publie } });
  },

  countSourates() {
    return prisma.sourate.count();
  },

  countLessons() {
    return prisma.lesson.count();
  },

  countDraftSections() {
    return prisma.section.count({ where: { publie: false } });
  },
};
