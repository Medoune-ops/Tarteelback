/**
 * Génère le contenu de TOUTES les leçons de sourates à partir des données réelles
 * (Verset + VersetMot + traductions fr + translittérations la).
 *
 * Format des leçons (partagé avec Al-Fatiha via prisma/lessonBuilder.ts) :
 *   - regroupement 1-2 versets par leçon (seuil LONG_VERSE_THRESHOLD)
 *   - étapes : discovery + ordering + matching + written
 *
 * Pour chaque section hizb : supprime TOUTES les leçons existantes et les recrée
 * dynamiquement. Idempotent. Chaque section est protégée par withRetry (le
 * Postgres free-tier de Render coupe parfois la connexion pendant un seed long).
 *
 *   DATABASE_URL="…" npx tsx prisma/generateLessons.ts
 *
 * La section Alphabet (hizb null) est gérée par generateAlphabet.ts.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  FR, buildGroupSteps, groupVerses, loadVersets, withRetry, type StepRow,
} from './lessonBuilder.js';

const prisma = new PrismaClient();

async function main() {
  const allTrad = await prisma.versetTraduction.findMany({ where: { langue: FR }, select: { texte: true } });
  const pool = [...new Set(allTrad.map((t) => t.texte).filter((t) => t.length > 0))];
  console.log(`Pool distracteurs: ${pool.length} traductions fr`);

  const hizbSections = await prisma.section.findMany({
    where: { hizb: { not: null } },
    orderBy: { ordre: 'asc' },
    include: {
      lessons: { orderBy: { ordre: 'asc' } },
      sourateLinks: { orderBy: { ordre: 'asc' }, include: { sourate: true } },
    },
  });

  let totalLessons = 0;
  let totalSteps = 0;

  for (const section of hizbSections) {
    const { lessons, steps } = await withRetry(async () => {
      // 1) Collecter les leçons (blueprints) pour toutes les sourates de la section.
      type LessonBlueprint = { titre: string; steps: StepRow[]; sourateNumero: number };
      const blueprints: LessonBlueprint[] = [];

      for (const link of section.sourateLinks) {
        const sourate = link.sourate;
        const versets = await loadVersets(prisma, sourate.id);
        if (versets.length === 0) continue;

        for (const group of groupVerses(versets)) {
          const built = buildGroupSteps(group, 1, pool);
          const nums = group.map((v) => v.numero).join('-');
          blueprints.push({ titre: `${sourate.nom} ${nums}`, steps: built, sourateNumero: sourate.numero });
        }
      }

      // 2) Supprimer les leçons existantes (cascade steps + progress).
      await prisma.lesson.deleteMany({ where: { sectionId: section.id } });

      // 3) Recréer en lot : leçons puis étapes (2-3 allers-retours par section).
      const createdLessons = await prisma.lesson.createManyAndReturn({
        data: blueprints.map((bp, i) => ({ sectionId: section.id, ordre: i + 1, titre: bp.titre, sourateNumero: bp.sourateNumero })),
        select: { id: true, ordre: true },
      });
      const idByOrdre = new Map(createdLessons.map((l) => [l.ordre, l.id]));
      const allSteps = blueprints.flatMap((bp, i) => {
        const lessonId = idByOrdre.get(i + 1)!;
        return bp.steps.map((s) => ({ lessonId, ordre: s.ordre, type: s.type, payload: s.payload }));
      });
      if (allSteps.length > 0) await prisma.lessonStep.createMany({ data: allSteps });

      return { lessons: blueprints.length, steps: allSteps.length };
    }, `Hizb ${section.hizb} (section ${section.ordre})`);

    totalLessons += lessons;
    totalSteps += steps;
    console.log(`  ✓ Hizb ${section.hizb} (section ${section.ordre}) — ${lessons} leçons, ${steps} étapes`);
  }

  console.log(`\n✓ ${totalLessons} leçons de sourates générées, ${totalSteps} étapes au total`);
}

main()
  .catch((e) => { console.error('❌', e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
