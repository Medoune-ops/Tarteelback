/**
 * Génère le contenu de TOUTES les leçons de sourates à partir des données réelles
 * (Verset + VersetMot + traductions fr + translittérations la).
 *
 * Format des leçons (partagé avec Al-Fatiha via prisma/lessonBuilder.ts) :
 *   - regroupement 1-2 versets par leçon (seuil LONG_VERSE_THRESHOLD)
 *   - étapes : discovery + ordering + matching + written
 *
 * Pour chaque section hizb : UPSERT en place par (sectionId, ordre) / (lessonId,
 * ordre) — jamais de deleteMany+recreate, pour préserver Lesson.id/LessonStep.id
 * (donc LessonProgress/SourateRevision des utilisateurs réels). Idempotent.
 * Chaque section est protégée par withRetry (le Postgres free-tier de Render
 * coupe parfois la connexion pendant un seed long).
 *
 *   DATABASE_URL="…" npx tsx prisma/generateLessons.ts
 *
 * La section Alphabet (hizb null) est gérée par generateAlphabet.ts.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  FR, buildGroupSteps, groupVerses, i18n, loadVersets, withRetry, type StepRow,
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
      // "Nom-de-sourate N" est un nom propre — identique dans les deux langues.
      type LessonBlueprint = {
        titre: { fr: string; en: string }; steps: StepRow[]; sourateNumero: number;
        versetDebut: number; versetFin: number;
      };
      const blueprints: LessonBlueprint[] = [];

      for (const link of section.sourateLinks) {
        const sourate = link.sourate;
        const versets = await loadVersets(prisma, sourate.id);
        if (versets.length === 0) continue;

        for (const group of groupVerses(versets)) {
          const built = buildGroupSteps(group, 1, pool);
          const nums = group.map((v) => v.numero).join('-');
          const titre = `${sourate.nom} ${nums}`;
          blueprints.push({
            titre: i18n(titre, titre),
            steps: built,
            sourateNumero: sourate.numero,
            versetDebut: group[0].numero,
            versetFin: group[group.length - 1]!.numero,
          });
        }
      }

      // 2) UPSERT en place — voir le commentaire d'en-tête du fichier : jamais
      // de deleteMany+recreate, ça préserve Lesson.id/LessonStep.id (donc
      // LessonProgress/SourateRevision réels). Seules les positions en
      // surplus (au-delà du nouveau compte) sont supprimées. Les leçons
      // d'une même section sont indépendantes entre elles → traitées en
      // parallèle par lots pour réduire le temps d'aller-retour réseau vers
      // la base distante (au lieu d'un upsert séquentiel leçon par leçon).
      const CONCURRENCY = 8;
      const existingLessons = await prisma.lesson.findMany({
        where: { sectionId: section.id },
        select: { id: true, ordre: true },
      });
      const lessonIdByOrdre = new Map(existingLessons.map((l) => [l.ordre, l.id]));

      let stepsTotal = 0;
      for (let batchStart = 0; batchStart < blueprints.length; batchStart += CONCURRENCY) {
        const batch = blueprints.slice(batchStart, batchStart + CONCURRENCY);
        const batchSteps = await Promise.all(
          batch.map(async (bp, k) => {
            const ordre = batchStart + k + 1;
            const lesson = await prisma.lesson.upsert({
              where: { sectionId_ordre: { sectionId: section.id, ordre } },
              update: {
                titre: bp.titre, sourateNumero: bp.sourateNumero,
                versetDebut: bp.versetDebut, versetFin: bp.versetFin,
              },
              create: {
                sectionId: section.id, ordre, titre: bp.titre, sourateNumero: bp.sourateNumero,
                versetDebut: bp.versetDebut, versetFin: bp.versetFin,
              },
            });
            lessonIdByOrdre.set(ordre, lesson.id);

            const existingSteps = await prisma.lessonStep.findMany({
              where: { lessonId: lesson.id },
              select: { ordre: true },
            });
            const stepOrdres = new Set(existingSteps.map((s) => s.ordre));

            await Promise.all(
              bp.steps.map((s) =>
                prisma.lessonStep.upsert({
                  where: { lessonId_ordre: { lessonId: lesson.id, ordre: s.ordre } },
                  update: { type: s.type, payload: s.payload },
                  create: { lessonId: lesson.id, ordre: s.ordre, type: s.type, payload: s.payload },
                }),
              ),
            );

            const staleStepOrdres = [...stepOrdres].filter((o) => o > bp.steps.length);
            if (staleStepOrdres.length > 0) {
              await prisma.lessonStep.deleteMany({ where: { lessonId: lesson.id, ordre: { in: staleStepOrdres } } });
            }
            return bp.steps.length;
          }),
        );
        stepsTotal += batchSteps.reduce((a, b) => a + b, 0);
      }

      const staleLessonOrdres = [...lessonIdByOrdre.keys()].filter((o) => o > blueprints.length);
      if (staleLessonOrdres.length > 0) {
        await prisma.lesson.deleteMany({ where: { sectionId: section.id, ordre: { in: staleLessonOrdres } } });
      }

      return { lessons: blueprints.length, steps: stepsTotal };
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
