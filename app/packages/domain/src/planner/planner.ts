import { isVisible } from '../content/lesson-gate';
import { MASTERY_KNOBS } from '../mastery/mastery';
import { DAY_MS } from '../ports/scheduler';
import type { Direction, ExerciseType, Item, RenderContext } from '../exercise/types';
import type { Rule } from '../content/types';
import type { ItemStore } from '../content/store';
import type { ItemExposureRow, RuleStateRow } from '../ports/repository';

/** A concrete render target — the Stage-2 output the practice route renders + grades. */
export interface Instrument {
  ruleKey: string; // Stage-1 selection target ONLY (observability / "why picked") — NOT the credit set; the attempt credits the item's full tested ruleKeys (in the route).
  itemId: string;
  exerciseTypeKey: string;
  paramKey: string; // canonical; '' for transformation
  direction: Direction;
}

/**
 * The Stage-1 priority terms. Typing `weights` as `Record<PriorityTerm, number>` makes a dead /
 * mis-named weight knob a compile error, not a silently un-consumed Monte-Carlo tuning input.
 */
export type PriorityTerm = 'overdue' | 'masteryGap' | 'coverageGap' | 'starred' | 'newness';

/**
 * Everything the pure planner reads. The web route assembles it from repo + store + clock + rng.
 * All fields are `readonly` — the planner only reads ctx (encodes purity; matches ItemStore's
 * readonly convention).
 */
export interface PlannerCtx {
  readonly eligibleRules: readonly Rule[];
  readonly ruleState: (ruleKey: string) => RuleStateRow | undefined;
  readonly exposure: (itemId: string) => ItemExposureRow | undefined;
  readonly store: ItemStore;
  readonly types: readonly ExerciseType[];
  readonly currentLesson: number;
  readonly now: number;
  readonly rng: () => number;
  readonly knobs?: PlannerKnobs;
}

export interface PlannerKnobs {
  weights: Record<PriorityTerm, number>;
  perLessonCap: number;
  perRuleCap: number;
  newRuleCapPerSession: number;
  cooldownMs: number;
  targetAttempts: number;
}

// Monte-Carlo-owned placeholders — NOT tuned (scheduler-sim owns the values; ledger). Terms are
// normalised before weighting: `overdue` = days overdue, gaps/starred/newness in 0..1.
export const PLANNER_KNOBS: PlannerKnobs = {
  weights: { overdue: 1, masteryGap: 2, coverageGap: 1, starred: 3, newness: 1.5 }, // Monte-Carlo-owned
  perLessonCap: 3, // Monte-Carlo-owned
  perRuleCap: 2, // Monte-Carlo-owned
  newRuleCapPerSession: 3, // Monte-Carlo-owned
  cooldownMs: 43_200_000, // 12h — Monte-Carlo-owned
  targetAttempts: 10 // ~10-min budget — Monte-Carlo-owned
};

export interface SessionPlanner {
  planSession(ctx: PlannerCtx, n: number): Instrument[];
}

interface Projected {
  rulePicks: Map<string, number>;
  lessonPicks: Map<number, number>;
  newPicks: number;
  usedDir: Map<string, Set<Direction>>;
  synthSeen: Map<string, number>;
}

function isNew(rule: Rule, ctx: PlannerCtx): boolean {
  return ctx.ruleState(rule.key) === undefined;
}

/**
 * An item is an instrument for a rule only in the `tests` role — a `uses` (foreshadowing) ref earns
 * no mastery credit and must never be drilled as that rule.
 */
function itemTestsRule(item: Item, ruleKey: string): boolean {
  return item.rule_refs.some((ref) => ref.key === ruleKey && ref.role === 'tests');
}

function hasStarredInstrument(rule: Rule, ctx: PlannerCtx): boolean {
  return ctx.store.itemsForRule(rule.key).some(
    (item) =>
      itemTestsRule(item, rule.key) &&
      isVisible(item, ctx.currentLesson) &&
      (ctx.exposure(item.id)?.starred ?? false)
  );
}

/** A rule is a candidate only if it is in some pool: due | weak | new | starred-forced. */
function inPool(rule: Rule, ctx: PlannerCtx): boolean {
  const st = ctx.ruleState(rule.key);
  if (!st) return true; // new
  if (st.due <= ctx.now) return true; // due
  if (st.mastery < MASTERY_KNOBS.mReady) return true; // weak
  return hasStarredInstrument(rule, ctx); // else maintenance unless starred
}

function priority(rule: Rule, ctx: PlannerCtx, k: PlannerKnobs): number {
  const st = ctx.ruleState(rule.key);
  const terms: Record<PriorityTerm, number> = {
    overdue: st ? Math.max(0, ctx.now - st.due) / DAY_MS : 0,
    masteryGap: Math.max(0, MASTERY_KNOBS.mReady - (st?.mastery ?? 0)),
    coverageGap: Math.max(0, MASTERY_KNOBS.K - (st?.coverage ?? 0)) / MASTERY_KNOBS.K,
    starred: hasStarredInstrument(rule, ctx) ? 1 : 0,
    newness: st ? 0 : 1
  };
  return (Object.keys(terms) as PriorityTerm[]).reduce((sum, t) => sum + k.weights[t] * terms[t], 0);
}

