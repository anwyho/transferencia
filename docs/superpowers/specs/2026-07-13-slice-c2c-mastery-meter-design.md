# Slice C.2c — EWMA mastery + distinct-instrument coverage-K meter (design)

**Status:** design, ready for implementation-plan. **Date:** 2026-07-13.
**Issue:** third sub-slice of #15 (C.2; Epic C #13). **Follows:** C.2b (FSRS + same-day guard + SM-2 replay — merged to `main` at `280e0c1`).
**Companions:** `2026-07-09-language-transfer-design-v2.md` (§Scheduling & mastery, §State plane), `2026-07-11-slice-c2a-fold-dial-design.md` (the fold + rebuild proof), `2026-07-13-slice-c2b-fsrs-guard-design.md` (the scheduler seam + `rebuild`), `language-transfer-requirements.md` (ledger; **two-signal, two-threshold** decision 2026-07-10, M6), `scheduler-monte-carlo-experiment.md` (owns the mastery knob *values*), `AGENTS.md`.

## Why this slice
C.2a proved the pure `fold` reproduces the incremental projection; C.2b made timing real (FSRS behind `apply`, M3 same-day guard) and proved a scheduler swap is a replay. C.2c adds the **second signal** of the two-signal learning model: a **mastery meter** — recency-weighted accuracy (EWMA) + distinct-instrument **coverage** (M6) + a **spacing** signal — materialized as new `rule_state` columns, folded from the log, shown in the inspector.

Mastery is **advisory and isolated**: it never touches `due`, never feeds FSRS's internal difficulty, never blocks or gates. It exists to (later, in D/P1) nudge lesson progression and rank the weakest-rules queue. C.2c ships the **meter machinery and its proof**, not its consumption — exactly as C.2b shipped the FSRS machinery with Monte-Carlo-owned param *values* left as marked placeholders.

The meter is the design's cleanest illustration of **mastery ≠ retention**: timing gets **≤ 1 tick per rule per UTC day** (the M3 guard), while mastery **eats every rep**. Same log, same fold, two independent signals diverging by construction — which is precisely what the extended rebuild proof asserts.

## Scope

**In C.2c:**
- **Shared mastery primitive** in `@lt/domain` (`mastery/`): a pure `applyMastery(prev, rating, instrumentKey, dayKey)` that both `fold` and the write-path call — the structural-identity seam (the `scheduler.apply` pattern) that keeps fold ≡ projection.
- **Four new `rule_state` columns** (additive; all a fold of the log): `mastery` (EWMA), `coverage` (distinct-instrument count), `seen_instruments` (JSON dedup set), `success_days` (JSON dedup set of distinct UTC days with a success).
- **`masteryReady(state, knobs?)`** — a pure, **read-time** predicate = `coverage ≥ K AND ewma ≥ M_ready AND |successDays| ≥ S`. Thresholds are **Monte-Carlo-owned placeholders**, consumed at read (inspector; future planner), **never baked into the stored fold** — so retuning is a code change, never a re-fold/migration.
- **Fold + write-path** both compute the four columns via `applyMastery`, unconditionally per attempt (no same-day guard on mastery).
- **`rebuild` unchanged** — it is already rule_state-only (C.2b decision 4), so it re-materializes the four new columns for free; the extended replay proof asserts they are **scheduler-independent** (a swap changes `due`, never mastery).
- **Inspector mastery panel** — the scheduled-rules rows gain `mastery` / `coverage` / a `mastered` badge (`data-testid`s), server-computed via `masteryReady`.
- **Fold in the five C.2b-review deferrals** (see §C.2b deferred nits).

**Deferred — D / P1:**
- The meter's **consumption**: the `SessionPlanner` priority function (`mastery_gap`, `coverage_gap` terms) and the **advance-lesson nudge** (two-signal *signal (a)* — the lenient, same-session accuracy bar on current-lesson rules, distinct from *mastered*).
- **Monte-Carlo-tuned values** for every mastery knob (`α`, `base(rating)`, `K`, `M_ready`, `S`, `isSuccess`, a hint penalty, novelty/difficulty weights).
- **Difficulty-weighting** of the EWMA (difficulty is OFF in Phase 0 → weight 1 everywhere now; P1 adds difficulty tags).

