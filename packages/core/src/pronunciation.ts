/**
 * Pronunciation dictionary application (§6.6): text_raw → text_tts.
 *
 * Whole-word replacements only, applied in a single pass, with the character
 * delta reported so the producer can see what each entry costs before adding
 * it — ElevenLabs bills per character and every harakah is a billed character.
 *
 * This module never diacritizes anything on its own (§13). Tashkeel arrives
 * only as part of a replacement someone typed into the dictionary.
 */

export interface PronunciationEntry {
  term: string;
  replacement: string;
}

export interface ApplyResult {
  text: string;
  /** Signed difference in characters; drives the cost preview in the UI. */
  charDelta: number;
  /** Per-term occurrence counts, for "يتكرر 12 مرة في هذا الدرس". */
  applied: { term: string; replacement: string; count: number; charDelta: number }[];
}

/**
 * Word characters for boundary detection.
 *
 * JavaScript's \b is defined over \w, which is [A-Za-z0-9_] — it does not
 * include a single Arabic letter. Using \b on "انجوسوفت" would match at every
 * character boundary and corrupt the text, so boundaries are asserted here
 * with explicit lookarounds over the Arabic blocks plus Latin.
 *
 * The Arabic block ؀-ۿ includes the harakat (ً-ْ), which is
 * deliberate: a replacement that already carries tashkeel must not be matched
 * and replaced a second time.
 */
const WORD_CHAR = "A-Za-z0-9_\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds one combined pattern rather than replacing term by term.
 *
 * Sequential per-term replacement lets an earlier replacement's output be
 * re-matched by a later term — replace "PMP" with "بي إم بي", then a rule for
 * "بي" rewrites the result. A single pass over the original string cannot
 * cascade like that.
 *
 * Terms are sorted longest-first so "PMBOK" wins over "PMP" where both could
 * start at the same position.
 */
function buildPattern(entries: PronunciationEntry[]): { re: RegExp; byTerm: Map<string, string> } | null {
  const usable = entries.filter((e) => e.term.trim().length > 0);
  if (usable.length === 0) return null;

  const sorted = [...usable].sort((a, b) => b.term.length - a.term.length);
  const byTerm = new Map<string, string>();
  for (const e of sorted) {
    // First definition wins for duplicates; the DB's unique index normally
    // prevents them, but a course-scoped entry may shadow a global one.
    if (!byTerm.has(e.term)) byTerm.set(e.term, e.replacement);
  }

  const alternation = [...byTerm.keys()].map(escapeRegExp).join("|");
  const re = new RegExp(`(?<![${WORD_CHAR}])(?:${alternation})(?![${WORD_CHAR}])`, "gu");
  return { re, byTerm };
}

export function applyPronunciations(
  textRaw: string,
  entries: PronunciationEntry[],
): ApplyResult {
  const built = buildPattern(entries);
  if (!built) return { text: textRaw, charDelta: 0, applied: [] };

  const counts = new Map<string, number>();
  const text = textRaw.replace(built.re, (match) => {
    const replacement = built.byTerm.get(match);
    if (replacement === undefined) return match;
    counts.set(match, (counts.get(match) ?? 0) + 1);
    return replacement;
  });

  const applied = [...counts.entries()].map(([term, count]) => {
    const replacement = built.byTerm.get(term)!;
    return {
      term,
      replacement,
      count,
      charDelta: (replacement.length - term.length) * count,
    };
  });

  return { text, charDelta: text.length - textRaw.length, applied };
}

/**
 * Preview for one dictionary entry against a sample (§6.6 "before/after").
 * Reports the cost of adding this entry, not of the whole script.
 */
export function previewEntry(
  sample: string,
  entry: PronunciationEntry,
  usdPer1kChars: number,
): {
  before: string;
  after: string;
  occurrences: number;
  charDelta: number;
  usdDeltaPerRun: number;
  addsTashkeel: boolean;
} {
  const result = applyPronunciations(sample, [entry]);
  const hit = result.applied[0];

  return {
    before: sample,
    after: result.text,
    occurrences: hit?.count ?? 0,
    charDelta: result.charDelta,
    usdDeltaPerRun: (result.charDelta / 1000) * usdPer1kChars,
    addsTashkeel: hasTashkeel(entry.replacement) && !hasTashkeel(entry.term),
  };
}

/** Arabic combining diacritics. Each one is a billed character (§6.6). */
const TASHKEEL_RE = /[ً-ْٰٓ-ٕ]/u;

export function hasTashkeel(s: string): boolean {
  return TASHKEEL_RE.test(s);
}

export function countTashkeel(s: string): number {
  return (s.match(/[ً-ْٰٓ-ٕ]/gu) ?? []).length;
}

/**
 * Guard for the review editor (§13, "do not auto-diacritize full scripts").
 * Flags narration a human has diacritized by hand, which would silently
 * inflate the bill and force wrong readings.
 */
export function looksAutoDiacritized(text: string, thresholdRatio = 0.08): boolean {
  if (text.length === 0) return false;
  return countTashkeel(text) / text.length > thresholdRatio;
}
