# Slice D.2 — bounded-session lifecycle + end-of-session re-drill + caught-up (design)

**Status:** design, ready for implementation-plan. **Date:** 2026-07-14.
**Issue:** second sub-slice of Epic D (planner + star). **Follows:** D.1 (star + SessionPlanner seam + deterministic 2-stage core — merged to `main` at `460c895`). C.1/C.2a/C.2b/C.2c/D.1 all green on `main`.
**Companions:** `2026-07-14-slice-d1-planner-star-design.md` (D.1 — the planner + the session-model divergence this slice reconciles), `2026-07-09-language-transfer-design-v2.md` (§Session orchestration, §State plane), `language-transfer-requirements.md` (ledger; [VARIETY][DIST][LOG]), `scheduler-monte-carlo-experiment.md` (owns knob *values*), `AGENTS.md`.

## Why this slice
D.1 landed the pure 2-stage `SessionPlanner` and a live practice route that serves the deterministic greedy head. But the **session is open-ended**: D.1 ships a *reuse-or-create* model — `load` reuses the user's latest practice session (creating one lazily only when something is servable), and **no code ever ends a session**. `targetAttempts` (=10) and `realized_count` are stored on the session row but **never enforced**: a session runs forever, `realized_count` climbs without bound, and there is no "you're done for now" state. Three D.1-deferred pieces all wait on a bounded session:

- **End-of-session re-drill of misses** (design-v2 §Session orchestration; ledger Rating decision) — only meaningful if a session *has* an end.
- **Caught-up / empty session UX** — "you've done your ~10 minutes" and "nothing is due" are *end states* a session must be able to reach.
- **`targetAttempts`/`realized_count` becoming meaningful** — the budget only has teeth if the session ends when the budget is spent.

D.2 lands the **session lifecycle** — the keystone the other two lean on — plus re-drill and the caught-up screen on top of it. It **reconciles the D.1 divergence** (below) and tidies the benign concurrent-first-load race D.1 noted.

## Reconciling the D.1 → decision #2 divergence
D.1's design doc (decision #2, §Seeded RNG + live consumption) specified: serve `planSession(ctx, N)[0]` where `N = targetAttempts − realized_count`, seeding a **new** PRNG per session from `sessionId`. D.1 **shipped** something different and left the doc stale: reuse-or-create session, `seededRng(session.id)` (stable across reloads), greedy head `planSession(ctx, 1)[0]`, `N` **not** enforced, **no session-ending**. The shipped change was correct for D.1 (minting a session per GET made the star toggle unreliable and wrote a session row on every page view — a regression; enforcing a 10-budget on a *reused* session would brick practice after 10 attempts).

**D.2 honours decision #2's *intent* — budget-bounded ~10-min sessions — via a cleaner mechanism than its literal code:**
- The budget is enforced by a **phase gate** (`realized_count < targetAttempts`), not by threading `N` into `planSession` (the greedy head is `n`-independent, so it stays `n = 1`).
- A session **ends** when the budget is spent (after a re-drill tail); the **next** session is a *fresh* row (`realized_count = 0`) started by an explicit user action — so budget enforcement no longer bricks practice (the D.1 concern dissolves once a session can end and a new one can begin).
- The per-**open-session** seed (`seededRng(session.id)`, stable across reloads) is **kept** from D.1's shipped model (not decision #2's per-GET reseed). A new session gets a new id → a new seed.

This doc is the authoritative session-model statement; D.1's decision #2 is superseded by §Lifecycle below.

## Scope