**Explicitly NOT C.2c:**
- Any coupling of mastery to `due` / the scheduler blob (the isolation is the point).
- Tuning any knob (the sim owns the values; C.2c ships marked placeholders).
- A `mastered` *stored column* (it is a read-time predicate over stored raw signals — see §masteryReady).
- `schedule_by_direction` (coverage counts across both directions into the one `'both'` row — unchanged M7 sentinel).

## Decisions locked in brainstorming (2026-07-13, with Anthony)

1. **Full mastered predicate this slice, but as a read-time predicate over materialized raw signals.** `fold` materializes only the raw accumulators (`ewma`, distinct-instrument set, distinct-success-day set); `masteryReady` compares them against the (placeholder) thresholds live at read. Baking a `mastered` boolean into the stored fold would make retuning `K`/`M_ready`/`S` a re-fold of every user — antithetical to "state is a cheap, rederivable fold." Rejected: a stored `mastered` column.
2. **Dedup accumulators are JSON columns on `rule_state`** (not separate normalized tables). Symmetric with the opaque `blob` already on `rule_state` as a JSON fold-accumulator; keeps `rebuild` rule_state-only (C.2b decision 4) with **zero** rebuild/FK change. The "composite columns, not fat concatenated strings" rule governs **identity keys** (design v2 §Identity), not derived accumulators — `blob` is the precedent. Per-instrument analytics is backlog and re-derivable from the log (ground truth). Rejected: `rule_instrument` / `rule_success_day` tables (more machinery; forces `rebuild` to extend to them for keyRemap-rename correctness).
3. **One shared mastery primitive, called by both paths.** `applyMastery` lives in `@lt/domain`; `fold` and `repo.appendAttempt` both call it, exactly as both already call `scheduler.apply`. Structural identity by construction is what keeps the rebuild proof green; duplicating the arithmetic across the two paths is how a hand-written incremental updater and the fold silently drift. Rejected: inlining the EWMA/coverage logic separately in `repo.ts` and `fold.ts`.
4. **Mastery eats every rep; timing does not.** The M3 same-day guard bounds *timing* to ≤ 1 tick/UTC-day. Mastery has **no** such guard for its EWMA or coverage: every attempt updates the EWMA and (on a new instrument) coverage. The one place mastery is per-day is the **spacing** signal, which is a **set of distinct day-keys** (order-invariant dedup, not a guarded tick) — so it needs none of the `dayAt`-anchor care the timing guard required.
5. **`base` keys on the final `SrsRating`.** Hint-reveal already caps the rating at Hard upstream (the central rating policy), so its effect flows into `base(rating)`; a *separate* hint penalty is a Monte-Carlo-owned knob deferred to D/P1.

## Data model — four additive `rule_state` columns

`schema.ts` `ruleState` gains (design v2 §State plane names `mastery` + `coverage`; the two sets are the dedup mechanism):

```ts
mastery:         real('mastery').notNull().default(0),            // EWMA accuracy in [0, 1]
coverage:        integer('coverage').notNull().default(0),        // = |seen_instruments|, materialized
seenInstruments: text('seen_instruments', { mode: 'json' })
                   .$type<string[]>().notNull().default([]),      // canonical instrument keys (dedup)
successDays:     text('success_days', { mode: 'json' })
                   .$type<number[]>().notNull().default([]),      // distinct UTC day-keys with a success (dedup)
```

- `coverage` is a **materialized cache of `seen_instruments.length`**, written together in the one primitive (no drift risk). The spacing count is derived from `success_days.length` at read (not promoted to its own column — only design-v2-named signals get scalar columns).
- **Migration:** `drizzle-kit generate` → forward-only `ALTER TABLE rule_state ADD COLUMN …` migration (committed, never `push`). SQLite `ADD COLUMN` needs no STRICT clause and takes a constant default — `0`, `0`, `'[]'`, `'[]'` backfill the seed `u1` rows safely. `migrate()` already runs on boot + test setup. **The plan verifies the generated SQL emits `DEFAULT '[]'` for the JSON columns** (drizzle-kit's json-default handling is a known quirk — cf. C.1's hand-edited STRICT clause; hand-fix the emitted migration if needed rather than trusting the schema literal).
- `RuleStateRow` (domain port `repository.ts`) gains the same four fields.

## The shared mastery primitive (`@lt/domain/src/mastery/`)

New module, parallel to `scheduler/`: `mastery.ts` (+ co-located `mastery.test.ts`, `index.ts`), re-exported from the domain entrypoint. Pure, isomorphic (M9-clean — arithmetic + array ops, no `Date.now()`/`Math.random()`, no I/O).

