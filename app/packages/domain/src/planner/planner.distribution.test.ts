import { describe, expect, it } from 'vitest';
import { buildContentStore } from '../content/store';
import { transformationType } from '../exercise/transformation';
import type { Item } from '../exercise/types';
import type { Rule } from '../content/types';
import type { ItemExposureRow, RuleStateRow } from '../ports/repository';
import { MASTERY_KNOBS } from '../mastery/mastery';
import { seededRng } from './rng';
import { planSession, PLANNER_KNOBS, type PlannerCtx } from './planner';

/**
 * Seeded distribution property harness for the planner — the regression guardrail the Monte-Carlo
 * experiment reuses. It exercises the NEW-USER FIRST-SESSION corner (all-new pool, no prior
 * exposure/cooldown) plus targeted star / cap scenarios, asserting: the per-rule/per-lesson caps
 * and no-in-session-repeat HARD invariants; that the sampler actually varies across seeds (a dead
 * RNG must fail); the exact first-session budget/spread binding derived from the knobs; the strong
 * Stage-1 star rescue and the star-is-not-a-gate-override design intent; and that perLessonCap
 * genuinely binds.
 *
 * DEFERRED to the Monte-Carlo work (needs a simulated-learner state generator that mixes
 * due/weak/mastered rule states across many days — out of scope for this all-new harness):
 *   - "a due rule is never skipped" + due/weak/new selection-fraction bounds;
 *   - full statistical shape over N seeds x M days (chi-square / entropy / max-min balance);
 *   - longitudinal starvation + new-rule-introduction-rate guarantees;
 *   - the cooldown-repeat scenario (the all-in-cooldown 1-instrument degeneration — see the
 *     no-repeat test comment below).
 */

const RULES: Rule[] = [2, 3, 4, 5].map((L) => ({
  key: `R${L}`, kind: 'transformation', homeLesson: L, bundle: 'b', importance: 1, schedulable: true
}));
const ITEMS: Item[] = RULES.flatMap((r) =>
  ['x', 'y'].map((s) => ({
    id: `${r.key}-${s}`,
    kind: 'transformation' as const,
    front_en: `${r.key}-${s}`,
    back_es: `${r.key}-${s}-es`,
    min_lesson: r.homeLesson,
    directions: ['en>es', 'es>en'] as Item['directions'],
    rule_refs: [{ key: r.key, role: 'tests' as const }],
    tier: 'primary' as const
  }))
);
const store = buildContentStore(RULES, ITEMS, [transformationType]);

const baseCtx = (seed: number): PlannerCtx => ({
  eligibleRules: [...store.schedulableRules()],
  ruleState: () => undefined, // all new
  exposure: () => undefined,
  store,
  types: [transformationType],
  currentLesson: 6,
  now: 1_000_000,
  rng: seededRng(seed)
});

const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

// ---- helpers for the bespoke star / cap scenario stores ----
const mkRule = (key: string, homeLesson: number): Rule => ({
  key, kind: 'transformation', homeLesson, bundle: 'b', importance: 1, schedulable: true
});
const mkItem = (
  id: string,
  ruleKey: string,
  minLesson: number,
  directions: Item['directions'] = ['en>es', 'es>en']
): Item => ({
  id, kind: 'transformation', front_en: id, back_es: `${id}-es`, min_lesson: minLesson,
  directions, rule_refs: [{ key: ruleKey, role: 'tests' }], tier: 'primary'
});
// A mastered + not-due rule state: excluded from the pool as maintenance UNLESS a star rescues it.
const masteredRow = (ruleKey: string): RuleStateRow => ({
  userId: 'u1', ruleKey, direction: 'both', blob: {},
  due: 5_000_000, // > baseCtx.now (1_000_000): not due
  firstExposedAt: 0,
  mastery: 1, // >= MASTERY_KNOBS.mReady: not weak
  coverage: MASTERY_KNOBS.K, // >= K: fully covered
  seenInstruments: [], successDays: []
});
// timesSeen:0 => the cooldown guard (timesSeen > 0) never fires, so the star is not cooled out.
const starredExposure = (itemId: string): ItemExposureRow => ({
  userId: 'u1', itemId, timesSeen: 0, lastSeenAt: 0, lastRating: null, known: false, starred: true
});