**In D.2:**
- **Session lifecycle state machine** — a pure `sessionPhase(...)` (new `@lt/domain/src/session/`) shared by the practice route's `load` (render) and `submit` (decide-to-end), so both agree on "is this session complete." Phases: `main` (budget remaining + a servable head) → `redrill` (budget spent or head empty, unresolved misses remain) → `complete` (write `session_end`).
- **Budget enforcement** — `PLANNER_KNOBS.targetAttempts` becomes the live per-session budget via the phase gate. `realized_count` (already folded/maintained) drives it.
- **End-of-session re-drill** — a pure `redrillQueue(...)` re-serves this session's *unresolved misses*, bounded per instrument. Stateless: derived from the session's persisted `attempt` log, not in-memory state — preserving D.1's no-plan-persistence discipline.
- **Caught-up / done screen** — replaces the bare `no-item` block: session summary (attempts / correct / re-drilled) + a **Start another** control; distinct copy for "budget done" vs "nothing servable."
- **`load` becomes side-effect-free** — session creation moves out of `load` into an explicit `?/start` action; `submit` writes `session_end` on completion. This **eliminates the concurrent-first-load race** (a `load` creates nothing) and removes the GET-mutation smell.
- **Repo deltas (no schema change):** `currentSession` → latest **unended** practice session; new `sessionAttempts(userId, sessionId)` read; `endSession` (already present) now called.
- **Observability:** an inspector session panel (current session id / `realized`/`target` / ended, and the open session's re-drill queue) — lifecycle becomes deterministically e2e-assertable.
- Full gate (`lint`/`check`/`build`/`test`/`test:e2e`) + M9 + MCP walkthrough; **evidence before claims**.

**Deferred — D.3:** adaptive new-lesson **trickle** sizing (shrink `newRuleCapPerSession` when the review backlog is high). Orthogonal to the lifecycle (a planner-internal read of `dueRuleStates` count); its own design + plan.

**Deferred — P1:** persisted / resumable session navigation (back / forward / revise / resume mid-session); the advance-lesson nudge; difficulty-weighting; Monte-Carlo-tuned knob *values*; exercise-type selection.

**Explicitly NOT D.2:**
- Any change to `due`, the scheduler, the scheduler blob, the M3 same-day guard, or the planner's priority/Stage-2 logic (the planner still only *reads* `due`; re-drill reads the log).
- **Any `ReviewLog` schema / event-kind change.** `session_end` is a **frozen** kind (design-v2 §State plane) already handled by the fold and `repo.endSession`; D.2 reuses it. No migration.
- Tuning any knob value (MC-owned; D.2 ships a marked placeholder for the one new knob).
- Persisting a plan or the re-drill set (both are re-derived from persisted state each load — the process-global isolation problem C.2a removed).

## Decisions locked in brainstorming (2026-07-14, with Anthony)

1. **Decompose Epic D.2 two ways.** D.2 = bounded-session lifecycle + caught-up + re-drill (this doc). D.3 = adaptive trickle. Cut on the real dependency seam: everything that needs a bounded session lands in D.2; the orthogonal planner-knob adaptivity is D.3. Keystone sequenced first. Rejected: one big slice (larger than D.1's already-dense surface); a 3-way split (re-drill is coupled to the lifecycle — it's the phase between budget-reached and `session_end` — so splitting it off fragments one coherent story).
2. **A session is bounded by budget + a re-drill tail.** Main phase serves the greedy head until `realized_count == targetAttempts` (or the plan empties first); then a re-drill tail serves unresolved misses; then `session_end` + a done screen. Rejected: caught-up-bounded-only (leaves `targetAttempts` meaningless, sessions open-ended until caught up); explicit-end-only (a user who keeps answering never triggers re-drill/caught-up — the bound isn't system-enforced).
3. **Explicit continue.** After `session_end`, the done screen shows a summary + a **Start another** button (`?/start` → fresh `startSession`). The budget is a real stopping point and the done/caught-up state is a visible, e2e-assertable screen.
4. **`load` is side-effect-free; cold start is explicit.** Session creation moves out of `load` into the `?/start` action; cold start (no session yet) renders a "Start practicing" screen. This eliminates the concurrent-first-load race (loads create nothing) and makes `load` a pure read — the reviewer-defensible model, symmetric with explicit-continue. Cost: cold start gains one click; D.1's practice e2e adds a Start click. Rejected: keep D.1's auto-create-in-load (retains the GET-write + a residual race).
5. **Re-drill is a stateless re-plan from the log, not in-memory state.** The unresolved-miss set is derived from the session's persisted `attempt` rows each load — no plan/queue persistence, no server-side session cache (mirrors D.1's stateless greedy head).
6. **Reuse the frozen `session_end` kind.** No new event, no `ReviewLog` schema change, no migration — the fold and `repo.endSession` already handle it, so fold ≡ incremental projection holds with zero fold change and the C.2*/D.1 rebuild/replay proofs do not regress.

## Lifecycle — the pure state machine (`@lt/domain/src/session/`)

New module `session/` (parallels `planner/`, `mastery/`): `phase.ts`, `redrill.ts`, `summary.ts`, co-located `*.test.ts`, `index.ts`; re-exported from the domain entrypoint. Pure / isomorphic (M9-clean); no clock / rng needed (time is injected at the route, the log carries `at`).

The correctness lever is that **`load` and `submit` share one completion decision.** If they diverged, a session could end while the UI still serves a question against a dead `sessionId`, or never end. So the decision is one pure function:

```ts
// phase.ts
import type { Instrument } from '../planner';

export type Phase =
  | { kind: 'main'; pick: Instrument }
  | { kind: 'redrill'; pick: Instrument }
  | { kind: 'complete' };

/**
 * The session's current phase, a pure function of persisted state. Budget is enforced HERE
 * (the `realized < target` gate), not by threading N into planSession — the greedy head is
 * n-independent. A null head (plan emptied before the budget was spent) falls straight through
 * to the re-drill tail / completion, so a light day is a short session.
 */
export function sessionPhase(i: {
  realizedCount: number;
  targetAttempts: number;
  head: Instrument | null;   // planSession greedy head at current state (null if the plan is empty)
  redrill: Instrument[];     // unresolved-miss instruments, eligibility-filtered + ordered
}): Phase {
  if (i.realizedCount < i.targetAttempts && i.head) return { kind: 'main', pick: i.head };
  if (i.redrill.length > 0) return { kind: 'redrill', pick: i.redrill[0] };
  return { kind: 'complete' };
}
```

**Where writes happen:**
- **`submit`** — `appendAttempt` (unchanged: credits the item's full tested + schedulable `ruleKeys`, bumps `realized_count`), then **recompute `sessionPhase` from the post-append state**; if `complete`, call `endSession`. Because normal completion is *caused by an attempt* (the attempt that spends the last of the budget, or exhausts the due pool, or resolves the last miss), `submit` is where `session_end` is written in the normal flow.
- **`?/start` action (new)** — `endSession(any lingering open session)` then `startSession(...)`; backs the **Start another** button and cold start. Ending-any-lingering-open makes `start` idempotent against the rare non-attempt-triggered completion (see edge cases).
- **`load`** — **pure read.** Computes `head` + `redrill` + `sessionPhase`, renders. Creates nothing, ends nothing.

## Re-drill — pure, stateless, log-derived (`redrill.ts`)

```ts
// redrill.ts
import type { Instrument } from '../planner';
import type { Direction, SrsRating } from '../exercise/types';

/** The projection of one session's `attempt` rows the re-drill logic needs. */
export interface RedrillAttempt {
  itemId: string;
  exerciseTypeKey: string;
  paramKey: string;
  direction: Direction;
  ruleKeys: string[];   // logged tested rules — first is carried onto Instrument.ruleKey for observability
  rating: SrsRating;
  at: number;
}

export interface RedrillKnobs {
  redrillMaxAttemptsPerInstrument: number; // bounds the tail; a stubborn miss re-drills at most (cap-1) times
}

/**
 * The ordered set of this session's UNRESOLVED misses to re-drill before closing. Pure: a function
 * of the session's attempt rows (in (at,id) order) + an eligibility predicate. No store, no rng.
 */
export function redrillQueue(
  attempts: readonly RedrillAttempt[],
  isEligible: (itemId: string) => boolean, // item still exists + isVisible at the current lesson
  knobs: RedrillKnobs
): Instrument[];
```

- **Miss** = an attempt rated `again` — the only "incorrect" rating (a hint-revealed-but-correct answer caps at `hard`, which is **not** a miss).
- Group attempts by instrument identity `(itemId, exerciseTypeKey, paramKey, direction)`. A group is an **unresolved-miss candidate** iff: its **latest** attempt this session is `again`, **and** `group.length < redrillMaxAttemptsPerInstrument` (bounds the tail — an instrument re-drills at most `cap - 1` times, then waits for a future session's normal due/weak flow), **and** `isEligible(itemId)`.
- **Ordered earliest-miss-first** (by the `at` of the group's first `again`) — deterministic; re-drill is a fixed set, not a sampled one, so it needs no RNG.
- `Instrument.ruleKey` on a re-drill pick is set to the missed attempt's first logged `ruleKey` (**observability only**; the re-drill submit re-credits the item's full tested `ruleKeys` in the route, exactly as a normal attempt).
- **M3 firewall:** a same-day re-drill is reinforcement-only (no second FSRS tick) — already enforced by the same-day-guard `Scheduler` wrapper (C.2b). Re-drill still updates mastery + exposure. D.2 adds nothing here.

**Done-screen summary** (`summary.ts`, pure over the session's attempts):
```ts
export function sessionSummary(attempts: readonly RedrillAttempt[]): {
  attempts: number;            // = realized_count
  correct: number;             // rating !== 'again'
  redrilled: number;           // instruments served more than once this session
};
```

## Route + repo

**Repo / port (`ReviewRepository`) — no schema change:**
- `currentSession(userId)` → latest **unended** (`endedAt IS NULL`) practice session, or `undefined`. (D.1 returned the latest regardless of `endedAt`; the one-open-session invariant needs "unended.") Keeps D.1's stable seed *within* an open session.
- `sessionAttempts(userId, sessionId)` → **new**; the `attempt` rows for that session ordered `(at, id)` (filters `user_id`). Input to `redrillQueue` + `sessionSummary`.
- `endSession(i)` — already implemented (updates `sessions.ended_at` + appends the `session_end` event); now actually called by `submit` + `?/start`.
- `startSession`, `appendAttempt` — unchanged.

**Practice `+page.server.ts`:**
- `load` (pure): `open = currentSession(user)`.
  - **No open session** → render idle. The summary (if any) comes from the **most-recent session row overall** — `repo.sessions(user)` last; when `currentSession` (unended) is null, that row is either absent (cold — "Start practicing") or ended (post-completion — its `sessionSummary(sessionAttempts(user, id))` + Start another). Both post `?/start`.
  - **Open session** → build the planner ctx (seed `seededRng(open.id)`), `head = planSession(ctx, 1)[0] ?? null`; `redrill = redrillQueue(sessionAttempts(open), isEligible, knobs)` where `isEligible(id) = store.get(id) && isVisible(store.get(id), currentLesson)`; `phase = sessionPhase({ realizedCount: open.realizedCount, targetAttempts: open.targetAttempts, head, redrill })`.
    - `main` / `redrill` → render the pick (prompt via `transformationType.promptRenderer`, star state, `sessionId`, `direction`, and a `phase` flag so the UI shows a re-drill badge).
    - `complete` → render the done screen for `open` (its summary + Start another). (Normally `submit` has already ended it; this handles the rare non-attempt completion — see edge cases.)
- `submit`: grade + `appendAttempt` (unchanged crediting). Then recompute `head`/`redrill`/`sessionPhase` from the post-append state; if `complete`, `endSession(open)`. Return the grade verdict as today; the re-run `load` serves the next phase.
- `?/start`: `endSession` any lingering open session, then `startSession({ userId, mode: 'practice', targetAttempts: PLANNER_KNOBS.targetAttempts, at: clockNow() })`.
- `?/star`, `?/unstar`: unchanged.

**Practice `+page.svelte`:** the `{:else}` (no active pick) branch becomes the idle/done/caught-up screen — summary block (`data-testid`s: `session-summary`, `summary-attempts`, `summary-correct`, `summary-redrilled`) + a `?/start` form (`data-testid="start-session"`); a `data-testid="caught-up"` vs a session-done message chosen from the data. Main/redrill render as today plus a `data-testid="redrill-badge"` when `phase === 'redrill'`.

## Knobs
`PLANNER_KNOBS` gains one **placeholder, Monte-Carlo-owned** knob; `targetAttempts` (already present, =10) becomes the *enforced* budget:
```ts
// added to PlannerKnobs + PLANNER_KNOBS — Monte-Carlo-owned placeholder, NOT tuned
redrillMaxAttemptsPerInstrument: 2, // Monte-Carlo-owned — a missed instrument re-drills at most once
```
Kept in `PLANNER_KNOBS` alongside `targetAttempts` (the existing session-budget knob) rather than a new config surface. `redrillQueue` reads only the fields it needs (`RedrillKnobs`), so its unit tests inject a focused knobs object.

## Edge cases (per AGENTS.md)
- **Cold start, nothing servable** (new user on lesson 1 — no Spanish yet) → idle screen, "All caught up / nothing to practice"; no session created (loads are side-effect-free).
- **Plan empties before budget** (fewer due rules than `targetAttempts`) → `head === null` while `realized < target` → straight to re-drill tail → complete. A light day is a short session.
- **Budget spent, no misses** → the attempt that hits `realized == target` makes `sessionPhase` `complete` (empty re-drill) → `submit` writes `session_end` → done screen.
- **Stubborn miss** (re-drilled and missed again) → its group reaches the cap → drops from the queue → the tail can end. It returns via the next session's normal due/weak flow; M3 keeps its timing reinforcement-only in the meantime.
- **Missed item gated out mid-session** (dial dropped) → `isEligible` excludes it from the re-drill queue; the logged miss is untouched (reversible).
- **Non-attempt completion** (clock advanced via test control, or the dial changed, emptying the plan with no completing submit) → the open session is `complete`-by-derivation but still `endedAt IS NULL`; `load` renders the done screen read-only; the next `?/start` ends it before creating the fresh one. This is strictly better than D.1 (where no session ever ends); the only residue is an *abandoned* such session lacking `session_end`, an accepted bounded edge (the alternative — ending in `load` — reintroduces the GET-mutation this slice removes).
- **Concurrent first load** → both loads create nothing (session birth is the `?/start` POST, a single user action) → the D.1 race is gone.
- **Refresh on the done screen** → `open` is null (or `complete`), the latest ended session re-summarised read-only; idempotent, no re-write.
- **Determinism** → `sessionPhase` + `redrillQueue` are pure and RNG-free; the open-session seed is stable across reloads (unchanged from D.1).

## Invariants preserved
- **No `due`/scheduler/planner-logic change.** The planner still only *reads* `due`; re-drill reads the `attempt` log; mastery stays advisory.
- **No `ReviewLog` schema / event-kind change.** `session_end` is frozen and already folds; `realized_count` already folds. **fold ≡ incremental projection holds with zero fold change** → the C.2*/D.1 rebuild/replay proofs do not regress (a D.2 web-integration test re-asserts `session_end` + `realized_count` fold identically).
- **`@lt/domain` stays isomorphic + deterministic** (M9 lint; `sessionPhase`/`redrillQueue`/`sessionSummary` pure; no `Date.now`/`Math.random`; time/rng injected at the route).
- **Every per-user read filters `user_id`** — including the new `sessionAttempts`.
- **No plan / session-plan persistence, no process-global** — phase + re-drill are re-derived from persisted state each load.
- **MC-owned values are placeholders** — `redrillMaxAttemptsPerInstrument` marked, not tuned.

## Tests
- **Domain unit** (`phase.test.ts`, `redrill.test.ts`, `summary.test.ts`): every `sessionPhase` transition (main; head-null-before-budget → redrill/complete; budget-spent → redrill vs complete); `redrillQueue` miss-detection, resolution-drops-a-group, cap-bounding (stubborn miss drops), eligibility filter, earliest-miss ordering, determinism; `sessionSummary` counts (correct = non-`again`, redrilled = served-more-than-once).
- **Web integration**: full lifecycle across *real* submits against the content store + fold — `main` (to budget) → `redrill` (a seeded miss) → `complete` → `session_end` written; `realized_count` matches; **fold parity** (`fold(events(u))` reproduces the ended session + `realized_count`; rebuild proof intact); `?/start` ends the old + creates a fresh session; cold-start idle vs caught-up render; per-user isolation.
- **e2e (Playwright)**: seed a due state → **Start** → answer to budget → a re-drill pick appears (`redrill-badge`) → resolve it → done screen (`session-summary`) → **Start another** → a fresh session serves. Rework D.1's practice e2e for the explicit Start (cold start no longer auto-serves). Deterministic assertions via the inspector session panel + DB-reset control.
- **Invariants**: budget respected (session never serves a `main` pick past `target`); re-drill never serves a non-missed or ineligible instrument; tail bounded by the cap.

## D.1 → D.2 → D.3 → P1 line (so scope can't creep)
- **D.1:** star + `SessionPlanner` seam + deterministic 2-stage core + greedy live consumption + distribution harness. *(shipped)*
- **D.2:** bounded-session lifecycle (budget + re-drill tail + `session_end`) + caught-up/done screen + side-effect-free load; reconciles the D.1 divergence. *(this doc)*
- **D.3:** adaptive new-lesson trickle sizing (backlog-driven `newRuleCapPerSession`).
- **P1:** persisted / resumable session navigation; advance-lesson nudge; difficulty-weighting; Monte-Carlo-tuned knob *values*; exercise-type selection.

## Notes
- The lifecycle's whole risk is the **load/submit agreement** on completion; making it one pure `sessionPhase` shared by both (rather than duplicated route conditionals) is what keeps that correct and exhaustively testable — the same discipline that made the D.1 planner a pure `planSession`.
- Re-drill deliberately re-derives from the log rather than holding an in-memory queue: it inherits the log's ground-truth (a mid-session reload / dial-drop is handled for free) and keeps the no-plan-persistence property that lets the shared e2e server stay stateless.
- Moving session creation into an explicit action is the quiet structural win: it turns "sessions never end + a first-load race + GET-mutation" into "sessions are bounded in the ground-truth log + no race + pure load," for the cost of one cold-start click.
