/**
 * Import the real Quran into the database from the Quran.com API v4.
 *
 * Fills: Sourate (114), Verset (6236) with Arabic (uthmani) + per-ayah audio,
 * and per-language VersetTraduction + VersetTranslitteration.
 *
 *   npm run seed:quran           # all 114 surahs
 *   QURAN_IMPORT_LIMIT=10 ...     # only the last 10 surahs (fast dev)
 *
 * Idempotent: re-running upserts surahs/verses and replaces translations.
 * Configure editions/recitation via .env (QURAN_* vars).
 */
import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env.js';
import { QuranClient } from './quranClient.js';

const prisma = new PrismaClient();

/** Parse "131:en,136:fr" -> Map<131,'en'>. */
function parseLangMap(spec: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const pair of spec.split(',')) {
    const [id, lang] = pair.split(':');
    if (id && lang) map.set(Number(id.trim()), lang.trim());
  }
  return map;
}

async function main() {
  const client = new QuranClient(env.QURAN_API_BASE);

  const translationIds = env.QURAN_TRANSLATION_IDS.split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  const translationLang = parseLangMap(env.QURAN_TRANSLATION_LANGS);
  const translitId = env.QURAN_TRANSLITERATION_ID;
  const recitationId = env.QURAN_RECITATION_ID;

  // The transliteration resource is fetched as just another "translation".
  const allTextResources = Array.from(new Set([...translationIds, translitId]));

  console.log('⏳ Fetching chapters…');
  const chapters = await client.chapters();

  // Optionally limit to the last N surahs (Juz Amma first), matching the front.
  const ordered = [...chapters].sort((a, b) => b.id - a.id); // 114 → 1
  const selected = env.QURAN_IMPORT_LIMIT
    ? ordered.slice(0, env.QURAN_IMPORT_LIMIT)
    : ordered;

  console.log(`📖 Importing ${selected.length} surah(s)…`);

  for (const ch of selected) {
    // Skip surahs already fully imported (resume after a network timeout without
    // re-uploading everything). A surah is "complete" when its verse count in the
    // DB matches the API AND its verses already carry word-by-word rows (so a
    // re-import that ADDS words isn't skipped by an older verse-only import).
    const existing = await prisma.sourate.findUnique({
      where: { numero: ch.id },
      select: { id: true, _count: { select: { versets: true } } },
    });
    if (existing && existing._count.versets >= ch.verses_count) {
      const wordCount = await prisma.versetMot.count({
        where: { verset: { sourateId: existing.id } },
      });
      if (wordCount > 0) {
        console.log(`  ↷ ${ch.id.toString().padStart(3)} ${ch.name_simple} (déjà importée + mots, ${ch.verses_count} versets)`);
        continue;
      }
    }

    const verses = await client.chapterVerses(ch.id, allTextResources, recitationId);
    const hizb = verses[0]?.hizb_number ?? 0;

    const sourate = await prisma.sourate.upsert({
      where: { numero: ch.id },
      create: {
        numero: ch.id,
        nom: ch.name_simple,
        nomArabe: ch.name_arabic,
        nombreVersets: ch.verses_count,
        hizb,
        revelation: ch.revelation_place,
      },
      update: {
        nom: ch.name_simple,
        nomArabe: ch.name_arabic,
        nombreVersets: ch.verses_count,
        hizb,
        revelation: ch.revelation_place,
      },
    });

    // One transaction PER SURAH (114 transactions instead of 6236) — far fewer
    // BEGIN/COMMIT round-trips, still atomic per surah and idempotent.
    await prisma.$transaction(async (tx) => {
      for (const v of verses) {
        const traductions: { langue: string; texte: string; source: string }[] = [];
        const translitterations: { langue: string; texte: string; source: string }[] = [];
        for (const t of v.translations ?? []) {
          const text = stripHtml(t.text);
          if (t.resource_id === translitId) {
            translitterations.push({ langue: 'la', texte: text, source: `quran.com#${translitId}` });
          } else {
            const lang = translationLang.get(t.resource_id);
            if (lang) traductions.push({ langue: lang, texte: text, source: `quran.com#${t.resource_id}` });
          }
        }

        const verset = await tx.verset.upsert({
          where: { sourateId_numero: { sourateId: sourate.id, numero: v.verse_number } },
          create: {
            sourateId: sourate.id,
            numero: v.verse_number,
            texteArabe: v.text_uthmani,
            audioUrl: v.audio?.url ?? null,
          },
          update: { texteArabe: v.text_uthmani, audioUrl: v.audio?.url ?? null },
        });
        await tx.versetTraduction.deleteMany({ where: { versetId: verset.id } });
        await tx.versetTranslitteration.deleteMany({ where: { versetId: verset.id } });
        if (traductions.length) {
          await tx.versetTraduction.createMany({ data: traductions.map((t) => ({ versetId: verset.id, ...t })) });
        }
        if (translitterations.length) {
          await tx.versetTranslitteration.createMany({ data: translitterations.map((t) => ({ versetId: verset.id, ...t })) });
        }

        // Word-by-word audio (so the UI plays exactly the word shown).
        await tx.versetMot.deleteMany({ where: { versetId: verset.id } });
        if (v.words.length) {
          await tx.versetMot.createMany({
            data: v.words.map((w) => ({
              versetId: verset.id,
              position: w.position,
              texteArabe: w.text_uthmani,
              audioUrl: w.audioUrl,
            })),
          });
        }
      }
    }, { timeout: 300_000, maxWait: 30_000 });

    console.log(`  ✓ ${ch.id.toString().padStart(3)} ${ch.name_simple} (hizb ${hizb}, ${verses.length} verses)`);
  }

  console.log('✅ Quran import complete.');
}

/** Quran.com translations may contain footnote <sup> tags — strip them. */
function stripHtml(s: string): string {
  return s
    .replace(/<sup[^>]*>.*?<\/sup>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Quran import failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
