# Slice C.2a — pure fold + per-user lesson dial + rebuild proof (design)

**Status:** design, ready for implementation-plan. **Date:** 2026-07-11.
**Issue:** first sub-slice of #15 (C.2; part of Epic C #13). **Follows:** #14 (C.1 persistence — merged on `main`).
**Companions:** `2026-07-09-language-transfer-design-v2.md` (§State plane = frozen schema + fold signature), `2026-07-10-slice-c1-persistence-design.md` (the incremental projection this fold must reproduce), `language-transfer-requirements.md` (ledger), `AGENTS.md`.

## Why this slice
C.1 shipped the persistence spine: an **incremental apply-on-write** projection (each attempt updates `rule_state`/`item_exposure`/`sessions` in one transaction) with `ReviewLog` as ground truth and a **trivial** scheduler (`due = at + 1d`). The projection is a hand-maintained cache; nothing yet proves it agrees with the log it is supposed to summarize.

C.2a builds that proof. It adds the pure `fold(events, { scheduler, keyRemap }) -> state` in `@lt/domain` and a **rebuild test** asserting `fold(events(u))` equals the live incremental projection. It also converts the last process-global piece of per-user state — the lesson dial — into a `set_lesson` event folded into a per-user `users.current_lesson`, retiring slice B's throwaway `settings-service`.

Deliberately **still the trivial scheduler.** With `trivialScheduler` on both sides, fold-vs-write-path agreement is nearly tautological — which is the point: it gives us a *clean, proven fold harness* before FSRS's same-day guard (C.2b) and the EWMA/coverage meter (C.2c) introduce the real divergence risk. Land the seatbelt before the speed.

## Scope

**In C.2a:**
- Pure `fold(events, { scheduler, keyRemap }) -> FoldState` in `@lt/domain` (isomorphic; enforced by the M9 lint). A total interpreter of the **frozen** `ReviewLogEvent` union — all seven kinds — producing `{ currentLesson, ruleStates, itemExposures, sessions }`.
- `rowToEvent(row)` adapter narrowing a nullable `ReviewLogRow` (repo read-back) to the clean discriminated `ReviewLogEvent`, throwing on a malformed row (surfaces corruption instead of folding garbage).
- `keyRemap` seam wired honestly: parameter present, identity default, applied fold-side to each tested `ruleKeys` entry; a unit test proving a 2-key→1-`rule_state` collapse.
- **Rebuild proof** (web integration): drive the real repo (session, attempts across clock advances, `set_lesson`), read `events(u)`, `fold` with `trivialScheduler` + identity remap, assert deep equality with the live projection (`ruleStates`, `itemExposures`, `sessions`, `currentLesson`).
- Per-user lesson dial: `set_lesson` event + `users.current_lesson` cache (one txn, incremental — the C.1 pattern); new repo methods `setLesson` / `currentLesson` / `sessions` / `itemExposures`; forward-only migration adding `users.current_lesson`.
- Retire `settings-service` (delete it + its test; rewire the two routes); relocate the content-derived `maxLesson` helper to `content-loader`.
- Inspector dial actions write `set_lesson` through the repo; both routes read `currentLesson` from the per-user cache.

