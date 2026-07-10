import type { SrsRating } from '../exercise/types';

/** One UTC day in ms — the trivial scheduler's fixed interval. */
export const DAY_MS = 86_400_000;

/**
 * Timing state is an OPAQUE, versioned, JSON-serialisable blob behind the port
 * (design v2 §State plane): FSRS→SM-2 is a replay, not a migration. The domain
 * never inspects its shape — only the concrete `Scheduler` impl does.
 */
export type SchedulerState = unknown;

export interface SchedulerResult {
  blob: SchedulerState;
  due: number;
}

/**
 * Timing seam. C.2 swaps FSRS in behind this exact signature; C.1 fixes the shape
 * now with a trivial placeholder so the persistence spine is verifiable first.
 */
export interface Scheduler {
  apply(prev: SchedulerState | null, rating: SrsRating, at: number): SchedulerResult;
}

/**
 * Trivial C.1 scheduler: due = at + 1 day, blob = { last: at }. No memory of prev
 * or rating — correct for a placeholder. C.2 replaces it with FSRS (spaced,
 * ≤ 1 tick/rule/day) behind the same `apply` signature.
 */
export const trivialScheduler: Scheduler = {
  apply(_prev, _rating, at) {
    return { blob: { last: at }, due: at + DAY_MS };
  }
};
