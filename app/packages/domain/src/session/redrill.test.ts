import { describe, expect, it } from 'vitest';
import { redrillQueue, type RedrillAttempt } from './redrill';

const A = (over: Partial<RedrillAttempt> = {}): RedrillAttempt => ({
  itemId: 'a',
  exerciseTypeKey: 'transformation',
  paramKey: '',
  direction: 'en>es',
  ruleKeys: ['R'],
  rating: 'again',
  at: 1,
  ...over
});
const all = () => true;
const KNOBS = { redrillMaxMissesPerInstrument: 2 };

describe('redrillQueue', () => {
  it('includes an instrument whose latest attempt is a miss', () => {
    expect(redrillQueue([A({ at: 1 })], all, KNOBS).map((i) => i.itemId)).toEqual(['a']);
  });

  it('excludes a miss later resolved (latest is not "again")', () => {
    expect(redrillQueue([A({ at: 1, rating: 'again' }), A({ at: 2, rating: 'good' })], all, KNOBS)).toEqual([]);
  });

  it('excludes a never-missed instrument', () => {
    expect(redrillQueue([A({ rating: 'good' })], all, KNOBS)).toEqual([]);
  });

  it('bounds the tail: drops an instrument at the miss cap', () => {
    // both attempts are misses: misses 2 >= cap 2 -> dropped
    expect(redrillQueue([A({ at: 1 }), A({ at: 2 })], all, KNOBS)).toEqual([]);
  });

  it('treats distinct directions as distinct instruments', () => {
    const q = redrillQueue([A({ direction: 'en>es', at: 1 }), A({ direction: 'es>en', at: 2 })], all, KNOBS);
    expect(q.map((i) => i.direction).sort()).toEqual(['en>es', 'es>en']);
  });

  it('excludes an instrument whose item is no longer eligible', () => {
    expect(redrillQueue([A({ itemId: 'gone' })], (id) => id !== 'gone', KNOBS)).toEqual([]);
  });

  it('orders earliest-first-miss', () => {
    const q = redrillQueue([A({ itemId: 'a', at: 5 }), A({ itemId: 'b', at: 2 })], all, KNOBS);
    expect(q.map((i) => i.itemId)).toEqual(['b', 'a']);
  });

  it('carries the first ruleKey onto the instrument (observability)', () => {
    expect(redrillQueue([A({ ruleKeys: ['R7', 'R8'] })], all, KNOBS)[0].ruleKey).toBe('R7');
  });

  it('throws on a degenerate cap (unbounded-tail guard)', () => {
    expect(() => redrillQueue([A()], all, { redrillMaxMissesPerInstrument: 0 })).toThrow(/>= 1/);
    expect(() => redrillQueue([A()], all, { redrillMaxMissesPerInstrument: NaN })).toThrow(/integer/);
  });

  it('a correct rep does not burn the re-drill budget (bound is misses, not attempts)', () => {
    // good then again, cap 2 -> misses=1 -> still a candidate (the attempt-count version would drop it)
    expect(
      redrillQueue([A({ at: 1, rating: 'good' }), A({ at: 2, rating: 'again' })], all, { redrillMaxMissesPerInstrument: 2 })
        .map((i) => i.itemId)
    ).toEqual(['a']);
  });

  it('again -> good -> again (latest again) is unresolved', () => {
    expect(
      redrillQueue(
        [A({ at: 1, rating: 'again' }), A({ at: 2, rating: 'good' }), A({ at: 3, rating: 'again' })],
        all, { redrillMaxMissesPerInstrument: 4 }
      ).map((i) => i.itemId)
    ).toEqual(['a']);
  });

  it('sort order key is the first miss, not the latest attempt', () => {
    const q = redrillQueue(
      [A({ itemId: 'x', at: 1, rating: 'again' }), A({ itemId: 'x', at: 2, rating: 'good' }),
       A({ itemId: 'y', at: 5, rating: 'again' }), A({ itemId: 'x', at: 9, rating: 'again' })],
      all, { redrillMaxMissesPerInstrument: 5 }
    );
    expect(q.map((i) => i.itemId)).toEqual(['x', 'y']); // x's first miss @1 precedes y's @5
  });

  it('is order-independent (sorts by at, not array position)', () => {
    const q = redrillQueue(
      [A({ itemId: 'x', at: 9, rating: 'again' }), A({ itemId: 'x', at: 1, rating: 'again' }), A({ itemId: 'x', at: 5, rating: 'good' })],
      all, { redrillMaxMissesPerInstrument: 5 }
    );
    expect(q.map((i) => i.itemId)).toEqual(['x']); // latest by `at` is again@9 -> unresolved
  });
});
