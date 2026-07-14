# Slice D.1 — star + SessionPlanner + 2-stage core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder "serve the first gated item" with a real 2-stage `SessionPlanner` that consumes the C.2c mastery meter (advisory priority, never a gate) plus due/exposure/star, and land the item-level **star** affordance (writer + UI + priority effect).

**Architecture:** A pure, deterministic, isomorphic `planSession(ctx, n) -> Instrument[]` in `@lt/domain` (Stage-1 picks rules by priority with round-robin-across-lessons + caps; Stage-2 picks the instrument by freshness/direction-rotation/cooldown/star/miss bias). Randomness is an injected seeded PRNG (no `Math.random` in the domain). The live practice route recomputes the plan from current persisted state each load and serves the head (greedy; no plan persistence). Star is exposure-only (append `star`/`unstar` event + upsert `item_exposure.starred`, one txn — the fold already interprets it).

**Tech Stack:** TypeScript, `@lt/domain` (isomorphic, M9-clean), SvelteKit (`@lt/web`), Drizzle + better-sqlite3, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-14-slice-d1-planner-star-design.md` (read it; this plan implements it). **No DB migration** in D.1.

**Conventions:**
- Run from `app/`. Single-file unit run: `pnpm --filter @lt/domain exec vitest run <relpath>` (or `@lt/web`). `pnpm test -- <file>` does NOT filter — don't use it.
- Full gates from `app/`: `pnpm lint`, `pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:e2e`.
- **Stage by explicit path — never `git add -A`** (a co-agent works `cards/` in the shared main tree). Use `trash`, never `rm`.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
  ```

---

## File Structure

**Create (domain):**
- `app/packages/domain/src/planner/rng.ts` — `seededRng(seed)` (mulberry32).
- `app/packages/domain/src/planner/rng.test.ts`
- `app/packages/domain/src/planner/planner.ts` — `Instrument`, `PlannerCtx`, `PlannerKnobs`, `PLANNER_KNOBS`, `SessionPlanner`, `planSession`, `sessionPlanner`.
- `app/packages/domain/src/planner/planner.test.ts`
- `app/packages/domain/src/planner/planner.distribution.test.ts`
- `app/packages/domain/src/planner/index.ts`

**Create (web):**
- `app/packages/web/src/lib/server/planner-ctx.ts` — assemble a `PlannerCtx` from repo + store (shared by practice + inspector).
- `app/packages/web/e2e/planner-star.e2e.ts`

**Modify (domain):**
- `app/packages/domain/src/index.ts` — export the planner module.
- `app/packages/domain/src/ports/repository.ts` — add `StarInput` + `star`/`unstar` to `ReviewRepository`.
- `app/packages/domain/src/ports/index.ts` — export `StarInput`.

**Modify (web):**
- `app/packages/web/src/lib/server/db/repo.ts` — implement `star`/`unstar`.
- `app/packages/web/src/lib/server/db/repo.test.ts` — star writer + fold parity.
- `app/packages/web/src/routes/+page.server.ts` — planner-driven `load` + `star`/`unstar` actions.
- `app/packages/web/src/routes/+page.svelte` — star toggle.
- `app/packages/web/src/routes/inspector/+page.server.ts` — planned-queue preview (fixed seed) + starred-items list.
- `app/packages/web/src/routes/inspector/+page.svelte` — planned-queue rows + starred list.
- `app/packages/web/e2e/practice.e2e.ts` — **rework** to planner-invariant assertions.
- `app/packages/web/e2e/persistence.e2e.ts` — **rework**: don't assume the served item; assert the scheduling spine on rule `L2#conv-al` (the only eligible rule at lesson 2).
- `app/packages/web/e2e/mastery.e2e.ts` — **rework**: the planner rotates instruments (Stage-2 freshness), so assert the meter is displayed + climbs, not "coverage stays 1 via the same instrument."

> **Why the e2e rework:** D.1 replaces the practice route's "serve `eligibleItems[0]`" placeholder with seeded planner selection, so *which* instrument is served is no longer fixed. Three C.1/C.2c e2e hardcoded the placeholder's item; they are reworked to assert planner **invariants** (a prompt is served; grading/reveal work; a rule schedules + comes due; the meter climbs). `inspector.e2e.ts` is unaffected (its eligible-queue panel is unchanged; the planner adds a *new* planned-queue panel).

---

## Task 1: Seeded PRNG (`@lt/domain/src/planner/rng.ts`)

**Files:** Create `rng.ts`, `rng.test.ts`.

- [ ] **Step 1: Write the failing test** — `app/packages/domain/src/planner/rng.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { seededRng } from './rng';

describe('seededRng (mulberry32)', () => {
  it('is deterministic: same seed -> same sequence', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    expect([a(), a(), a(), a()]).toEqual([b(), b(), b(), b()]);
  });

  it('different seeds diverge', () => {
    const a = seededRng(1);
    const b = seededRng(2);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('stays in [0, 1)', () => {
    const r = seededRng(123);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lt/domain exec vitest run src/planner/rng.test.ts`
Expected: FAIL — `Cannot find module './rng'`.

- [ ] **Step 3: Implement** — `app/packages/domain/src/planner/rng.ts`