```ts
/** The mastery accumulator folded per rule_state row. coverage = instruments.length (materialized separately). */
export interface MasteryState {
  ewma: number;          // recency-weighted accuracy, seed 0
  instruments: string[]; // distinct instrument keys seen (dedup set as a sorted array)
  successDays: number[]; // distinct UTC day-keys with a success (dedup set as a sorted array)
}

/** Advisory mastery thresholds + inputs — ALL Monte-Carlo-owned placeholders (scheduler-sim owns the values). */
export interface MasteryKnobs {
  alpha: number;                        // EWMA learning rate; low => slow (~20 reps, not ~3)
  base: Record<SrsRating, number>;      // per-rating accuracy contribution
  isSuccess: (r: SrsRating) => boolean; // what counts as a "success" for the spacing signal
  K: number;                            // distinct-instrument coverage threshold (M6: a count, not a % of catalog)
  mReady: number;                       // EWMA readiness threshold
  S: number;                            // distinct-success-days (spacing) threshold — "not blitzable"
}

// Monte-Carlo-owned — placeholders, NOT tuned. The scheduler-sim experiment sets these (ledger).
export const MASTERY_KNOBS: MasteryKnobs = {
  alpha: 0.1,                                              // Monte-Carlo-owned
  base: { again: 0, hard: 0.5, good: 1, easy: 1 },         // Monte-Carlo-owned
  isSuccess: (r) => r === 'good' || r === 'easy',          // Monte-Carlo-owned
  K: 8,                                                    // Monte-Carlo-owned
  mReady: 0.85,                                            // Monte-Carlo-owned
  S: 3                                                     // Monte-Carlo-owned
};

/** Fold one attempt into a rule's mastery state. Called by BOTH fold and the write-path (structural identity). */
export function applyMastery(
  prev: MasteryState | null,
  rating: SrsRating,
  instrumentKey: string,
  dayKey: number,
  knobs?: MasteryKnobs
): MasteryState;

/** Read-time predicate. NEVER stored — retuning the thresholds is a code change, not a re-fold. */
export function masteryReady(s: MasteryState, knobs?: MasteryKnobs): boolean;

/** Collision-safe canonical instrument key: the attempt's CONCRETE direction, not the 'both' sentinel. */
export function instrumentKey(itemId: string, exerciseTypeKey: string, paramKey: string, direction: Direction): string;
```

