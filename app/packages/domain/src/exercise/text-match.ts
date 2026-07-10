export interface SpanishMatchResult {
  correct: boolean;
  /** true when base letters match but accents differ beyond position 0 (accent-off — correct but flagged). */
  accentMismatch: boolean;
  /** the expected candidate that matched (accent-correct form), for the flag note. */
  matched?: string;
}

/**
 * Accent-aware Spanish answer matching (LOCKED policy — ledger 2026-07-09, report M1).
 *
 * - Accents carry meaning, so an accent-correct answer is the clean pass.
 * - Typing convenience: a **capital vowel = its accented form** (`canciOn`→`canción`),
 *   EXCLUDING position 0 (a sentence-initial capital is ambiguous — `El` vs `él`).
 * - At position 0 the accent is accepted either way (sentence-initial), with no note.
 * - An **accent-off** answer (base letters right, accents missing/misplaced beyond
 *   pos 0) is still **correct**, but flagged via `accentMismatch` so the caller can
 *   add a `Grade.detail` note. It carries NO rating penalty (see `ratingFromAssessment`).
 * - `expected` may hold several legitimately-variant answers (`Item.accepted_answers`).
 */
const CAP_VOWEL_TO_ACCENT: Record<string, string> = {
  A: 'á',
  E: 'é',
  I: 'í',
  O: 'ó',
  U: 'ú',
};

function collapseWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function stripAccents(s: string): string {
  // Decompose, then drop all combining marks (the accents) via the Unicode Mark class.
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Capital vowel → accented lowercase, excluding position 0 (ambiguous sentence-initial capital). */
function applyCapitalAsAccent(s: string): string {
  return Array.from(s, (ch, i) => (i > 0 ? (CAP_VOWEL_TO_ACCENT[ch] ?? ch) : ch)).join('');
}

function normalizeUser(s: string): string {
  return applyCapitalAsAccent(collapseWhitespace(s)).toLowerCase().normalize('NFC');
}

function normalizeExpected(s: string): string {
  return collapseWhitespace(s).toLowerCase().normalize('NFC');
}

/** Exact (accent-correct) OR differing only at position 0 by accent (sentence-initial — accept either). */
function exactAllowingSentenceInitial(user: string, expected: string): boolean {
  if (user === expected) return true;
  if (user.length === 0 || expected.length === 0) return false;
  return stripAccents(user[0]) === stripAccents(expected[0]) && user.slice(1) === expected.slice(1);
}

export function matchSpanish(userRaw: string, expected: string[]): SpanishMatchResult {
  const user = normalizeUser(userRaw);
  const candidates = expected.map((raw) => ({ raw, norm: normalizeExpected(raw) }));

  // Clean pass: accent-correct (or sentence-initial accent), no note.
  for (const c of candidates) {
    if (exactAllowingSentenceInitial(user, c.norm)) {
      return { correct: true, accentMismatch: false, matched: c.raw };
    }
  }
  // Accent-off: same base letters, accents differ beyond pos 0 → correct but flagged.
  if (user.length > 0) {
    for (const c of candidates) {
      if (stripAccents(user) === stripAccents(c.norm)) {
        return { correct: true, accentMismatch: true, matched: c.raw };
      }
    }
  }
  return { correct: false, accentMismatch: false };
}
