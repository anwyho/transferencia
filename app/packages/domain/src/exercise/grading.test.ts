import { describe, expect, it } from 'vitest';
import { transformationType } from './transformation';
import { ratingFromAssessment } from './rating-policy';
import type { GradeContext, Grade, Item, ItemStore } from './types';

// A.2 — the LOCKED accent-aware grading policy (ledger 2026-07-09; report M1),
// exercised through the real grader the app calls.
const store: ItemStore = { get: () => undefined };
const gctx: GradeContext = { items: store };

const nacion: Item = {
  id: 'l1-nation-nacion',
  kind: 'transformation',
  front_en: 'nation',
  back_es: 'nación',
  min_lesson: 1,
  directions: ['en>es'],
  rule_refs: [{ key: 'L1#suffix-cion', role: 'tests' }],
};

function grade(item: Item, answer: string): Grade {
  return transformationType.grader.grade(
    item,
    { direction: 'en>es' },
    { modality: 'text', text: answer },
    gctx
  );
}

describe('grader policy — accent-aware match (A.2)', () => {
  it('exact accented answer → correct, no note', () => {
    expect(grade(nacion, 'nación')).toEqual({ correct: true });
  });

  it('capital-as-accent mid-word (naciOn → nación) → correct, no note', () => {
    expect(grade(nacion, 'naciOn')).toEqual({ correct: true });
  });

  it('accent-off (nacion) → correct + flag note, and NO SrsRating penalty', () => {
    const g = grade(nacion, 'nacion');
    expect(g.correct).toBe(true);
    expect(g.detail).toMatch(/accent/i);
    expect(g.detail).toContain('nación');
    // The soft accent signal must NOT lower the rating (ledger decision).
    expect(ratingFromAssessment(g, { hintRevealed: false })).toBe('good');
  });

  it('declared variant via accepted_answers[] → correct, no note', () => {
    const wants: Item = {
      ...nacion,
      id: 'l4-he-wants',
      front_en: '(he) wants',
      back_es: 'quiere',
      accepted_answers: ['quieres'],
    };
    expect(grade(wants, 'quieres')).toEqual({ correct: true });
    expect(grade(wants, 'quiere')).toEqual({ correct: true });
  });

  it('sentence-initial capital (El accepted for él) → correct, no note', () => {
    const he: Item = { ...nacion, id: 'l-he', front_en: 'he', back_es: 'él' };
    expect(grade(he, 'El')).toEqual({ correct: true });
    expect(grade(he, 'él')).toEqual({ correct: true });
  });

  it('wrong base letters → incorrect', () => {
    expect(grade(nacion, 'perro')).toEqual({ correct: false });
  });

  it('empty / whitespace-only answer → incorrect', () => {
    expect(grade(nacion, '')).toEqual({ correct: false });
    expect(grade(nacion, '   ')).toEqual({ correct: false });
  });

  it('ignores surrounding whitespace', () => {
    expect(grade(nacion, '  nación  ')).toEqual({ correct: true });
  });
});
