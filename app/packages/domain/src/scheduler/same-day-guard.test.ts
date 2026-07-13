import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../ports/scheduler';
import type { Scheduler } from '../ports/scheduler';
import { sameDayGuard, worseOf } from './same-day-guard';

// Fake core: blob.ticks counts applies FROM the given prev; due encodes ticks so we can observe
// how many times the core effectively advanced and with which rating.
const fakeCore: Scheduler = {
  apply(prev, rating, at) {
    const ticks = ((prev as { ticks?: number } | null)?.ticks ?? 0) + 1;
    return { blob: { ticks, lastRating: rating }, due: at + ticks };
  }
};

const DAY0 = 5 * DAY_MS; // some UTC day boundary
const guard = sameDayGuard(fakeCore);

describe('worseOf', () => {
  it('returns the lower-ranked (worse) rating: again < hard < good < easy', () => {
    expect(worseOf('again', 'good')).toBe('again');
    expect(worseOf('easy', 'hard')).toBe('hard');
    expect(worseOf('good', 'good')).toBe('good');
    expect(worseOf('easy', 'again')).toBe('again');
  });
});

describe('sameDayGuard (M3 worst-of-day, monotonic)', () => {
  it('first-ever attempt ticks the core from null', () => {
    const r = guard.apply(null, 'good', DAY0 + 100);
    expect((r.blob as { core: { ticks: number; lastRating: string } }).core).toEqual({ ticks: 1, lastRating: 'good' });
    expect((r.blob as { dayKey: number }).dayKey).toBe(5);
    expect((r.blob as { worstToday: string }).worstToday).toBe('good');
    expect((r.blob as { dayBaseline: unknown }).dayBaseline).toBeNull();
  });

  it('same-day re-tick recomputes from the day baseline with the WORST rating (one tick/day)', () => {
    const r1 = guard.apply(null, 'good', DAY0 + 100);
    const r2 = guard.apply(r1.blob, 'again', DAY0 + 200); // same day, worse
    const r3 = guard.apply(r2.blob, 'good', DAY0 + 300); // same day, better -> stays worst
    expect((r3.blob as { core: { ticks: number; lastRating: string } }).core).toEqual({ ticks: 1, lastRating: 'again' });
    expect((r3.blob as { worstToday: string }).worstToday).toBe('again');
    expect(r3.due).toBe(r2.due); // monotonic: later 'good' did not change the tick
  });

  it('a new day advances from the prior day’s core state', () => {
    const r1 = guard.apply(null, 'good', DAY0 + 100); // day 5, core.ticks=1
    const r2 = guard.apply(r1.blob, 'good', DAY0 + DAY_MS + 100); // day 6
    expect((r2.blob as { core: { ticks: number } }).core.ticks).toBe(2);
    expect((r2.blob as { dayKey: number }).dayKey).toBe(6);
    expect((r2.blob as { worstToday: string }).worstToday).toBe('good');
  });

  it('blob is JSON-round-trippable', () => {
    const r = guard.apply(null, 'hard', DAY0 + 1);
    expect(JSON.parse(JSON.stringify(r.blob))).toEqual(r.blob);
  });
});
