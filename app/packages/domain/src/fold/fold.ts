import { BOTH_DIRECTION } from '../ports/repository';
import type { ItemExposureRow, RuleStateRow, SessionRow } from '../ports/repository';
import type { ReviewLogEvent, ReviewLogRow } from '../ports/review-log';
import type { Scheduler } from '../ports/scheduler';
import { applyMastery, instrumentKey } from '../mastery/mastery';
import type { MasteryState } from '../mastery/mastery';

/** Applied fold-time to each tested rule key to collapse a rename's history (design v2 m7/M8). */
export type KeyRemap = (ruleKey: string) => string;

/** The projection `fold` rebuilds — the same state C.1's incremental write path materializes. */
export interface FoldState {
  currentLesson: number;
  ruleStates: RuleStateRow[];
  itemExposures: ItemExposureRow[];
  sessions: SessionRow[];
}

const IDENTITY: KeyRemap = (k) => k;

/** Code-unit string order — matches SQLite's default BINARY collation (the repo read-back order). */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pure, isomorphic projection of the ReviewLog (design v2 §State plane). Walks `events`
 * AS GIVEN — the caller guarantees `(at, id)` order (the repo's `events()` does). Equality
 * with the incremental projection holds under monotonic time (contract A); under a backward
 * clock the cache may lag and this fold is authoritative. Never inspects the scheduler blob
 * (opaque) and performs no I/O. `rule_state` is keyed by rule with the `'both'` direction
 * sentinel (C.1/C.2a do not schedule by direction — M7).
 * Assumes a single-user event stream (as returned by ReviewRepository.events(userId)) —
 * rule/item maps are keyed without userId.
 */
export function fold(events: ReviewLogEvent[], opts: { scheduler: Scheduler; keyRemap?: KeyRemap }): FoldState {
  const keyRemap = opts.keyRemap ?? IDENTITY;
  const { scheduler } = opts;

  let currentLesson = 1;
  const ruleStates = new Map<string, RuleStateRow>();
  const itemExposures = new Map<string, ItemExposureRow>();
  const sessions = new Map<number, SessionRow>();

  const exposureFor = (userId: string, itemId: string, at: number): ItemExposureRow => {
    let e = itemExposures.get(itemId);
    if (!e) {
      e = { userId, itemId, timesSeen: 0, lastSeenAt: at, lastRating: null, known: false, starred: false };
      itemExposures.set(itemId, e);
    }
    return e;
  };

  for (const ev of events) {
    switch (ev.kind) {
      case 'attempt': {
        for (const raw of ev.ruleKeys) {
          const ruleKey = keyRemap(raw);
          const prev = ruleStates.get(ruleKey);
          const { blob, due } = scheduler.apply(prev ? prev.blob : null, ev.rating, ev.at);
          const prevMastery: MasteryState | null = prev
            ? { ewma: prev.mastery, instruments: prev.seenInstruments, successDays: prev.successDays }
            : null;
          const m = applyMastery(
            prevMastery,
            ev.rating,
            instrumentKey(ev.itemId, ev.exerciseTypeKey, ev.paramKey, ev.direction),
            ev.at
          );
          ruleStates.set(ruleKey, {
            userId: ev.userId,
            ruleKey,
            direction: BOTH_DIRECTION,
            blob,
            due,
            firstExposedAt: prev ? prev.firstExposedAt : ev.at,
            mastery: m.ewma,
            coverage: m.instruments.length,
            seenInstruments: m.instruments,
            successDays: m.successDays
          });
        }
        const e = exposureFor(ev.userId, ev.itemId, ev.at);
        e.timesSeen += 1;
        e.lastSeenAt = ev.at;
        e.lastRating = ev.rating;
        const s = sessions.get(ev.sessionId);
        if (s) s.realizedCount += 1;
        break;
      }
      case 'session_start':
        sessions.set(ev.sessionId, {
          id: ev.sessionId,
          userId: ev.userId,
          startedAt: ev.at,
          endedAt: null,
          mode: ev.sessionMode,
          targetAttempts: ev.sessionTargetAttempts,
          realizedCount: 0
        });
        break;
      case 'session_end': {
        const s = sessions.get(ev.sessionId);
        if (s) s.endedAt = ev.at;
        break;
      }
      case 'set_lesson':
        currentLesson = Math.max(1, ev.annotationLesson);
        break;
      case 'star':
        exposureFor(ev.userId, ev.itemId, ev.at).starred = true;
        break;
      case 'unstar':
        exposureFor(ev.userId, ev.itemId, ev.at).starred = false;
        break;
      case 'set_known':
        exposureFor(ev.userId, ev.itemId, ev.at).known = ev.annotationKnown;
        break;
      default: {
        const _exhaustive: never = ev;
        throw new Error(`fold: unhandled event kind ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  return {
    currentLesson,
    ruleStates: [...ruleStates.values()].sort(
      (a, b) => byCodeUnit(a.ruleKey, b.ruleKey) || byCodeUnit(a.direction, b.direction)
    ),
    itemExposures: [...itemExposures.values()].sort((a, b) => byCodeUnit(a.itemId, b.itemId)),
    sessions: [...sessions.values()].sort((a, b) => a.id - b.id)
  };
}

/**
 * Narrow a nullable read-back `ReviewLogRow` to the clean discriminated `ReviewLogEvent`.
 * Throws on a row whose `kind`-required columns are null — surfacing corruption instead of
 * folding garbage. `latency_ms` null maps to `undefined` (the optional event field).
 */
export function rowToEvent(row: ReviewLogRow): ReviewLogEvent {
  const base = { userId: row.userId, at: row.at };
  switch (row.kind) {
    case 'attempt':
      if (
        row.itemId == null || row.ruleKeys == null || row.exerciseTypeKey == null ||
        row.paramKey == null || row.direction == null || row.rating == null ||
        row.assessment == null || row.hintRevealed == null || row.contentHash == null ||
        row.sessionId == null
      ) {
        throw new Error(`malformed attempt row id=${row.id}`);
      }
      return {
        ...base,
        kind: 'attempt',
        sessionId: row.sessionId,
        itemId: row.itemId,
        ruleKeys: row.ruleKeys,
        exerciseTypeKey: row.exerciseTypeKey,
        paramKey: row.paramKey,
        direction: row.direction,
        rating: row.rating,
        assessment: row.assessment,
        hintRevealed: row.hintRevealed,
        latencyMs: row.latencyMs ?? undefined,
        contentHash: row.contentHash
      };
    case 'star':
      if (row.itemId == null) throw new Error(`malformed star row id=${row.id}`);
      return { ...base, kind: 'star', itemId: row.itemId };
    case 'unstar':
      if (row.itemId == null) throw new Error(`malformed unstar row id=${row.id}`);
      return { ...base, kind: 'unstar', itemId: row.itemId };
    case 'set_known':
      if (row.itemId == null || row.annotationKnown == null) throw new Error(`malformed set_known row id=${row.id}`);
      return { ...base, kind: 'set_known', itemId: row.itemId, annotationKnown: row.annotationKnown };
    case 'set_lesson':
      if (row.annotationLesson == null) throw new Error(`malformed set_lesson row id=${row.id}`);
      return { ...base, kind: 'set_lesson', annotationLesson: row.annotationLesson };
    case 'session_start':
      if (row.sessionId == null || row.sessionMode == null || row.sessionTargetAttempts == null) {
        throw new Error(`malformed session_start row id=${row.id}`);
      }
      return { ...base, kind: 'session_start', sessionId: row.sessionId, sessionMode: row.sessionMode, sessionTargetAttempts: row.sessionTargetAttempts };
    case 'session_end':
      if (row.sessionId == null) throw new Error(`malformed session_end row id=${row.id}`);
      return { ...base, kind: 'session_end', sessionId: row.sessionId };
    default:
      throw new Error(`unknown kind "${row.kind}" row id=${row.id}`);
  }
}
