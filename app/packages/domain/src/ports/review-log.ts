import type { Direction, Grade, SrsRating } from '../exercise/types';

/**
 * The FROZEN ReviewLog event model (design v2 §State plane; issue #2). A single
 * kind-discriminated append-only stream is the one ground truth; every per-user
 * table is a fold of it (B2). C.1 only WRITES `attempt` + `session_start`/
 * `session_end`; the other kinds' shapes are frozen here and written by C.2
 * (`set_lesson`) and Epic D (`star`/`unstar`/`set_known`).
 */
export type ReviewLogKind =
  | 'attempt'
  | 'star'
  | 'unstar'
  | 'set_known'
  | 'set_lesson'
  | 'session_start'
  | 'session_end';

interface BaseEvent {
  userId: string;
  /** epoch ms UTC, from the injected Clock; total fold order is (at, id). */
  at: number;
}

export interface AttemptEvent extends BaseEvent {
  kind: 'attempt';
  sessionId: number;
  itemId: string;
  /** tested (schedulable) rule keys this attempt credits; denormalized (attribution). */
  ruleKeys: string[];
  exerciseTypeKey: string;
  /** canonical param_key (B1); '' for empty params — present, never null. */
  paramKey: string;
  /** concrete direction; never the 'both' sentinel. */
  direction: Direction;
  rating: SrsRating;
  assessment: Grade;
  hintRevealed: boolean;
  latencyMs?: number;
  contentHash: string;
}
export interface StarEvent extends BaseEvent {
  kind: 'star';
  itemId: string;
}
export interface UnstarEvent extends BaseEvent {
  kind: 'unstar';
  itemId: string;
}
export interface SetKnownEvent extends BaseEvent {
  kind: 'set_known';
  itemId: string;
  annotationKnown: boolean;
}
export interface SetLessonEvent extends BaseEvent {
  kind: 'set_lesson';
  /** fold floors at 1. */
  annotationLesson: number;
}
export interface SessionStartEvent extends BaseEvent {
  kind: 'session_start';
  sessionId: number;
  sessionMode: string;
  sessionTargetAttempts: number;
}
export interface SessionEndEvent extends BaseEvent {
  kind: 'session_end';
  sessionId: number;
}

export type ReviewLogEvent =
  | AttemptEvent
  | StarEvent
  | UnstarEvent
  | SetKnownEvent
  | SetLessonEvent
  | SessionStartEvent
  | SessionEndEvent;

/**
 * A read-back row (single-table event log): the full frozen column set, columns
 * not applicable to a row's `kind` are null. Ordered (at, id) by `events()` — the
 * input C.2's `fold` replays.
 */
export interface ReviewLogRow {
  id: number;
  userId: string;
  at: number;
  kind: ReviewLogKind;
  itemId: string | null;
  ruleKeys: string[] | null;
  exerciseTypeKey: string | null;
  paramKey: string | null;
  direction: Direction | null;
  rating: SrsRating | null;
  assessment: Grade | null;
  hintRevealed: boolean | null;
  latencyMs: number | null;
  contentHash: string | null;
  sessionId: number | null;
  annotationKnown: boolean | null;
  annotationLesson: number | null;
  sessionMode: string | null;
  sessionTargetAttempts: number | null;
}
