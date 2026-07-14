import { describe, expect, it } from 'vitest';
import { buildContentStore } from '../content/store';
import { transformationType } from '../exercise/transformation';
import type { Item } from '../exercise/types';
import type { Rule } from '../content/types';
import type { ItemExposureRow, RuleStateRow } from '../ports/repository';
import { seededRng } from './rng';
import { planSession, PLANNER_KNOBS, type PlannerCtx } from './planner';

const rule = (key: string, homeLesson: number): Rule => ({
  key,
  kind: 'transformation',
  homeLesson,
  bundle: 'b',
  importance: 1,
  schedulable: true
});
const item = (id: string, ruleKey: string, min_lesson: number, directions: Item['directions'] = ['en>es']): Item => ({
  id,
  kind: 'transformation',
  front_en: id,
  back_es: id + '-es',
  min_lesson,
  directions,
  rule_refs: [{ key: ruleKey, role: 'tests' }],
  tier: 'primary'
});

const RULES = [rule('R2', 2), rule('R3', 3)];
const ITEMS = [item('a', 'R2', 2), item('b', 'R2', 2), item('c', 'R3', 3), item('d', 'R3', 3)];
const store = buildContentStore(RULES, ITEMS, [transformationType]);

function ctx(over: Partial<PlannerCtx> = {}): PlannerCtx {
  return {
    eligibleRules: [...store.schedulableRules()],
    ruleState: () => undefined, // all new by default
    exposure: () => undefined,
    store,
    types: [transformationType],
    currentLesson: 5,
    now: 1_000_000,
    rng: seededRng(1),
    ...over
  };
}

const rs = (over: Partial<RuleStateRow>): RuleStateRow => ({
  userId: 'u1', ruleKey: 'R2', direction: 'both', blob: {}, due: 0, firstExposedAt: 0,
  mastery: 0, coverage: 0, seenInstruments: [], successDays: [], ...over
});
const exp = (over: Partial<ItemExposureRow>): ItemExposureRow => ({
  userId: 'u1', itemId: 'a', timesSeen: 0, lastSeenAt: 0, lastRating: null, known: false, starred: false, ...over
});

describe('planSession — Stage 1 (rule selection)', () => {
  it('is deterministic for a fixed seed', () => {
    expect(planSession(ctx({ rng: seededRng(7) }), 4)).toEqual(planSession(ctx({ rng: seededRng(7) }), 4));
  });

  it('spreads across lesson buckets via round-robin (not all one lesson)', () => {
    const plan = planSession(ctx(), 4);
    expect(new Set(plan.map((i) => store.getRule(i.ruleKey)!.homeLesson)).size).toBe(2);
  });

  it('honors perRuleCap across the batch', () => {
    const plan = planSession(ctx(), 10);
    const per = new Map<string, number>();
    for (const i of plan) per.set(i.ruleKey, (per.get(i.ruleKey) ?? 0) + 1);
    for (const c of per.values()) expect(c).toBeLessThanOrEqual(PLANNER_KNOBS.perRuleCap);
  });

  it('excludes a mastered, not-due, unstarred rule (maintenance) from the pool', () => {
    const mastered = rs({ ruleKey: 'R2', due: 2_000_000, mastery: 0.99, coverage: 99 });
    const plan = planSession(ctx({ ruleState: (k) => (k === 'R2' ? mastered : undefined) }), 4);
    expect(plan.every((i) => i.ruleKey === 'R3')).toBe(true);
  });

  it('prioritizes a due rule over a fresh new rule (priority, not lesson order, decides)', () => {
    // Both rules share homeLesson 2 so the round-robin bucket is identical — priority alone decides.
    // The due rule is strongly overdue (~10 days) so its `overdue` term dominates newness regardless
    // of the exact mReady/K knob values.
    const sameLesson = buildContentStore(
      [rule('Rdue', 2), rule('Rnew', 2)],
      [item('a', 'Rdue', 2), item('b', 'Rnew', 2)],
      [transformationType]
    );
    const due = rs({ ruleKey: 'Rdue', due: 1_000_000 - 10 * 86_400_000, mastery: 0.2 });
    const plan = planSession(
      ctx({
        eligibleRules: [...sameLesson.schedulableRules()],
        store: sameLesson,
        ruleState: (k) => (k === 'Rdue' ? due : undefined)
      }),
      1
    );
    expect(plan[0].ruleKey).toBe('Rdue');
  });

  it('caps DISTINCT new rules (not picks): started rules reach perRuleCap with direction rotation', () => {
    // 6 fresh rules, one per homeLesson 2..7, each a single item drillable in BOTH directions.
    // The buggy pick-counting cap stopped after ~newRuleCapPerSession one-direction picks; the
    // distinct-rule cap must instead let started rules drill to perRuleCap in both directions.
    const lessons = [2, 3, 4, 5, 6, 7];
    const rules6 = lessons.map((L) => rule('Rr' + L, L));
    const items6 = lessons.map((L) => item('i' + L, 'Rr' + L, L, ['en>es', 'es>en']));
    const store6 = buildContentStore(rules6, items6, [transformationType]);
    const plan = planSession(
      ctx({ eligibleRules: [...store6.schedulableRules()], store: store6, currentLesson: 10 }),
      10
    );
    // cap respected: exactly newRuleCapPerSession DISTINCT rules started.
    expect(new Set(plan.map((i) => i.ruleKey)).size).toBe(PLANNER_KNOBS.newRuleCapPerSession);
    // bug fixed: each started rule drilled to perRuleCap (not stranded at 1 pick).
    expect(plan.length).toBe(PLANNER_KNOBS.newRuleCapPerSession * PLANNER_KNOBS.perRuleCap);
    // rotation restored: each selected rule shows BOTH directions.
    const byRule = new Map<string, Set<string>>();
    for (const i of plan) {
      const dirs = byRule.get(i.ruleKey) ?? new Set<string>();
      dirs.add(i.direction);
      byRule.set(i.ruleKey, dirs);
    }
    for (const dirs of byRule.values()) expect(dirs.size).toBe(2);
  });
});

