import { describe, expect, it } from 'vitest';
import { seededRng } from './rng';

describe('seededRng (mulberry32)', () => {
  it('is deterministic: same seed -> same sequence', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    expect([a(), a(), a(), a()]).toEqual([b(), b(), b(), b()]);
  });

  it('produces a stable golden sequence for a fixed seed', () => {
    // Pins the EXACT mulberry32 stream (values captured from a real run). Locks reproducibility
    // the planner depends on: distribution proofs, inspector seededRng(1), per-session
    // seededRng(sessionId). A swapped-in but still-deterministic PRNG would fail here.
    const r = seededRng(42);
    expect([r(), r(), r(), r()]).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
    ]);
  });

  it('different seeds diverge', () => {
    const a = seededRng(1);
    const b = seededRng(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('stays in [0, 1)', () => {
    for (const seed of [1, 42, 123, 9999]) {
      const r = seededRng(seed);
      for (let i = 0; i < 1000; i++) {
        const v = r();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});