describe('planner distribution invariants (seeded, over many sessions)', () => {
  it('HARD: never exceeds perRuleCap or perLessonCap in any session', () => {
    for (const seed of SEEDS) {
      const plan = planSession(baseCtx(seed), PLANNER_KNOBS.targetAttempts);
      const perRule = new Map<string, number>();
      const perLesson = new Map<number, number>();
      for (const inst of plan) {
        perRule.set(inst.ruleKey, (perRule.get(inst.ruleKey) ?? 0) + 1);
        const L = store.getRule(inst.ruleKey)!.homeLesson;
        perLesson.set(L, (perLesson.get(L) ?? 0) + 1);
      }
      for (const c of perRule.values()) expect(c).toBeLessThanOrEqual(PLANNER_KNOBS.perRuleCap);
      for (const c of perLesson.values()) expect(c).toBeLessThanOrEqual(PLANNER_KNOBS.perLessonCap);
    }
  });

  it('HARD: never repeats the exact same instrument within a session', () => {
    // Holds for this all-new first-session harness. The ONE documented exception is the
    // all-in-cooldown 1-instrument degeneration (pickInstrument's `pool = cooled.length > 0 ?
    // cooled : all` fallback), which can only re-serve an instrument once EVERY instrument for a
    // rule is inside cooldown — a state that needs prior exposure + cooldown, i.e. the MC-era
    // simulated learner. Deliberately not exercised here; see the DEFERRED note at the top.
    for (const seed of SEEDS) {
      const plan = planSession(baseCtx(seed), PLANNER_KNOBS.targetAttempts);
      const keys = plan.map((i) => `${i.itemId}|${i.direction}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('HARD: plans vary across seeds — a dead/constant RNG must fail', () => {
    // The whole point of a *seeded* distribution harness: the sampler must actually vary. If every
    // seed produced the identical plan (dead/constant RNG, or the Stage jitter got dropped), every
    // other assertion here would be a single-sample coincidence rather than a distribution property.
    // Baseline is ~21/25 distinct; a constant rng collapses the set to size 1 and fails this.
    const plans = SEEDS.map((seed) =>
      JSON.stringify(planSession(baseCtx(seed), PLANNER_KNOBS.targetAttempts))
    );
    expect(new Set(plans).size).toBeGreaterThan(1);
  });

  it('SOFT: spreads across multiple lessons (no single-lesson bombarding)', () => {
    // Soft floor kept for readability; the EXACT, knob-derived binding lives in the next test.
    for (const seed of SEEDS) {
      const plan = planSession(baseCtx(seed), PLANNER_KNOBS.targetAttempts);
      expect(new Set(plan.map((i) => store.getRule(i.ruleKey)!.homeLesson)).size).toBeGreaterThanOrEqual(3);
    }
  });

  it('HARD: first-session budget + spread bind to knobs, clamped to content capacity (all-new pool)', () => {
    // The all-new 4-rule pool (lessons 2,3,4,5) is throttled to a deterministic, seed-invariant SHAPE
    // (only WHICH instrument fills each slot varies by seed; the variance test covers that). To stay
    // correct for MC reuse, expectations are CLAMPED to what this content can actually supply — a knob
    // sweep beyond content capacity must NOT false-fail a correct planner:
    //   distinct rules  = min(newRuleCapPerSession, #rules)
    //   picks per rule  = min(perRuleCap, instruments per rule)
    //   total picks     = min(distinctRules * picksPerRule, targetAttempts)
    // At the default knobs these are still 3 / 3 / 6, so the strict `toBe` retains full teeth (it
    // catches the distinct-new-rule cap regressing either UP or down).
    const knobs = PLANNER_KNOBS; // swap here (as the MC sweep will) and expectations + planner follow together
    const instrumentsPerRule = Math.min(
      ...RULES.map((r) => store.itemsForRule(r.key).reduce((n, it) => n + it.directions.length, 0))
    );
    const expectedDistinctRules = Math.min(knobs.newRuleCapPerSession, RULES.length);
    const expectedPerRule = Math.min(knobs.perRuleCap, instrumentsPerRule);
    const expectedLength = Math.min(expectedDistinctRules * expectedPerRule, knobs.targetAttempts);
    for (const seed of SEEDS) {
      const plan = planSession({ ...baseCtx(seed), knobs }, knobs.targetAttempts);
      expect(new Set(plan.map((i) => i.ruleKey)).size).toBe(expectedDistinctRules);
      expect(new Set(plan.map((i) => store.getRule(i.ruleKey)!.homeLesson)).size).toBe(expectedDistinctRules);
      expect(plan.length).toBe(expectedLength);
    }
  });

  it('HARD: perLessonCap binds when two rules share a lesson (clamped to combined per-rule capacity)', () => {
    // Two all-new rules on the SAME homeLesson. A lesson's pick count is bounded by BOTH the lesson
    // cap AND the rules' combined per-rule capacity = ruleCount * min(perRuleCap, instruments/rule).
    // Expecting the min() of the two keeps this correct under ANY knobs: at the default knobs the
    // lesson cap is the binding side (min(3, 2*2) = 3), so deleting the perLessonCap gate would yield
    // 4 != 3 and this fails (teeth); under a sweep with perLessonCap >= combined capacity it
    // correctly expects the per-rule-bound value instead of false-failing a correct planner.
    const lessonStore = buildContentStore(
      [mkRule('La', 2), mkRule('Lb', 2)],
      [
        mkItem('La-1', 'La', 2), mkItem('La-2', 'La', 2),
        mkItem('Lb-1', 'Lb', 2), mkItem('Lb-2', 'Lb', 2)
      ],
      [transformationType]
    );
    const knobs = PLANNER_KNOBS; // swap here (as the MC sweep will) and expectation + planner follow together
    const rulesOnLesson = ['La', 'Lb'];
    const perRuleInstruments = Math.min(
      ...rulesOnLesson.map((k) => lessonStore.itemsForRule(k).reduce((n, it) => n + it.directions.length, 0))
    );
    const expectedOnLesson2 = Math.min(
      knobs.perLessonCap,
      rulesOnLesson.length * Math.min(knobs.perRuleCap, perRuleInstruments)
    );
    const plan = planSession(
      {
        eligibleRules: [...lessonStore.schedulableRules()],
        ruleState: () => undefined, // all new
        exposure: () => undefined,
        store: lessonStore,
        types: [transformationType],
        currentLesson: 6,
        now: 1_000_000,
        rng: seededRng(1),
        knobs
      },
      knobs.targetAttempts
    );
    const onLesson2 = plan.filter((i) => lessonStore.getRule(i.ruleKey)!.homeLesson === 2).length;
    expect(onLesson2).toBe(expectedOnLesson2);
  });

  it('HARD: Stage-1 star RESCUE — a starred maintenance rule is drilled, its unstarred sibling is not', () => {
    // Two rules at the SAME homeLesson, BOTH mastered + not-due => both normally EXCLUDED from the
    // pool as maintenance. Only `Rstar` owns a starred tested item. inPool's hasStarredInstrument
    // rescue must pull `Rstar` back in and leave `Rplain` out — proving the STRONG Stage-1 star
    // effect (the starred-forced pool), distinct from the weak Stage-2 tiebreak. Teeth: flipping the
    // star to false drops `Rstar` from the pool too and the plan goes empty (some(...) => false).
    const rescueStore = buildContentStore(
      [mkRule('Rstar', 2), mkRule('Rplain', 2)],
      [mkItem('Rstar-i', 'Rstar', 2), mkItem('Rplain-i', 'Rplain', 2)],
      [transformationType]
    );
    const plan = planSession(
      {
        eligibleRules: [...rescueStore.schedulableRules()],
        ruleState: (key) => masteredRow(key), // both mastered + not-due
        exposure: (id) => (id === 'Rstar-i' ? starredExposure('Rstar-i') : undefined),
        store: rescueStore,
        types: [transformationType],
        currentLesson: 6,
        now: 1_000_000,
        rng: seededRng(1)
      },
      PLANNER_KNOBS.targetAttempts
    );
    expect(plan.some((i) => i.ruleKey === 'Rstar')).toBe(true);
    expect(plan.every((i) => i.ruleKey !== 'Rplain')).toBe(true);
  });

  it('star does NOT override the new-rule throttle (locks design intent — not a bug)', () => {
    // Reuse the all-new 4-rule pool but STAR an item of R5 — the rule the distinct-new-rule cap
    // excludes (round-robin fills lessons 2,3,4 first, so newPicks reaches newRuleCapPerSession
    // before lesson 5 is ever drawn). A star boosts Stage-1 priority and rescues maintenance rules,
    // but it is NOT a bypass of newRuleCapPerSession: R5 must still be throttled out of a first
    // session. Assert rule-scoped (no R5 instrument admitted, not just R5-x) so it catches admission
    // regardless of which R5 instrument Stage-2 would serve. If this ever flips to admit R5, that is
    // a real regression in the new-rule throttle — do NOT relax this assertion to make it pass.
    const starred = new Map([['R5-x', starredExposure('R5-x')]]);
    for (const seed of SEEDS.slice(0, 10)) {
      const plan = planSession(
        { ...baseCtx(seed), exposure: (id) => starred.get(id) },
        PLANNER_KNOBS.targetAttempts
      );
      expect(plan.every((i) => i.ruleKey !== 'R5')).toBe(true);
    }
  });
});
