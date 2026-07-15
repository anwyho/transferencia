import { describe, expect, it } from 'vitest';
import { sessionPhase } from './phase';
import type { Instrument } from '../planner/planner';

const inst = (itemId: string): Instrument => ({
  ruleKey: 'R',
  itemId,
  exerciseTypeKey: 'transformation',
  paramKey: '',
  direction: 'en>es'
});

describe('sessionPhase', () => {
  it('main while under budget with a servable head', () => {
    expect(sessionPhase({ realizedCount: 3, targetAttempts: 10, head: inst('a'), redrill: [] })).toEqual({
      kind: 'main',
      pick: inst('a')
    });
  });

  it('main takes precedence over a pending re-drill while under budget', () => {
    expect(
      sessionPhase({ realizedCount: 3, targetAttempts: 10, head: inst('a'), redrill: [inst('m')] })
    ).toEqual({ kind: 'main', pick: inst('a') });
  });

  it('re-drill when the budget is spent and a miss remains', () => {
    expect(
      sessionPhase({ realizedCount: 10, targetAttempts: 10, head: inst('a'), redrill: [inst('m')] })
    ).toEqual({ kind: 'redrill', pick: inst('m') });
  });

  it('re-drill when the plan empties before the budget but a miss remains', () => {
    expect(
      sessionPhase({ realizedCount: 4, targetAttempts: 10, head: null, redrill: [inst('m')] })
    ).toEqual({ kind: 'redrill', pick: inst('m') });
  });

  it('serves the head of the re-drill queue', () => {
    expect(
      sessionPhase({ realizedCount: 10, targetAttempts: 10, head: null, redrill: [inst('m1'), inst('m2')] })
    ).toEqual({ kind: 'redrill', pick: inst('m1') });
  });

  it('complete when the budget is spent and no misses remain', () => {
    expect(
      sessionPhase({ realizedCount: 10, targetAttempts: 10, head: inst('a'), redrill: [] })
    ).toEqual({ kind: 'complete' });
  });

  it('complete when the plan empties before the budget and no misses (light day)', () => {
    expect(sessionPhase({ realizedCount: 2, targetAttempts: 10, head: null, redrill: [] })).toEqual({
      kind: 'complete'
    });
  });

  it('main at one under budget (the gate is <, not <=)', () => {
    expect(
      sessionPhase({ realizedCount: 9, targetAttempts: 10, head: inst('a'), redrill: [] })
    ).toEqual({ kind: 'main', pick: inst('a') });
  });
});
