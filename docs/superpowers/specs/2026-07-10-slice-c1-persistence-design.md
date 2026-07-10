# Slice C.1 — persistence, ports, clock, trivial scheduler (design)

**Status:** design, ready for implementation-plan. **Date:** 2026-07-10.
**Issue:** #14 (part of Epic C #13). **Blocked-by:** #2 (ReviewLog schema — FROZEN 2026-07-10, so unblocked).
**Companions:** `2026-07-09-language-transfer-design-v2.md` (§State plane = frozen schema + fold signature), `language-transfer-requirements.md` (ledger), `final-review-report.md` (B1/B2, M3/M4/M6/M7/M9, m9), `AGENTS.md`.

## Why this slice
Slice C makes attempts persist and reschedule behind pure-fold ports with deterministic time. C.1 is the thin half (report m9's sub-split): the repository, the SQLite schema (incl. the **frozen, un-backfillable `ReviewLog`**), a deterministic clock, and a **trivial** scheduler — so the whole persistence spine is verifiable before FSRS/EWMA land in C.2. It replaces slice A's in-memory `session-service` grading path with a repo-backed, durable one.

## Scope

**In C.1 (#14):**
- `Clock`, `Scheduler`, `ReviewRepository` **ports** as pure contracts in `@lt/domain` (types + a trivial scheduler impl); Drizzle impl of the repo in `@lt/web` server.
- SQLite schema (Drizzle, STRICT): `review_log` (full frozen column set), `rule_state`, `item_exposure`, `sessions`, `users`. Hygiene: WAL, `busy_timeout=5000`, `synchronous=NORMAL`, `foreign_keys=ON`, epoch-int UTC, indexed `due`, one txn/attempt.
- **Forward-only committed migrations** (drizzle-kit `generate`; `migrate()` on boot + test setup; never `push`).
- Incremental projection: each attempt, in one transaction, appends the `ReviewLog` row, upserts `rule_state` (due via the trivial scheduler) for each tested schedulable rule, and bumps `item_exposure`.
- Injectable `Clock`; prod = wall clock; **env-gated test control-plane** to advance time instantly.
- Domain isomorphic-boundary lint (report M9) verified + a **tripwire test** proving it fails on a planted server import.
- `/inspector` gains a "scheduled rules" panel (durable `data-testid`s) so due-state is observable under the test clock; practice screen `/` persists attempts.
- Playwright #C.3: **attempt → reload (persisted) → advance 1 day → rule due again.**

**Explicitly deferred — C.2 (#15):** the general pure `fold(events, { scheduler, keyRemap }) -> state`; the rebuild-from-log test + **SM-2 replay** (swap = replay, not migration); FSRS timing (opaque blob); EWMA mastery + `coverage = count ≥ K` (M6); the **same-day / re-drill reinforcement-only guard** (M3); `set_lesson`/`current_lesson` as a fold + the **per-user** lesson dial (retiring the process-global `settings-service` and the e2e `workers:1` pin).

**Explicitly deferred — Epic D (#16–#19) / P1:** 2-stage seeded planner, adaptive trickle, star-as-event + priority ordering, end-of-session re-drill, and the session-navigation UX + progression prompts captured in the ledger backlog below.

## Decisions locked in brainstorming (2026-07-10, with Anthony)

1. **Projection = incremental apply-on-write** (not fold-on-read, not full-fold-per-write). `rule_state.due` is a materialized, indexed cache updated one-txn-per-attempt; ground truth stays `ReviewLog`. C.2's pure fold must reproduce this exact projection from the log (its rebuild test is where C.1's write path and C.2's fold are proven to agree — the one guard against divergence).
2. **Test clock = injectable `Clock` + env-gated control route.** No DB clock row, no boot-only env var (can't advance mid-walkthrough).
3. **Lesson dial migration deferred to C.2, and will be per-user then.** C.1 keeps reading `currentLesson` from the throwaway `settings-service`. (The dial only filters eligibility; it writes no attempts, so leaving it does not taint any persisted schedule.)
4. **FSRS swaps in at C.2**, behind the `Scheduler.apply` signature C.1 fixes now.
5. **Two-signal, two-threshold learning model** (resolves Anthony's "does FSRS allow same-session mastery?" — see next section). Mechanism recorded in the log now; values are Monte-Carlo-owned.

## FSRS × intense same-session drilling — the crux

Phase 0 is ~15 schedulable rules over lessons 1–5, drilled hard. FSRS is a *spaced* scheduler; naive same-session repetition would feed it `elapsed≈0` and thrash intervals (report M3/M4). Resolution — **the timing layer never sees the hammering, and never gates mastery**:

- **Timing (FSRS, C.2): ≤ 1 tick per rule per day.** Same-day / re-drill repeats are reinforcement-only — they update mastery + exposure but emit **no** second FSRS rating that day (collapse to the day's worst rating). So FSRS stays a legitimate spaced model; intervals grow across *days*, and well-known rules leave the daily queue. This is a `Scheduler`-port rule (C.2), not planner-local.
- **Mastery (EWMA + coverage, C.2): eats every rep, but rewards variety and spacing, not volume.** `coverage` counts **distinct instruments** `(item_id, exercise_type_key, param_key, direction)` ≥ K (M6 — a count, not a % of the live catalog). Showing four *different* items today is legitimate generalization evidence; showing the *same* item four times is coverage +1. Advisory only — never touches due dates.
- **Two thresholds, both a fold of the same attempt log (both C.2/D; values MC-owned):**
  - **Advance-lesson nudge** (Anthony's ~90%): recent accuracy on current-lesson rules crosses a **lenient, same-session-achievable** bar → offer to bump `current_lesson` (a `set_lesson` event; user's choice). Progression.
  - **Mastered** (exits active drilling → light maintenance): coverage-K **and** EWMA **and** a **spacing** signal (successes span distinct days). **Not** achievable in one marathon session — the pedagogy says mastery is spaced varied generalization, so a blitz cannot buy it.

**Why the due queue does not clog** (Anthony's second worry): the SRS unit is the **rule**, so a rule has exactly one `due` — answering N items of it updates one `rule_state` row, never N. The daily queue is bounded by *schedulable rules* (~10–15/lesson), never by items. Interval growth + mastered-exit + (D) planner caps/cooldown/fresh-instrument rotation keep it from filling with knowns or the same card.

**C.1 impact: none beyond honest recording.** C.1 stamps every attempt with `at` and the full instrument identity, so C.2 can fold either threshold and apply the same-day guard without a schema change. C.1's trivial scheduler ticks +1d on every attempt (no guard yet — correct for a placeholder).

## Ports (in `@lt/domain` — pure, isomorphic; enforced by the M9 lint)

```ts
// Time. Prod impl = wall clock (web); test impl = wall clock + mutable offset.
interface Clock { now(): number }            // epoch ms, UTC

// Timing seam. Opaque blob behind the port (design v2): FSRS→SM-2 = replay.
// Trivial C.1 impl: due = at + 86_400_000, blob = { last: at }. C.2 swaps FSRS in.
type SchedulerState = unknown               // opaque, versioned; JSON-serialisable
interface Scheduler {
  apply(prev: SchedulerState | null, rating: SrsRating, at: number):
    { blob: SchedulerState; due: number }
}

// Persistence seam. Types-only here; the Drizzle impl lives in @lt/web server.
// Every method takes/filters user_id (multi-user seam from day one, even at n=1).
interface ReviewRepository {
  startSession(i: { userId; mode; targetAttempts; at }): { sessionId }
  endSession(i: { userId; sessionId; at }): void
  appendAttempt(i: AttemptInput): void       // one txn: log row + rule_state upserts + exposure bump
  dueRuleStates(userId, now): RuleStateRow[]  // WHERE user_id AND due <= now ORDER BY due, rule_key, direction
  ruleStates(userId): RuleStateRow[]
  itemExposure(userId, itemId): ItemExposureRow | undefined
  events(userId): ReviewLogRow[]             // ordered (at, id) — for C.2's fold/rebuild
}
```
`AttemptInput` carries the full frozen attempt payload: `sessionId, itemId, ruleKeys[], exerciseTypeKey, paramKey, direction, rating, assessment, hintRevealed, latencyMs?, contentHash`. `at` comes from the injected `Clock`, not the caller.

The `ReviewLog` event union (kind-discriminated: `attempt | star | unstar | set_known | set_lesson | session_start | session_end`) is defined as TS types in the domain, matching design-v2 §State plane exactly. C.1 only *writes* `attempt` + `session_start`/`session_end`; the other kinds' columns exist (frozen) and are written by C.2 (`set_lesson`) and D (`star`/`unstar`/`set_known`).

## DB schema (Drizzle, SQLite STRICT, in `@lt/web` server)

- **`review_log`** — full frozen column set now (un-backfillable ground truth): `id` (autoinc PK), `user_id`, `at`, `kind`, `item_id?`, `rule_keys?` (JSON text), `exercise_type_key?`, `param_key?` (present-not-null for attempts; `''` for empty params), `direction?` (concrete `en>es`/`es>en`; never `'both'`), `rating?`, `assessment?` (JSON text), `hint_revealed?`, `latency_ms?`, `content_hash?`, `session_id?`, `annotation_known?`, `annotation_lesson?`, `session_mode?`, `session_target_attempts?`. Non-applicable columns null per row. Index `(user_id, at, id)`.
- **`rule_state`** — PK `(user_id, rule_key, direction)`; `blob` (JSON text), `due` (int), `first_exposed_at` (int). Index `(user_id, due)`. `direction` always present with `'both'` sentinel (M7). *mastery/coverage columns added in C.2's migration (derived cache → cheap to extend by re-fold).*
- **`item_exposure`** — PK `(user_id, item_id)`; `times_seen`, `last_seen_at`, `last_rating`, `known` (int 0/1, default 0), `starred` (int 0/1, default 0). `known`/`starred` written by D's events; columns present now.
- **`sessions`** — `id` (PK), `user_id`, `started_at`, `ended_at?`, `mode`, `target_attempts`, `realized_count` (default 0).
- **`users`** — `id` (PK). Seeded one row `u1`. *`current_lesson` column added in C.2 with the folded per-user dial.*

Every per-user table carries `user_id`; every query filters by it. Booleans are int 0/1 (STRICT + SQLite). All timestamps epoch-int UTC.

## Migrations
drizzle-kit `generate` produces SQL under `app/packages/web/drizzle/`, committed. `drizzle.config.ts` committed. A `migrate()` runs at server startup and in test setup. **Forward-only; never `push`.** The initial migration also sets the connection pragmas (WAL, busy_timeout, synchronous, foreign_keys).

## Clock + test control-plane
- `Clock` interface in domain. Prod impl in web: `now = Date.now()`.
- Test impl: `now = Date.now() + offset`, `offset` a server-side singleton. Mutated only via an **env-gated** endpoint `POST /__test__/clock` with actions `advance(ms)` / `set(epoch)` / `reset`, active **iff** `LT_TEST_CONTROL=1`. When the flag is off the route is absent / no-op (cannot ship live). Playwright's preview server sets the flag.
- Attempts stamped with `clock.now()`; advancing the offset past a stored `due` makes that rule due — the mechanism the #C.3 walkthrough exercises.

## M9 isomorphic-boundary lint
The `no-restricted-imports` rule in `packages/domain/eslint.config.js` already bans `node:*`, `fs`/`path`/`crypto`/…, `better-sqlite3`, `drizzle-orm`, and Svelte(Kit) modules. C.1 verifies it covers the drivers introduced here and adds a **tripwire test**: plant a fixture importing `better-sqlite3` into the domain, run eslint programmatically, assert the M9 rule fires (and clean up). Turns "the boundary holds" into a checked claim, per the issue's acceptance.

## Observability + wiring (Playwright surface)
- `/inspector`: add a **scheduled-rules** panel — one row per `rule_state` (`rule_key`, `direction`, `due_at`, and `due_now` = `due <= clock.now()`), stable `data-testid`s, deterministic order `(due, rule_key)`. Reads the repo for the seeded user.
- `/` practice: `load` opens a session (repo.startSession) + renders a gated seed item; the submit action grades (domain) then `repo.appendAttempt` (durable + reschedules). Reload re-reads persisted state.
- Keep the scrappy UI automatable, not pretty.

## Edge cases (design step, per AGENTS.md — owner slice noted)
- **Dial thrashing** (rapid up/down): dialing writes **no attempts**, so no schedule is touched; only eligibility re-filters. In C.2 each change is a `set_lesson` event; `current_lesson = fold(last set_lesson, floor 1)` — many events, last wins, no corruption. *(C.1 safe by construction; C.2 confirms.)*
- **Reviewing old lessons** (dial lowered): older rules/items become eligible again; their `rule_state` was never deleted, so overdue ones resurface by `due`. Works without special-casing. *(C.1 persists; D surfaces.)*
- **Dial set below existing progress:** higher-lesson `rule_state` rows persist (not deleted), just ineligible until the dial rises again. No data loss.
- **Dial dropped mid-session:** plan is a snapshot; now-gated instruments are skipped at render; persisted state untouched; fully reversible. *(D render; C.1 state.)*
- **Caught up / empty due queue:** `dueRuleStates` returns `[]`; the panel shows nothing due; D offers weak/maintenance or a short "done" session.
- **Same-day repeat / re-drill:** C.1 trivial scheduler re-ticks +1d harmlessly; C.2 enforces reinforcement-only (≤1 FSRS tick/day, M3).
- **First attempt on a never-seen rule:** `rule_state` created, `first_exposed_at = at`, `due = at + 1d` (C.1) / FSRS-initial (C.2).
- **Attempt crediting multiple tested rules:** loop over `rule_keys`; upsert each tested schedulable rule's `rule_state`. Non-schedulable / `uses`-role refs are not scheduled.
- **Reload / server restart mid-session:** attempts durable (DB); the open session (no `session_end`) is resumable. #C.3 proves persist-survives-reload.
- **Empty / new user:** no rows; `dueRuleStates` `[]`; panel empty. Every query still filters `user_id`.
- **Prod clock safety:** `LT_TEST_CONTROL` unset → offset always 0, control route absent.
- **content_hash churn / orphaned rule_key:** attempt logs `content_hash` + denormalized `rule_keys`; edited-answer staleness policy is P1 (hash captured now); orphan rows accepted (tombstone), id-manifest snapshot guards silent loss.
- **Concurrency (n=1 now):** one txn/attempt + `busy_timeout`; SQLite single-writer suffices. Tripwire = >1 host serving the API → Postgres (design v2).

## Testing / verification
- **Domain unit:** trivial `Scheduler` (`due = at + 86_400_000`; blob round-trips); port type-contracts compile.
- **Web integration** (node, fresh temp SQLite per test, real migrations): `appendAttempt` persists a `review_log` row + upserts `rule_state` + bumps `item_exposure` in one txn; `dueRuleStates` honors the clock and `(due, id)` order; `user_id` filtering (a second user's rows never leak); STRICT rejects a malformed row; session open/close + `realized_count`.
- **Clock:** advancing the offset flips a stored rule from not-due to due.
- **M9 tripwire:** planted server import fails eslint.
- **Playwright #C.3:** attempt → reload (row persisted) → `POST /__test__/clock advance 1d` → the scheduled-rules panel shows the rule `due_now`. Evidence before claims (AGENTS.md).

## C.1 → C.2 → D line (explicit, so scope can't creep)
- **C.1:** durable attempts, indexed `due` via trivial scheduler, deterministic clock, one-txn projection, boundary lint. *(this doc)*
- **C.2:** pure `fold` + rebuild/replay proof; FSRS timing; EWMA mastery + coverage-K; same-day guard; per-user `set_lesson`/`current_lesson`.
- **D / P1:** planner, star, priority, re-drill; the two mastery thresholds' *values* (MC); the session-navigation UX + auto-advance prompt (ledger backlog).

## Backlog captured this session (see ledger)
Session-navigation UX (persist a resumable session; back/forward; revise a past answer; keep answering past the target) and the mastery-driven **advance-lesson prompt** (~90% recent accuracy) are new scope surfaced 2026-07-10. The frozen C schema supports all of them (append-only attempts, open/close session events, `set_lesson`, per-lesson mastery rollup) — recorded in the requirements-ledger backlog, deferred to D/P1, not built in Phase-0 slice C.
