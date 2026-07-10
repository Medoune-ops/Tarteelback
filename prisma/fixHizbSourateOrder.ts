/**
 * Réordonne les sourates de chaque section hizb en ordre INVERSE du Mushaf
 * (An-Nas 114 en premier … Al-Fatiha 1 en dernier) : l'ordre de mémorisation
 * classique, déjà appliqué par seed.ts pour les nouvelles bases mais jamais
 * réappliqué aux bases existantes seedées avant ce changement.
 *
 * Met à jour SectionSourate.ordre + le sousTitre de la section. Idempotent.
 * À faire suivre de generateLessons.ts (qui suit l'ordre des liens) puis
 * bumpCache.ts pour servir le nouveau contenu immédiatement.
 *
 *   DATABASE_URL="…" npx tsx prisma/fixHizbSourateOrder.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { withRetry } from './lessonBuilder.js';

const prisma = new PrismaClient();

function sousTitre(noms: string[]): string {
  if (noms.length === 0) return '';
  if (noms.length <= 3) return noms.join(' · ');
  return `${noms.slice(0, 3).join(' · ')} +${noms.length - 3}`;
}

async function main() {
  const sections = await prisma.section.findMany({
    where: { hizb: { not: null } },
    orderBy: { ordre: 'asc' },
    include: { sourateLinks: { include: { sourate: { select: { numero: true, nom: true } } } } },
  });

  for (const section of sections) {
    await withRetry(async () => {
      const desc = [...section.sourateLinks].sort((a, b) => b.sourate.numero - a.sourate.numero);
      await prisma.$transaction([
        ...desc.map((link, i) =>
          prisma.sectionSourate.update({ where: { id: link.id }, data: { ordre: i + 1 } }),
        ),
        prisma.section.update({
          where: { id: section.id },
          data: { sousTitre: sousTitre(desc.map((l) => l.sourate.nom)) },
        }),
      ]);
    }, `Hizb ${section.hizb} (section ${section.ordre})`);
    console.log(`  ✓ Hizb ${section.hizb} — ${section.sourateLinks.length} sourates réordonnées`);
  }
  console.log(`\n✓ ${sections.length} sections hizb réordonnées (Mushaf inverse)`);
}

main()
  .catch((e) => { console.error('❌', e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
