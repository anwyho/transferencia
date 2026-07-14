# Slice D.1 — star + SessionPlanner seam + deterministic 2-stage core (design)

**Status:** design, ready for implementation-plan. **Date:** 2026-07-14.
**Issue:** first sub-slice of Epic D (planner + star). **Follows:** C.2c (mastery meter — merged to `main` at `2321549`). C.1/C.2a/C.2b/C.2c all green on main.
**Companions:** `2026-07-09-language-transfer-design-v2.md` (§Session orchestration, §Scheduling & mastery), `language-transfer-requirements.md` (ledger; [DIST][VARIETY][SELECT][MASTERY]), `scheduler-monte-carlo-experiment.md` (owns the planner knob *values* + distribution guardrails), the C.2* designs, `AGENTS.md`.

## Why this slice
C shipped the state spine: FSRS timing behind `Scheduler.apply`, the advisory mastery meter (EWMA + coverage), all a fold of `ReviewLog`. But selection is still a placeholder — the practice route serves `eligibleItems(store, lesson)[0]` (the first gated item, every time). D.1 lands the real **2-stage `SessionPlanner`**: it *consumes* the C.2c meter (as advisory priority input, never as a gate) plus due/exposure/star to pick **which rule** to drill (Stage-1) and **which instrument** exercises it (Stage-2, the variance engine). It also lands **star** — the item-level affordance C.2a deferred (the fold already interprets `star`/`unstar`; D.1 adds the writer + UI + priority effect).

This is where the pedagogy becomes visible: rules are the unit, items are interchangeable variance instruments, mastery is advisory, and "due is one term in a priority function, not the sole driver" (design v2). Per the ledger, **every planner weight is Monte-Carlo-owned** — D.1 ships the *mechanism* + a seeded distribution-test harness (which the Monte Carlo will reuse) with clearly-marked placeholder weights, exactly as C.2b/C.2c shipped FSRS params / mastery knobs.

## Scope

**In D.1:**
- **Star writer + UI + effect.** `ReviewRepository.star/unstar` (one txn: append the `star`/`unstar` event + upsert `item_exposure.starred`); a practice-screen star toggle for the current item; star participates in planner priority (Stage-1 pool + boost) and Stage-2 bias.
- **`SessionPlanner` port** (new `@lt/domain/src/planner/`) + pure `planSession(ctx, n) -> Instrument[]` — deterministic, isomorphic, seeded.
- **Stage-1** (pick rules): pools = due + weak + new (fixed cap) + starred-forced; priority over overdue / mastery_gap / coverage_gap / starred / newness (placeholder weights); even distribution via round-robin across `homeLesson` buckets; per-lesson + per-rule session caps.
- **Stage-2** (pick instrument): eligible = tested-role gated items of the rule × supporting types × enumerated `{paramKey, direction}`; rank by freshness (`times_seen`), direction rotation, exposure cooldown, star bias, recent-miss bias, seeded jitter.
- **Seeded PRNG** in the domain (deterministic; no `Math.random`), seeded per-session from `sessionId`.
- **Practice route** rewritten to consume the planner (greedy head), replacing the first-item placeholder.
- **Observability:** an inspector "planned queue" preview (fixed seed) + the star toggle; **distribution property tests** (seeded) + unit + web integration + Playwright; full gate + MCP walkthrough.

**Deferred — D.2:** adaptive new-lesson **trickle** sizing (shrinks when review backlog is high); **end-of-session re-drill** of misses; the **caught-up / empty** session UX.

**Deferred — P1:** exercise-**type selection** ("these types today" — a no-op with one registered type); **persisted / resumable** session navigation (back/forward/revise/resume — ledger backlog); **difficulty-weighting** of selection (difficulty OFF in P0).

**Explicitly NOT D.1:**
- Any change to `due`, the scheduler, the scheduler blob, or the M3 guard (timing is settled; the planner only *reads* `due`).
- Any `ReviewLog` schema/event change (star/unstar are already-frozen kinds).
- Tuning any weight (Monte-Carlo owns values; D.1 ships marked placeholders).
- Persisting the plan or any server-side per-session plan cache (a process-global — the isolation problem C.2a removed).

## Decisions locked in brainstorming (2026-07-14, with Anthony)

