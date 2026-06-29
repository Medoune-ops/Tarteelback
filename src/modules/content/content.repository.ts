import { prisma } from '../../config/prisma.js';

/** Read access for content (sections, lessons, sourates, versets). */
export const contentRepository = {
  listSections() {
    return prisma.section.findMany({
      orderBy: { ordre: 'asc' },
      include: {
        sourateLinks: {
          orderBy: { ordre: 'asc' },
          include: { sourate: true },
        },
        lessons: {
          orderBy: { ordre: 'asc' },
          select: { id: true, ordre: true, titre: true, iconType: true },
        },
      },
    });
  },

  getSection(id: string) {
    return prisma.section.findUnique({
      where: { id },
      include: {
        lessons: { orderBy: { ordre: 'asc' } },
        sourateLinks: { orderBy: { ordre: 'asc' }, include: { sourate: true } },
      },
    });
  },

  listLessonsForSection(sectionId: string) {
    return prisma.lesson.findMany({
      where: { sectionId },
      orderBy: { ordre: 'asc' },
      include: { steps: { orderBy: { ordre: 'asc' } } },
    });
  },

  getLesson(id: string) {
    return prisma.lesson.findUnique({
      where: { id },
      include: { steps: { orderBy: { ordre: 'asc' } } },
    });
  },

  listSourates() {
    return prisma.sourate.findMany({ orderBy: { numero: 'asc' } });
  },

  getSourate(id: string) {
    return prisma.sourate.findUnique({ where: { id } });
  },

  getSourateByNumero(numero: number) {
    return prisma.sourate.findUnique({ where: { numero } });
  },

  /** Verses of a surah, with the translation/translitteration for `lang`
   *  plus the default-language fallback (resolved in the service). */
  listVersets(sourateId: string, langs: string[]) {
    return prisma.verset.findMany({
      where: { sourateId },
      orderBy: { numero: 'asc' },
      include: {
        traductions: { where: { langue: { in: langs } } },
        translitterations: { where: { langue: { in: langs } } },
      },
    });
  },

  /** Progress map for one user over a set of lessons. */
  progressForUser(userId: string, lessonIds: string[]) {
    return prisma.lessonProgress.findMany({
      where: { userId, lessonId: { in: lessonIds } },
    });
  },
};
