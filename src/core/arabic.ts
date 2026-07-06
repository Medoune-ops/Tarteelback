/**
 * Normalisation de texte arabe + scoring de récitation — logique pure.
 *
 * Le verset de référence (base) est vocalisé (tashkil) et porte des signes
 * d'annotation coranique ; la transcription Whisper peut l'être ou non. On
 * compare donc les deux côtés sous une forme canonique : sans diacritiques,
 * variantes de lettres unifiées, uniquement des lettres arabes séparées par
 * des espaces simples.
 */

// Diacritiques & signes à retirer :
//  - U+0610–U+061A : signes coraniques (honorifiques, etc.)
//  - U+064B–U+065F : tashkil (fatha, damma, kasra, tanwin, shadda, sukun…)
//  - U+0670        : alef suscrit (dagger alif)
//  - U+06D6–U+06ED : signes d'arrêt/annotation coraniques (dont fin d'ayah)
//  - U+08D3–U+08FF : diacritiques arabes étendus
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]/g;
const TATWEEL = /ـ/g;
// Variantes d'alef (madda U+0622, hamza dessus U+0623 / dessous U+0625,
// wasla U+0671) -> alef simple U+0627.
const ALEF_VARIANTS = /[آأإٱ]/g;
// Tout ce qui n'est pas une lettre arabe de base (U+0621–U+063A, U+0641–U+064A)
// devient un espace.
const NON_ARABIC_LETTER = /[^ء-غف-ي]+/g;

/** Forme canonique pour comparaison (PAS pour affichage). */
export function normalizeArabic(text: string): string {
  return text
    .normalize('NFC')
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(ALEF_VARIANTS, 'ا') // -> ا
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(NON_ARABIC_LETTER, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Distance de Levenshtein classique sur une séquence de caractères. */
function levenshteinChars(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  if (A.length === 0) return B.length;
  if (B.length === 0) return A.length;
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const curr = [i, ...new Array<number>(B.length)];
    for (let j = 1; j <= B.length; j++) {
      curr[j] = Math.min(
        prev[j]! + 1, // suppression
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + (A[i - 1] === B[j - 1] ? 0 : 1), // substitution
      );
    }
    prev = curr;
  }
  return prev[B.length]!;
}

/** Similarité 0–1 entre deux mots (Levenshtein caractère). */
function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max([...a].length, [...b].length);
  if (max === 0) return 1;
  return 1 - levenshteinChars(a, b) / max;
}

/**
 * Score de récitation 0–100 : édition au niveau des mots, où une substitution
 * coûte selon la ressemblance des deux mots — un mot presque juste pénalise
 * peu, un mot manquant/étranger pénalise plein. Comparable au `seuilReussite`
 * des étapes voice (défaut 70).
 */
export function scoreRecitation(expected: string, transcribed: string): number {
  const exp = normalizeArabic(expected).split(' ').filter(Boolean);
  const got = normalizeArabic(transcribed).split(' ').filter(Boolean);
  if (exp.length === 0 || got.length === 0) return 0;

  // Levenshtein pondéré au niveau mot.
  let prev = Array.from({ length: got.length + 1 }, (_, j) => j);
  for (let i = 1; i <= exp.length; i++) {
    const curr = [i, ...new Array<number>(got.length)];
    for (let j = 1; j <= got.length; j++) {
      const subCost = 1 - wordSimilarity(exp[i - 1]!, got[j - 1]!);
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + subCost);
    }
    prev = curr;
  }
  const dist = prev[got.length]!;
  const score = 100 * (1 - dist / Math.max(exp.length, got.length));
  return Math.max(0, Math.min(100, Math.round(score)));
}
