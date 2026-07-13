import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../ports/scheduler';
import {
  applyMastery,
  instrumentKey,
  masteryReady,
  MASTERY_KNOBS,
  type MasteryKnobs,
  type MasteryState
} from './mastery';

const K = (over: Partial<MasteryKnobs> = {}): MasteryKnobs => ({ ...MASTERY_KNOBS, ...over });
const inst = (i: string) => instrumentKey(i, 'transformation', '', 'en>es');

describe('instrumentKey', () => {
  it('is a collision-safe canonical encoding of the 4 identity fields', () => {
    // Naive delimiter joins collide; JSON encoding does not.
    expect(instrumentKey('a|b', 'transformation', '', 'en>es')).not.toBe(
      instrumentKey('a', 'b|transformation', '', 'en>es')
    );
    expect(instrumentKey('it1', 'transformation', '', 'en>es')).toBe(
      instrumentKey('it1', 'transformation', '', 'en>es')
    );
    // Direction is part of identity: the same item/type/param in two directions = two instruments.
    expect(instrumentKey('it1', 'transformation', '', 'en>es')).not.toBe(
      instrumentKey('it1', 'transformation', '', 'es>en')
    );
  });
});

describe('applyMastery — EWMA (eats every rep, no same-day guard)', () => {
  it('seeds from 0; a first good moves ewma to alpha*base(good)', () => {
    const s = applyMastery(null, 'good', inst('it1'), 1000, K({ alpha: 0.1 }));
    expect(s.ewma).toBeCloseTo(0.1, 10); // 0 + 0.1*(1 - 0)
  });

  it('updates on EVERY attempt, including a repeat of the same instrument', () => {
    let s = applyMastery(null, 'good', inst('it1'), 1000, K({ alpha: 0.1 }));
    s = applyMastery(s, 'good', inst('it1'), 1000, K({ alpha: 0.1 })); // same instrument, same day
    expect(s.ewma).toBeCloseTo(0.19, 10); // 0.1 + 0.1*(1 - 0.1)
    expect(s.instruments).toHaveLength(1); // coverage did NOT move (dedup)
  });

  it('a miss pulls ewma toward base(again)=0', () => {
    const good = applyMastery(null, 'good', inst('it1'), 1000);
    const then = applyMastery(good, 'again', inst('it2'), 1000);
    expect(then.ewma).toBeLessThan(good.ewma);
  });

  it('base keys on the rating', () => {
    const easy = applyMastery(null, 'easy', inst('x'), 1000, K({ base: { again: 0, hard: 0.5, good: 1, easy: 1 } }));
    const hard = applyMastery(null, 'hard', inst('x'), 1000, K({ base: { again: 0, hard: 0.5, good: 1, easy: 1 } }));
    expect(easy.ewma).toBeGreaterThan(hard.ewma);
  });
});

describe('applyMastery — coverage (distinct instruments)', () => {
  it('dedups the same instrument and counts distinct ones (sorted set)', () => {
    let s = applyMastery(null, 'good', inst('b'), 1000);
    s = applyMastery(s, 'good', inst('b'), 1000); // dup
    s = applyMastery(s, 'good', inst('a'), 1000); // distinct
    expect(s.instruments).toEqual([inst('a'), inst('b')]); // sorted, deduped
  });
});

describe('applyMastery — spacing (distinct success-days)', () => {
  it('adds a UTC day only on a success, deduping same-day successes', () => {
    let s = applyMastery(null, 'good', inst('i'), 5 * DAY_MS + 10); // day 5 success
    s = applyMastery(s, 'good', inst('j'), 5 * DAY_MS + 99); // same day success -> dedup
    s = applyMastery(s, 'again', inst('k'), 6 * DAY_MS + 1); // day 6 NOT a success
    s = applyMastery(s, 'good', inst('l'), 7 * DAY_MS + 1); // day 7 success
    expect(s.successDays).toEqual([5, 7]);
  });
});

describe('masteryReady — read-time predicate (all thresholds must hold)', () => {
  const full: MasteryState = {
    ewma: 0.9,
    instruments: Array.from({ length: 8 }, (_, i) => inst('i' + i)),
    successDays: [1, 2, 3]
  };
  it('is true only when coverage>=K AND ewma>=mReady AND |successDays|>=S', () => {
    expect(masteryReady(full, K({ K: 8, mReady: 0.85, S: 3 }))).toBe(true);
  });
  it('is false if any single signal is below threshold', () => {
    expect(masteryReady({ ...full, instruments: full.instruments.slice(0, 7) }, K({ K: 8, mReady: 0.85, S: 3 }))).toBe(false);
    expect(masteryReady({ ...full, ewma: 0.84 }, K({ K: 8, mReady: 0.85, S: 3 }))).toBe(false);
    expect(masteryReady({ ...full, successDays: [1, 2] }, K({ K: 8, mReady: 0.85, S: 3 }))).toBe(false);
  });
});

describe('MasteryState determinism', () => {
  it('round-trips through JSON (sorted arrays, plain scalars)', () => {
    const s = applyMastery(applyMastery(null, 'good', inst('b'), 1000), 'hard', inst('a'), 1000);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