```ts
/**
 * Deterministic seeded PRNG (mulberry32). The domain must never call `Math.random` (report M9
 * + determinism: the fold/replay/distribution proofs require reproducible output). Callers inject
 * a seed; the web route seeds it per-session from the sessionId so a session's plan is reproducible.
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @lt/domain exec vitest run src/planner/rng.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/packages/domain/src/planner/rng.ts app/packages/domain/src/planner/rng.test.ts
git commit -F - <<'EOF'
feat(domain): seeded PRNG (mulberry32) for the planner (#15)

Deterministic injected randomness; keeps the domain free of Math.random (M9 + reproducible plans).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 2: The pure planner (`@lt/domain/src/planner/planner.ts`)

**Files:** Create `planner.ts`, `planner.test.ts`, `index.ts`; modify `app/packages/domain/src/index.ts`.

**Context:** Uses `eligibleRules`/`isVisible` (content), `MASTERY_KNOBS` (the meter's own `mReady`/`K`, reused so "weak"/"coverage gap" stay consistent with `masteryReady`), `DAY_MS`, and the `ExerciseType`/`Rule`/`ItemStore`/`RuleStateRow`/`ItemExposureRow` types. Pure/isomorphic. `Instrument.ruleKey` is the Stage-1 target only; the attempt still credits the item's full tested `ruleKeys` (that stays in the route).

- [ ] **Step 1: Write the failing tests** — `app/packages/domain/src/planner/planner.test.ts`

```ts
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

  it('prioritizes a due rule over a fresh new rule', () => {
    const due = rs({ ruleKey: 'R2', due: 0, mastery: 0.2 });
    const plan = planSession(ctx({ ruleState: (k) => (k === 'R2' ? due : undefined) }), 1);
    expect(plan[0].ruleKey).toBe('R2');
  });
});

