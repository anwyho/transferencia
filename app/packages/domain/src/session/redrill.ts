import { instrumentKey } from '../mastery/mastery';
import type { AttemptEvent } from '../ports/review-log';
import type { Instrument, PlannerKnobs } from '../planner/planner';

/** The projection of one session's `attempt` rows the re-drill logic needs (non-null unlike the raw log row). */
export type RedrillAttempt = Pick<
  AttemptEvent,
  'at' | 'itemId' | 'exerciseTypeKey' | 'paramKey' | 'direction' | 'ruleKeys' | 'rating'
>;

export type RedrillKnobs = Pick<PlannerKnobs, 'redrillMaxMissesPerInstrument'>;

/**
 * The ordered set of this session's UNRESOLVED misses to re-drill before closing. Pure: a function
 * of the session's attempt rows + an eligibility predicate. No store, no rng.
 *
 * A miss = a `again` rating (the only 'incorrect'; a hint-revealed-but-correct answer caps at `hard`,
 * which is not a miss). An instrument is a candidate iff: its LATEST attempt this session is `again`
 * (currently failing), it has missed fewer than `redrillMaxMissesPerInstrument` times (a stubborn
 * miss re-drills at most cap-1 times; a correct rep does not burn the budget), and it is still
 * eligible. Ordered earliest-first-miss.
 */
export function redrillQueue(
  attempts: readonly RedrillAttempt[],
  isEligible: (itemId: string) => boolean,
  knobs: RedrillKnobs
): Instrument[] {
  const cap = knobs.redrillMaxMissesPerInstrument;
  // Reject a degenerate cap loudly (matching the planner's knob discipline): NaN/Infinity never
  // trip `misses >= cap` (unbounded tail); a fractional cap like 2.5 is rejected too, as a
  // misconfig, even though it would still trip; a `< 1` cap always trips it (re-drill disabled).
  if (!Number.isInteger(cap) || cap < 1) {
    throw new Error(`redrillQueue: redrillMaxMissesPerInstrument must be an integer >= 1, got ${cap}`);
  }
  // Sort a copy up front so the function is robust for any caller order (incl. the Monte-Carlo harness).
  const sorted = [...attempts].sort((a, b) => a.at - b.at);
  const groups = new Map<string, RedrillAttempt[]>();
  for (const a of sorted) {
    const key = instrumentKey(a.itemId, a.exerciseTypeKey, a.paramKey, a.direction);
    const g = groups.get(key);
    if (g) g.push(a);
    else groups.set(key, [a]);
  }
  const candidates: { at: number; inst: Instrument }[] = [];
  for (const g of groups.values()) {
    const last = g[g.length - 1];
    if (last.rating !== 'again') continue; // resolved (or never missed)
    const misses = g.filter((a) => a.rating === 'again').length;
    if (misses >= cap) continue; // tail bound: stop re-drilling after `cap` misses this session (a correct rep does NOT burn the budget)
    if (!isEligible(last.itemId)) continue; // gated out since the miss
    const firstAgain = g.find((a) => a.rating === 'again')!; // last is 'again', so one exists
    candidates.push({
      at: firstAgain.at,
      inst: {
        ruleKey: last.ruleKeys[0] ?? '', // observability only; the route re-credits the full tested ruleKeys
        itemId: last.itemId,
        exerciseTypeKey: last.exerciseTypeKey,
        paramKey: last.paramKey,
        direction: last.direction
      }
    });
  }
  candidates.sort((a, b) => a.at - b.at); // earliest-first-miss (stable for equal `at`)
  return candidates.map((c) => c.inst);
}
