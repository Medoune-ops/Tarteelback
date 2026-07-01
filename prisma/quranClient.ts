/**
 * Minimal typed client for the Quran.com API v4 (https://api.quran.com/api/v4).
 * Public, no key required.
 *
 * We use the per-chapter `verses/by_chapter` endpoint with fields + resources
 * requested inline, so each verse carries: uthmani text, hizb, audio, and the
 * requested translations — index-aligned per verse. This avoids fragile
 * cross-endpoint joining.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REQUEST_TIMEOUT_MS = 20_000;

async function getJson<T>(url: string, attempt = 0): Promise<T> {
  let res: Response;
  try {
    // AbortSignal.timeout guards against a server that accepts the connection
    // but never responds (Node fetch has no default timeout).
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
  if (!res.ok) throw new Error(`Quran API ${res.status} for ${url}`);

  const json = (await res.json()) as unknown;
  if (json == null || typeof json !== 'object') {
    throw new Error(`Quran API returned a non-object response for ${url}`);
  }
  return json as T;
}

export interface QChapter {
  id: number;
  name_simple: string;
  name_arabic: string;
  verses_count: number;
  revelation_place: string;
}

export interface QVerseTranslation {
  resource_id: number;
  text: string;
}

/** One word of a verse (word-by-word), with its own recitation audio. */
export interface QWord {
  position: number;
  text_uthmani: string;
  audioUrl: string | null;
}

export interface QVerse {
  verse_number: number;
  verse_key: string; // "1:1"
  hizb_number: number;
  text_uthmani: string;
  audio?: { url: string } | null;
  translations?: QVerseTranslation[];
  words: QWord[];
}

export class QuranClient {
  constructor(private readonly base: string) {}

  async chapters(): Promise<QChapter[]> {
    const data = await getJson<{ chapters: QChapter[] }>(`${this.base}/chapters?language=en`);
    if (!Array.isArray(data.chapters)) {
      throw new Error('Quran API: unexpected /chapters shape (chapters not an array)');
    }
    return data.chapters;
  }

  /**
   * Fetch every verse of a chapter with uthmani text, hizb, audio (for the
   * given recitation) and the requested translations. Handles pagination.
   * Skips verses with missing Arabic text and bounds the page loop so a
   * misbehaving API can't cause an infinite loop.
   */
  async chapterVerses(
    chapterId: number,
    translationIds: number[],
    recitationId: number,
  ): Promise<QVerse[]> {
    const out: QVerse[] = [];
    let page = 1;
    let guard = 0;
    const tids = translationIds.join(',');
    for (;;) {
      if (++guard > 1000) throw new Error(`Quran API: pagination did not terminate for chapter ${chapterId}`);
      const url =
        `${this.base}/verses/by_chapter/${chapterId}` +
        `?words=true&fields=text_uthmani,hizb_number` +
        `&word_fields=text_uthmani,audio_url` +
        `&translations=${tids}` +
        `&audio=${recitationId}` +
        `&per_page=50&page=${page}`;
      const data = await getJson<{
        verses: (QVerse & {
          audio?: { url: string };
          words?: { char_type_name?: string; text_uthmani?: string; audio_url?: string | null }[];
        })[];
        pagination: { next_page: number | null };
      }>(url);
      if (!Array.isArray(data.verses)) {
        throw new Error(`Quran API: unexpected verses shape for chapter ${chapterId}`);
      }
      for (const v of data.verses) {
        // Skip malformed verses rather than crashing the whole import.
        if (typeof v.text_uthmani !== 'string' || typeof v.verse_number !== 'number') continue;

        // Word-by-word: keep only real words (drop the "end" ayah-number glyph),
        // resolve each word's audio to an absolute URL, and number them 1-based.
        const words: QWord[] = [];
        if (Array.isArray(v.words)) {
          let pos = 0;
          for (const w of v.words) {
            if (w.char_type_name !== 'word' || typeof w.text_uthmani !== 'string') continue;
            pos += 1;
            words.push({
              position: pos,
              text_uthmani: w.text_uthmani,
              audioUrl: w.audio_url
                ? (w.audio_url.startsWith('http') ? w.audio_url : `https://verses.quran.com/${w.audio_url}`)
                : null,
            });
          }
        }

        out.push({
          verse_number: v.verse_number,
          verse_key: v.verse_key,
          hizb_number: typeof v.hizb_number === 'number' ? v.hizb_number : 0,
          text_uthmani: v.text_uthmani,
          audio: v.audio?.url
            ? { url: v.audio.url.startsWith('http') ? v.audio.url : `https://verses.quran.com/${v.audio.url}` }
            : null,
          translations: Array.isArray(v.translations) ? v.translations : [],
          words,
        });
      }
      if (!data.pagination?.next_page || data.pagination.next_page <= page) break;
      page = data.pagination.next_page;
    }
    return out;
  }
}
