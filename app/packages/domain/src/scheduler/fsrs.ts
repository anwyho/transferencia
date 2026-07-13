import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from 'ts-fsrs';
import { sameDayGuard } from './same-day-guard';
import type { Scheduler } from '../ports/scheduler';
import type { SrsRating } from '../exercise/types';

// request_retention + the trained weights are Monte-Carlo-owned — placeholder defaults, tuned
// by the scheduler-sim experiment (ledger). Two flags are STRUCTURAL, not tuning knobs:
//   enable_fuzz: false  — the fold + rebuild/replay proofs require deterministic output.
//   enable_short_term: false — this app schedules at DAY grain (design v2: "intervals grow over
//     days; known rules leave the daily queue"). ts-fsrs's default sub-day learning steps
//     (1m/10m) can't progress under the M3 one-tick-per-day guard — a drilled rule would sit
//     `due` all day instead of leaving the queue — so short-term steps are disabled here.
const PARAMS = generatorParameters({
  request_retention: 0.9,
  enable_fuzz: false,
  enable_short_term: false
});
const F = fsrs(PARAMS);

const GRADE: Record<SrsRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy
};

// Opaque blob: a ts-fsrs Card with Date fields serialized to epoch ms (JSON-safe), versioned.
// Generic spread keeps it lossless across ts-fsrs field changes.
type FsrsBlob = { v: 1 } & Omit<Card, 'due' | 'last_review'> & { due: number; last_review: number | null };

function toCard(b: FsrsBlob): Card {
  // Drop the envelope fields via delete (not destructure-to-exclude) so no binding goes
  // unused — `rest` keeps every other field, lossless across ts-fsrs field changes.
  const rest = { ...b } as Record<string, unknown>;
  delete rest.v;
  delete rest.due;
  delete rest.last_review;
  return {
    ...(rest as Omit<Card, 'due' | 'last_review'>),
    due: new Date(b.due),
    last_review: b.last_review == null ? undefined : new Date(b.last_review)
  } as Card;
}

function fromCard(c: Card): FsrsBlob {
  return {
    ...(c as Card),
    v: 1,
    due: c.due.getTime(),
    last_review: c.last_review ? c.last_review.getTime() : null
  };
}

/**
 * FSRS timing core (design v2 §Scheduling; C.2b). Rule-grain: the "card" is the rule. Opaque
 * versioned blob behind the port so FSRS->SM-2 is a replay, not a migration. Pure/isomorphic
 * (ts-fsrs is pure JS) so it runs inside the fold client-side (P3).
 */
export const fsrsCore: Scheduler = {
  apply(prev, rating, at) {
    const card = prev ? toCard(prev as FsrsBlob) : createEmptyCard(new Date(at));
    const { card: next } = F.next(card, new Date(at), GRADE[rating]);
    return { blob: fromCard(next), due: next.due.getTime() };
  }
};

/** The app's live scheduler: FSRS under the M3 same-day guard. */
export const fsrsScheduler: Scheduler = sameDayGuard(fsrsCore);
