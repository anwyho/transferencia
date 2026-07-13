# Slice C.2b — FSRS timing + same-day guard (M3) + SM-2 replay proof (design)

**Status:** design, ready for implementation-plan. **Date:** 2026-07-13.
**Issue:** second sub-slice of #15 (C.2; Epic C #13). **Follows:** C.2a (fold + per-user dial + rebuild proof — merged to `main` at `20672a1`).
**Companions:** `2026-07-09-language-transfer-design-v2.md` (§Scheduling & mastery, §State plane), `2026-07-11-slice-c2a-fold-dial-design.md` (the fold + rebuild proof this builds on), `language-transfer-requirements.md` (ledger; two-signal model, M3), `scheduler-monte-carlo-experiment.md` (owns the FSRS knob *values*), `AGENTS.md`.

## Why this slice
C.2a proved the pure `fold` reproduces the incremental projection under the **trivial** scheduler (`due = at + 1d`). C.2b makes the timing real: FSRS via `ts-fsrs` behind the fixed `Scheduler.apply` seam, with the **same-day / re-drill reinforcement-only guard (M3)** so intense same-session drilling can't thrash intervals. It also lands the **SM-2-on-rule** escape hatch and a **replay proof** — swapping the scheduler is a re-fold of the immutable log (`rebuild`), never a data migration. This is the payoff of the whole event-sourced design: the algorithm is swappable because state is a fold of the log.

Because C.2a routed all timing through one seam — `appendAttempt` and `fold` both call `scheduler.apply(prev, rating, at)` and never inspect the blob — **C.2b changes no write-path or fold code.** The new behavior lives entirely inside the scheduler implementations and one new `rebuild` repo method.

## Scope