1. **Decomposition: D.1 core, then D.2 adaptive.** D.1 = star + planner seam + deterministic 2-stage selection. D.2 = adaptive trickle + re-drill + caught-up edges. Rejected: one big slice D (large, logic-dense surface); a finer 3-way split (more overhead than value).
2. **Stateless greedy head for plan threading.** The pure `planSession(ctx, n)` batch is the tested unit; the **live practice route recomputes it from current persisted state each load and serves the head** (`plan[0]`), N = `targetAttempts − realized_count`. Each attempt advances real state, so the next load greedily picks the next best. **No plan persistence, no server-side plan cache.** "Due never skipped" holds by re-evaluating current state every step. Rejected: persisted plan-at-start (adds plan-storage the ledger puts in P1; a mid-session dial-drop re-gating path); in-memory per-session cache (reintroduces a process-global — the serial-pin/isolation problem C.2a worked to remove; breaks the shared e2e server).
3. **Every planner weight is a Monte-Carlo-owned placeholder** in a single `PLANNER_KNOBS` config (mirrors `MASTERY_KNOBS`/FSRS params). D.1 ships mechanism + marked placeholder values, not tuned numbers.
4. **Mastery is consumed advisorily, never as a gate.** `mastery`/`coverage` feed priority *terms* (`mastery_gap`, `coverage_gap`) only; a low-mastery rule is *prioritized*, a high-mastery rule is *de-prioritized* — nothing is blocked or hidden by mastery. `due` is likewise one term, not the sole driver.
5. **Determinism via injected seeded RNG.** The domain stays pure (no `Math.random`); the planner takes `rng: () => number`. The live route seeds a domain PRNG **per session from `sessionId`** — reproducible, isolation-safe, no global. Tests pass fixed seeds.

## Star (writer + route + UI)