describe('planSession — Stage 2 (instrument selection)', () => {
  it('cools out a recently-seen instrument (cooldown exclusion)', () => {
    const exposures = new Map([['a', exp({ itemId: 'a', timesSeen: 50, lastSeenAt: 1 })]]);
    const plan = planSession(ctx({ eligibleRules: [store.getRule('R2')!], exposure: (id) => exposures.get(id) }), 1);
    expect(plan[0].itemId).toBe('b');
  });

  it('prefers a fresher instrument when both are outside cooldown', () => {
    const now = 200_000_000; // now - lastSeenAt(1) >> 12h cooldown => neither is cooled out
    const exposures = new Map([
      ['a', exp({ itemId: 'a', timesSeen: 50, lastSeenAt: 1 })],
      ['b', exp({ itemId: 'b', timesSeen: 1, lastSeenAt: 1 })]
    ]);
    const plan = planSession(ctx({ eligibleRules: [store.getRule('R2')!], exposure: (id) => exposures.get(id), now }), 1);
    expect(plan[0].itemId).toBe('b');
  });

  it('rotates direction within a rule across the session', () => {
    const twoDir = buildContentStore([rule('R2', 2)], [item('a', 'R2', 2, ['en>es', 'es>en'])], [transformationType]);
    const plan = planSession(ctx({ eligibleRules: [twoDir.getRule('R2')!], store: twoDir }), 2);
    expect(new Set(plan.map((i) => i.direction)).size).toBe(2);
  });

  it('biases toward a starred item', () => {
    const exposures = new Map([['b', exp({ itemId: 'b', starred: true })]]);
    const plan = planSession(ctx({ eligibleRules: [store.getRule('R2')!], exposure: (id) => exposures.get(id) }), 1);
    expect(plan[0].itemId).toBe('b');
  });

  it('serves the sole instrument even when all are in cooldown (degeneration fallback)', () => {
    const solo = buildContentStore([rule('R1', 2)], [item('solo', 'R1', 2)], [transformationType]);
    const exposures = new Map([['solo', exp({ itemId: 'solo', timesSeen: 1, lastSeenAt: 1_000_000 - 1000 })]]);
    const plan = planSession(
      ctx({ eligibleRules: [solo.getRule('R1')!], store: solo, exposure: (id) => exposures.get(id) }),
      1
    );
    expect(plan.length).toBe(1);
    expect(plan[0].itemId).toBe('solo');
  });

  it('biases toward a recent-miss instrument (equal freshness, same direction)', () => {
    const now = 200_000_000; // both outside cooldown; equal timesSeen => the miss tiebreak decides
    const exposures = new Map([
      ['a', exp({ itemId: 'a', timesSeen: 1, lastSeenAt: 1, lastRating: 'again' })],
      ['b', exp({ itemId: 'b', timesSeen: 1, lastSeenAt: 1, lastRating: null })]
    ]);
    const plan = planSession(ctx({ eligibleRules: [store.getRule('R2')!], exposure: (id) => exposures.get(id), now }), 1);
    expect(plan[0].itemId).toBe('a');
  });
});

describe('planSession — fail-loud invariants', () => {
  it('throws when an eligible rule enumerates 0 instruments (gated-out item)', () => {
    // The rule's only item has min_lesson above currentLesson, so it is gated out at plan time and
    // the rule enumerates 0 instruments — a broken caller invariant that must fail loud, not skip.
    const gated = buildContentStore([rule('Rg', 2)], [item('g', 'Rg', 2)], [transformationType]);
    expect(() =>
      planSession(ctx({ eligibleRules: [gated.getRule('Rg')!], store: gated, currentLesson: 1 }), 1)
    ).toThrow(/enumerated 0 instruments/);
  });

  it('throws on degenerate PlannerKnobs (cap < 1)', () => {
    expect(() => planSession(ctx({ knobs: { ...PLANNER_KNOBS, perRuleCap: 0 } }), 5)).toThrow(/invalid PlannerKnobs/);
  });

  it('throws on a non-finite priority weight (Monte-Carlo sweep guard)', () => {
    // A NaN/Infinity weight is reachable via the weight sweep (the primary tuning target). Left
    // unguarded it silently produces NaN priorities and corrupts Stage-1 ordering — must fail loud.
    const knobs = { ...PLANNER_KNOBS, weights: { ...PLANNER_KNOBS.weights, overdue: NaN } };
    expect(() => planSession(ctx({ knobs }), 5)).toThrow(/invalid PlannerKnobs/);
  });
});
