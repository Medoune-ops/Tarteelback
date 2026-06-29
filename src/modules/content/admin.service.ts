import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import type { z } from 'zod';
import type {
  sectionCreateSchema,
  sectionUpdateSchema,
  lessonCreateSchema,
  lessonUpdateSchema,
  stepCreateSchema,
  sourateCreateSchema,
  sourateUpdateSchema,
  versetCreateSchema,
  versetUpdateSchema,
} from './admin.schemas.js';

/** Resolve a set of surah numbers to their SectionSourate link rows. */
async function linkSourates(sectionId: string, numeros: number[]) {
  const sourates = await prisma.sourate.findMany({ where: { numero: { in: numeros } } });
  const byNum = new Map(sourates.map((s) => [s.numero, s]));
  await prisma.sectionSourate.deleteMany({ where: { sectionId } });
  await prisma.sectionSourate.createMany({
    data: numeros
      .map((n, i) => {
        const s = byNum.get(n);
        return s ? { sectionId, sourateId: s.id, ordre: i + 1 } : null;
      })
      .filter((x): x is { sectionId: string; sourateId: string; ordre: number } => x !== null),
  });
}

export const adminService = {
  // ── Sections ──
  async createSection(input: z.infer<typeof sectionCreateSchema>) {
    const { sourateNumeros, ...data } = input;
    const section = await prisma.section.create({ data: { ...data, sousTitre: data.sousTitre ?? '' } });
    if (sourateNumeros?.length) await linkSourates(section.id, sourateNumeros);
    return section;
  },
  async updateSection(id: string, input: z.infer<typeof sectionUpdateSchema>) {
    const { sourateNumeros, ...data } = input;
    const exists = await prisma.section.findUnique({ where: { id } });
    if (!exists) throw new AppError('NOT_FOUND', 'Section not found');
    const section = await prisma.section.update({ where: { id }, data });
    if (sourateNumeros) await linkSourates(section.id, sourateNumeros);
    return section;
  },
  deleteSection(id: string) {
    return prisma.section.delete({ where: { id } });
  },

  // ── Lessons ──
  createLesson(input: z.infer<typeof lessonCreateSchema>) {
    return prisma.lesson.create({ data: input });
  },
  async updateLesson(id: string, input: z.infer<typeof lessonUpdateSchema>) {
    return prisma.lesson.update({ where: { id }, data: input });
  },
  deleteLesson(id: string) {
    return prisma.lesson.delete({ where: { id } });
  },

  // ── Lesson steps ──
  createStep(input: z.infer<typeof stepCreateSchema>) {
    return prisma.lessonStep.create({
      data: {
        lessonId: input.lessonId,
        ordre: input.ordre,
        type: input.type,
        payload: input.payload,
      },
    });
  },
  deleteStep(id: string) {
    return prisma.lessonStep.delete({ where: { id } });
  },

  // ── Sourates ──
  createSourate(input: z.infer<typeof sourateCreateSchema>) {
    return prisma.sourate.create({ data: input });
  },
  updateSourate(id: string, input: z.infer<typeof sourateUpdateSchema>) {
    return prisma.sourate.update({ where: { id }, data: input });
  },
  deleteSourate(id: string) {
    return prisma.sourate.delete({ where: { id } });
  },

  // ── Versets ──
  async createVerset(input: z.infer<typeof versetCreateSchema>) {
    const { traductions, translitterations, ...data } = input;
    return prisma.verset.create({
      data: {
        ...data,
        traductions: traductions ? { create: traductions } : undefined,
        translitterations: translitterations ? { create: translitterations } : undefined,
      },
    });
  },
  async updateVerset(id: string, input: z.infer<typeof versetUpdateSchema>) {
    const { traductions, translitterations, ...data } = input;
    return prisma.$transaction(async (tx) => {
      const verset = await tx.verset.update({ where: { id }, data });
      if (traductions) {
        for (const t of traductions) {
          await tx.versetTraduction.upsert({
            where: { versetId_langue: { versetId: id, langue: t.langue } },
            create: { versetId: id, ...t },
            update: { texte: t.texte, source: t.source },
          });
        }
      }
      if (translitterations) {
        for (const t of translitterations) {
          await tx.versetTranslitteration.upsert({
            where: { versetId_langue: { versetId: id, langue: t.langue } },
            create: { versetId: id, ...t },
            update: { texte: t.texte, source: t.source },
          });
        }
      }
      return verset;
    });
  },
  deleteVerset(id: string) {
    return prisma.verset.delete({ where: { id } });
  },
};
