import { DAY_MS } from '../ports/scheduler';
import type { Scheduler, SchedulerState } from '../ports/scheduler';
import type { SrsRating } from '../exercise/types';

const RANK: Record<SrsRating, number> = { again: 0, hard: 1, good: 2, easy: 3 };

/** The worse (lower-ranked) of two ratings — again < hard < good < easy. */
export function worseOf(a: SrsRating, b: SrsRating): SrsRating {
  return RANK[a] <= RANK[b] ? a : b;
}

interface GuardedState {
  v: 1;
  core: SchedulerState;
  dayBaseline: SchedulerState | null;
  dayKey: number;
  /** `at` of the day's first (anchor) tick — reused by every same-day recompute so that
   * re-ticking with an unchanged worst rating reproduces a byte-identical result. */
  dayAt: number;
  worstToday: SrsRating;
}

/**
 * M3 same-day / re-drill guard (design C.2b). Wraps any core `Scheduler` so a rule gets at
 * most ONE effective tick per UTC day (`floor(at / DAY_MS)`), computed from that day's baseline
 * with the day's WORST rating so far (monotonic — a later 'good' never undoes an earlier
 * 'again'). All day-tracking lives in the opaque blob, so `appendAttempt` and `fold` inherit
 * the guard through the single `apply` seam with no change to either.
 *
 * The same-day recompute re-applies the core from the day's *baseline* using the day's *first*
 * attempt time (`dayAt`), not the current call's `at`. Pinning the anchor is what makes "one
 * tick per day" an actual invariant rather than an approximation: a later attempt that keeps
 * (or loses) the worst-rating title changes only the rating fed into that single tick, never
 * *when* the tick is considered to have happened — so the tick, and thus `due`, stays stable
 * across any number of same-day re-drills as long as the effective worst rating doesn't change.
 */
export function sameDayGuard(core: Scheduler): Scheduler {
  return {
    apply(prev: SchedulerState | null, rating: SrsRating, at: number) {
      const day = Math.floor(at / DAY_MS);
      const g = prev as GuardedState | null;
      if (g && g.dayKey === day) {
        const worstToday = worseOf(g.worstToday, rating);
        const r = core.apply(g.dayBaseline, worstToday, g.dayAt);
        const blob: GuardedState = { v: 1, core: r.blob, dayBaseline: g.dayBaseline, dayKey: day, dayAt: g.dayAt, worstToday };
        return { blob, due: r.due };
      }
      const dayBaseline = g ? g.core : null;
      const r = core.apply(dayBaseline, rating, at);
      const blob: GuardedState = { v: 1, core: r.blob, dayBaseline, dayKey: day, dayAt: at, worstToday: rating };
      return { blob, due: r.due };
    }
  };
}
