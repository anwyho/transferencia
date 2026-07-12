import type { Direction, Grade, SrsRating } from '../exercise/types';
import type { SchedulerState } from './scheduler';
import type { ReviewLogRow } from './review-log';

/**
 * rule_state.direction sentinel (report M7): the SRS unit is (user, rule, direction)
 * with a fixed key arity — 'both' when the rule is not scheduled by direction (the
 * C.1 default). The schedule_by_direction escape hatch (C.2+) flips the VALUE to a
 * concrete direction, never the key arity.
 */
export const BOTH_DIRECTION = 'both';

/**
 * The full frozen attempt payload the caller hands the repo. `at` is NOT here — the
 * repo stamps it from its injected Clock (design C.1 §Ports). `userId` is carried on
 * every input (multi-user seam from day one, even at n=1).
 */
export interface AttemptInput {
  userId: string;
  sessionId: number;
  itemId: string;
  /** tested schedulable rule keys (caller filters role='tests' + schedulable). */
  ruleKeys: string[];
  exerciseTypeKey: string;
  paramKey: string;
  direction: Direction;
  rating: SrsRating;
  assessment: Grade;
  hintRevealed: boolean;
  latencyMs?: number;
  contentHash: string;
}

export interface SessionStartInput {
  userId: string;
  mode: string;
  targetAttempts: number;
  at: number;
}
export interface SessionEndInput {
  userId: string;
  sessionId: number;
  at: number;
}

export interface RuleStateRow {
  userId: string;
  ruleKey: string;
  /** 'both' sentinel in C.1 (M7). */
  direction: string;
  blob: SchedulerState;
  due: number;
  firstExposedAt: number;
}

export interface ItemExposureRow {
  userId: string;
  itemId: string;
  timesSeen: number;
  lastSeenAt: number;
  lastRating: SrsRating | null;
  known: boolean;
  starred: boolean;
}

/** A session row (fold output + repo read-back). `endedAt` null until session_end. */
export interface SessionRow {
  id: number;
  userId: string;
  startedAt: number;
  endedAt: number | null;
  mode: string;
  targetAttempts: number;
  realizedCount: number;
}

/** Payload for the per-user lesson dial (C.2a). `at` from the caller's Clock. */
export interface SetLessonInput {
  userId: string;
  lesson: number;
  at: number;
}

/**
 * Persistence seam (design v2). Types-only in the domain; the Drizzle impl lives in
 * @lt/web server. Every method takes/filters user_id. One impl now (SQLite);
 * tripwire = >1 host serving the API → Postgres (design v2).
 */
export interface ReviewRepository {
  startSession(i: SessionStartInput): { sessionId: number };
  endSession(i: SessionEndInput): void;
  /** one txn: append the attempt log row + upsert rule_state per rule + bump exposure. */
  appendAttempt(i: AttemptInput): void;
  /** WHERE user_id AND due <= now ORDER BY due, rule_key, direction. */
  dueRuleStates(userId: string, now: number): RuleStateRow[];
  ruleStates(userId: string): RuleStateRow[];
  itemExposure(userId: string, itemId: string): ItemExposureRow | undefined;
  /** ordered (at, id) — the input to C.2's fold/rebuild. */
  events(userId: string): ReviewLogRow[];
}