- **EWMA:** `ewma' = ewma + α·(base(rating) − ewma)`, seed `0`. Low `α` ⇒ many spaced reps to approach the asymptote (the design's "~20 not ~3"). Updates on **every** attempt.
- **coverage:** add `instrumentKey` to `instruments` if absent (dedup) — on **every** rep including same-day; a repeat of the *same* instrument does not bump it. Coverage counts across **both directions** (the concrete `direction` is part of the key) into the single `'both'` row.
- **spacing:** if `isSuccess(rating)`, add `dayKey = floor(at / DAY_MS)` to `successDays` if absent. A set of day-keys ⇒ **order-invariant** (no `dayAt`-anchor subtlety; unlike the timing guard, this is dedup, not a single mutable tick).
- **`instrumentKey`** encodes `[itemId, exerciseTypeKey, paramKey, direction]` via `JSON.stringify` (not a delimiter join — design v2 §Identity bans delimiter collisions in raw ids).
- Sets stored as **sorted arrays** for deterministic JSON (byte-identical folds/rebuilds; matches `fold`'s determinism discipline).

## Fold + write-path — the asymmetry (timing ≤1/day, mastery every rep)

Both paths keep timing behind the (guarded) `scheduler.apply` **unchanged**, and add the mastery update via `applyMastery`, unconditionally per attempt per cited rule:

- **`fold` (`fold.ts`) attempt branch:** for each cited `ruleKey`, alongside the existing `scheduler.apply(...)` → `{ blob, due }`, compute `m = applyMastery(prevMastery, ev.rating, instrumentKey(ev.itemId, ev.exerciseTypeKey, ev.paramKey, ev.direction), floor(ev.at / DAY_MS))`; write `mastery = m.ewma`, `coverage = m.instruments.length`, `seenInstruments = m.instruments`, `successDays = m.successDays` onto the `RuleStateRow`. `prevMastery` is read from the accumulating `ruleStates` map (`{ ewma, instruments, successDays }` reconstructed from the prior row, or `null` on first sight).
- **`repo.appendAttempt` (`repo.ts`):** in the same transaction, feed the existing row's `{ mastery, seenInstruments, successDays }` into `applyMastery`, and extend `onConflictDoUpdate.set` from `{ blob, due }` to also set `mastery`, `coverage`, `seenInstruments`, `successDays`. `deps` already carries no clock coupling for mastery (dayKey derives from the same `at` the row is stamped with).

Because both paths call the **same** `applyMastery`, the C.2a equality contract (A) extends to the four columns automatically under monotonic time. `coverage` and `successDays` are **sets** ⇒ order-invariant ⇒ backward-clock-**insensitive**. `ewma` is order-sensitive ⇒ contract A (fold authoritative under a backward clock), identical to every other accumulator.

## `masteryReady` — read-time, thresholds not folded

`masteryReady(state, MASTERY_KNOBS)` is called where the meter is *consumed*, never during the fold:
- **now (C.2c):** the inspector `load` computes it per rule to render the badge.
- **later (D/P1):** the planner's priority function.

Retuning `K`/`M_ready`/`S` (when the Monte Carlo lands) changes only this predicate's inputs — no user's stored `rule_state` needs rewriting, because the raw signals it reads are threshold-free. (Contrast: had `mastered` been folded, retuning would require a `rebuild` of every user.)

**Knob split — which retunes force a re-fold.** Two classes: the **EWMA-shape** knobs (`α`, `base`) *are* folded into the stored `mastery` value, so retuning them is a **`rebuild`** — a re-fold of the immutable log through new knobs, exactly the C.2b replay mechanism (a code change + a re-fold, never a schema migration). The **threshold** knobs (`K`, `M_ready`, `S`) are read-time inputs to `masteryReady`, so retuning them touches nothing stored. `applyMastery`/`masteryReady` therefore accept an optional `knobs` argument (unit tests + the future Monte-Carlo sim inject candidate configs); `fold` calls them with the module-default `MASTERY_KNOBS` (fold's signature is *not* threaded with a knobs param this slice — YAGNI until the sim exists; adding it later is a mechanical re-fold).

## `rebuild` / replay proof — extended (the headline C.2c assertions)

`rebuild` is **unchanged** (C.2b): one txn, `fold(events(u))` → delete + re-insert `rule_state`. Because the four new columns live on `rule_state` and are produced by `fold`, `rebuild` re-materializes them for free. The proof grows:

- **fold ≡ projection** now deep-equals on `mastery`/`coverage`/`seenInstruments`/`successDays` too (monotonic time), through the real write path under `fsrsScheduler`.
- **Divergence (the C.2c headline):** N same-day attempts on one rule with **distinct** instruments → `coverage == N` and the EWMA reflects all N, while `due` reflects the **single** M3-guarded tick. Timing and mastery provably diverge from the same events.
- **Scheduler-swap replay:** `rebuild` FSRS→SM-2 → `due` changes on **every** row (strengthen C.2b's `.some(...)` to `.every(...)`), while `mastery`/`coverage`/`seenInstruments`/`success_days` are **byte-identical** (mastery is scheduler-independent). `rebuild` back through FSRS == the live incremental projection (idempotent).
- **keyRemap rebuild:** two raw keys → one target folds to a merged row whose `seenInstruments`/`success_days` are the **union** of both keys' sets and whose `ewma` is folded over both keys' attempts in `(at, id)` order.

## Inspector (Playwright surface)

`inspector/+page.server.ts` `load` maps the new `rule_state` columns and calls `masteryReady`; `+page.svelte` scheduled-rules rows gain:
- `data-testid="rule-mastery"` (the EWMA, fixed precision), `data-testid="rule-coverage"` (the int), `data-testid="rule-mastered"` (the `masteryReady` boolean badge).
Existing `data-testid`s unchanged (the C.1/C.2a/C.2b e2e keep passing). No new screen.

**Playwright walkthrough:** drill one rule through several **distinct** instruments across advanced days → `rule-coverage` climbs per distinct instrument, `rule-mastery` climbs, re-drilling the **same** instrument leaves `rule-coverage` flat (dedup visible). `rule-due-at` continues to reflect FSRS timing, untouched by mastery.

## Edge cases (per AGENTS.md)
- **Empty `ruleKeys` (`[]`):** no rule row touched; `item_exposure` still bumps (unchanged).
- **Attempt citing multiple rules:** each rule's meter updates independently; the same instrument key is added to **each** cited rule's set.
- **First attempt on a rule:** `ewma = α·base(rating)` (from seed 0); `coverage = 1`; `successDays = isSuccess ? [dayKey] : []`.
- **Same instrument repeated:** `coverage` flat (dedup); `ewma` still moves (eats the rep).
- **Same-day distinct instruments:** `coverage` climbs; `due` one guarded tick (the divergence).
- **Success on the same day twice:** `successDays` dedups the day (spacing is distinct-*days*).
- **Backward clock:** `coverage`/`successDays` order-invariant (identical); `ewma` order-sensitive → fold authoritative (contract A), cache may lag — unchanged from C.2a/b.
- **Empty log / new user:** `fold([])` mastery fields default (`0`/`0`/`[]`/`[]`); `rebuild` writes zero rows.
- **`masteryReady` is advisory:** it never gates rendering, scheduling, or `due`. A `mastered` rule still schedules normally (its light-maintenance de-prioritization is D/P1's planner, not C.2c).

## C.2b deferred nits (folded into C.2c test work)
- Tests that mean "the app's actual scheduler" import the shipped **`fsrsScheduler`** singleton instead of reconstructing `sameDayGuard(fsrsCore)` inline.
- `repo.test.ts` blocks that spin their own `env2` and ignore the `beforeEach` `env` — tidied to one setup path.
- The scheduler-swap replay test asserts `.every(due differs)` (was `.some`).
- A one-line comment on `ReviewRepository.rebuild`'s inlined `keyRemap` type explaining it avoids a ports→fold import cycle.
- A by-design note (code comment + this doc): `rebuild(otherScheduler)` is a **coordinated swap** — it must be paired with swapping the app's injected scheduler, because `apply` never hydrates a foreign blob (C.2b decision 5; Phase-0 disposable dev DB).

## Testing / verification
- **Domain unit — `mastery.test.ts`:** EWMA formula (seed 0, monotone toward asymptote, `α` effect); `base(rating)` map; coverage dedup (same key no-ops, distinct climbs, both-directions counted); spacing dedup (distinct days only, `isSuccess` gating); `masteryReady` truth table around each threshold; `instrumentKey` collision-safety; `MasteryState` JSON round-trips (sorted arrays deterministic).
- **Domain unit — `fold.test.ts` (extended):** the four columns fold correctly per kind; multi-rule attempt updates each; first-exposure seeds; same-instrument repeat; the unordered-input note stays honest.
- **Web integration (real repo, `createTestDb(clock, fsrsScheduler)`):** fold ≡ projection on all four columns; the **divergence** test; the **scheduler-swap replay** (`due` `.every` differs, mastery byte-identical, idempotent back through FSRS); **keyRemap** union merge; a second user never leaks into `events(u)`.
- **Existing tests stay green:** `test-db` default (trivial) keeps C.1/C.2a `due === at + DAY_MS` assertions valid; C.2b guard/replay tests still pass.
- **Playwright (updated):** the mastery-panel walkthrough above; existing dial + persistence e2e unchanged.
- **Full gate + MCP walkthrough:** `pnpm lint` / `check` / `-r build` / `test` / `test:e2e` green; M9 isomorphic-boundary lint + tripwire still pass (the mastery module is pure domain); real-UI inspector walkthrough with the FSRS-aware clock advance. **Evidence before claims** (AGENTS.md).

## C.2c → D line (so scope can't creep)
- **C.2c:** mastery meter (EWMA + coverage + spacing) materialized + folded + `masteryReady` read-time predicate + inspector panel + extended rebuild/replay proof. *(this doc)*
- **D / P1:** the meter's consumption — `SessionPlanner` priority (`mastery_gap`/`coverage_gap`), the advance-lesson nudge (signal (a)), star-forced selection, end-of-session re-drill.
- **Monte Carlo:** the *values* for every mastery knob + the spacing rule.
- **Separate task:** e2e `workers:1` removal (needs clock + DB/user per-test isolation) — unchanged from C.2a/b.

## Notes / deviations
- **Mastery is the one "invented" piece** (design v2): deterministic arithmetic, isolated, unit-testable, recomputable from the log — or swappable for `ts-elo` later. C.2c keeps it behind a single pure function so that swap stays a code change, not a data migration.
- **No `ReviewLog` change.** Every column added here is a fold of the already-frozen event stream — the invariant that makes mastery a retune-not-migrate signal.
- **`coverage` is a count, not a fraction of the live catalog** (M6): adding a new exercise type in P1 cannot silently un-master a rule.
