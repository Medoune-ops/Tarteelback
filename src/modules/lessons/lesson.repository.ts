import { prisma } from '../../config/prisma.js';

/** Data access for the lesson engine (steps, progress). */
export const lessonRepository = {
  getStep(stepId: string) {
    return prisma.lessonStep.findUnique({ where: { id: stepId } });
  },

  getLessonWithSteps(lessonId: string) {
    return prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { steps: { orderBy: { ordre: 'asc' } } },
    });
  },

  getProgress(userId: string, lessonId: string) {
    return prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });
  },

  /**
   * Atomically remove one heart if the user still has at least one. Single SQL
   * statement → no read-modify-write race. When `anchorNow` is provided (the
   * user was full before this loss), it also sets the regen anchor; otherwise
   * an existing anchor is preserved. Returns the affected row count.
   */
  async decrementHeart(userId: string, anchorNow: Date | null) {
    if (anchorNow) {
      return prisma.user.updateMany({
        where: { id: userId, hearts: { gt: 0 } },
        data: { hearts: { decrement: 1 }, lastHeartLossAt: anchorNow },
      });
    }
    return prisma.user.updateMany({
      where: { id: userId, hearts: { gt: 0 } },
      data: { hearts: { decrement: 1 } },
    });
  },

  upsertProgress(
    userId: string,
    lessonId: string,
    data: { etat?: 'locked' | 'active' | 'completed'; score?: number; completedAt?: Date | null },
  ) {
    return prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: { userId, lessonId, etat: data.etat ?? 'active', score: data.score ?? 0, completedAt: data.completedAt ?? null },
      update: data,
    });
  },
};