The fold already interprets `star`/`unstar` (C.2a, create-if-missing exposure). D.1 adds the writer + surface:
- **`ReviewRepository.star(i: { userId; itemId; at })` / `unstar(...)`** — one transaction: append `{ kind, userId, itemId, at }` to `review_log`, then upsert `item_exposure` setting `starred = true/false` (insert with `times_seen: 0, last_seen_at: at` if the row is absent — matching the fold's annotate-before-attempt semantics). No `rule_state` / `due` / scheduler touch (star is exposure-only; its *effect* is in the planner).
- **Route:** practice `+page.server.ts` gains `?/star` + `?/unstar` actions that call the repo with `clockNow()` for the current `itemId`.
- **UI:** a `data-testid="star-toggle"` control on the practice screen reflecting `item_exposure.starred` for the served item (server passes the item's `starred` into the page).
- **Fold parity:** unchanged proof holds — `star`/`unstar` fold to `item_exposure.starred`, which is scheduler-independent; the C.2a/C.2c rebuild proofs are unaffected (exposure is not re-materialized by `rebuild`). A web-integration test asserts the star write path folds identically (star → `itemExposures(u)` matches `fold(events(u))`).

## SessionPlanner port + types (`@lt/domain/src/planner/`)

New module `planner/` (parallels `scheduler/`, `mastery/`): `planner.ts` (the pure planner + `PLANNER_KNOBS`), `rng.ts` (seeded PRNG), co-located `*.test.ts`, `index.ts`; re-exported from the domain entrypoint. Pure/isomorphic (M9-clean).

```ts
/** A concrete render target — the Stage-2 output the practice route renders + grades. */
export interface Instrument {
  ruleKey: string;          // the Stage-1 target rule (attribution / "why picked")
  itemId: string;
  exerciseTypeKey: string;
  paramKey: string;         // canonical; '' for transformation
  direction: Direction;
}

/** Everything the pure planner reads. The web route assembles it from repo + store + clock + rng. */
export interface PlannerCtx {
  eligibleRules: Rule[];                                   // from eligibleRules(store, currentLesson)
  ruleState: (ruleKey: string) => RuleStateRow | undefined; // due / mastery / coverage ('both' row)
  exposure: (itemId: string) => ItemExposureRow | undefined; // times_seen / last_seen_at / last_rating / starred
  store: ItemStore;                                        // Stage-2 enumeration
  types: ExerciseType[];                                   // [transformationType] in P0
  currentLesson: number;
  now: number;
  rng: () => number;                                       // injected seeded PRNG
  knobs?: PlannerKnobs;                                    // default PLANNER_KNOBS
}

export interface SessionPlanner {
  /** An ordered, deterministic session plan of up to `n` instruments (fewer if the eligible set is small). */
  planSession(ctx: PlannerCtx, n: number): Instrument[];
}
```

Note: an attempt on the chosen instrument still logs the item's **full** tested-schedulable `ruleKeys` (multi-rule attribution, unchanged from the current route). `Instrument.ruleKey` records only the Stage-1 target (for observability); it does not narrow what the attempt credits.

## The pure planner — two stages, forward-projecting

`planSession(ctx, n)` produces the ordered list by simulating `n` picks against an **in-batch projected copy** of the mutable signals (session-so-far rule/lesson counts, synthetic `times_seen`/`last pick`), so caps, round-robin, and cooldown hold *across the batch* without touching persisted state. Each pick:

**Stage-1 — choose the target rule.**
- **Candidate pools** (union over `eligibleRules`, deduped): `due` (`ruleState.due ≤ now`), `weak` (`mastery < mReady`), `new` (no `ruleState` row — capped at `newRuleCapPerSession`, a placeholder; D.2 makes it adaptive), `starred-forced` (rules with ≥1 starred tested item).
- **priority(rule)** = weighted sum of: `overdueTerm` (`max(0, now − due)`, 0 if new), `masteryGapTerm` (`max(0, mReady − mastery)`), `coverageGapTerm` (`max(0, K − coverage)`), `starredTerm` (1 if any starred instrument), `newnessTerm` (1 if new). Weights from `PLANNER_KNOBS` (all `// Monte-Carlo-owned`).
- **Even distribution:** bucket the eligible-and-uncapped rules by `homeLesson`; round-robin across buckets, taking each bucket's highest-priority remaining rule; enforce `perLessonCap` + `perRuleCap` for the session; a small seeded jitter breaks priority ties (so ties don't always resolve by key order). This realises "round-robin across lesson buckets, not a global priority sort" (design v2 — a global sort bombards one overdue lesson).

**Stage-2 — choose the instrument (the variance engine).**
- **Eligible instruments** for the picked rule: `store.itemsForRule(ruleKey)` filtered to tested-role + `isVisible(item, currentLesson)`, crossed with `types.filter(t => t.supports(item))`, crossed with `type.paramEnumerator.paramsFor(item, ctx')` → `{ paramKey: key, direction: params.direction }`.
- **Rank** by: low `times_seen` (freshness), **direction rotation** (prefer a direction not yet used for this rule this session), **cooldown** (drop candidates with `now − last_seen_at < cooldownMs`, unless all are in cooldown → then allow, so a 1-instrument rule degenerates to a correct flashcard), **star bias** (prefer a starred item's instrument), **recent-miss bias** (prefer an instrument whose item's `last_rating` was a miss), seeded jitter. Take the top; **project** it forward (bump synthetic `times_seen`, record the rule's used direction + session counts) and continue to the next pick.

Determinism: identical `(ctx, seed, n)` → identical plan (required by the distribution tests + reproducible live sessions).

## `PLANNER_KNOBS` (placeholder, Monte-Carlo-owned)

```ts
export interface PlannerKnobs {
  weights: { overdue: number; masteryGap: number; coverageGap: number; starred: number; newness: number };
  perLessonCap: number;        // max rules from one homeLesson per session
  perRuleCap: number;          // max instruments of one rule per session
  newRuleCapPerSession: number;// fixed in D.1; adaptive in D.2
  cooldownMs: number;          // Stage-2 exposure cooldown
  targetAttempts: number;      // session budget N (~10-min)
}
// Monte-Carlo-owned placeholders — NOT tuned (scheduler-sim owns the values; ledger).
export const PLANNER_KNOBS: PlannerKnobs = {
  weights: { overdue: 1, masteryGap: 2, coverageGap: 1, starred: 3, newness: 1.5 }, // Monte-Carlo-owned
  perLessonCap: 3,          // Monte-Carlo-owned
  perRuleCap: 2,            // Monte-Carlo-owned
  newRuleCapPerSession: 3,  // Monte-Carlo-owned
  cooldownMs: 43_200_000,   // 12h — Monte-Carlo-owned
  targetAttempts: 10        // ~10-min budget — Monte-Carlo-owned
};
```
Weight-scale note: the terms are normalised before weighting so the placeholder weights are meaningful — `overdue` as **days** overdue (`max(0, now − due) / DAY_MS`), `masteryGap`/`coverageGap`/`starred`/`newness` as 0..1 (coverageGap = `max(0, K − coverage) / K`). The real balance is Monte-Carlo's job; these are marked placeholders exercising the mechanism.

## Seeded RNG + live consumption

- **`seededRng(seed: number): () => number`** — a small deterministic PRNG (mulberry32) in `@lt/domain`. No `Math.random` anywhere in the domain (M9 + determinism).
- **Live practice route (`+page.server.ts`) rewrite:** `load` builds a `PlannerCtx` from current persisted state — `eligibleRules(store, currentLesson)`, `ruleState`/`exposure` lookups backed by `repo.ruleStates`/`repo.itemExposures` (or targeted reads), `store`, `[transformationType]`, `clockNow()`, and `seededRng(sessionId)` — then serves `planSession(ctx, N)[0]` where `N = session.targetAttempts − realized_count` (≥ 1; if the plan is empty → the existing "no-item" state). The session's `targetAttempts` is sourced from `PLANNER_KNOBS.targetAttempts` at `startSession` (replacing today's hard-coded `10`) and stored on the session row; `realized_count` (already maintained) bounds N. `submit` grades + `appendAttempt` as today (logging the item's full tested `ruleKeys`); the next `load` recomputes greedily.
- Because the seed is a pure function of `sessionId`, a given session's greedy trajectory is reproducible, yet no plan is stored and no global is introduced.

## Observability + tests

- **Inspector planned-queue preview:** a new panel rendering `planSession(ctx, N)` with a **fixed seed** (deterministic), one row per instrument (`data-testid`s: `plan-rule`, `plan-item`, `plan-direction`), so the plan is inspectable + e2e-assertable without depending on live RNG.
- **Practice:** serves the planned pick (existing `given`/`answer-input`/`submit`/`reveal` testids) + the `star-toggle`.
- **Domain unit (`planner.test.ts`, `rng.test.ts`):** pool membership; priority ordering per term; round-robin across lessons + caps; Stage-2 freshness / direction rotation / cooldown (incl. the all-in-cooldown 1-instrument degenerate) / star + recent-miss bias; forward-projection prevents over-picking one rule; determinism per seed; PRNG uniformity/repeatability.
- **Distribution property tests (seeded, many simulated sessions)** — the harness the Monte Carlo reuses: over N seeds × simulated sessions assert the hard invariants (per-lesson/per-rule caps respected; no cooldown-repeat; a due rule is never skipped for variety; budget respected ±0) and soft bounds (lesson-coverage spread; due/weak/new fractions ≈ configured; starred instrument always included when present). Chi-square/entropy/max-min assertions over a fixed seed spread.
- **Web integration:** star writer folds identically (star → `itemExposures(u)` == `fold(events(u))`); practice serves a planner pick (not blindly the first eligible item); starring an item reorders the served instrument toward its rule. `createTestDb` default scheduler stays trivial; planner tests inject a fixed seed.
- **Playwright (design v2 slice-D exit):** seed a due state, star an item, assert the planned queue reorders + a varied instrument is served across submits + the starred state persists. Full gate (`lint`/`check`/`build`/`test`/`test:e2e`) + M9 + MCP walkthrough. Evidence before claims.

## Edge cases (per AGENTS.md)
- **Empty eligible set** (lesson 1 teaches no Spanish) → empty plan → practice "no-item" (existing state).
- **Rule with a single instrument** → cooldown would drop it; the "all candidates in cooldown → allow" rule lets it re-show (correct flashcard degeneration).
- **Rule with 0 gated instruments** → not eligible (the content invariant guarantees ≥ 1 at `homeLesson`; below home it is simply not surfaced).
- **Dial dropped mid-session** → the next greedy `load` re-gates from the current lesson; now-gated-out instruments are never picked; logged state untouched (reversible).
- **N ≤ 0 / caught up** → empty head → "no-item"; the richer caught-up UX (offer weak/maintenance) is D.2.
- **Starred item gated out** → its rule is a candidate only if it still has a gated instrument; otherwise it waits (star is not a gate-override).
- **New user, nothing due** → `new` pool (capped) drives introduction; the planner still produces a plan.
- **Determinism under a fixed seed** → identical plans (distribution tests + reproducible sessions depend on it).

## Invariants preserved
- **No `due`/scheduler/`ReviewLog` change.** The planner only *reads* `due`; star/unstar are frozen event kinds; no migration.
- **Mastery stays advisory.** Consumed as priority terms only; never gates or hides.
- **`@lt/domain` stays isomorphic + deterministic** (M9 lint; injected seeded RNG; no `Date.now`/`Math.random`).
- **Every per-user read filters `user_id`**; the planner is single-user (its ctx is built from one user's state).
- **MC-owned values are placeholders** — marked, not tuned.

## D.1 → D.2 → P1 line (so scope can't creep)
- **D.1:** star + `SessionPlanner` seam + deterministic 2-stage core + greedy live consumption + distribution harness. *(this doc)*
- **D.2:** adaptive new-lesson trickle sizing; end-of-session re-drill of misses; caught-up/empty session UX.
- **P1:** exercise-type selection; persisted/resumable session navigation; difficulty-weighted selection; Monte-Carlo-tuned knob *values*.

## Notes
- The planner is the app's most logic-dense unit; keeping it a **pure `planSession(ctx, n)`** with all I/O in the thin route (and all randomness injected) is what makes it exhaustively testable + Monte-Carlo-reusable.
- The greedy-head live consumption is a deliberate P0 simplification of the batch plan; a pre-committed, resumable plan is P1 and slots in behind the same `SessionPlanner` port without disturbing the pure core.