function candidateRules(ctx: PlannerCtx, k: PlannerKnobs, p: Projected): Rule[] {
  return ctx.eligibleRules.filter((rule) => {
    if (!inPool(rule, ctx)) return false;
    if ((p.rulePicks.get(rule.key) ?? 0) >= k.perRuleCap) return false;
    if ((p.lessonPicks.get(rule.homeLesson) ?? 0) >= k.perLessonCap) return false;
    // Cap DISTINCT new rules, not new-rule picks: a new rule already STARTED this batch (rulePicks
    // > 0) stays eligible so it can reach perRuleCap in both directions; only brand-new rules are
    // gated once newRuleCapPerSession distinct ones are underway.
    if (isNew(rule, ctx) && (p.rulePicks.get(rule.key) ?? 0) === 0 && p.newPicks >= k.newRuleCapPerSession) {
      return false;
    }
    return true;
  });
}

/** Round-robin: draw from the lesson bucket with the fewest picks so far, then highest priority within. */
function chooseRule(cands: Rule[], ctx: PlannerCtx, k: PlannerKnobs, p: Projected): Rule {
  const lessons = [...new Set(cands.map((r) => r.homeLesson))];
  let bestLesson = lessons[0];
  for (const L of lessons) {
    const pl = p.lessonPicks.get(L) ?? 0;
    const pb = p.lessonPicks.get(bestLesson) ?? 0;
    if (pl < pb || (pl === pb && L < bestLesson)) bestLesson = L;
  }
  const bucket = cands.filter((r) => r.homeLesson === bestLesson);
  let best = bucket[0];
  let bestScore = priority(best, ctx, k) + ctx.rng() * 1e-9; // seeded jitter breaks ties
  for (let i = 1; i < bucket.length; i++) {
    const s = priority(bucket[i], ctx, k) + ctx.rng() * 1e-9;
    if (s > bestScore) {
      best = bucket[i];
      bestScore = s;
    }
  }
  return best;
}

function enumerateInstruments(rule: Rule, ctx: PlannerCtx): Instrument[] {
  const renderCtx: RenderContext = { items: ctx.store, currentLesson: ctx.currentLesson, rng: ctx.rng };
  const out: Instrument[] = [];
  for (const item of ctx.store.itemsForRule(rule.key)) {
    if (!itemTestsRule(item, rule.key) || !isVisible(item, ctx.currentLesson)) continue;
    for (const type of ctx.types) {
      if (!type.supports(item)) continue;
      for (const { key, params } of type.paramEnumerator.paramsFor(item, renderCtx)) {
        // P0: transformation encodes `direction` in its params; a generic direction accessor lands
        // with the 2nd exercise type (P1). This guard turns a future type whose params omit
        // `direction` into a loud error instead of an `undefined` that would poison the mastery
        // coverage key downstream.
        const direction = (params as { direction?: Direction }).direction;
        if (direction !== 'en>es' && direction !== 'es>en') {
          throw new Error(
            `planner: exercise type "${type.stableKey}" yielded param "${key}" without a valid direction for item "${item.id}"`
          );
        }
        out.push({ ruleKey: rule.key, itemId: item.id, exerciseTypeKey: type.stableKey, paramKey: key, direction });
      }
    }
  }
  return out;
}

function pickInstrument(rule: Rule, ctx: PlannerCtx, k: PlannerKnobs, p: Projected): Instrument | null {
  const all = enumerateInstruments(rule, ctx);
  if (all.length === 0) return null;
  const inCooldown = (inst: Instrument): boolean => {
    const e = ctx.exposure(inst.itemId);
    // `timesSeen > 0` guard: a star/unstar/set_known event materializes an exposure row via
    // fold's exposureFor with lastSeenAt = that event's `at` (fold.ts), NOT a drill timestamp.
    // Without this guard, a just-starred-but-never-drilled item reads as "recently seen" and gets
    // excluded here — backwards from the star bias below.
    return e != null && e.timesSeen > 0 && ctx.now - e.lastSeenAt < k.cooldownMs;
  };
  const cooled = all.filter((i) => !inCooldown(i));
  const pool = cooled.length > 0 ? cooled : all; // all in cooldown -> allow (1-instrument flashcard degeneration)
  const usedDirs = p.usedDir.get(rule.key) ?? new Set<Direction>();
  const jitter = new Map<Instrument, number>();
  for (const i of pool) jitter.set(i, ctx.rng());
  const better = (a: Instrument, b: Instrument): number => {
    const ea = ctx.exposure(a.itemId);
    const eb = ctx.exposure(b.itemId);
    const seenA = (ea?.timesSeen ?? 0) + (p.synthSeen.get(a.itemId) ?? 0);
    const seenB = (eb?.timesSeen ?? 0) + (p.synthSeen.get(b.itemId) ?? 0);
    if (seenA !== seenB) return seenA - seenB; // fresher (fewer) first
    const dirA = usedDirs.has(a.direction) ? 1 : 0;
    const dirB = usedDirs.has(b.direction) ? 1 : 0;
    if (dirA !== dirB) return dirA - dirB; // unused direction first
    const starA = ea?.starred ? 1 : 0;
    const starB = eb?.starred ? 1 : 0;
    // Stage-2 star is only a LOW tiebreaker (after freshness + direction rotation). The strong star
    // effect lives in Stage-1 (the starred-forced pool + the `starred` priority weight).
    if (starA !== starB) return starB - starA; // starred first
    const missA = ea?.lastRating === 'again' ? 1 : 0;
    const missB = eb?.lastRating === 'again' ? 1 : 0;
    if (missA !== missB) return missB - missA; // recent-miss first
    return jitter.get(a)! - jitter.get(b)!; // deterministic seeded tie-break
  };
  return [...pool].sort(better)[0];
}

