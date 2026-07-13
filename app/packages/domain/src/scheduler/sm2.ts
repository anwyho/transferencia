import { DAY_MS } from '../ports/scheduler';
import type { Scheduler } from '../ports/scheduler';
import type { SrsRating } from '../exercise/types';

interface Sm2Blob {
  v: 1;
  ef: number;
  reps: number;
  intervalDays: number;
}

// SM-2 quality (0..5) per rating; 'again' is a lapse (reset).
const QUALITY: Record<SrsRating, number> = { again: 2, hard: 3, good: 4, easy: 5 };

/**
 * Grain-agnostic SM-2 on the rule (design v2 escape hatch): classic ease-factor + interval,
 * NO per-item difficulty. Exists to prove "swap scheduler = replay" (the C.2b replay proof);
 * not wired into the app runtime. Opaque versioned blob behind the same `apply` seam as FSRS.
 */
export const sm2Core: Scheduler = {
  apply(prev, rating, at) {
    const p = (prev as Sm2Blob | null) ?? { v: 1, ef: 2.5, reps: 0, intervalDays: 0 };
    const q = QUALITY[rating];
    let reps = p.reps;
    let intervalDays: number;
    if (rating === 'again') {
      reps = 0;
      intervalDays = 1;
    } else {
      reps += 1;
      intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(p.intervalDays * p.ef);
    }
    const ef = Math.max(1.3, p.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    return { blob: { v: 1, ef, reps, intervalDays }, due: at + intervalDays * DAY_MS };
  }
};
