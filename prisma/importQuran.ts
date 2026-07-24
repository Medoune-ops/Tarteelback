/**
 * Import the real Quran into the database, combining two sources:
 *   - Al Quran Cloud (api.alquran.cloud + cdn.islamic.network): Arabic text,
 *     hizb, French translation, English transliteration, per-verse audio.
 *     Their terms (alquran.cloud/terms-and-conditions, checked 2026-07-24)
 *     explicitly allow storing/reproducing text and bundling audio into a
 *     commercial product (with attribution) — unlike Quran.com's
 *     "personal, non-commercial use only" terms.
 *   - Quran.com (api.quran.com/api/v4): chapter metadata (surah names,
 *     revelation place) and WORD-BY-WORD audio, which Al Quran Cloud does
 *     not provide at all. This is the only remaining use of Quran.com data.
 *
 * Fills: Sourate (114), Verset (6236) with Arabic (uthmani) + per-ayah audio,
 * per-language VersetTraduction + VersetTranslitteration, and per-word
 * VersetMot (text + audio) from Quran.com.
 *
 *   npm run seed:quran           # all 114 surahs
 *   QURAN_IMPORT_LIMIT=10 ...     # only the last 10 surahs (fast dev)
 *
 * Idempotent: re-running upserts surahs/verses and replaces translations.
 * Configure editions/recitation via .env (QURAN_* / ALQURAN_CLOUD_* vars).
 */
import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env.js';
import { QuranClient } from './quranClient.js';
import { AlQuranCloudClient, type AcVerse } from './alquranCloudClient.js';

const prisma = new PrismaClient();

interface WordRow {
  position: number;
  texteArabe: string;
  audioUrl: string | null;
}

async function main() {
  const quranCom = new QuranClient(env.QURAN_API_BASE);
  const alQuranCloud = new AlQuranCloudClient(env.ALQURAN_CLOUD_API_BASE, env.ALQURAN_CLOUD_CDN_BASE);
  const recitationId = env.QURAN_RECITATION_ID;

  console.log('⏳ Fetching chapters (Quran.com — names only)…');
  const chapters = await quranCom.chapters();
  const chapterById = new Map(chapters.map((c) => [c.id, c]));

  console.log('⏳ Fetching Arabic text + French translation + transliteration + audio (Al Quran Cloud)…');
  const acVerses = await alQuranCloud.allVerses(env.ALQURAN_CLOUD_RECITER);
  const acBySourate = new Map<number, AcVerse[]>();
  for (const v of acVerses) {
    const arr = acBySourate.get(v.numeroSourate) ?? [];
    arr.push(v);
    acBySourate.set(v.numeroSourate, arr);
  }

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
      const versetsSansMots = await prisma.verset.count({
        where: { sourateId: existing.id, mots: { none: {} } },
      });
      if (versetsSansMots === 0) {
        console.log(`  ↷ ${ch.id.toString().padStart(3)} ${ch.name_simple} (déjà importée + mots, ${ch.verses_count} versets)`);
        continue;
      }
    }

    const acVersesForChapter = acBySourate.get(ch.id) ?? [];
    if (acVersesForChapter.length === 0) {
      console.warn(`  ⚠ ${ch.id.toString().padStart(3)} ${ch.name_simple}: aucun verset Al Quran Cloud, sourate ignorée`);
      continue;
    }
    const hizb = acVersesForChapter[0]!.hizbNumber;

    // Word-by-word audio still comes from Quran.com — fetched per chapter,
    // keyed by verse_number, and merged into the Al Quran Cloud verses below.
    const qcVerses = await quranCom.chapterVerses(ch.id, [], recitationId);
    const wordsByVerseNumber = new Map<number, WordRow[]>();
    for (const v of qcVerses) {
      wordsByVerseNumber.set(
        v.verse_number,
        v.words.map((w) => ({ position: w.position, texteArabe: w.text_uthmani, audioUrl: w.audioUrl })),
      );
    }

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

    // Write verses in small CONCURRENT batches rather than one strictly
    // sequential loop: each verse's writes are independent and idempotent, so
    // the only real cost against a high-latency remote DB is round-trip
    // count, not row count. Batches keep the import resumable (no giant
    // per-surah transaction) while cutting wall-clock time roughly by
    // `VERSE_CONCURRENCY` for a network-bound remote database.
    const VERSE_CONCURRENCY = 8;
    for (let i = 0; i < acVersesForChapter.length; i += VERSE_CONCURRENCY) {
      const batch = acVersesForChapter.slice(i, i + VERSE_CONCURRENCY);
      await Promise.all(
        batch.map((v) => importVerset(sourate.id, v, wordsByVerseNumber.get(v.verseNumber) ?? [])),
      );
    }

    console.log(`  ✓ ${ch.id.toString().padStart(3)} ${ch.name_simple} (hizb ${hizb}, ${acVersesForChapter.length} verses)`);
  }

  console.log('✅ Quran import complete.');
}

/** Writes one verse (text/audio from Al Quran Cloud, words from Quran.com). */
async function importVerset(sourateId: string, v: AcVerse, words: WordRow[]): Promise<void> {
  const verset = await prisma.verset.upsert({
    where: { sourateId_numero: { sourateId, numero: v.verseNumber } },
    create: {
      sourateId,
      numero: v.verseNumber,
      texteArabe: v.textUthmani,
      audioUrl: v.audioUrl,
    },
    update: { texteArabe: v.textUthmani, audioUrl: v.audioUrl },
  });

  await prisma.versetTraduction.deleteMany({ where: { versetId: verset.id, langue: 'fr' } });
  if (v.translationFr) {
    await prisma.versetTraduction.create({
      data: { versetId: verset.id, langue: 'fr', texte: v.translationFr, source: 'alquran.cloud#fr.hamidullah' },
    });
  }

  await prisma.versetTranslitteration.deleteMany({ where: { versetId: verset.id, langue: 'la' } });
  if (v.transliterationEn) {
    await prisma.versetTranslitteration.create({
      data: { versetId: verset.id, langue: 'la', texte: v.transliterationEn, source: 'alquran.cloud#en.transliteration' },
    });
  }

  // Word-by-word audio (so the UI plays exactly the word shown) — Quran.com only.
  await prisma.versetMot.deleteMany({ where: { versetId: verset.id } });
  if (words.length) {
    await prisma.versetMot.createMany({
      data: words.map((w) => ({
        versetId: verset.id,
        position: w.position,
        texteArabe: w.texteArabe,
        audioUrl: w.audioUrl,
      })),
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Quran import failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