**In C.2b:**
- **`sameDayGuard(core)`** — a scheduler *decorator* in `@lt/domain` that enforces M3 (≤ 1 effective tick per rule per UTC day, **worst-of-day monotonic**) over any core scheduler's opaque state. Pure, unit-tested independently.
- **FSRS core** (`ts-fsrs`, in `@lt/domain` — pure JS, isomorphic, runs inside the fold in P3): implements `apply` with ts-fsrs default params (**placeholders, Monte-Carlo-owned**), 1:1 rating map, a **versioned JSON-round-trippable** blob (FSRS `Card` with dates as epoch ms). The app's scheduler = `sameDayGuard(fsrsCore)`.
- **SM-2-on-rule core** — minimal grain-agnostic SM-2 (ease-factor + interval, **no difficulty param**), also `sameDayGuard`-wrapped. In `@lt/domain`, exercised by the replay proof only; **not** wired into the app runtime.
- **`repo.rebuild(userId, { scheduler, keyRemap })`** — one txn: `fold(events(u))` → delete + re-insert the user's **`rule_state`** rows (the only scheduler-dependent projection). The swap/rename replay mechanism.
- **Swap the app** `db/index.ts` from `trivialScheduler` to `sameDayGuard(fsrsCore)`. Parameterize the test-db helper to accept a scheduler (default stays `trivialScheduler`, so C.1/C.2a tests are untouched).
- **Replay proof** (integration): seed a log under FSRS → `rebuild` through SM-2 → `rule_state.due` differs, row set identical, no schema change → `rebuild` through FSRS again = idempotent (== the live incremental projection).
- Update the persistence e2e + the MCP walkthrough to advance the clock **past the FSRS-computed due** (see Edge cases — FSRS's first-review interval is several days, not 1).

**Deferred — C.2c:** EWMA mastery + distinct-instrument `coverage ≥ K` (M6); the mastery meter columns + inspector panel.

**Deferred — D / P1:** the two mastery **threshold values** + FSRS knob values (Monte Carlo); `schedule_by_direction`; the planner/priority function.

**Explicitly NOT C.2b:** tuning FSRS params (MC owns the values — C.2b ships defaults, clearly marked); wiring SM-2 as a user-selectable scheduler (YAGNI); a boot-time auto-rebuild on version mismatch (Phase-0 has no prod data; dev DB is disposable).

## Decisions locked in brainstorming (2026-07-13, with Anthony)

1. **Same-day guard = worst-of-day, monotonic** (M3). Multiple attempts on a rule in one **UTC** day (`floor(at / DAY_MS)`) produce exactly one effective FSRS tick, computed from the day's *baseline* with the day's **worst** rating so far. A later `good` does **not** undo an earlier `again` (monotonic worsening within the day). Pedagogically conservative: fumbling a rule today counts even if you later nail it that same day. Rejected: first-of-day-wins (a same-day miss after a pass is invisible to timing) and last-of-day-wins (a lucky late `good` masks the fumble).
2. **Guard is a shared decorator**, not baked into each scheduler. `sameDayGuard(core)` wraps any core over its opaque state, so M3 is written and tested once and every scheduler (FSRS, SM-2) honors it identically.
3. **FSRS via `ts-fsrs` with default params as placeholders.** Values are **Monte-Carlo-owned** (ledger); C.2b ships ts-fsrs defaults + `request_retention` 0.9 and a docstring/`// MC-owned` marker — not tuned. Rating map is 1:1 (`again→Again`, `hard→Hard`, `good→Good`, `easy→Easy`). Blob is versioned (`{ v: 1, … }`).
4. **`rebuild` re-materializes `rule_state` only.** Item exposure, sessions, and `users.current_lesson` are **scheduler-independent** (the fold produces them identically for any scheduler), so a swap/rename never changes them; and `review_log.session_id` FK-references `sessions`, so deleting sessions during a rebuild would violate the FK. Re-writing just `rule_state` (which has no inbound FK) is the complete + minimal replay for both a scheduler swap and a `keyRemap` rename.
5. **Swap = replay, not migration; `apply` never handles a foreign blob.** FSRS `apply` consumes only `null` or its own `v:1` guarded blob. A blob produced by a *different* scheduler (e.g. trivial's `{last}`) is the province of `rebuild`, never `apply`. Phase-0 has no prod; the dev `local.sqlite` is disposable → swapping `trivial→FSRS` on a fresh or rebuilt DB is the whole story. No defensive foreign-blob hydration.
6. **SM-2 is test-only.** A real second impl (the documented escape hatch) exercised by the replay proof; the app runs FSRS.

## The same-day guard (M3)

A **decorator** over a core `Scheduler`. The guarded blob is generic over the core's opaque state `C`:

```ts
interface GuardedState<C = unknown> {
  v: 1;
  core: C;              // core state AFTER today's effective tick
  dayBaseline: C | null;// core state BEFORE today's first tick (null before the first-ever tick)
  dayKey: number;       // UTC day of the last tick = floor(at / DAY_MS)
  worstToday: SrsRating;// worst rating seen so far today (monotonic)
}

function sameDayGuard(core: Scheduler): Scheduler // returns a Scheduler whose blob is GuardedState
```

`apply(prev, rating, at)`:
- `day = Math.floor(at / DAY_MS)`.
- **Same day** (`prev && prev.dayKey === day`): `worst = worseOf(prev.worstToday, rating)`; re-tick from the day's baseline: `r = core.apply(prev.dayBaseline, worst, at)`; blob `{ v:1, core: r.blob, dayBaseline: prev.dayBaseline, dayKey: day, worstToday: worst }`; `due = r.due`.
- **New day / first ever**: `baseline = prev ? prev.core : null`; `r = core.apply(baseline, rating, at)`; blob `{ v:1, core: r.blob, dayBaseline: baseline, dayKey: day, worstToday: rating }`; `due = r.due`.

`worseOf` uses the rank `again(0) < hard(1) < good(2) < easy(3)` and returns the lower-ranked (worse) rating.

**Why in the blob:** `appendAttempt` and `fold` both call `apply` and store/return the opaque blob unchanged. Putting the day-tracking *in the blob* means the guard needs zero changes to the write-path or the fold — and the C.2a rebuild proof (fold == projection) keeps holding for FSRS automatically, because both sides run the same guarded scheduler over the same events. The guard emits exactly one tick per UTC day (same-day attempts *replace* the day's tick, never append), satisfying "≤ 1 FSRS rating/day" (M3).

## FSRS core (`ts-fsrs`, `@lt/domain`)

- New runtime dependency `ts-fsrs` on `@lt/domain` (its first `dependencies` entry; pure JS, passes the M9 isomorphic-boundary lint — that rule bans `node:*`/persistence/Svelte, not pure npm packages).
- `fsrsCore: Scheduler`. State `C_fsrs` = the ts-fsrs `Card` serialized JSON-safe (**dates as epoch ms**, rehydrated on read) plus `{ v }`. `apply(prev, rating, at)`:
  - `card = prev ? hydrate(prev) : createEmptyCard(new Date(at))`.
  - `{ card: next } = f.next(card, new Date(at), fsrsRating(rating))` where `f = fsrs(params)`.
  - return `{ blob: serialize(next), due: next.due.getTime() }`.
- `params` = ts-fsrs defaults with `request_retention: 0.9` and `enable_fuzz: false` (deterministic tests). A `// Monte-Carlo-owned — placeholder defaults, tuned in the MC experiment` marker. **Fuzz off** so the fold is deterministic and the rebuild proof's equality holds.
- The app scheduler = `sameDayGuard(fsrsCore)`.

## SM-2-on-rule core (`@lt/domain`, test-only)

Minimal, grain-agnostic (no per-item difficulty): state `{ v, ef, reps, intervalDays }`. `apply(prev, rating, at)`:
- `again` → `reps = 0`, `intervalDays = 1`, `ef` decreased (floor 1.3).
- pass (`hard|good|easy`) → `reps += 1`; `intervalDays = reps===1 ? 1 : reps===2 ? 6 : Math.round(prev.intervalDays * ef)`; adjust `ef` by a quality mapped from the rating (SM-2 formula, clamped ≥ 1.3).
- `due = at + intervalDays * DAY_MS`.
Wrapped by `sameDayGuard`. Exists to prove the replay seam; not wired into the app.

## `rebuild` (the replay mechanism)

`ReviewRepository.rebuild(userId: string, opts: { scheduler: Scheduler; keyRemap?: KeyRemap }): void`

One transaction: `const state = fold(this.events(userId).map(rowToEvent), opts)` → `DELETE FROM rule_state WHERE user_id = ?` → insert `state.ruleStates`. Nothing else is touched (decision 4). Idempotent when `opts.scheduler` matches the one that produced the live rows.

## Swap + wiring
- `db/index.ts`: build `const appScheduler = sameDayGuard(fsrsCore)` and pass it to `DrizzleReviewRepository` (replacing `trivialScheduler`). This is the app's live timing.
- `test-db.ts`: `createTestDb(clock, scheduler = trivialScheduler)` — default keeps every existing C.1/C.2a integration test on the trivial scheduler (their `due === at + DAY_MS` assertions stay valid). FSRS/SM-2/rebuild tests pass an explicit scheduler.
- `trivialScheduler` stays in the domain (reference + C.2a proof). No data migration ships (decision 5).

## Domain / ports changes
- New module `packages/domain/src/scheduler/` — `same-day-guard.ts`, `fsrs.ts`, `sm2.ts` (+ `index.ts`), each with co-located `*.test.ts`; re-exported from the domain entrypoint. (`trivialScheduler` stays in `ports/scheduler.ts`; the new impls live together under `scheduler/`.)
- `ReviewRepository` gains `rebuild(userId, { scheduler, keyRemap })`.
- `@lt/domain` `package.json` gains a `dependencies` block with `ts-fsrs` (pin the latest published version at implementation time; it is `@lt/domain`'s first runtime dependency).

## Observability + wiring (Playwright surface)
- The inspector's scheduled-rules panel is blob-agnostic (shows `due_at`/`due_now`), so it needs no change — but under FSRS the `due_at` is now a realistic multi-day interval rather than `at + 1d`.
- No new screen.

## Edge cases (per AGENTS.md)
- **FSRS first-review interval > 1 day.** A first `good` yields an interval of several days (default initial stability), not 1. The C.1 persistence e2e (#C.3) and the MCP walkthrough advance **exactly 1 day** and assert due — that would now FAIL. Both must advance **past the FSRS-computed due**: read `due_at` from the panel and advance to `due_at + ε` (robust), or advance a generous fixed span (e.g. 10 days) documented as "> any first-review interval." This is a required C.2b change, not optional.
- **Same-day drilling** (the whole point): N attempts on a rule in one UTC day → one tick at the day's worst rating; interval grows across *days*, matching M3.
- **Clock moved backward across a day boundary** (test control-plane): `dayKey` differs → treated as a new day; `dayBaseline` becomes the (later-timestamped) prev core state. Fold is authoritative (contract A); the incremental cache may differ under backward time — unchanged from C.2a.
- **Rebuild with a rename** (`keyRemap`): fold collapses renamed keys → `rule_state` delete+reinsert yields the merged rows; scheduler-independent projections untouched.
- **Foreign/stale blob after swap** (dev `local.sqlite` with trivial blobs): `apply` does not handle it (decision 5) → the dev rebuilds or deletes the disposable DB. Fresh/`:memory:` DBs (tests, e2e) are unaffected.
- **Empty log / new user:** `rebuild` writes zero `rule_state` rows; `apply` on the first attempt sees `prev = null` → `createEmptyCard`.
- **FSRS determinism:** `enable_fuzz: false` so repeated folds/rebuilds are byte-identical (the rebuild/replay proofs require it).

## Testing / verification
- **Domain unit — `same-day-guard.test.ts`:** with a fake counting core, assert one tick/day; worst-of-day monotonic (good→again→good in a day collapses to `again`'s tick); new day starts from the prior day's core; `worseOf` ranking; blob round-trips JSON.
- **Domain unit — `fsrs.test.ts`:** `apply(null, 'good', t)` produces a card + `due > t` (multi-day); ratings order intervals (`again` < `hard` ≤ `good` ≤ `easy`); blob is JSON-round-trippable (dates as epoch ms) and re-hydrates to the same next state; deterministic (fuzz off).
- **Domain unit — `sm2.test.ts`:** `again` resets to 1-day; successive passes grow the interval via `ef`; `ef` floors at 1.3.
- **Web integration — `rebuild` + replay proof** (real repo, `createTestDb(clock, sameDayGuard(fsrsCore))`): drive attempts across days → `rebuild` through SM-2 → `rule_state` due changes, key set identical, `item_exposure`/`sessions`/`current_lesson` untouched; `rebuild` through FSRS again == the live projection (idempotent). No schema/migration.
- **Web integration — same-day guard through the real write path:** three attempts on one rule the same day (good, again, good) → one effective tick at `again`; the C.2a-style fold-vs-projection equality still holds under `sameDayGuard(fsrsCore)`.
- **Existing tests stay green:** `test-db` default (trivial) keeps C.1/C.2a `due === at + DAY_MS` assertions valid.
- **Playwright #C.3 (updated):** attempt → reload → advance **past the FSRS due** (read `due_at`, or +10d) → rule `due_now`. Plus the dial-persistence test (unchanged).
- **Full gate + MCP walkthrough:** lint/check/build/test/e2e green; real-UI walkthrough with the FSRS-aware clock advance. Evidence before claims (AGENTS.md).

## C.2b → C.2c line
- **C.2b:** FSRS behind `apply`; `sameDayGuard` (M3, worst-of-day); SM-2 + `rebuild` + replay proof; app swapped to FSRS. *(this doc)*
- **C.2c:** EWMA mastery + coverage-K meter (materialized + folded + inspector panel).
- **D / P1:** planner/priority; MC-tuned FSRS + mastery threshold values; `schedule_by_direction`.

## Notes / carried forward from C.2a review
- **M1 (tighten now):** `appendAttempt`'s `realized_count` update filters `sessionId` only, not `userId` (`repo.ts`). Fold counts per-user; this is the one spot the write-path and fold aren't structurally identical (unreachable today, but a multi-user rebuild would expose it). C.2b touches `repo.ts` for `rebuild` anyway — add `and(eq(sessions.userId, i.userId), eq(sessions.id, i.sessionId))` while here.
- **M3 (nice-to-have):** add the explicit unordered-input fold test the C.2a spec mentioned (fold walks as-given) — cheap, closes a spec↔test gap. Fold it into the C.2b domain test work.