**Deferred — C.2b (next sub-slice):** FSRS timing behind `Scheduler.apply` (`ts-fsrs`); the **same-day / re-drill reinforcement-only guard** (M3, ≤ 1 tick/rule/day, day's-worst collapse) held **inside the scheduler blob** so both write-path and fold get it through the one `apply` seam; **SM-2-on-rule** as the second impl + the **replay proof** (re-fold the same log through a different scheduler = new `due`, no migration); the **rebuild-write** repo method (drop + re-materialize the projection from fold) that replay and rename need.

**Deferred — C.2c:** EWMA mastery + distinct-instrument `coverage ≥ K` (M6) — new `rule_state` columns, folded + incrementally materialized (distinct-instrument set stored for dedup), inspector mastery panel.

**Explicitly NOT C.2a (handoff correction):** dropping the e2e `workers:1` pin. The pin has **three** serial-forcing process-globals on the single shared preview server: the dial (removed here), **the clock offset**, and **the shared `:memory:` DB + seed user `u1`**. Removing the dial global does not unblock parallelism on its own — advancing the clock or writing attempts in one worker still pollutes another. Dropping `workers:1` needs per-test isolation (per-test user + per-test clock offset, or a per-worker server/DB) and is its own task, tracked separately.

## Decisions locked in brainstorming (2026-07-11, with Anthony)

1. **Fold is canonical; the projection is a monotonic-time cache** (equality contract A). The invariant is `fold(events) == projection` **when `at` is non-decreasing** — the production wall-clock guarantee. The rebuild test asserts equality on monotonic sequences (including clock-advance). Under a backward clock (`set` into the past via the test control-plane; also real-world NTP steps and P3 multi-device offline sync) the incremental cache **may** differ, and **fold wins** — this is exactly what "ReviewLog is ground truth, the projection is a convenience" means. Fold ordering is the frozen total order `(at, id)`; the cache is arrival (id) order; they coincide iff time moves forward. Rejected: making the write-path order-independent (contradicts C.1's locked apply-on-write; costs a per-attempt re-fold) and forbidding backward clock (regresses C.1's shipped `set`/`reset`, and would not help P3 sync anyway).
2. **Dial clamp split.** The route clamps a requested lesson to `[1, maxLesson]` (content-derived, not per-user, not folded) **before** emitting, so no absurd value is ever logged. The **fold** independently applies only `currentLesson = max(1, annotationLesson)` — it floors at 1 and never upper-clamps, staying pure over events and blind to which lessons content defines. A stale `set_lesson 999` after content shrinks folds to 999 → gating shows everything ≤ 999 (harmless); the route prevents it going forward.
3. **keyRemap wired but not populated.** The parameter exists with an identity default and is applied fold-side; no real rename map is built (none is needed). One unit test proves the collapse. The write-path does **not** remap (it writes current keys); identity today keeps write-path and fold in agreement, so the rebuild proof is green. A real rename later is a fold-time map plus a rebuild-write (C.2b) — documented, not C.2a's concern.
4. **Fold snapshots are YAGNI** (recorded in the ledger backlog 2026-07-11). Rule-grain keeps a user's log to ~thousands of events; fold is sub-millisecond. If ever built: a separate table (never in `ReviewLog`), keyed by covered-`at`, invalidated by late arrivals, version-stamped, with fold-from-zero as the arbiter.

## The fold (pure, isomorphic, `@lt/domain`)

```ts
type KeyRemap = (ruleKey: string) => string           // default: (k) => k

interface FoldState {
  currentLesson: number                                // floor 1
  ruleStates: RuleStateRow[]                           // sorted (ruleKey, direction) for determinism
  itemExposures: ItemExposureRow[]                     // sorted (itemId)
  sessions: SessionRow[]                               // sorted (id)
}

function fold(
  events: ReviewLogEvent[],
  opts: { scheduler: Scheduler; keyRemap?: KeyRemap }
): FoldState
```

Walk events **as given** (the repo hands them back in `(at, id)` order; `fold` does not re-sort — order is the caller's contract, matching the frozen total order). Accumulate:

- **attempt** — for each raw key in `ruleKeys`, `ruleKey = keyRemap(raw)`; the `rule_state` key is `(ruleKey, BOTH_DIRECTION)` (C.1/C.2a do not schedule by direction — the attempt's concrete `direction` is retained in the log for C.2c coverage, but the timing unit stays direction-agnostic via the M7 sentinel, matching `repo.ts`). `{ blob, due } = scheduler.apply(prev?.blob ?? null, rating, at)`; `firstExposedAt = prev?.firstExposedAt ?? at`. Bump the item's exposure (`timesSeen += 1`, `lastSeenAt = at`, `lastRating = rating`; `known`/`starred` preserved). Increment `realizedCount` of the referenced session **if it exists** (an attempt citing an unknown session updates nothing — matches `repo.ts`, whose `UPDATE` touches 0 rows).
- **session_start** — create the session (`startedAt = at`, `endedAt = null`, `mode`, `targetAttempts`, `realizedCount = 0`).
- **session_end** — set the session's `endedAt = at`.
- **set_lesson** — `currentLesson = max(1, annotationLesson)`.
- **star / unstar / set_known** — set the item exposure's `starred` / `known` flag. If no exposure row exists yet (annotate-before-attempt), create one with `lastSeenAt = at`, `timesSeen = 0`. *Provisional*: these three kinds have **no writer** in C.2a (D adds them), so this branch is unit-tested in isolation, not in the rebuild proof; D confirms the create-if-missing semantics when the writers land. Implemented now so `fold` is a total interpreter of the frozen union rather than a partial function reopened every slice.

`fold` never inspects the scheduler blob (opaque, per design v2) and performs no I/O. It depends only on domain types (`Scheduler`, `ReviewLogEvent`, the `*Row` shapes, `BOTH_DIRECTION`) — no content store, no persistence, no Node built-ins.

## Fold ↔ write-path equality contract (A)

**Invariant (production contract):** with `at` non-decreasing, `fold(events(u), { scheduler, keyRemap: identity })` deep-equals the live projection: `ruleStates(u)`, `itemExposures(u)`, `sessions(u)`, and `users.current_lesson`.

Both sides run the **same `Scheduler` instance** (`trivialScheduler` in C.2a), so timing agrees by construction; the test's job is to catch a divergence in the *fold logic* (ordering, first-exposed carry-forward, exposure counting, session `realizedCount`, `set_lesson` folding), which is where a hand-written incremental updater and a fold can silently drift.

The rebuild test drives the **real repo** (not hand-built rows) so it exercises the exact write path C.1 shipped: open a session; several attempts on overlapping rules/items; advance the clock a day (forward — monotonic); a `set_lesson`; more attempts; `endSession`. Then read `events(u)`, fold, and assert equality. Blobs compare as JSON; maps normalize to sorted arrays.

Documented alongside the test: under a **backward** clock the two may differ and fold is authoritative — not a bug, the definition of the cache.

## Per-user lesson dial (retire `settings-service`)

Slice B's `settings-service` is a single process-global `currentLesson` — fine at n=1 in-memory, wrong for a per-user durable app and a source of the e2e serial pin. C.2a folds it in:

- **`users.current_lesson`** — new column, `INTEGER NOT NULL DEFAULT 1`. The per-user cache of `fold(...).currentLesson`. Seed `u1` covered by the default.
- **`repo.setLesson({ userId, lesson, at })`** — one transaction: append a `set_lesson` `ReviewLog` row (`annotationLesson = lesson`) **and** upsert `users.current_lesson = lesson`. The caller (route) has already clamped to `[1, maxLesson]`; the DB stores that value; a re-fold would `max(1, …)` it (identical, since already ≥ 1).
- **`repo.currentLesson(userId)`** — read the `users.current_lesson` cache (fast; the incremental projection). The fold recomputes the same value; the rebuild test asserts they match.
- **`maxLesson`** — the content-derived ceiling (highest seeded `homeLesson`) moves from `settings-service` to `content-loader` as a plain helper. Not per-user, not persisted, not folded — purely a UI clamp bound.
- **Routes:** `inspector/+page.server.ts` `up`/`down`/`set` actions compute the clamped target and call `repo.setLesson(...)` with `clockNow()`; `load` reads `repo.currentLesson(locals.user.id)` and `maxLesson()`. `+page.server.ts` (practice) reads `currentLesson` from `repo.currentLesson(locals.user.id)`.
- Delete `settings-service.ts` and `settings-service.test.ts`.

## keyRemap seam
`fold`'s `keyRemap` collapses a renamed rule's history onto one `rule_state` at fold time (the log is immutable — a rename is never a row rewrite; design v2 m7/M8). C.2a ships the identity default and a single unit test: two distinct raw keys mapped to one target fold into a **single** `rule_state` whose `blob`/`due` reflect **both** attempts in `(at, id)` order. No production rename map exists yet.

## DB schema + migration
- Add `current_lesson` to `users` in `schema.ts` (`integer('current_lesson').notNull().default(1)`).
- `drizzle-kit generate` → new forward-only migration under `drizzle/` (committed). SQLite `ALTER TABLE users ADD COLUMN current_lesson INTEGER NOT NULL DEFAULT 1` — safe on the STRICT table; the `DEFAULT 1` backfills the existing `u1` row. `migrate()` already runs on boot + test setup. Never `push`.
- No other schema change (`set_lesson`'s `annotation_lesson` column is already in the frozen `review_log`).

## Domain / ports changes
- New module `packages/domain/src/fold/` — `fold.ts` (the fold + `rowToEvent` + `KeyRemap`/`FoldState` types), `fold.test.ts`, `index.ts`; re-exported from the domain entrypoint.
- New `SessionRow` type + `SetLessonInput { userId; lesson; at }` in the repository port.
- Extend `ReviewRepository`: `setLesson(i: SetLessonInput): void`, `currentLesson(userId: string): number`, `sessions(userId: string): SessionRow[]`, `itemExposures(userId: string): ItemExposureRow[]` (the last two — list reads for the full-projection rebuild comparison, alongside the existing `ruleStates(userId)`; also future use).
- `DrizzleReviewRepository` implements the three; all filter/carry `user_id`.

## Observability + wiring (Playwright surface)
- Inspector dial still shows `currentLesson` / `maxLesson` and the up/down/set controls — now durable and per-user. Existing `data-testid`s unchanged so the slice-B dial e2e keeps passing.
- The scheduled-rules panel is unchanged (already repo-backed in C.1).
- No new screen. The visible behavior change: the dial now survives reload (it is DB-backed), which the dial e2e can additionally assert.

## Edge cases (per AGENTS.md)
- **Backward clock / out-of-order arrival:** fold is authoritative; the cache may lag (contract A). Covered by a fold unit test on a deliberately out-of-order event list (fold sorts nothing; the *caller* guarantees `(at, id)` — the test feeds ordered input and a separate test documents that unordered input yields caller-ordered folding).
- **`set_lesson` below 1 / absurdly high:** fold floors at 1; the route clamps the top. A logged `0`/`-3` (only possible via a future non-route writer) folds to 1.
- **Multiple `set_lesson` events:** last (by `(at, id)`) wins. No corruption.
- **Attempt citing an unknown `session_id`:** no session row updated (matches `repo.ts`).
- **`star`/`set_known` before any attempt on the item:** create-if-missing exposure (`lastSeenAt = at`, `timesSeen = 0`) — provisional, D-confirmed.
- **Empty log / new user:** `fold([]) = { currentLesson: 1, ruleStates: [], itemExposures: [], sessions: [] }`; `repo.currentLesson` returns the seeded default 1.
- **keyRemap collapsing to an existing key:** two histories merge into one `rule_state`, folded in order — the covered case.
- **Malformed row** (e.g. an `attempt` row with null `rating`): `rowToEvent` throws — corruption surfaces, not silently folded.

## Testing / verification
- **Domain unit (`fold.test.ts`):** each kind folds correctly; `firstExposedAt` carries forward; exposure counting; session `realizedCount`/`endedAt`; `set_lesson` last-wins + floor-1; keyRemap 2→1 collapse; `star`/`set_known` create-if-missing; `rowToEvent` narrows valid rows and throws on malformed; `fold([])` empty state.
- **Web integration (rebuild proof):** real repo + real migrations + fresh DB; drive session/attempts/clock-advance/`set_lesson`/end; `fold(events(u), { trivialScheduler, identity })` deep-equals the live projection — `ruleStates(u)`, `itemExposures(u)`, `sessions(u)`, `currentLesson(u)`. A second user's rows never leak into the fold (per-user `events(u)`).
- **Web integration (dial):** `setLesson` appends a `set_lesson` row and updates `users.current_lesson`; `currentLesson` reads it back; clamp is a route concern (unit-tested on the action) while fold-floor is domain-tested.
- **Playwright (dial persistence):** dial to N, reload, assert it stays N (now DB-backed); existing dial→queue e2e still green. Evidence before claims (AGENTS.md).
- Full gate as C.1: `pnpm lint` / `check` / `-r build` / `test` / `test:e2e` all green; M9 boundary lint + tripwire still pass (fold is pure domain).

## C.2a → C.2b → C.2c line (so scope can't creep)
- **C.2a:** pure fold (trivial scheduler) + rebuild proof; per-user `set_lesson`/`current_lesson`; retire `settings-service`. *(this doc)*
- **C.2b:** FSRS behind `apply`; same-day guard in the blob; SM-2-on-rule + replay proof; rebuild-write.
- **C.2c:** EWMA + coverage-K meter, materialized + folded; inspector mastery panel.
- **Separate task:** e2e `workers:1` removal (needs clock + DB/user per-test isolation).

## Notes / deviations
- **Handoff correction:** the C.1 handoff bundled "retire settings-service + e2e workers:1." Verified against `playwright.config.ts`: `workers:1` is forced by three globals (dial, clock offset, shared `:memory:` DB/`u1`). C.2a removes only the dial; the pin stays until clock + DB isolation land. Split out above.
- **Fold consumes the clean union, not raw rows:** `rowToEvent` isolates nullable-row narrowing (and validation) from the fold body, keeping `fold` total over the honest discriminated union and giving a corruption tripwire for free.
- **All seven kinds implemented now** even though C.2a writes only `attempt`/`session_*`/`set_lesson`: the event union is frozen, so a total interpreter is cheaper to get right once than to reopen every slice; the writer-less kinds are unit-tested directly.