describe('planSession — Stage 2 (instrument selection)', () => {
  it('prefers a fresher (lower times_seen) instrument', () => {
    const exposures = new Map([['a', exp({ itemId: 'a', timesSeen: 50, lastSeenAt: 1 })]]);
    const plan = planSession(ctx({ eligibleRules: [store.getRule('R2')!], exposure: (id) => exposures.get(id) }), 1);
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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lt/domain exec vitest run src/planner/planner.test.ts`
Expected: FAIL — `Cannot find module './planner'`.

- [ ] **Step 3: Implement the planner** — `app/packages/domain/src/planner/planner.ts`

```ts
import { isVisible } from '../content/lesson-gate';
import { MASTERY_KNOBS } from '../mastery/mastery';
import { DAY_MS } from '../ports/scheduler';
import type { Direction, ExerciseType, RenderContext } from '../exercise/types';
import type { Rule } from '../content/types';
import type { ItemStore } from '../content/store';
import type { ItemExposureRow, RuleStateRow } from '../ports/repository';

/** A concrete render target — the Stage-2 output the practice route renders + grades. */
export interface Instrument {
  ruleKey: string; // the Stage-1 target rule (attribution / "why picked")
  itemId: string;
  exerciseTypeKey: string;
  paramKey: string; // canonical; '' for transformation
  direction: Direction;
}

/** Everything the pure planner reads. The web route assembles it from repo + store + clock + rng. */
export interface PlannerCtx {
  eligibleRules: Rule[];
  ruleState: (ruleKey: string) => RuleStateRow | undefined;
  exposure: (itemId: string) => ItemExposureRow | undefined;
  store: ItemStore;
  types: ExerciseType[];
  currentLesson: number;
  now: number;
  rng: () => number;
  knobs?: PlannerKnobs;
}

export interface PlannerKnobs {
  weights: { overdue: number; masteryGap: number; coverageGap: number; starred: number; newness: number };
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

function hasStarredInstrument(rule: Rule, ctx: PlannerCtx): boolean {
  return ctx.store.itemsForRule(rule.key).some((item) => {
    const tests = item.rule_refs.some((r) => r.key === rule.key && r.role === 'tests');
    return tests && isVisible(item, ctx.currentLesson) && (ctx.exposure(item.id)?.starred ?? false);
  });
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
  const overdue = st ? Math.max(0, ctx.now - st.due) / DAY_MS : 0;
  const mastery = st ? st.mastery : 0;
  const coverage = st ? st.coverage : 0;
  const masteryGap = Math.max(0, MASTERY_KNOBS.mReady - mastery);
  const coverageGap = Math.max(0, MASTERY_KNOBS.K - coverage) / MASTERY_KNOBS.K;
  const starred = hasStarredInstrument(rule, ctx) ? 1 : 0;
  const newness = st ? 0 : 1;
  const w = k.weights;
  return (
    w.overdue * overdue +
    w.masteryGap * masteryGap +
    w.coverageGap * coverageGap +
    w.starred * starred +
    w.newness * newness
  );
}

function candidateRules(ctx: PlannerCtx, k: PlannerKnobs, p: Projected): Rule[] {
  return ctx.eligibleRules.filter((rule) => {
    if (!inPool(rule, ctx)) return false;
    if ((p.rulePicks.get(rule.key) ?? 0) >= k.perRuleCap) return false;
    if ((p.lessonPicks.get(rule.homeLesson) ?? 0) >= k.perLessonCap) return false;
    if (isNew(rule, ctx) && p.newPicks >= k.newRuleCapPerSession) return false;
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
    const tests = item.rule_refs.some((r) => r.key === rule.key && r.role === 'tests');
    if (!tests || !isVisible(item, ctx.currentLesson)) continue;
    for (const type of ctx.types) {
      if (!type.supports(item)) continue;
      for (const { key, params } of type.paramEnumerator.paramsFor(item, renderCtx)) {
        // P0: transformation encodes `direction` in its params; a generic direction accessor lands
        // with the 2nd exercise type (P1). One registered type today, so this cast is sound.
        const direction = (params as { direction: Direction }).direction;
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
    return e != null && ctx.now - e.lastSeenAt < k.cooldownMs;
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
    if (starA !== starB) return starB - starA; // starred first
    const missA = ea?.lastRating === 'again' ? 1 : 0;
    const missB = eb?.lastRating === 'again' ? 1 : 0;
    if (missA !== missB) return missB - missA; // recent-miss first
    return jitter.get(a)! - jitter.get(b)!; // deterministic seeded tie-break
  };
  return [...pool].sort(better)[0];
}

/**
 * Deterministic 2-stage session plan (design D.1). Simulates up to `n` picks against an in-batch
 * projected copy of the mutable signals so caps / round-robin / cooldown hold across the batch
 * without touching persisted state. Pure/isomorphic; all randomness via the injected `ctx.rng`.
 */
export function planSession(ctx: PlannerCtx, n: number): Instrument[] {
  const k = ctx.knobs ?? PLANNER_KNOBS;
  const p: Projected = {
    rulePicks: new Map(),
    lessonPicks: new Map(),
    newPicks: 0,
    usedDir: new Map(),
    synthSeen: new Map()
  };
  const plan: Instrument[] = [];
  let guard = 0;
  const maxIter = n * (ctx.eligibleRules.length + 2) + n;
  while (plan.length < n && guard++ < maxIter) {
    const cands = candidateRules(ctx, k, p);
    if (cands.length === 0) break;
    const rule = chooseRule(cands, ctx, k, p);
    const inst = pickInstrument(rule, ctx, k, p);
    if (inst == null) {
      p.rulePicks.set(rule.key, k.perRuleCap); // defensive: exclude a rule with no gated instrument
      continue;
    }
    plan.push(inst);
    p.rulePicks.set(rule.key, (p.rulePicks.get(rule.key) ?? 0) + 1);
    p.lessonPicks.set(rule.homeLesson, (p.lessonPicks.get(rule.homeLesson) ?? 0) + 1);
    if (isNew(rule, ctx)) p.newPicks += 1;
    const dirs = p.usedDir.get(rule.key) ?? new Set<Direction>();
    dirs.add(inst.direction);
    p.usedDir.set(rule.key, dirs);
    p.synthSeen.set(inst.itemId, (p.synthSeen.get(inst.itemId) ?? 0) + 1);
  }
  return plan;
}

export const sessionPlanner: SessionPlanner = { planSession };
```

- [ ] **Step 4: Write the module index** — `app/packages/domain/src/planner/index.ts`

```ts
export { planSession, sessionPlanner, PLANNER_KNOBS } from './planner';
export type { Instrument, PlannerCtx, PlannerKnobs, SessionPlanner } from './planner';
export { seededRng } from './rng';
```

- [ ] **Step 5: Export from the domain entrypoint** — `app/packages/domain/src/index.ts`

Add at the end (after the `./mastery/index` export):

```ts
// Slice D.1: the 2-stage SessionPlanner (consumes the meter advisorily) + seeded PRNG.
export * from './planner/index';
```

- [ ] **Step 6: Run tests + check + lint**

Run: `pnpm --filter @lt/domain exec vitest run src/planner/planner.test.ts` → Expected: PASS.
Run: `pnpm --filter @lt/domain run check && pnpm --filter @lt/domain run lint` → Expected: PASS (M9-clean).

- [ ] **Step 7: Commit**

```bash
git add app/packages/domain/src/planner/planner.ts app/packages/domain/src/planner/planner.test.ts app/packages/domain/src/planner/index.ts app/packages/domain/src/index.ts
git commit -F - <<'EOF'
feat(domain): 2-stage SessionPlanner core (priority + round-robin + Stage-2 instrument) (#15)

Pure planSession(ctx,n): Stage-1 pools (due/weak/new/starred) scored by priority (overdue,
mastery_gap, coverage_gap, star, newness — Monte-Carlo-owned weights), round-robin across
lessons + caps; Stage-2 by freshness/direction-rotation/cooldown/star/miss. Advisory meter
consumed, never a gate; due never the sole driver. Deterministic via injected seed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 3: Star writer (`repo.star` / `repo.unstar`)

**Files:** Modify `ports/repository.ts`, `ports/index.ts`, `db/repo.ts`, `db/repo.test.ts`.

- [ ] **Step 1: Write the failing test** — append inside the top `describe('DrizzleReviewRepository (C.1 integration)', ...)` block in `app/packages/web/src/lib/server/db/repo.test.ts`

```ts
	it('star/unstar writes the event and folds identically to item_exposure', () => {
		env.repo.star({ userId: 'u1', itemId: 'al-annual', at: t });
		expect(env.repo.itemExposure('u1', 'al-annual')?.starred).toBe(true);
		expect(env.repo.events('u1').find((e) => e.kind === 'star')?.itemId).toBe('al-annual');
		const st = fold(env.repo.events('u1').map(rowToEvent), { scheduler: trivialScheduler });
		expect(st.itemExposures).toEqual(env.repo.itemExposures('u1'));

		env.repo.unstar({ userId: 'u1', itemId: 'al-annual', at: t + 1 });
		expect(env.repo.itemExposure('u1', 'al-annual')?.starred).toBe(false);
		const st2 = fold(env.repo.events('u1').map(rowToEvent), { scheduler: trivialScheduler });
		expect(st2.itemExposures).toEqual(env.repo.itemExposures('u1'));
	});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lt/web exec vitest run src/lib/server/db/repo.test.ts`
Expected: FAIL — `env.repo.star is not a function`.

- [ ] **Step 3: Add the port** — `app/packages/domain/src/ports/repository.ts`

(a) After the `SetLessonInput` interface, add:

```ts
/** Payload for star/unstar (item-level). `at` from the caller's Clock. */
export interface StarInput {
  userId: string;
  itemId: string;
  at: number;
}
```

(b) In `ReviewRepository`, after the `rebuild(...)` line, add:

```ts
  /** Star/unstar an item: append the event + upsert item_exposure.starred (exposure-only, no due). */
  star(i: StarInput): void;
  unstar(i: StarInput): void;
```

- [ ] **Step 4: Export the type** — `app/packages/domain/src/ports/index.ts`

Add `StarInput` to the `repository` type export list:

```ts
export type {
  AttemptInput,
  ItemExposureRow,
  ReviewRepository,
  RuleStateRow,
  SessionEndInput,
  SessionRow,
  SessionStartInput,
  SetLessonInput,
  StarInput
} from './repository';
```

- [ ] **Step 5: Implement** — `app/packages/web/src/lib/server/db/repo.ts`

(a) Add `type StarInput` to the `@lt/domain` import block (with the other `type` imports, keep alphabetical near `SetLessonInput`):

```ts
	type SetLessonInput,
	type StarInput
} from '@lt/domain';
```

(b) Add the methods at the end of `DrizzleReviewRepository` (after `rebuild`, before the class closing brace):

```ts
	star(i: StarInput): void {
		this.setStarred(i, true, 'star');
	}

	unstar(i: StarInput): void {
		this.setStarred(i, false, 'unstar');
	}

	/** One txn: append the star/unstar event + upsert item_exposure.starred. Create-if-missing
	 *  mirrors the fold (timesSeen 0, lastSeenAt = at) so the star write path folds identically. */
	private setStarred(i: StarInput, starred: boolean, kind: 'star' | 'unstar'): void {
		this.db.transaction((tx) => {
			tx.insert(reviewLog).values({ userId: i.userId, at: i.at, kind, itemId: i.itemId }).run();
			const exp = tx
				.select()
				.from(itemExposure)
				.where(and(eq(itemExposure.userId, i.userId), eq(itemExposure.itemId, i.itemId)))
				.get();
			tx.insert(itemExposure)
				.values({
					userId: i.userId,
					itemId: i.itemId,
					timesSeen: exp?.timesSeen ?? 0,
					lastSeenAt: exp?.lastSeenAt ?? i.at,
					lastRating: exp?.lastRating ?? null,
					known: exp?.known ?? false,
					starred
				})
				.onConflictDoUpdate({ target: [itemExposure.userId, itemExposure.itemId], set: { starred } })
				.run();
		});
	}
```

- [ ] **Step 6: Run tests + check**

Run: `pnpm --filter @lt/web exec vitest run src/lib/server/db/repo.test.ts` → Expected: PASS.
Run: `pnpm check` → Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/packages/domain/src/ports/repository.ts app/packages/domain/src/ports/index.ts app/packages/web/src/lib/server/db/repo.ts app/packages/web/src/lib/server/db/repo.test.ts
git commit -F - <<'EOF'
feat: star/unstar writer (event + item_exposure.starred, folds identically) (#15)

Exposure-only (no due/scheduler touch); create-if-missing mirrors the fold so the write path
and fold agree. The fold already interpreted star/unstar (C.2a); D.1 lands the writer.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 4: Planner-driven practice route + star toggle (+ rework the placeholder-coupled e2e)

**Files:** Create `app/packages/web/src/lib/server/planner-ctx.ts`; rewrite `app/packages/web/src/routes/+page.server.ts`; modify `+page.svelte`; **rework** `e2e/practice.e2e.ts`, `e2e/persistence.e2e.ts`, `e2e/mastery.e2e.ts`.

**Context:** The route change makes practice serve a seeded planner pick instead of `eligibleItems[0]`. The three existing e2e assumed the placeholder always serves `al-annual`; they are reworked to planner-invariant assertions. Do the implementation (Steps 1–3) first, then rework the e2e (Steps 4–6), then verify (Step 7).

- [ ] **Step 1: Shared PlannerCtx builder** — `app/packages/web/src/lib/server/planner-ctx.ts`

```ts
import { eligibleRules, transformationType, type ItemStore, type PlannerCtx } from '@lt/domain';
import type { DrizzleReviewRepository } from './db/repo';

/**
 * Assemble a PlannerCtx from the repo + content store (shared by the practice + inspector routes).
 * The caller supplies `rng` (per-session seed live; a fixed seed for the deterministic inspector
 * preview). Rule/exposure lookups are Map-backed snapshots of the user's current projection.
 */
export function buildPlannerCtx(
	store: ItemStore,
	repo: DrizzleReviewRepository,
	userId: string,
	now: number,
	rng: () => number
): PlannerCtx {
	const currentLesson = repo.currentLesson(userId);
	const ruleStates = new Map(repo.ruleStates(userId).map((r) => [r.ruleKey, r]));
	const exposures = new Map(repo.itemExposures(userId).map((e) => [e.itemId, e]));
	return {
		eligibleRules: [...eligibleRules(store, currentLesson)],
		ruleState: (k) => ruleStates.get(k),
		exposure: (id) => exposures.get(id),
		store,
		types: [transformationType],
		currentLesson,
		now,
		rng
	};
}
```

- [ ] **Step 2: Rewrite the practice loader + add star actions** — replace all of `app/packages/web/src/routes/+page.server.ts` with:

```ts
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	planSession,
	PLANNER_KNOBS,
	ratingFromAssessment,
	seededRng,
	transformationType,
	type Direction
} from '@lt/domain';
import { contentStore } from '$lib/server/content-loader';
import { getRepo } from '$lib/server/db';
import { buildPlannerCtx } from '$lib/server/planner-ctx';
import { webClock } from '$lib/server/clock';

/**
 * Repo-backed practice (slice D.1). `load` opens a session, builds a PlannerCtx from the user's
 * current projection, and serves the HEAD of a deterministic planSession (greedy — no plan
 * persistence; the pre-committed/resumable plan is P1). `submit` grades + appendAttempt (crediting
 * the item's full tested rules). `star`/`unstar` toggle the current item.
 */
export const load: PageServerLoad = ({ locals }) => {
	const store = contentStore();
	const repo = getRepo();
	const userId = locals.user.id;
	const now = webClock.now();
	const currentLesson = repo.currentLesson(userId);
	const { sessionId } = repo.startSession({
		userId,
		mode: 'practice',
		targetAttempts: PLANNER_KNOBS.targetAttempts,
		at: now
	});
	const ctx = buildPlannerCtx(store, repo, userId, now, seededRng(sessionId));
	const pick = planSession(ctx, PLANNER_KNOBS.targetAttempts)[0];
	if (!pick) {
		return { sessionId, itemId: null, direction: null, prompt: null, hint: null, starred: false };
	}
	const item = store.get(pick.itemId)!;
	const renderCtx = { items: store, currentLesson, rng: seededRng(sessionId) };
	const prompt = transformationType.promptRenderer.render(item, { direction: pick.direction }, renderCtx);
	return {
		sessionId,
		itemId: item.id,
		direction: pick.direction,
		prompt,
		hint: item.hint ?? null,
		starred: repo.itemExposure(userId, item.id)?.starred ?? false
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const data = await request.formData();
		const sessionId = Number(data.get('sessionId'));
		const itemId = String(data.get('itemId') ?? '');
		const answer = String(data.get('answer') ?? '');
		const hintRevealed = data.get('hintRevealed') === 'true';
		const direction = String(data.get('direction') ?? 'en>es') as Direction;

		const store = contentStore();
		const item = store.get(itemId);
		if (!item || Number.isNaN(sessionId)) return fail(400, { error: 'unknown item or session' });

		const grade = transformationType.grader.grade(
			item,
			{ direction },
			{ modality: 'text', text: answer },
			{ items: store }
		);
		const rating = ratingFromAssessment(grade, { hintRevealed });

		const ruleKeys = item.rule_refs
			.filter((r) => r.role === 'tests' && (store.getRule(r.key)?.schedulable ?? false))
			.map((r) => r.key);

		getRepo().appendAttempt({
			userId: locals.user.id,
			sessionId,
			itemId,
			ruleKeys,
			exerciseTypeKey: 'transformation',
			paramKey: '',
			direction,
			rating,
			assessment: grade,
			hintRevealed,
			contentHash: item.content_hash ?? ''
		});

		return {
			verdict: grade.correct ? 'correct' : 'incorrect',
			detail: grade.detail ?? null,
			rating,
			answer,
			correctAnswer: item.back_es,
			hintRevealed
		};
	},

	star: async ({ request, locals }) => {
		const itemId = String((await request.formData()).get('itemId') ?? '');
		if (itemId) getRepo().star({ userId: locals.user.id, itemId, at: webClock.now() });
	},

	unstar: async ({ request, locals }) => {
		const itemId = String((await request.formData()).get('itemId') ?? '');
		if (itemId) getRepo().unstar({ userId: locals.user.id, itemId, at: webClock.now() });
	}
};
```

- [ ] **Step 3: Add the star toggle** — `app/packages/web/src/routes/+page.svelte`

After the `answer-form` `</form>` (before the `{:else}`), add:

```svelte
			<form method="POST" action={data.starred ? '?/unstar' : '?/star'} data-testid="star-form">
				<input type="hidden" name="itemId" value={data.itemId} />
				<button type="submit" data-testid="star-toggle" aria-pressed={data.starred}>
					{data.starred ? '★ starred' : '☆ star'}
				</button>
			</form>
```

- [ ] **Step 4: Rework** `app/packages/web/e2e/practice.e2e.ts` — replace the whole file:

```ts
import { expect, test, type Page } from '@playwright/test';

// D.1: practice is planner-driven — the served instrument is planner-chosen (seeded), so assert
// INVARIANTS (a prompt is served; grading + reveal work; the star toggle is present), not a
// specific item. (The placeholder's given='annual' assertions no longer hold.)
async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}

test('empty practice at lesson 1 (no eligible rule)', async ({ page }) => {
	await setLesson(page, 1);
	await page.goto('/');
	await expect(page.getByTestId('no-item')).toBeVisible();
});

test('planner serves a prompt; a wrong answer grades incorrect and reveals the answer', async ({ page }) => {
	await setLesson(page, 5);
	await page.goto('/');
	await expect(page.getByTestId('instruction')).toBeVisible();
	await expect(page.getByTestId('given')).toBeVisible();
	await page.getByTestId('answer-input').fill('zzzzz-not-a-word');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toHaveText('incorrect');
	await expect(page.getByTestId('rating')).toHaveText('again');
	await expect(page.getByTestId('reveal')).not.toBeEmpty();
});

test('the star toggle is present and clickable on the served item', async ({ page }) => {
	await setLesson(page, 5);
	await page.goto('/');
	await expect(page.getByTestId('star-toggle')).toBeVisible();
	await page.getByTestId('star-toggle').click();
	await expect(page.getByTestId('given')).toBeVisible(); // page still functional after starring
});
```

- [ ] **Step 5: Rework** `app/packages/web/e2e/persistence.e2e.ts` — replace the whole file:

```ts
import { expect, test, type Page } from '@playwright/test';

// D.1: practice is planner-driven; at lesson 2 the only eligible rule is L2#conv-al, so whatever
// instrument the planner serves credits that rule. Assert the persistence spine (attempt -> rule
// scheduled -> survives reload -> comes due after the clock advances) without assuming the item.
const ROW = '[data-testid="rule-state-row"][data-rule-key="L2#conv-al"]';

async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}
async function clock(page: Page, body: Record<string, unknown>) {
	const res = await page.request.post('/__test__/clock', { data: body });
	expect(res.ok()).toBeTruthy();
}

test('an attempt persists, survives reload, and comes due after advancing the clock', async ({ page }) => {
	await clock(page, { action: 'reset' });
	await setLesson(page, 2);

	await page.goto('/');
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toBeVisible(); // graded (correct or not)

	await page.goto('/inspector');
	await expect(page.locator(ROW)).toHaveCount(1);
	await expect(page.locator(ROW).getByTestId('rule-due-now')).toHaveText('false');

	await page.goto('/');
	await page.goto('/inspector');
	await expect(page.locator(ROW)).toHaveCount(1);

	const dueAt = Number(await page.locator(ROW).getByTestId('rule-due-at').textContent());
	await clock(page, { action: 'set', epoch: dueAt + 1000 });
	await page.goto('/inspector');
	await expect(page.locator(ROW).getByTestId('rule-due-now')).toHaveText('true');
});
```

- [ ] **Step 6: Rework** `app/packages/web/e2e/mastery.e2e.ts` — replace the whole file:

```ts
import { expect, test, type Page } from '@playwright/test';

// D.1: at lesson 2 the planner serves instruments of the single eligible rule L2#conv-al, rotating
// items (Stage-2 freshness). Assert the meter is displayed and climbs as attempts accrue — not the
// C.2c "coverage stays 1 via the same instrument" (the planner deliberately varies instruments).
const ROW = '[data-testid="rule-state-row"][data-rule-key="L2#conv-al"]';

async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}
async function attempt(page: Page) {
	await page.goto('/');
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toBeVisible();
}
async function meter(page: Page): Promise<{ mastery: number; coverage: number }> {
	await page.goto('/inspector');
	return {
		mastery: Number(await page.locator(ROW).getByTestId('rule-mastery').textContent()),
		coverage: Number(await page.locator(ROW).getByTestId('rule-coverage').textContent())
	};
}

test('inspector shows the mastery meter climbing as attempts accrue', async ({ page }) => {
	await page.request.post('/__test__/clock', { data: { action: 'reset' } });
	await setLesson(page, 2);

	await attempt(page);
	const a = await meter(page);
	expect(a.coverage).toBeGreaterThanOrEqual(1);

	await attempt(page);
	const b = await meter(page);
	expect(b.mastery).toBeGreaterThan(0);
	expect(b.coverage).toBeGreaterThanOrEqual(a.coverage); // climbs (varied instruments) or holds
});
```

- [ ] **Step 7: Run the reworked e2e + check + lint**

Run: `pnpm --filter @lt/web exec playwright test practice.e2e.ts persistence.e2e.ts mastery.e2e.ts inspector.e2e.ts`
Expected: PASS (inspector.e2e unchanged + still green; the three reworked files green).
Run: `pnpm check && pnpm --filter @lt/web run lint` → Expected: PASS (run `prettier --write` on touched files if flagged).

- [ ] **Step 8: Commit**

```bash
git add app/packages/web/src/lib/server/planner-ctx.ts app/packages/web/src/routes/+page.server.ts app/packages/web/src/routes/+page.svelte app/packages/web/e2e/practice.e2e.ts app/packages/web/e2e/persistence.e2e.ts app/packages/web/e2e/mastery.e2e.ts
git commit -F - <<'EOF'
feat(web): planner-driven practice + star toggle; rework placeholder-coupled e2e (#15)

Practice load serves the greedy head of a deterministic planSession (per-session seed, no plan
persistence) instead of the first-eligible placeholder; star/unstar actions + toggle; targetAttempts
from PLANNER_KNOBS. The practice/persistence/mastery e2e are reworked to planner-invariant
assertions (the placeholder's fixed-item assumptions no longer hold).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 5: Inspector planned-queue preview + starred-items list + planner-star e2e

**Files:** Modify `app/packages/web/src/routes/inspector/+page.server.ts`, `+page.svelte`; create `app/packages/web/e2e/planner-star.e2e.ts`.

- [ ] **Step 1: Extend the inspector loader** — `app/packages/web/src/routes/inspector/+page.server.ts`

(a) Extend the `@lt/domain` import (currently `import { eligibleItems, eligibleRules, masteryReady } from '@lt/domain';`):

```ts
import { eligibleItems, eligibleRules, masteryReady, planSession, PLANNER_KNOBS, seededRng } from '@lt/domain';
```

(b) Add the ctx-builder import (below the existing `$lib/server/...` imports):

```ts
import { buildPlannerCtx } from '$lib/server/planner-ctx';
```

(c) In the returned object of `load`, after `scheduledRules: ...`, add:

```ts
		// Deterministic planner preview (fixed seed) — the planned session at the current state.
		plannedQueue: planSession(
			buildPlannerCtx(store, repo, locals.user.id, now, seededRng(1)),
			PLANNER_KNOBS.targetAttempts
		).map((inst) => ({ ruleKey: inst.ruleKey, itemId: inst.itemId, direction: inst.direction })),
		// Starred items (deterministic star-persistence surface for e2e + observability).
		starredItems: repo
			.itemExposures(locals.user.id)
			.filter((e) => e.starred)
			.map((e) => e.itemId)
```

- [ ] **Step 2: Render the panels** — `app/packages/web/src/routes/inspector/+page.svelte`

Before the closing `</main>`, add:

```svelte
	<section data-testid="planned-queue" aria-label="planned session">
		<p>planned attempts: <span data-testid="planned-count">{data.plannedQueue.length}</span></p>
		<ol data-testid="planned-list">
			{#each data.plannedQueue as p, i (i)}
				<li data-testid="planned-item" data-rule-key={p.ruleKey} data-item-id={p.itemId}>
					<span data-testid="plan-rule">{p.ruleKey}</span>
					<span data-testid="plan-item">{p.itemId}</span>
					<span data-testid="plan-direction">{p.direction}</span>
				</li>
			{/each}
		</ol>
	</section>

	<section data-testid="starred" aria-label="starred items">
		<p>starred: <span data-testid="starred-count">{data.starredItems.length}</span></p>
		<ul data-testid="starred-list">
			{#each data.starredItems as id (id)}
				<li data-testid="starred-item" data-item-id={id}>{id}</li>
			{/each}
		</ul>
	</section>
```

- [ ] **Step 3: Create the e2e** — `app/packages/web/e2e/planner-star.e2e.ts`

```ts
import { expect, test, type Page } from '@playwright/test';

async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}

test('inspector planned-queue lists a spread of planned instruments (deterministic)', async ({ page }) => {
	await setLesson(page, 5);
	await page.goto('/inspector');
	await expect(page.getByTestId('planned-list')).toBeVisible();
	expect(Number(await page.getByTestId('planned-count').textContent())).toBeGreaterThan(1);
	const distinctRules = await page
		.locator('[data-testid="planned-item"]')
		.evaluateAll((els) => new Set(els.map((e) => e.getAttribute('data-rule-key'))).size);
	expect(distinctRules).toBeGreaterThanOrEqual(2); // spread across lessons/rules, not one bombarded
});

test('starring the practice item shows it in the inspector starred list (persisted)', async ({ page }) => {
	await setLesson(page, 5);
	await page.goto('/');
	const itemId = await page.getByTestId('star-form').locator('input[name="itemId"]').inputValue();
	await page.getByTestId('star-toggle').click();
	await page.goto('/inspector');
	await expect(page.locator(`[data-testid="starred-item"][data-item-id="${itemId}"]`)).toHaveCount(1);
});
```

- [ ] **Step 4: Run the e2e + check + lint**

Run: `pnpm --filter @lt/web exec playwright test planner-star.e2e.ts` → Expected: PASS.
Run: `pnpm check && pnpm --filter @lt/web run lint` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/packages/web/src/routes/inspector/+page.server.ts app/packages/web/src/routes/inspector/+page.svelte app/packages/web/e2e/planner-star.e2e.ts
git commit -F - <<'EOF'
feat(web): inspector planned-queue preview + starred list + planner/star e2e (#15)

Deterministic fixed-seed planSession preview (inspectable/assertable) + a starred-items list
(deterministic star-persistence surface). e2e: planned queue spreads across rules; starring a
practice item surfaces it in the starred list.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 6: Distribution property tests (seeded harness)

**Files:** Create `app/packages/domain/src/planner/planner.distribution.test.ts`. Pure test addition (planner already works) — the guardrail the Monte Carlo will reuse.

- [ ] **Step 1: Write the tests** — `app/packages/domain/src/planner/planner.distribution.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { buildContentStore } from '../content/store';
import { transformationType } from '../exercise/transformation';
import type { Item } from '../exercise/types';
import type { Rule } from '../content/types';
import type { ItemExposureRow } from '../ports/repository';
import { seededRng } from './rng';
import { planSession, PLANNER_KNOBS, type PlannerCtx } from './planner';

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
    for (const seed of SEEDS) {
      const plan = planSession(baseCtx(seed), PLANNER_KNOBS.targetAttempts);
      const keys = plan.map((i) => `${i.itemId}|${i.direction}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('SOFT: spreads across multiple lessons (no single-lesson bombarding)', () => {
    for (const seed of SEEDS) {
      const plan = planSession(baseCtx(seed), PLANNER_KNOBS.targetAttempts);
      expect(new Set(plan.map((i) => store.getRule(i.ruleKey)!.homeLesson)).size).toBeGreaterThanOrEqual(3);
    }
  });

  it('a starred item is always included when present', () => {
    const star: ItemExposureRow = {
      userId: 'u1', itemId: 'R4-x', timesSeen: 0, lastSeenAt: 0, lastRating: null, known: false, starred: true
    };
    const starred = new Map([['R4-x', star]]);
    for (const seed of SEEDS.slice(0, 10)) {
      const plan = planSession({ ...baseCtx(seed), exposure: (id) => starred.get(id) }, PLANNER_KNOBS.targetAttempts);
      expect(plan.some((i) => i.itemId === 'R4-x')).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `pnpm --filter @lt/domain exec vitest run src/planner/planner.distribution.test.ts`
Expected: PASS. If any HARD invariant fails for a seed, that is a real planner bug — stop and report (do not weaken the assertion).

- [ ] **Step 3: Commit**

```bash
git add app/packages/domain/src/planner/planner.distribution.test.ts
git commit -F - <<'EOF'
test(domain): planner distribution invariants (seeded harness) (#15)

Hard invariants (caps, no in-session instrument repeat) + soft bounds (lesson spread, starred
inclusion) over 25 seeds. The regression guardrail the Monte Carlo experiment reuses.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 7: Full gate + Playwright MCP walkthrough (verification, per AGENTS.md)

**No new files.** Evidence-before-claims over the whole slice.

- [ ] **Step 1: Full automated gate** (from `app/`)

```bash
pnpm lint
pnpm check
pnpm build
pnpm test
pnpm test:e2e
```
Expected: all green. Capture unit counts (domain + web) and e2e count; the new `rng`/`planner`/`planner.distribution` domain suites + `planner-star.e2e.ts` should appear, and the reworked practice/persistence/mastery e2e should pass.

- [ ] **Step 2: M9 boundary + tripwire**

Confirm `pnpm --filter @lt/web exec vitest run src/lib/server/m9-boundary.test.ts` passes (planner + rng are pure domain — no node/persistence/svelte leaked).

- [ ] **Step 3: Playwright MCP walkthrough of the real built UI**

```bash
cd app/packages/web && LT_TEST_CONTROL=1 LT_DB_PATH=:memory: pnpm build && LT_TEST_CONTROL=1 LT_DB_PATH=:memory: pnpm preview --port 4173
```
Then via the Playwright MCP tools: reset the clock, set lesson 5, open `/inspector` and read the `planned-queue` (deterministic) — confirm it lists multiple instruments spread across ≥2 rules. Open `/`, confirm a prompt is served; star the current item (read the served itemId from `star-form`), then `/inspector` and confirm it appears in the `starred-list`. Back on `/`, submit a few answers and confirm across loads that varied instruments are served (not the same item every time) and the scheduled-rules due/mastery panels update. Screenshot the inspector (planned-queue + starred + scheduled panels); report observed values as evidence. **Clean up:** kill the preview (`lsof -ti tcp:4173 | xargs kill`) and `trash` any stray `.playwright-mcp/` + screenshots written to the repo root.

---

## Self-Review (author) — spec coverage

- **Seeded PRNG (determinism, no Math.random)** → Task 1.
- **SessionPlanner port + Instrument/PlannerCtx/PlannerKnobs + pure 2-stage planSession** (Stage-1 pools/priority/round-robin/caps; Stage-2 freshness/direction-rotation/cooldown/star/miss; forward-projection; mastery advisory via `mReady`/`K`; due one term) → Task 2. `PLANNER_KNOBS` marked `// Monte-Carlo-owned`.
- **Star writer (event + item_exposure.starred, folds identically) + port** → Task 3.
- **Practice route greedy head (no persistence, per-session seed) + star toggle + targetAttempts from knob** → Task 4. Placeholder-coupled e2e reworked to planner-invariant assertions (Task 4).
- **Inspector planned-queue preview (fixed seed) + starred list** → Task 5.
- **Distribution property tests (seeded harness)** → Task 6.
- **Full gate + M9 + MCP walkthrough** → Task 7; **slice-D-exit e2e** (planned queue spread + star surfaced) → Task 5.
- **No migration; no due/scheduler/ReviewLog change; domain isomorphic/deterministic; per-user** → by construction (no schema/scheduler edits anywhere; planner ctx is single-user; M9 test in Task 7).
- **Deferred (D.2/P1)** — trickle adaptivity, re-drill, caught-up UX, type-selection, persisted nav, difficulty — absent from every task.
