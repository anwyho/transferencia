import { describe, expect, it } from 'vitest';
import { sessionSummary } from './summary';
import type { RedrillAttempt } from './redrill';

const A = (over: Partial<RedrillAttempt> = {}): RedrillAttempt => ({
  itemId: 'a',
  exerciseTypeKey: 'transformation',
  paramKey: '',
  direction: 'en>es',
  ruleKeys: ['R'],
  rating: 'good',
  at: 1,
  ...over
});

describe('sessionSummary', () => {
  it('counts attempts + correct (rating !== again)', () => {
    const s = sessionSummary([
      A({ itemId: 'a', rating: 'good' }),
      A({ itemId: 'b', rating: 'again' }),
      A({ itemId: 'c', rating: 'hard' })
    ]);
    expect(s.attempts).toBe(3);
    expect(s.correct).toBe(2); // good + hard; again is the only miss
  });

  it('counts re-drilled instruments (served more than once)', () => {
    const s = sessionSummary([
      A({ itemId: 'a', at: 1 }),
      A({ itemId: 'a', at: 2 }), // a served twice -> re-drilled
      A({ itemId: 'b', at: 3 })
    ]);
    expect(s.redrilled).toBe(1);
  });

  it('same item in two directions counts as two instruments, not a redrill', () => {
    const s = sessionSummary([
      A({ itemId: 'a', direction: 'en>es', at: 1 }),
      A({ itemId: 'a', direction: 'es>en', at: 2 })
    ]);
    expect(s.redrilled).toBe(0); // different instruments -> neither served twice
  });

  it('an instrument served three times counts once as re-drilled (distinct instruments, not events)', () => {
    const s = sessionSummary([
      A({ itemId: 'a', at: 1 }),
      A({ itemId: 'a', at: 2 }),
      A({ itemId: 'a', at: 3 })
    ]);
    expect(s.redrilled).toBe(1); // one distinct instrument seen >1x, not 2 re-drill events
  });

  it('empty session', () => {
    expect(sessionSummary([])).toEqual({ attempts: 0, correct: 0, redrilled: 0 });
  });
});
