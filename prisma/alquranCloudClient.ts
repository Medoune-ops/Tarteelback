/**
 * Minimal typed client for the Al Quran Cloud API (https://api.alquran.cloud)
 * and its CDN (https://cdn.islamic.network). Public, no key required.
 *
 * Licensing (alquran.cloud/terms-and-conditions, checked 2026-07-24):
 * text/translations may be freely reproduced, stored and displayed (with
 * courteous attribution — translator name), and audio may be bundled into a
 * commercial product (reciters keep their own copyright). This is why Arabic
 * text, French translation and per-verse audio moved here, away from
 * Quran.com's "personal, non-commercial use only" terms. Word-by-word audio
 * has NO equivalent on Al Quran Cloud, so it stays on quranClient.ts
 * (Quran.com) — see prisma/importQuran.ts for how the two are combined.
 *
 * We fetch the WHOLE Quran in one call (editions joined server-side, index-
 * aligned per surah/ayah) rather than paginating per chapter like Quran.com:
 * simpler, and avoids 114 round-trips.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REQUEST_TIMEOUT_MS = 30_000;

async function getJson<T>(url: string, attempt = 0): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    if (attempt < 5) {
      await sleep(1000 * (attempt + 1));
      return getJson<T>(url, attempt + 1);
    }
    throw e;
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(1000 * (attempt + 1));
    return getJson<T>(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Al Quran Cloud API ${res.status} for ${url}`);

  const json = (await res.json()) as unknown;
  if (json == null || typeof json !== 'object') {
    throw new Error(`Al Quran Cloud API returned a non-object response for ${url}`);
  }
  return json as T;
}

interface AcAyah {
  text: string;
  numberInSurah: number;
  hizbQuarter: number; // 1..240 — quarter-hizb; hizb_number = ceil(hizbQuarter / 4)
}

interface AcSurah {
  number: number;
  ayahs: AcAyah[];
}

interface AcEditionResponse {
  data: { surahs: AcSurah[] };
}

export interface AcVerse {
  numeroSourate: number;
  verseNumber: number;
  hizbNumber: number;
  textUthmani: string;
  translationFr: string | null;
  transliterationEn: string | null;
  audioUrl: string;
}

const EDITION_ARABIC = 'quran-uthmani';
const EDITION_TRANSLATION_FR = 'fr.hamidullah';
const EDITION_TRANSLITERATION_EN = 'en.transliteration';

export class AlQuranCloudClient {
  constructor(
    private readonly apiBase: string,
    private readonly cdnBase: string,
  ) {}

  /**
   * Fetch the WHOLE Quran (all 114 surahs) with Arabic text, French
   * translation, English transliteration and a verse-level audio URL for the
   * given reciter. Requesting several editions at once on `/v1/quran/`
   * silently returns only ONE of them (confirmed empirically) — so this
   * issues one call per edition instead, run concurrently.
   */
  async allVerses(reciter: string, bitrateKbps = 64): Promise<AcVerse[]> {
    const [arabicRes, frRes, translitRes] = await Promise.all([
      getJson<AcEditionResponse>(`${this.apiBase}/quran/${EDITION_ARABIC}`),
      getJson<AcEditionResponse>(`${this.apiBase}/quran/${EDITION_TRANSLATION_FR}`),
      getJson<AcEditionResponse>(`${this.apiBase}/quran/${EDITION_TRANSLITERATION_EN}`),
    ]);
    const arabicSurahs = arabicRes.data.surahs;
    const frSurahs = frRes.data.surahs;
    const translitSurahs = translitRes.data.surahs;
    if (arabicSurahs.length !== 114) {
      throw new Error(`Al Quran Cloud API: expected 114 surahs, got ${arabicSurahs.length}`);
    }

    const out: AcVerse[] = [];
    // The CDN numbers ayahs GLOBALLY across the whole Quran (1..6236), not
    // per-surah — this running counter reconstructs that numbering from the
    // per-surah ayahs we already have, in the same iteration order (surah
    // ascending, ayah ascending) that the global numbering follows.
    let globalAyah = 0;
    for (let s = 0; s < arabicSurahs.length; s++) {
      const ar = arabicSurahs[s]!;
      const fr = frSurahs[s];
      const tr = translitSurahs[s];
      for (let a = 0; a < ar.ayahs.length; a++) {
        const ayah = ar.ayahs[a]!;
        globalAyah += 1;
        out.push({
          numeroSourate: ar.number,
          verseNumber: ayah.numberInSurah,
          hizbNumber: Math.ceil(ayah.hizbQuarter / 4),
          textUthmani: ayah.text,
          translationFr: fr?.ayahs[a]?.text ?? null,
          transliterationEn: tr?.ayahs[a]?.text ?? null,
          audioUrl: `${this.cdnBase}/quran/audio/${bitrateKbps}/ar.${reciter}/${globalAyah}.mp3`,
        });
      }
    }
    return out;
  }
}
