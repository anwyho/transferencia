import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../ports/scheduler';
import { sm2Core } from './sm2';

const T = 1_700_000_000_000;

describe('sm2Core (grain-agnostic SM-2 escape hatch)', () => {
  it('again resets to a 1-day interval', () => {
    const r = sm2Core.apply(null, 'again', T);
    expect(r.due).toBe(T + DAY_MS);
    expect((r.blob as { reps: number }).reps).toBe(0);
  });

  it('successive passes grow the interval (1 -> 6 -> ~ef*6 days)', () => {
    const r1 = sm2Core.apply(null, 'good', T);
    expect(r1.due).toBe(T + 1 * DAY_MS);
    const r2 = sm2Core.apply(r1.blob, 'good', T);
    expect(r2.due).toBe(T + 6 * DAY_MS);
    const r3 = sm2Core.apply(r2.blob, 'good', T);
    expect((r3.due - T) / DAY_MS).toBeGreaterThan(6); // interval = round(6 * ef), ef ~2.5
  });

  it('ef floors at 1.3 under repeated hard ratings', () => {
    let blob = sm2Core.apply(null, 'hard', T).blob;
    for (let i = 0; i < 10; i++) blob = sm2Core.apply(blob, 'hard', T).blob;
    expect((blob as { ef: number }).ef).toBeGreaterThanOrEqual(1.3);
  });

  it('blob is JSON-round-trippable', () => {
    const r = sm2Core.apply(null, 'good', T);
    expect(JSON.parse(JSON.stringify(r.blob))).toEqual(r.blob);
  });
});
