import { describe, expect, it } from 'vitest';
import { fsrsCore } from './fsrs';

const T = 1_700_000_000_000;

describe('fsrsCore', () => {
  it('a first good review schedules a due strictly in the future (multi-day)', () => {
    const r = fsrsCore.apply(null, 'good', T);
    expect(r.due).toBeGreaterThan(T);
    expect(r.due - T).toBeGreaterThan(60_000); // not seconds — a real spaced interval
  });

  it('orders first-review intervals by rating: again <= hard <= good <= easy', () => {
    const dAgain = fsrsCore.apply(null, 'again', T).due;
    const dHard = fsrsCore.apply(null, 'hard', T).due;
    const dGood = fsrsCore.apply(null, 'good', T).due;
    const dEasy = fsrsCore.apply(null, 'easy', T).due;
    expect(dAgain).toBeLessThanOrEqual(dHard);
    expect(dHard).toBeLessThanOrEqual(dGood);
    expect(dGood).toBeLessThanOrEqual(dEasy);
  });

  it('blob is JSON-round-trippable and rehydrates to the same next state', () => {
    const first = fsrsCore.apply(null, 'good', T);
    const roundTripped = JSON.parse(JSON.stringify(first.blob));
    expect(roundTripped).toEqual(first.blob);
    const next1 = fsrsCore.apply(first.blob, 'good', T + 5 * 86_400_000);
    const next2 = fsrsCore.apply(roundTripped, 'good', T + 5 * 86_400_000);
    expect(next2).toEqual(next1);
  });

  it('is deterministic (fuzz disabled)', () => {
    expect(fsrsCore.apply(null, 'good', T)).toEqual(fsrsCore.apply(null, 'good', T));
  });
});
