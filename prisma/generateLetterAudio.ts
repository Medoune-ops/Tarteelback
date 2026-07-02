/**
 * Génère les URLs audio Google TTS (gTTS / translate.google.com) pour les
 * 28 lettres de l'alphabet arabe et met à jour les étapes `discovery` des
 * leçons de la section Alphabet en base.
 *
 * Google TTS est utilisé sans clé API via l'endpoint public :
 *   https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ar&q=<texte>
 * C'est la même URL qu'utilisent les extensions Chrome / apps TTS gratuites.
 * Les URLs sont directement lisibles par expo-av (stream HTTP).
 *
 * IMPORTANT : les URLs sont générées à la volée (pas de fichier hébergé).
 * Si Google change son API, remplacer l'URL de base par un CDN propre.
 *
 *   DATABASE_URL="…" npx tsx prisma/generateLetterAudio.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Les 28 lettres — même ordre que generateAlphabet.ts.
const LETTERS = [
  { g: 'ا', nom: 'Alif',  son: 'a / â long',                  tts: 'أَلِف' },
  { g: 'ب', nom: 'Bā',    son: 'b',                            tts: 'بَاء' },
  { g: 'ت', nom: 'Tā',    son: 't',                            tts: 'تَاء' },
  { g: 'ث', nom: 'Thā',   son: 'th (anglais « think »)',       tts: 'ثَاء' },
  { g: 'ج', nom: 'Jīm',   son: 'dj',                           tts: 'جِيم' },
  { g: 'ح', nom: 'Ḥā',    son: 'h aspiré fort',                tts: 'حَاء' },
  { g: 'خ', nom: 'Khā',   son: 'kh (jota)',                    tts: 'خَاء' },
  { g: 'د', nom: 'Dāl',   son: 'd',                            tts: 'دَال' },
  { g: 'ذ', nom: 'Dhāl',  son: 'dh (anglais « this »)',        tts: 'ذَال' },
  { g: 'ر', nom: 'Rā',    son: 'r roulé',                      tts: 'رَاء' },
  { g: 'ز', nom: 'Zāy',   son: 'z',                            tts: 'زَاي' },
  { g: 'س', nom: 'Sīn',   son: 's',                            tts: 'سِين' },
  { g: 'ش', nom: 'Shīn',  son: 'ch',                           tts: 'شِين' },
  { g: 'ص', nom: 'Ṣād',   son: 's emphatique',                 tts: 'صَاد' },
  { g: 'ض', nom: 'Ḍād',   son: 'd emphatique',                 tts: 'ضَاد' },
  { g: 'ط', nom: 'Ṭā',    son: 't emphatique',                 tts: 'طَاء' },
  { g: 'ظ', nom: 'Ẓā',    son: 'z emphatique',                 tts: 'ظَاء' },
  { g: 'ع', nom: 'ʿAyn',  son: 'son guttural « ʿa »',         tts: 'عَيْن' },
  { g: 'غ', nom: 'Ghayn', son: 'gh (r grasseyé)',              tts: 'غَيْن' },
  { g: 'ف', nom: 'Fā',    son: 'f',                            tts: 'فَاء' },
  { g: 'ق', nom: 'Qāf',   son: 'q guttural',                   tts: 'قَاف' },
  { g: 'ك', nom: 'Kāf',   son: 'k',                            tts: 'كَاف' },
  { g: 'ل', nom: 'Lām',   son: 'l',                            tts: 'لَام' },
  { g: 'م', nom: 'Mīm',   son: 'm',                            tts: 'مِيم' },
  { g: 'ن', nom: 'Nūn',   son: 'n',                            tts: 'نُون' },
  { g: 'ه', nom: 'Hā',    son: 'h léger',                      tts: 'هَاء' },
  { g: 'و', nom: 'Wāw',   son: 'w / ou',                       tts: 'وَاو' },
  { g: 'ي', nom: 'Yā',    son: 'y / î',                        tts: 'يَاء' },
];

/** Construit l'URL Google TTS pour un texte arabe. */
function ttsUrl(texteArabe: string): string {
  const q = encodeURIComponent(texteArabe);
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ar&q=${q}`;
}

// Map glyphe → URL audio.
const AUDIO_MAP = new Map(LETTERS.map((l) => [l.g, ttsUrl(l.tts)]));

async function main() {
  const alphabet = await prisma.section.findFirst({
    where: { hizb: null },
    include: { lessons: { orderBy: { ordre: 'asc' }, include: { steps: { orderBy: { ordre: 'asc' } } } } },
  });
  if (!alphabet) throw new Error('Section Alphabet introuvable');

  let updated = 0;

  for (const lesson of alphabet.lessons) {
    for (const step of lesson.steps) {
      if (step.type !== 'discovery') continue;
      const payload = step.payload as Record<string, unknown>;
      const glyphe = (payload.arabe as string | undefined)?.trim() ?? '';

      const audioUrl = AUDIO_MAP.get(glyphe);
      if (!audioUrl) continue; // step multi-lettres ou autre — on ignore
      if (payload.audioUrl === audioUrl) continue; // déjà à jour

      await prisma.lessonStep.update({
        where: { id: step.id },
        data: { payload: { ...payload, audioUrl } },
      });
      updated++;
    }
  }

  console.log(`✓ ${updated} étapes mises à jour avec audio TTS`);
  if (updated === 0) {
    console.log('  (déjà à jour ou aucune étape discovery de lettre trouvée)');
  }
}

main()
  .catch((e) => { console.error('❌', e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
