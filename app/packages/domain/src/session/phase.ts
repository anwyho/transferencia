import type { Instrument } from '../planner/planner';

/** The practice session's current phase — a pure function of persisted state (design D.2). */
export type Phase =
  | { kind: 'main'; pick: Instrument }
  | { kind: 'redrill'; pick: Instrument }
  | { kind: 'complete' };

export interface PhaseInput {
  readonly realizedCount: number;
  readonly targetAttempts: number;
  /** the planSession greedy head at the current state; null if the plan is empty */
  readonly head: Instrument | null;
  /** unresolved-miss instruments, eligibility-filtered + ordered (from redrillQueue) */
  readonly redrill: readonly Instrument[];
}

/**
 * Shared by the practice route's `load` (render) and `submit` (decide-to-end) so both agree on
 * completion. Budget is enforced HERE (the realized<target gate), NOT by threading N into the
 * planner (the greedy head is n-independent). A null head — the plan emptied before the budget was
 * spent — falls straight through to the re-drill tail / completion, so a light day is a short one.
 */
export function sessionPhase(i: PhaseInput): Phase {
  if (i.realizedCount < i.targetAttempts && i.head) return { kind: 'main', pick: i.head };
  if (i.redrill.length > 0) return { kind: 'redrill', pick: i.redrill[0] };
  return { kind: 'complete' };
}
