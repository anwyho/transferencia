import { describe, expect, it } from 'vitest';
import { ratingFromAssessment } from './rating-policy';

// Ledger 2026-07-09: correct→Good; wrong→Again; hint-revealed caps at Hard; "too easy"→Easy.
describe('central rating policy (A.1)', () => {
  it('correct → good', () => {
    expect(ratingFromAssessment({ correct: true }, { hintRevealed: false })).toBe('good');
  });

  it('wrong → again', () => {
    expect(ratingFromAssessment({ correct: false }, { hintRevealed: false })).toBe('again');
  });

  it('hint revealed caps at hard (even if self-reported easy)', () => {
    expect(ratingFromAssessment({ correct: true }, { hintRevealed: true })).toBe('hard');
    expect(ratingFromAssessment({ correct: true }, { hintRevealed: true, selfReport: 'easy' })).toBe(
      'hard'
    );
  });

  it('self-reported easy → easy', () => {
    expect(ratingFromAssessment({ correct: true }, { hintRevealed: false, selfReport: 'easy' })).toBe(
      'easy'
    );
  });
});
