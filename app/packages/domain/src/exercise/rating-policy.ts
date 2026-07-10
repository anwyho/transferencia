import type { Grade, RatingSignals, SrsRating } from './types';

/**
 * Central rating policy: derive the SRS rating from the grader's assessment plus
 * signals (ledger 2026-07-09). The grader reports *correctness*; only this policy
 * decides the rating.
 *
 * - wrong → Again
 * - hint revealed → capped at Hard (even if the learner self-reports "easy")
 * - self-reported "too easy" → Easy
 * - otherwise correct → Good
 *
 * Note: an accent-off answer is `correct: true` with a note in `Grade.detail`; the
 * note is advisory and deliberately does not enter here, so accents-off → Good.
 */
export function ratingFromAssessment(grade: Grade, signals: RatingSignals): SrsRating {
  if (!grade.correct) return 'again';
  if (signals.hintRevealed) return 'hard';
  if (signals.selfReport === 'easy') return 'easy';
  return 'good';
}
