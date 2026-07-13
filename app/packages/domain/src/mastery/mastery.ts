import { DAY_MS } from '../ports/scheduler';
import type { Direction, SrsRating } from '../exercise/types';

/**
 * The advisory mastery meter (design C.2c; two-signal model, ledger 2026-07-10). A fold of the
 * ReviewLog, materialized on rule_state — NEVER a driver of `due`. Three raw signals:
 *   ewma         — recency-weighted accuracy (isolated; not FSRS's internal difficulty)
 *   instruments  — distinct instrument identities seen (coverage = length; M6: a count, not a %)
 *   successDays  — distinct UTC days with a success (the "not blitzable" spacing signal)
 * `coverage` is materialized to its own rule_state column as `instruments.length`.
 */
export interface MasteryState {
  ewma: number;
  instruments: string[]; // sorted dedup set of canonical instrument keys
  successDays: number[]; // sorted dedup set of UTC day-keys
}

/** Advisory thresholds + inputs — ALL Monte-Carlo-owned placeholders (scheduler-sim owns the values). */
export interface MasteryKnobs {
  alpha: number; // EWMA learning rate; low => slow (~20 spaced reps to saturate, not ~3)
  base: Record<SrsRating, number>; // per-rating accuracy contribution
  isSuccess: (r: SrsRating) => boolean; // what counts as a "success" for the spacing signal
  K: number; // distinct-instrument coverage threshold
  mReady: number; // EWMA readiness threshold
  S: number; // distinct-success-days (spacing) threshold
}

// Monte-Carlo-owned — placeholder defaults, NOT tuned. The scheduler-sim experiment sets these
// (docs/superpowers/specs/scheduler-monte-carlo-experiment.md). Retuning alpha/base is a `rebuild`
// (re-fold); retuning K/mReady/S is a pure read-time change (masteryReady).
export const MASTERY_KNOBS: MasteryKnobs = {
  alpha: 0.1, // Monte-Carlo-owned
  base: { again: 0, hard: 0.5, good: 1, easy: 1 }, // Monte-Carlo-owned
  isSuccess: (r) => r === 'good' || r === 'easy', // Monte-Carlo-owned
  K: 8, // Monte-Carlo-owned
  mReady: 0.85, // Monte-Carlo-owned
  S: 3 // Monte-Carlo-owned
};

const EMPTY: MasteryState = { ewma: 0, instruments: [], successDays: [] };

/**
 * Collision-safe canonical instrument key over the frozen identity (design v2 §Identity bans
 * delimiter joins). The CONCRETE `direction` is part of the key — coverage counts across both
 * directions into the single 'both' rule_state row.
 */
export function instrumentKey(
  itemId: string,
  exerciseTypeKey: string,
  paramKey: string,
  direction: Direction
): string {
  return JSON.stringify([itemId, exerciseTypeKey, paramKey, direction]);
}

function addSortedStr(set: string[], v: string): string[] {
  if (set.includes(v)) return set;
  return [...set, v].sort();
}
function addSortedNum(set: number[], v: number): number[] {
  if (set.includes(v)) return set;
  return [...set, v].sort((a, b) => a - b);
}

/**
 * Fold one attempt into a rule's mastery meter. Called by BOTH `fold` and the write-path
 * (structural identity — the scheduler.apply pattern) so the incremental projection can never
 * drift from the fold. Eats EVERY rep (no same-day guard, unlike timing): the EWMA always
 * updates; a distinct instrument bumps coverage; a success on a new UTC day bumps spacing.
 * Pure/deterministic — no Date.now/Math.random. Takes `at` (not a pre-derived dayKey) so the
 * day math lives in one place, not duplicated across the two callers.
 */
export function applyMastery(
  prev: MasteryState | null,
  rating: SrsRating,
  instrKey: string,
  at: number,
  knobs: MasteryKnobs = MASTERY_KNOBS
): MasteryState {
  const p = prev ?? EMPTY;
  const ewma = p.ewma + knobs.alpha * (knobs.base[rating] - p.ewma);
  const instruments = addSortedStr(p.instruments, instrKey);
  const successDays = knobs.isSuccess(rating)
    ? addSortedNum(p.successDays, Math.floor(at / DAY_MS))
    : p.successDays;
  return { ewma, instruments, successDays };
}

/**
 * Read-time advisory predicate. NEVER stored — retuning K/mReady/S must not force a re-fold.
 * All three signals must clear their threshold ("mastered" is coverage AND accuracy AND spacing).
 */
export function masteryReady(s: MasteryState, knobs: MasteryKnobs = MASTERY_KNOBS): boolean {
  return s.instruments.length >= knobs.K && s.ewma >= knobs.mReady && s.successDays.length >= knobs.S;
}
