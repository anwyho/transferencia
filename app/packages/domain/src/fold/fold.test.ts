import { describe, expect, it } from 'vitest';
import { DAY_MS, trivialScheduler } from '../ports/scheduler';
import type { AttemptEvent, ReviewLogEvent, ReviewLogRow } from '../ports/review-log';
import { fold, rowToEvent } from './fold';

function attemptEv(over: Partial<AttemptEvent> = {}): AttemptEvent {
  return {
    kind: 'attempt',
    userId: 'u1',
    at: 1000,
    sessionId: 1,
    itemId: 'it1',
    ruleKeys: ['R1'],
    exerciseTypeKey: 'transformation',
    paramKey: '',
    direction: 'en>es',
    rating: 'good',
    assessment: { correct: true },
    hintRevealed: false,
    contentHash: 'h',
    ...over
  };
}

describe('fold (C.2a)', () => {
  it('empty log folds to the initial state', () => {
    expect(fold([], { scheduler: trivialScheduler })).toEqual({
      currentLesson: 1,
      ruleStates: [],
      itemExposures: [],
      sessions: []
    });
  });

  it('an attempt creates rule_state, exposure, and bumps the session', () => {
    const events: ReviewLogEvent[] = [
      { kind: 'session_start', userId: 'u1', at: 1000, sessionId: 1, sessionMode: 'practice', sessionTargetAttempts: 10 },
      attemptEv({ at: 1000, sessionId: 1 })
    ];
    const st = fold(events, { scheduler: trivialScheduler });
    expect(st.ruleStates).toHaveLength(1);
    expect(st.ruleStates[0]).toEqual({
      userId: 'u1',
      ruleKey: 'R1',
      direction: 'both',
      blob: { last: 1000 },
      due: 1000 + DAY_MS,
      firstExposedAt: 1000
    });
    expect(st.itemExposures[0]).toMatchObject({ itemId: 'it1', timesSeen: 1, lastSeenAt: 1000, lastRating: 'good', known: false, starred: false });
    expect(st.sessions[0]).toMatchObject({ id: 1, startedAt: 1000, endedAt: null, mode: 'practice', targetAttempts: 10, realizedCount: 1 });
  });

  it('a second attempt on the same rule keeps firstExposedAt, moves due, counts exposure', () => {
    const st = fold([attemptEv({ at: 1000 }), attemptEv({ at: 2000, rating: 'again' })], { scheduler: trivialScheduler });
    expect(st.ruleStates).toHaveLength(1);
    expect(st.ruleStates[0].firstExposedAt).toBe(1000);
    expect(st.ruleStates[0].due).toBe(2000 + DAY_MS);
    expect(st.itemExposures[0].timesSeen).toBe(2);
    expect(st.itemExposures[0].lastRating).toBe('again');
  });

  it('set_lesson is last-wins and floors at 1', () => {
    expect(fold([{ kind: 'set_lesson', userId: 'u1', at: 1, annotationLesson: 5 }], { scheduler: trivialScheduler }).currentLesson).toBe(5);
    expect(fold([
      { kind: 'set_lesson', userId: 'u1', at: 1, annotationLesson: 5 },
      { kind: 'set_lesson', userId: 'u1', at: 2, annotationLesson: 3 }
    ], { scheduler: trivialScheduler }).currentLesson).toBe(3);
    expect(fold([{ kind: 'set_lesson', userId: 'u1', at: 1, annotationLesson: 0 }], { scheduler: trivialScheduler }).currentLesson).toBe(1);
  });

  it('session_end sets endedAt; realized_count counts attempts under the session', () => {
    const st = fold([
      { kind: 'session_start', userId: 'u1', at: 1000, sessionId: 1, sessionMode: 'practice', sessionTargetAttempts: 10 },
      attemptEv({ at: 1100, sessionId: 1 }),
      attemptEv({ at: 1200, sessionId: 1, itemId: 'it2' }),
      { kind: 'session_end', userId: 'u1', at: 2000, sessionId: 1 }
    ], { scheduler: trivialScheduler });
    expect(st.sessions[0]).toMatchObject({ id: 1, startedAt: 1000, endedAt: 2000, realizedCount: 2 });
  });

  it('keyRemap collapses two raw keys onto one rule_state, folded in order', () => {
    const st = fold(
      [attemptEv({ at: 1000, ruleKeys: ['old-a'] }), attemptEv({ at: 2000, ruleKeys: ['old-b'] })],
      { scheduler: trivialScheduler, keyRemap: (k) => (k === 'old-a' || k === 'old-b' ? 'new' : k) }
    );
    expect(st.ruleStates).toHaveLength(1);
    expect(st.ruleStates[0].ruleKey).toBe('new');
    expect(st.ruleStates[0].firstExposedAt).toBe(1000);
    expect(st.ruleStates[0].due).toBe(2000 + DAY_MS);
  });

  it('star / set_known / unstar set exposure flags (create-if-missing, no lastSeenAt bump)', () => {
    const st = fold([
      { kind: 'star', userId: 'u1', at: 1000, itemId: 'it1' },
      { kind: 'set_known', userId: 'u1', at: 1100, itemId: 'it1', annotationKnown: true },
      { kind: 'unstar', userId: 'u1', at: 1200, itemId: 'it1' }
    ], { scheduler: trivialScheduler });
    expect(st.itemExposures[0]).toEqual({
      userId: 'u1', itemId: 'it1', timesSeen: 0, lastSeenAt: 1000, lastRating: null, known: true, starred: false
    });
  });

  it('rowToEvent narrows a valid attempt row and throws on a malformed one', () => {
    const row: ReviewLogRow = {
      id: 1, userId: 'u1', at: 1000, kind: 'attempt', itemId: 'it1', ruleKeys: ['R1'],
      exerciseTypeKey: 'transformation', paramKey: '', direction: 'en>es', rating: 'good',
      assessment: { correct: true }, hintRevealed: false, latencyMs: null, contentHash: 'h',
      sessionId: 1, annotationKnown: null, annotationLesson: null, sessionMode: null, sessionTargetAttempts: null
    };
    expect(rowToEvent(row)).toMatchObject({ kind: 'attempt', itemId: 'it1', ruleKeys: ['R1'], rating: 'good', latencyMs: undefined });
    expect(() => rowToEvent({ ...row, rating: null })).toThrow(/malformed attempt/);
  });

  it('rowToEvent throws when any kind is missing a required column', () => {
    const baseRow: ReviewLogRow = {
      id: 7, userId: 'u1', at: 1000, kind: 'attempt', itemId: null, ruleKeys: null,
      exerciseTypeKey: null, paramKey: null, direction: null, rating: null, assessment: null,
      hintRevealed: null, latencyMs: null, contentHash: null, sessionId: null,
      annotationKnown: null, annotationLesson: null, sessionMode: null, sessionTargetAttempts: null
    };
    const cases: Array<[string, ReviewLogRow]> = [
      ['star', { ...baseRow, kind: 'star', itemId: null }],
      ['unstar', { ...baseRow, kind: 'unstar', itemId: null }],
      ['set_known', { ...baseRow, kind: 'set_known', itemId: 'it1', annotationKnown: null }],
      ['set_lesson', { ...baseRow, kind: 'set_lesson', annotationLesson: null }],
      ['session_start', { ...baseRow, kind: 'session_start', sessionId: 1, sessionMode: null, sessionTargetAttempts: 10 }],
      ['session_end', { ...baseRow, kind: 'session_end', sessionId: null }]
    ];
    for (const [kind, row] of cases) {
      expect(() => rowToEvent(row), kind).toThrow(new RegExp(`malformed ${kind}`));
    }
  });

  it('walks events as given (does not re-sort) — caller owns (at, id) order', () => {
    const st = fold([attemptEv({ at: 2000, rating: 'again' }), attemptEv({ at: 1000, rating: 'good' })], {
      scheduler: trivialScheduler
    });
    expect(st.ruleStates[0].due).toBe(1000 + DAY_MS);
    expect(st.ruleStates[0].firstExposedAt).toBe(2000);
  });
});