/**
 * Commit one pick to the projected batch state. Centralized so every signal that gates later picks
 * (per-rule / per-lesson caps, distinct-new-rule cap, direction rotation, in-batch freshness) is
 * updated together — a partial update here would silently break a cap or the Stage-2 freshness bias.
 */
function recordPick(p: Projected, rule: Rule, inst: Instrument, ctx: PlannerCtx): void {
  const firstPickOfRule = (p.rulePicks.get(rule.key) ?? 0) === 0;
  p.rulePicks.set(rule.key, (p.rulePicks.get(rule.key) ?? 0) + 1);
  p.lessonPicks.set(rule.homeLesson, (p.lessonPicks.get(rule.homeLesson) ?? 0) + 1);
  if (isNew(rule, ctx) && firstPickOfRule) p.newPicks += 1; // count DISTINCT new rules, not picks
  const dirs = p.usedDir.get(rule.key) ?? new Set<Direction>();
  dirs.add(inst.direction);
  p.usedDir.set(rule.key, dirs);
  p.synthSeen.set(inst.itemId, (p.synthSeen.get(inst.itemId) ?? 0) + 1);
}

/**
 * Deterministic 2-stage session plan (design D.1). Simulates up to `n` picks against an in-batch
 * projected copy of the mutable signals so caps / round-robin / cooldown hold across the batch
 * without touching persisted state. Pure/isomorphic; all randomness via the injected `ctx.rng`.
 *
 * The result length is best-effort ≤ `n`: it may be shorter when the eligible pool / caps are
 * exhausted (a valid caught-up or empty state). Should-never-happen states — a rule with no gated
 * instrument, degenerate knobs, or the iteration backstop — throw rather than silently truncate.
 */
export function planSession(ctx: PlannerCtx, n: number): Instrument[] {
  const k = ctx.knobs ?? PLANNER_KNOBS;
  if (
    k.perRuleCap < 1 ||
    k.perLessonCap < 1 ||
    k.newRuleCapPerSession < 1 ||
    k.cooldownMs < 0 ||
    // A NaN/Infinity weight (reachable via the Monte-Carlo weight sweep) would silently poison
    // every priority score and corrupt Stage-1 ordering — reject it like the degenerate caps.
    !Object.values(k.weights).every(Number.isFinite)
  ) {
    throw new Error(
      `planner: invalid PlannerKnobs (caps >=1, cooldownMs >=0, finite weights): ${JSON.stringify(k)}`
    );
  }
  const p: Projected = {
    rulePicks: new Map(),
    lessonPicks: new Map(),
    newPicks: 0,
    usedDir: new Map(),
    synthSeen: new Map()
  };
  const plan: Instrument[] = [];
  // Backstop only: each iteration now either pushes an instrument or breaks (an empty candidate pool
  // breaks; a 0-instrument rule throws), so ≤ n iterations are actually needed. The generous bound
  // guards against a future refactor that could loop without progressing.
  const maxIter = n * (ctx.eligibleRules.length + 3);
  let guard = 0;
  let guardTripped = false;
  while (plan.length < n) {
    if (guard++ >= maxIter) {
      guardTripped = true;
      break;
    }
    const cands = candidateRules(ctx, k, p);
    if (cands.length === 0) break; // legitimate: pool / caps exhausted (caught-up state)
    const rule = chooseRule(cands, ctx, k, p);
    const inst = pickInstrument(rule, ctx, k, p);
    if (inst == null) {
      throw new Error(
        `planner: eligible rule "${rule.key}" enumerated 0 instruments at lesson ${ctx.currentLesson} — ` +
          `broken invariant (ungated caller, lesson-dependent enumerator, or content regression)`
      );
    }
    plan.push(inst);
    recordPick(p, rule, inst, ctx);
  }
  if (guardTripped) {
    throw new Error(
      `planner: iteration guard tripped (${guard}/${maxIter}) with ${plan.length}/${n} instruments — exclusion invariant broken`
    );
  }
  return plan;
}

export const sessionPlanner: SessionPlanner = { planSession };
