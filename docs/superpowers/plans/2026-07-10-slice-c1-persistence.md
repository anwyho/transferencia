# Slice C.1 — Persistence, Ports, Clock, Trivial Scheduler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make practice attempts durable and reschedulable behind pure-fold ports with deterministic time — the persistence spine (repo + SQLite + clock + trivial scheduler) that C.2 swaps FSRS into, verified end-to-end on the real scrappy UI.

**Architecture:** Pure port *contracts* + a trivial scheduler live in the isomorphic `@lt/domain` (zero deps, M9-enforced). The Drizzle/better-sqlite3 implementation, migrations, injectable clock, and env-gated test control-plane live in `@lt/web` server. Each attempt is one transaction: append the frozen `review_log` row, upsert `rule_state` (due via the trivial scheduler) per tested schedulable rule, bump `item_exposure`. `rule_state.due` is a materialized, indexed cache; `review_log` stays ground truth (C.2's fold must reproduce this projection).

**Tech Stack:** SvelteKit + TS, Drizzle ORM + better-sqlite3 (SQLite STRICT/WAL, forward-only committed migrations), Vitest (node "server" project), Playwright (workers:1).

**Contract docs:** `docs/superpowers/specs/2026-07-10-slice-c1-persistence-design.md` (the C.1 design — build exactly this); `2026-07-09-language-transfer-design-v2.md` §State plane (FROZEN log schema + fold signature); `final-review-report.md` (B1/B2, M7, M9, m9); `AGENTS.md` (verification non-negotiable).

**Scope discipline:** C.1 only. NON-SCOPE (do not build): the general `fold(events,{scheduler,keyRemap})`, FSRS/EWMA/coverage-K, the same-day reinforcement-only guard (M3), `set_lesson`/`current_lesson` fold + per-user dial, planner/star/priority/re-drill, session-nav UX (#20), advance-lesson prompt (#21). Do NOT install `ts-fsrs`. Do NOT touch `build/`, `cards/`, `dist/`, `audio/`, `podcast.xml`.

**Deviations from the literal spec (justified — AGENTS.md "own correctness"):**
1. **Connection pragmas are set per-connection in the DB client, not "in the initial migration."** `foreign_keys` and `busy_timeout` are per-connection pragmas — SQLite silently ignores `PRAGMA foreign_keys` inside a migration transaction and it does not persist. Setting all four (WAL, busy_timeout, synchronous, foreign_keys) on every connection open is the only correct way to guarantee they take effect. A test asserts they are actually on.
2. **STRICT is added by editing the drizzle-kit-generated SQL.** drizzle-kit does not emit `STRICT` tables. We generate the baseline with drizzle-kit (per spec), then append `STRICT` to each `CREATE TABLE` in the single committed migration (forward-only, one-time). `migrate()` only reads the `.sql` + `_journal.json`, so this is runtime-faithful; a STRICT-enforcement integration test proves it took.
3. **e2e DB is `:memory:`** (via `LT_DB_PATH=:memory:` in the Playwright webServer env) so each run starts clean with no file to gitignore-race or accumulate. Dev uses a gitignored `local.sqlite` file.
4. **`test-control` gating reads `process.env.LT_TEST_CONTROL`** (via a small testable helper) rather than `$env/dynamic/private`, so the guard is unit-testable under vitest and works identically under adapter-node preview.

---

## File map

**Create — domain (`app/packages/domain/`):**
- `src/ports/clock.ts` — `Clock` interface.
- `src/ports/scheduler.ts` — `SchedulerState`/`Scheduler`/`SchedulerResult`, `DAY_MS`, `trivialScheduler`.
- `src/ports/scheduler.test.ts` — trivial scheduler unit tests.
- `src/ports/review-log.ts` — `ReviewLogKind`, the kind-discriminated `ReviewLogEvent` union, `ReviewLogRow`.
- `src/ports/repository.ts` — `AttemptInput`, `RuleStateRow`, `ItemExposureRow`, `SessionStartInput`, `SessionEndInput`, `ReviewRepository`, `BOTH_DIRECTION`.
- `src/ports/index.ts` — re-exports.

**Create — web (`app/packages/web/`):**
- `src/lib/server/db/schema.ts` — Drizzle tables.
- `src/lib/server/db/repo.ts` — `DrizzleReviewRepository`.
- `src/lib/server/db/index.ts` — connection, pragmas, `migrate`, seed `u1`, lazy `getDb()`/`getRepo()`, `applyPragmas`.
- `src/lib/server/db/test-db.ts` — `createTestDb(clock)` helper (fresh temp SQLite).
- `src/lib/server/db/repo.test.ts` — integration tests (node/server project).
- `src/lib/server/clock.ts` — offset singleton, `webClock`, advance/set/reset, `testControlEnabled`.
- `src/lib/server/clock.test.ts` — clock unit tests.
- `src/lib/server/m9-boundary.test.ts` — M9 tripwire.
- `src/routes/__test__/clock/+server.ts` — env-gated POST control route.
- `src/hooks.server.ts` — seed `locals.user = { id: 'u1' }`.
- `drizzle.config.ts` — drizzle-kit config.
- `drizzle/**` — generated + STRICT-edited migration SQL + meta (COMMITTED).
- `e2e/persistence.e2e.ts` — Playwright #C.3.

**Modify — web:**
- `src/app.d.ts` — extend `App.Locals`.
- `vite.config.ts` — `ssr.external: ['better-sqlite3']`.
- `playwright.config.ts` — webServer `env: { LT_TEST_CONTROL: '1', LT_DB_PATH: ':memory:' }`.
- `package.json` — add deps + `db:generate` script.
- `.gitignore` — sqlite artifacts.
- `src/routes/+page.server.ts` + `src/routes/+page.svelte` — repo-backed practice.
- `src/routes/inspector/+page.server.ts` + `src/routes/inspector/+page.svelte` — scheduled-rules panel.
- `e2e/practice.e2e.ts` — retarget to the seeded item + repo flow.

**Modify — domain:**
- `src/index.ts` — `export * from './ports/index'`.

**Delete — web:**
- `src/lib/server/session-service.ts` + `src/lib/server/session-service.test.ts` (throwaway slice-A in-memory seam, replaced by the repo).

**Modify — root:**
- `app/package.json` — `pnpm.onlyBuiltDependencies: ['better-sqlite3']`.

---

## Task 0: Baseline + dependencies

**Files:** `app/package.json`, `app/packages/web/package.json`, `app/packages/web/vite.config.ts`

- [ ] **Step 1: Confirm the tree is green before touching anything**

Run (from `app/`): `pnpm test`
Expected: domain 46 passed, web 15 passed (61 total).

- [ ] **Step 2: Allow the better-sqlite3 native build under pnpm**

Add to `app/package.json` (root) a `pnpm` field:

```json
{
	"name": "transferencia-app",
	"version": "0.0.0",
	"private": true,
	"type": "module",
	"packageManager": "pnpm@11.11.0",
	"engines": {
		"node": ">=22"
	},
	"pnpm": {
		"onlyBuiltDependencies": ["better-sqlite3"]
	},
	"scripts": {
		"test": "pnpm -r run test",
		"test:e2e": "pnpm --filter @lt/web run test:e2e",
		"lint": "pnpm -r run lint",
		"check": "pnpm -r run check",
		"build": "pnpm -r run build"
	}
}
```

- [ ] **Step 3: Add web deps + the generate script**

In `app/packages/web/package.json`, add to `dependencies`: `"better-sqlite3": "^12.4.1"`, `"drizzle-orm": "^0.44.6"`. Add to `devDependencies`: `"@types/better-sqlite3": "^7.6.13"`, `"drizzle-kit": "^0.31.5"`. Add to `scripts`: `"db:generate": "drizzle-kit generate"`.

(Use the latest compatible versions pnpm resolves; the above are known-good floors. Do NOT add `ts-fsrs`.)

- [ ] **Step 4: Install + verify the native module compiles under Node 22**

Run (from `app/`): `pnpm install`
If pnpm reports the build script was ignored, run `pnpm approve-builds` (or confirm `onlyBuiltDependencies` took) and re-install.
Verify: `pnpm --filter @lt/web exec node -e "const D=require('better-sqlite3'); const db=new D(':memory:'); db.pragma('foreign_keys = ON'); console.log('better-sqlite3 OK', db.pragma('foreign_keys', {simple:true}))"`
Expected: `better-sqlite3 OK 1`

- [ ] **Step 5: Externalize better-sqlite3 for SSR/vitest**

In `app/packages/web/vite.config.ts`, change the `ssr` block:

```ts
	ssr: {
		// Consume the isomorphic domain package as TS source (its exports resolve to
		// src/index.ts) rather than a prebuilt dist — let Vite transpile it.
		noExternal: ['@lt/domain'],
		// better-sqlite3 is a native CJS addon — never bundle it (SSR build, preview, vitest).
		external: ['better-sqlite3']
	},
```

- [ ] **Step 6: Commit the dependency baseline**

```bash
cd /Users/anthony.ho/workspace/transferencia
git add app/package.json app/packages/web/package.json app/packages/web/vite.config.ts app/pnpm-lock.yaml
git commit -m "build(app): add drizzle-orm + better-sqlite3 for slice C.1 persistence (#14)"
```

---

## Task 1: Domain ports (Clock, Scheduler, ReviewLog types, ReviewRepository)

**Files:**
- Create: `app/packages/domain/src/ports/clock.ts`, `scheduler.ts`, `review-log.ts`, `repository.ts`, `index.ts`
- Test: `app/packages/domain/src/ports/scheduler.test.ts`
- Modify: `app/packages/domain/src/index.ts`

- [ ] **Step 1: Write the failing scheduler test**

Create `app/packages/domain/src/ports/scheduler.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DAY_MS, trivialScheduler } from './scheduler';

describe('trivial scheduler (C.1 placeholder)', () => {
  it('schedules due one day out and stamps the blob with the attempt time', () => {
    const at = 1_700_000_000_000;
    const { blob, due } = trivialScheduler.apply(null, 'good', at);
    expect(due).toBe(at + DAY_MS);
    expect(blob).toEqual({ last: at });
  });

  it('ignores the prev blob and rating (placeholder has no memory)', () => {
    const at = 42;
    const withPrev = trivialScheduler.apply({ last: 1 }, 'again', at);
    const noPrev = trivialScheduler.apply(null, 'easy', at);
    expect(withPrev).toEqual(noPrev);
    expect(withPrev.due).toBe(at + DAY_MS);
  });

  it('produces a JSON-serialisable blob (opaque, versioned, round-trips)', () => {
    const { blob } = trivialScheduler.apply(null, 'good', 5);
    expect(JSON.parse(JSON.stringify(blob))).toEqual(blob);
  });
});
```

- [ ] **Step 2: Run it — expect failure (module missing)**

Run (from `app/packages/domain/`): `pnpm test -- scheduler`
Expected: FAIL — cannot resolve `./scheduler`.

- [ ] **Step 3: Implement the clock + scheduler ports**

Create `app/packages/domain/src/ports/clock.ts`:

```ts
/**
 * Time port (design v2 §Multi-user & persistence seams; C.1 design §Ports).
 * Epoch ms, UTC. Prod impl = wall clock (web); test impl = wall clock + a mutable
 * offset so a Playwright walkthrough can advance time instantly. Isomorphic: the
 * domain never reads `Date.now()` directly, so folds/scheduling stay deterministic.
 */
export interface Clock {
  now(): number;
}
```

Create `app/packages/domain/src/ports/scheduler.ts`:

```ts
import type { SrsRating } from '../exercise/types';

/** One UTC day in ms — the trivial scheduler's fixed interval. */
export const DAY_MS = 86_400_000;

/**
 * Timing state is an OPAQUE, versioned, JSON-serialisable blob behind the port
 * (design v2 §State plane): FSRS→SM-2 is a replay, not a migration. The domain
 * never inspects its shape — only the concrete `Scheduler` impl does.
 */
export type SchedulerState = unknown;

export interface SchedulerResult {
  blob: SchedulerState;
  due: number;
}

/**
 * Timing seam. C.2 swaps FSRS in behind this exact signature; C.1 fixes the shape
 * now with a trivial placeholder so the persistence spine is verifiable first.
 */
export interface Scheduler {
  apply(prev: SchedulerState | null, rating: SrsRating, at: number): SchedulerResult;
}

/**
 * Trivial C.1 scheduler: due = at + 1 day, blob = { last: at }. No memory of prev
 * or rating — correct for a placeholder. C.2 replaces it with FSRS (spaced,
 * ≤ 1 tick/rule/day) behind the same `apply` signature.
 */
export const trivialScheduler: Scheduler = {
  apply(_prev, _rating, at) {
    return { blob: { last: at }, due: at + DAY_MS };
  }
};
```

- [ ] **Step 4: Run the scheduler test — expect green**

Run (from `app/packages/domain/`): `pnpm test -- scheduler`
Expected: 3 passed.

- [ ] **Step 5: Add the ReviewLog event types (frozen schema, TS mirror)**

Create `app/packages/domain/src/ports/review-log.ts`:

```ts
import type { Direction, Grade, SrsRating } from '../exercise/types';

/**
 * The FROZEN ReviewLog event model (design v2 §State plane; issue #2). A single
 * kind-discriminated append-only stream is the one ground truth; every per-user
 * table is a fold of it (B2). C.1 only WRITES `attempt` + `session_start`/
 * `session_end`; the other kinds' shapes are frozen here and written by C.2
 * (`set_lesson`) and Epic D (`star`/`unstar`/`set_known`).
 */
export type ReviewLogKind =
  | 'attempt'
  | 'star'
  | 'unstar'
  | 'set_known'
  | 'set_lesson'
  | 'session_start'
  | 'session_end';

interface BaseEvent {
  userId: string;
  /** epoch ms UTC, from the injected Clock; total fold order is (at, id). */
  at: number;
}

export interface AttemptEvent extends BaseEvent {
  kind: 'attempt';
  sessionId: number;
  itemId: string;
  /** tested (schedulable) rule keys this attempt credits; denormalized (attribution). */
  ruleKeys: string[];
  exerciseTypeKey: string;
  /** canonical param_key (B1); '' for empty params — present, never null. */
  paramKey: string;
  /** concrete direction; never the 'both' sentinel. */
  direction: Direction;
  rating: SrsRating;
  assessment: Grade;
  hintRevealed: boolean;
  latencyMs?: number;
  contentHash: string;
}
export interface StarEvent extends BaseEvent {
  kind: 'star';
  itemId: string;
}
export interface UnstarEvent extends BaseEvent {
  kind: 'unstar';
  itemId: string;
}
export interface SetKnownEvent extends BaseEvent {
  kind: 'set_known';
  itemId: string;
  annotationKnown: boolean;
}
export interface SetLessonEvent extends BaseEvent {
  kind: 'set_lesson';
  /** fold floors at 1. */
  annotationLesson: number;
}
export interface SessionStartEvent extends BaseEvent {
  kind: 'session_start';
  sessionId: number;
  sessionMode: string;
  sessionTargetAttempts: number;
}
export interface SessionEndEvent extends BaseEvent {
  kind: 'session_end';
  sessionId: number;
}

export type ReviewLogEvent =
  | AttemptEvent
  | StarEvent
  | UnstarEvent
  | SetKnownEvent
  | SetLessonEvent
  | SessionStartEvent
  | SessionEndEvent;

/**
 * A read-back row (single-table event log): the full frozen column set, columns
 * not applicable to a row's `kind` are null. Ordered (at, id) by `events()` — the
 * input C.2's `fold` replays.
 */
export interface ReviewLogRow {
  id: number;
  userId: string;
  at: number;
  kind: ReviewLogKind;
  itemId: string | null;
  ruleKeys: string[] | null;
  exerciseTypeKey: string | null;
  paramKey: string | null;
  direction: Direction | null;
  rating: SrsRating | null;
  assessment: Grade | null;
  hintRevealed: boolean | null;
  latencyMs: number | null;
  contentHash: string | null;
  sessionId: number | null;
  annotationKnown: boolean | null;
  annotationLesson: number | null;
  sessionMode: string | null;
  sessionTargetAttempts: number | null;
}
```

- [ ] **Step 6: Add the ReviewRepository + row/input types**

Create `app/packages/domain/src/ports/repository.ts`:

```ts
import type { Direction, Grade, SrsRating } from '../exercise/types';
import type { SchedulerState } from './scheduler';
import type { ReviewLogRow } from './review-log';

/**
 * rule_state.direction sentinel (report M7): the SRS unit is (user, rule, direction)
 * with a fixed key arity — 'both' when the rule is not scheduled by direction (the
 * C.1 default). The schedule_by_direction escape hatch (C.2+) flips the VALUE to a
 * concrete direction, never the key arity.
 */
export const BOTH_DIRECTION = 'both';

/**
 * The full frozen attempt payload the caller hands the repo. `at` is NOT here — the
 * repo stamps it from its injected Clock (design C.1 §Ports). `userId` is carried on
 * every input (multi-user seam from day one, even at n=1).
 */
export interface AttemptInput {
  userId: string;
  sessionId: number;
  itemId: string;
  /** tested schedulable rule keys (caller filters role='tests' + schedulable). */
  ruleKeys: string[];
  exerciseTypeKey: string;
  paramKey: string;
  direction: Direction;
  rating: SrsRating;
  assessment: Grade;
  hintRevealed: boolean;
  latencyMs?: number;
  contentHash: string;
}

export interface SessionStartInput {
  userId: string;
  mode: string;
  targetAttempts: number;
  at: number;
}
export interface SessionEndInput {
  userId: string;
  sessionId: number;
  at: number;
}

export interface RuleStateRow {
  userId: string;
  ruleKey: string;
  /** 'both' sentinel in C.1 (M7). */
  direction: string;
  blob: SchedulerState;
  due: number;
  firstExposedAt: number;
}

export interface ItemExposureRow {
  userId: string;
  itemId: string;
  timesSeen: number;
  lastSeenAt: number;
  lastRating: SrsRating | null;
  known: boolean;
  starred: boolean;
}

/**
 * Persistence seam (design v2). Types-only in the domain; the Drizzle impl lives in
 * @lt/web server. Every method takes/filters user_id. One impl now (SQLite);
 * tripwire = >1 host serving the API → Postgres (design v2).
 */
export interface ReviewRepository {
  startSession(i: SessionStartInput): { sessionId: number };
  endSession(i: SessionEndInput): void;
  /** one txn: append the attempt log row + upsert rule_state per rule + bump exposure. */
  appendAttempt(i: AttemptInput): void;
  /** WHERE user_id AND due <= now ORDER BY due, rule_key, direction. */
  dueRuleStates(userId: string, now: number): RuleStateRow[];
  ruleStates(userId: string): RuleStateRow[];
  itemExposure(userId: string, itemId: string): ItemExposureRow | undefined;
  /** ordered (at, id) — the input to C.2's fold/rebuild. */
  events(userId: string): ReviewLogRow[];
}
```

- [ ] **Step 7: Barrel + export from the domain entrypoint**

Create `app/packages/domain/src/ports/index.ts`:

```ts
export type { Clock } from './clock';
export { DAY_MS, trivialScheduler } from './scheduler';
export type { Scheduler, SchedulerResult, SchedulerState } from './scheduler';
export type {
  AttemptEvent,
  ReviewLogEvent,
  ReviewLogKind,
  ReviewLogRow,
  SessionEndEvent,
  SessionStartEvent,
  SetKnownEvent,
  SetLessonEvent,
  StarEvent,
  UnstarEvent
} from './review-log';
export { BOTH_DIRECTION } from './repository';
export type {
  AttemptInput,
  ItemExposureRow,
  ReviewRepository,
  RuleStateRow,
  SessionEndInput,
  SessionStartInput
} from './repository';
```

Append to `app/packages/domain/src/index.ts` (after the content-plane export line):

```ts

// Slice C.1 persistence ports (pure contracts + trivial scheduler; the Drizzle impl
// lives in @lt/web server — the domain stays isomorphic, report M9).
export * from './ports/index';
```

- [ ] **Step 8: Full domain gate — test, lint, typecheck**

Run (from `app/packages/domain/`): `pnpm test && pnpm lint && pnpm check`
Expected: all scheduler tests pass (49 domain total); eslint clean (no node/persistence imports in ports); tsc clean.

- [ ] **Step 9: Commit the domain ports**

```bash
cd /Users/anthony.ho/workspace/transferencia
git add app/packages/domain/src/ports app/packages/domain/src/index.ts
git commit -m "feat(domain): C.1 persistence ports — Clock/Scheduler/ReviewLog/ReviewRepository + trivial scheduler (#14)"
```

---

## Task 2: Drizzle schema + migration (STRICT, indexed, forward-only)

**Files:**
- Create: `app/packages/web/src/lib/server/db/schema.ts`, `app/packages/web/drizzle.config.ts`, `app/packages/web/drizzle/**`

- [ ] **Step 1: Write the schema**

Create `app/packages/web/src/lib/server/db/schema.ts`:

```ts
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Direction, Grade, SchedulerState, SrsRating } from '@lt/domain';

/**
 * SQLite schema (design v2 §State plane; C.1 design §DB schema). Every per-user
 * table carries user_id; booleans are int 0/1; all timestamps epoch-int UTC.
 * STRICT is added to the generated migration SQL (drizzle-kit does not emit it);
 * this schema is the typed query surface + the drizzle-kit generate source.
 *
 * review_log holds the FULL frozen column set now (un-backfillable ground truth),
 * even though C.1 only writes attempt + session_start/session_end. rule_state /
 * item_exposure gain mastery/coverage/known/starred columns in C.2/D by re-fold.
 */

export const users = sqliteTable('users', {
	id: text('id').primaryKey()
	// current_lesson added in C.2 with the folded per-user dial.
});

export const sessions = sqliteTable('sessions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id')
		.notNull()
		.references(() => users.id),
	startedAt: integer('started_at').notNull(),
	endedAt: integer('ended_at'),
	mode: text('mode').notNull(),
	targetAttempts: integer('target_attempts').notNull(),
	realizedCount: integer('realized_count').notNull().default(0)
});

export const reviewLog = sqliteTable(
	'review_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		at: integer('at').notNull(),
		kind: text('kind').notNull(),
		itemId: text('item_id'),
		ruleKeys: text('rule_keys', { mode: 'json' }).$type<string[]>(),
		exerciseTypeKey: text('exercise_type_key'),
		paramKey: text('param_key'),
		direction: text('direction').$type<Direction>(),
		rating: text('rating').$type<SrsRating>(),
		assessment: text('assessment', { mode: 'json' }).$type<Grade>(),
		hintRevealed: integer('hint_revealed', { mode: 'boolean' }),
		latencyMs: integer('latency_ms'),
		contentHash: text('content_hash'),
		sessionId: integer('session_id').references(() => sessions.id),
		annotationKnown: integer('annotation_known', { mode: 'boolean' }),
		annotationLesson: integer('annotation_lesson'),
		sessionMode: text('session_mode'),
		sessionTargetAttempts: integer('session_target_attempts')
	},
	(t) => [index('review_log_user_at_id_idx').on(t.userId, t.at, t.id)]
);

export const ruleState = sqliteTable(
	'rule_state',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		ruleKey: text('rule_key').notNull(),
		direction: text('direction').notNull(),
		blob: text('blob', { mode: 'json' }).$type<SchedulerState>().notNull(),
		due: integer('due').notNull(),
		firstExposedAt: integer('first_exposed_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.ruleKey, t.direction] }),
		index('rule_state_user_due_idx').on(t.userId, t.due)
	]
);

export const itemExposure = sqliteTable(
	'item_exposure',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		itemId: text('item_id').notNull(),
		timesSeen: integer('times_seen').notNull().default(0),
		lastSeenAt: integer('last_seen_at').notNull(),
		lastRating: text('last_rating').$type<SrsRating>(),
		known: integer('known', { mode: 'boolean' }).notNull().default(false),
		starred: integer('starred', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [primaryKey({ columns: [t.userId, t.itemId] })]
);
```

- [ ] **Step 2: Write the drizzle-kit config**

Create `app/packages/web/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

// Forward-only committed migrations (design C.1 §Migrations). `generate` diffs the
// schema into ./drizzle SQL; we NEVER `push`. migrate() (db/index.ts) applies them
// on boot + in test setup.
export default defineConfig({
	dialect: 'sqlite',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle'
});
```

- [ ] **Step 3: Generate the baseline migration**

Run (from `app/packages/web/`): `pnpm db:generate`
Expected: creates `drizzle/0000_<name>.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json`. Output: "5 tables" (users, sessions, review_log, rule_state, item_exposure).

- [ ] **Step 4: Add STRICT to every CREATE TABLE in the generated SQL**

Open `drizzle/0000_<name>.sql`. For each `CREATE TABLE ... (\n ... \n);` block, change the closing `);` to `) STRICT;`. Verify every column type is one of INTEGER / TEXT (STRICT-compatible — drizzle emits exactly these here; no REAL/BLOB/untyped columns). Leave `CREATE INDEX` statements unchanged. Confirm foreign-key clauses stay inside the `)` (before ` STRICT`).

The final SQL must match this shape (names/exact FK formatting may vary slightly by drizzle-kit version — the load-bearing edits are ` STRICT` on each table and the columns/PKs/indexes below):

```sql
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`mode` text NOT NULL,
	`target_attempts` integer NOT NULL,
	`realized_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE TABLE `review_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`item_id` text,
	`rule_keys` text,
	`exercise_type_key` text,
	`param_key` text,
	`direction` text,
	`rating` text,
	`assessment` text,
	`hint_revealed` integer,
	`latency_ms` integer,
	`content_hash` text,
	`session_id` integer,
	`annotation_known` integer,
	`annotation_lesson` integer,
	`session_mode` text,
	`session_target_attempts` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `review_log_user_at_id_idx` ON `review_log` (`user_id`,`at`,`id`);--> statement-breakpoint
CREATE TABLE `rule_state` (
	`user_id` text NOT NULL,
	`rule_key` text NOT NULL,
	`direction` text NOT NULL,
	`blob` text NOT NULL,
	`due` integer NOT NULL,
	`first_exposed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `rule_key`, `direction`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `rule_state_user_due_idx` ON `rule_state` (`user_id`,`due`);--> statement-breakpoint
CREATE TABLE `item_exposure` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`times_seen` integer DEFAULT 0 NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_rating` text,
	`known` integer DEFAULT 0 NOT NULL,
	`starred` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
```

(Task 3's STRICT-enforcement test proves the edit took, regardless of exact drizzle-kit formatting.)

- [ ] **Step 5: Commit the schema + committed migration**

```bash
cd /Users/anthony.ho/workspace/transferencia
git add app/packages/web/src/lib/server/db/schema.ts app/packages/web/drizzle.config.ts app/packages/web/drizzle
git commit -m "feat(web): drizzle SQLite schema + STRICT forward-only migration for C.1 (#14)"
```

---

## Task 3: DB client, repository impl, and integration tests (TDD)

**Files:**
- Create: `app/packages/web/src/lib/server/db/index.ts`, `repo.ts`, `test-db.ts`, `repo.test.ts`
- Modify: `app/packages/web/.gitignore`

- [ ] **Step 1: Write the connection/client (pragmas, migrate, seed)**

Create `app/packages/web/src/lib/server/db/index.ts`:

```ts
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { trivialScheduler } from '@lt/domain';
import { webClock } from '../clock';
import { DrizzleReviewRepository } from './repo';
import * as schema from './schema';
import { users } from './schema';

/**
 * Server persistence wiring (C.1 design §Migrations / §Clock). Native module + node
 * built-ins live here, NEVER in @lt/domain (report M9). Pragmas are set per-connection
 * (foreign_keys / busy_timeout do not persist and are ignored inside a migration txn —
 * see plan "Deviations"). Lazy singleton so importing this module opens no DB.
 */
export type Db = BetterSQLite3Database<typeof schema>;

export function applyPragmas(sqlite: Database.Database): void {
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('busy_timeout = 5000');
	sqlite.pragma('synchronous = NORMAL');
	sqlite.pragma('foreign_keys = ON');
}

function migrationsDir(): string {
	// cwd is packages/web for dev, `pnpm preview`, and vitest; override via env if not.
	return process.env.LT_MIGRATIONS_DIR ?? resolve('drizzle');
}

/** Open + migrate + seed a DB at `path` (':memory:' for e2e; a file for dev). */
export function openDb(path: string): { db: Db; sqlite: Database.Database } {
	const sqlite = new Database(path);
	applyPragmas(sqlite);
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: migrationsDir() });
	db.insert(users).values({ id: 'u1' }).onConflictDoNothing().run();
	return { db, sqlite };
}

let _db: Db | null = null;
let _repo: DrizzleReviewRepository | null = null;

export function getDb(): Db {
	if (!_db) _db = openDb(process.env.LT_DB_PATH ?? 'local.sqlite').db;
	return _db;
}

export function getRepo(): DrizzleReviewRepository {
	if (!_repo) _repo = new DrizzleReviewRepository(getDb(), { clock: webClock, scheduler: trivialScheduler });
	return _repo;
}
```

- [ ] **Step 2: Write the repository impl**

Create `app/packages/web/src/lib/server/db/repo.ts`:

```ts
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import {
	BOTH_DIRECTION,
	type AttemptInput,
	type Clock,
	type ItemExposureRow,
	type ReviewLogRow,
	type ReviewRepository,
	type RuleStateRow,
	type Scheduler,
	type SessionEndInput,
	type SessionStartInput
} from '@lt/domain';
import type { Db } from './index';
import { itemExposure, reviewLog, ruleState, sessions } from './schema';

/**
 * Drizzle/SQLite ReviewRepository (C.1 design §Ports / §DB schema). Incremental
 * apply-on-write: each attempt is ONE transaction — append the frozen log row,
 * upsert rule_state (due via the injected Scheduler) per tested rule, bump exposure,
 * bump the session's realized_count. `at` is stamped from the injected Clock, once
 * per attempt, so log + rule_state + exposure agree. Every query filters user_id.
 */
export class DrizzleReviewRepository implements ReviewRepository {
	constructor(
		private readonly db: Db,
		private readonly deps: { clock: Clock; scheduler: Scheduler }
	) {}

	startSession(i: SessionStartInput): { sessionId: number } {
		const [row] = this.db
			.insert(sessions)
			.values({ userId: i.userId, startedAt: i.at, mode: i.mode, targetAttempts: i.targetAttempts })
			.returning({ id: sessions.id });
		this.db
			.insert(reviewLog)
			.values({
				userId: i.userId,
				at: i.at,
				kind: 'session_start',
				sessionId: row.id,
				sessionMode: i.mode,
				sessionTargetAttempts: i.targetAttempts
			})
			.run();
		return { sessionId: row.id };
	}

	endSession(i: SessionEndInput): void {
		this.db
			.update(sessions)
			.set({ endedAt: i.at })
			.where(and(eq(sessions.userId, i.userId), eq(sessions.id, i.sessionId)))
			.run();
		this.db
			.insert(reviewLog)
			.values({ userId: i.userId, at: i.at, kind: 'session_end', sessionId: i.sessionId })
			.run();
	}

	appendAttempt(i: AttemptInput): void {
		const at = this.deps.clock.now();
		this.db.transaction((tx) => {
			tx.insert(reviewLog)
				.values({
					userId: i.userId,
					at,
					kind: 'attempt',
					itemId: i.itemId,
					ruleKeys: i.ruleKeys,
					exerciseTypeKey: i.exerciseTypeKey,
					paramKey: i.paramKey,
					direction: i.direction,
					rating: i.rating,
					assessment: i.assessment,
					hintRevealed: i.hintRevealed,
					latencyMs: i.latencyMs ?? null,
					contentHash: i.contentHash,
					sessionId: i.sessionId
				})
				.run();

			for (const ruleKey of i.ruleKeys) {
				const existing = tx
					.select()
					.from(ruleState)
					.where(
						and(
							eq(ruleState.userId, i.userId),
							eq(ruleState.ruleKey, ruleKey),
							eq(ruleState.direction, BOTH_DIRECTION)
						)
					)
					.get();
				const { blob, due } = this.deps.scheduler.apply(existing ? existing.blob : null, i.rating, at);
				const firstExposedAt = existing ? existing.firstExposedAt : at;
				tx.insert(ruleState)
					.values({ userId: i.userId, ruleKey, direction: BOTH_DIRECTION, blob, due, firstExposedAt })
					.onConflictDoUpdate({
						target: [ruleState.userId, ruleState.ruleKey, ruleState.direction],
						set: { blob, due }
					})
					.run();
			}

			const exp = tx
				.select()
				.from(itemExposure)
				.where(and(eq(itemExposure.userId, i.userId), eq(itemExposure.itemId, i.itemId)))
				.get();
			tx.insert(itemExposure)
				.values({ userId: i.userId, itemId: i.itemId, timesSeen: 1, lastSeenAt: at, lastRating: i.rating })
				.onConflictDoUpdate({
					target: [itemExposure.userId, itemExposure.itemId],
					set: { timesSeen: (exp?.timesSeen ?? 0) + 1, lastSeenAt: at, lastRating: i.rating }
				})
				.run();

			tx.update(sessions)
				.set({ realizedCount: sql`${sessions.realizedCount} + 1` })
				.where(eq(sessions.id, i.sessionId))
				.run();
		});
	}

	dueRuleStates(userId: string, now: number): RuleStateRow[] {
		return this.db
			.select()
			.from(ruleState)
			.where(and(eq(ruleState.userId, userId), lte(ruleState.due, now)))
			.orderBy(asc(ruleState.due), asc(ruleState.ruleKey), asc(ruleState.direction))
			.all();
	}

	ruleStates(userId: string): RuleStateRow[] {
		return this.db
			.select()
			.from(ruleState)
			.where(eq(ruleState.userId, userId))
			.orderBy(asc(ruleState.due), asc(ruleState.ruleKey), asc(ruleState.direction))
			.all();
	}

	itemExposure(userId: string, itemId: string): ItemExposureRow | undefined {
		return this.db
			.select()
			.from(itemExposure)
			.where(and(eq(itemExposure.userId, userId), eq(itemExposure.itemId, itemId)))
			.get();
	}

	events(userId: string): ReviewLogRow[] {
		return this.db
			.select()
			.from(reviewLog)
			.where(eq(reviewLog.userId, userId))
			.orderBy(asc(reviewLog.at), asc(reviewLog.id))
			.all() as ReviewLogRow[];
	}
}
```

(Drizzle's inferred select types match the `*Row` shapes because the schema column `$type<>()`s them; `dueRuleStates`/`ruleStates`/`itemExposure` return the drizzle rows directly. `events()` casts because `kind`/`direction` are stored as plain `text` — the narrowing to the union types is a read-time assertion.)

- [ ] **Step 3: Write the test-db helper**

Create `app/packages/web/src/lib/server/db/test-db.ts`:

```ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { trivialScheduler, type Clock } from '@lt/domain';
import { applyPragmas, type Db } from './index';
import { DrizzleReviewRepository } from './repo';
import * as schema from './schema';
import { users } from './schema';

/**
 * A FRESH temp-file SQLite per integration test (real WAL/foreign_keys, real
 * migrations). Not a *.test.ts so vitest won't run it as an (empty) suite.
 */
export function createTestDb(clock: Clock): {
	db: Db;
	sqlite: Database.Database;
	repo: DrizzleReviewRepository;
	cleanup: () => void;
} {
	const dir = mkdtempSync(join(tmpdir(), 'lt-c1-'));
	const sqlite = new Database(join(dir, 'test.sqlite'));
	applyPragmas(sqlite);
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: resolve('drizzle') });
	db.insert(users).values({ id: 'u1' }).onConflictDoNothing().run();
	const repo = new DrizzleReviewRepository(db, { clock, scheduler: trivialScheduler });
	return {
		db,
		sqlite,
		repo,
		cleanup: () => {
			sqlite.close();
			rmSync(dir, { recursive: true, force: true });
		}
	};
}
```

- [ ] **Step 4: Write the integration tests (expect failure first)**

Create `app/packages/web/src/lib/server/db/repo.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS, type AttemptInput, type Clock } from '@lt/domain';
import { createTestDb } from './test-db';
import { users } from './schema';

// A controllable clock: appendAttempt stamps `at` from clock.now(); tests move `t`.
let t = 1_700_000_000_000;
const clock: Clock = { now: () => t };

let env: ReturnType<typeof createTestDb>;
beforeEach(() => {
	t = 1_700_000_000_000;
	env = createTestDb(clock);
});
afterEach(() => env.cleanup());

function attempt(over: Partial<AttemptInput> = {}): AttemptInput {
	return {
		userId: 'u1',
		sessionId: 1,
		itemId: 'al-annual',
		ruleKeys: ['L2#conv-al'],
		exerciseTypeKey: 'transformation',
		paramKey: '',
		direction: 'en>es',
		rating: 'good',
		assessment: { correct: true },
		hintRevealed: false,
		contentHash: 'deadbeef',
		...over
	};
}

describe('DrizzleReviewRepository (C.1 integration)', () => {
	it('appendAttempt writes log + rule_state + exposure in one txn', () => {
		const { sessionId } = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(attempt({ sessionId }));

		const events = env.repo.events('u1');
		const att = events.find((e) => e.kind === 'attempt');
		expect(att).toBeTruthy();
		expect(att!.itemId).toBe('al-annual');
		expect(att!.ruleKeys).toEqual(['L2#conv-al']);
		expect(att!.paramKey).toBe(''); // present, never null (B1)
		expect(att!.direction).toBe('en>es'); // concrete, never 'both'
		expect(att!.contentHash).toBe('deadbeef');
		expect(att!.at).toBe(t);

		const rs = env.repo.ruleStates('u1');
		expect(rs).toHaveLength(1);
		expect(rs[0].ruleKey).toBe('L2#conv-al');
		expect(rs[0].direction).toBe('both'); // M7 sentinel
		expect(rs[0].due).toBe(t + DAY_MS);
		expect(rs[0].firstExposedAt).toBe(t);

		const exp = env.repo.itemExposure('u1', 'al-annual');
		expect(exp?.timesSeen).toBe(1);
		expect(exp?.lastRating).toBe('good');
		expect(exp?.known).toBe(false);
		expect(exp?.starred).toBe(false);
	});

	it('a second attempt reschedules due but keeps first_exposed_at, and counts exposure', () => {
		const { sessionId } = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(attempt({ sessionId }));
		const firstDue = env.repo.ruleStates('u1')[0].due;

		t += 60_000; // one minute later
		env.repo.appendAttempt(attempt({ sessionId, rating: 'again' }));

		const rs = env.repo.ruleStates('u1');
		expect(rs).toHaveLength(1); // still one row (rule is the SRS unit)
		expect(rs[0].firstExposedAt).toBe(1_700_000_000_000); // unchanged
		expect(rs[0].due).toBe(t + DAY_MS);
		expect(rs[0].due).toBeGreaterThan(firstDue);
		expect(env.repo.itemExposure('u1', 'al-annual')?.timesSeen).toBe(2);
	});

	it('dueRuleStates honors the clock cutoff and orders by (due, rule_key)', () => {
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(attempt({ ruleKeys: ['L3#conv-mente'] })); // due t+DAY
		t += 1000;
		env.repo.appendAttempt(attempt({ ruleKeys: ['L2#conv-al'] })); // due t+1000+DAY (later)

		expect(env.repo.dueRuleStates('u1', 1_700_000_000_000 + DAY_MS - 1)).toHaveLength(0);
		const dueAll = env.repo.dueRuleStates('u1', 1_700_000_000_000 + DAY_MS + 10_000);
		expect(dueAll.map((r) => r.ruleKey)).toEqual(['L3#conv-mente', 'L2#conv-al']); // by due asc
	});

	it('filters by user_id — a second user never leaks', () => {
		env.db.insert(users).values({ id: 'u2' }).run();
		env.repo.appendAttempt(attempt({ userId: 'u1', ruleKeys: ['L2#conv-al'] }));
		env.repo.appendAttempt(attempt({ userId: 'u2', ruleKeys: ['L3#conv-mente'] }));

		expect(env.repo.ruleStates('u1').map((r) => r.ruleKey)).toEqual(['L2#conv-al']);
		expect(env.repo.ruleStates('u2').map((r) => r.ruleKey)).toEqual(['L3#conv-mente']);
		expect(env.repo.dueRuleStates('u2', t + DAY_MS).map((r) => r.ruleKey)).toEqual(['L3#conv-mente']);
		expect(env.repo.events('u1').every((e) => e.userId === 'u1')).toBe(true);
	});

	it('STRICT rejects a wrongly-typed row', () => {
		expect(() =>
			env.sqlite.exec(
				"INSERT INTO rule_state (user_id, rule_key, direction, blob, due, first_exposed_at) VALUES ('u1','k','both','{}','not-an-int', 1)"
			)
		).toThrow(/STRICT|cannot store|datatype/i);
	});

	it('foreign_keys are enforced (attempt for a missing user is rejected)', () => {
		expect(() =>
			env.sqlite.exec(
				"INSERT INTO sessions (user_id, started_at, mode, target_attempts) VALUES ('ghost', 1, 'practice', 10)"
			)
		).toThrow(/FOREIGN KEY/i);
	});

	it('session open/close writes events and realized_count', () => {
		const { sessionId } = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(attempt({ sessionId }));
		t += 5000;
		env.repo.endSession({ userId: 'u1', sessionId, at: t });

		const kinds = env.repo.events('u1').map((e) => e.kind);
		expect(kinds).toEqual(['session_start', 'attempt', 'session_end']); // (at, id) order
		const s = env.db.select().from(env.db._.fullSchema ? undefined! : undefined!); // placeholder — see note
	});
});
```

Note: delete the broken last line of the `session open/close` test before running — replace the `realized_count` assertion with a direct query. Final version of that test body:

```ts
	it('session open/close writes events and realized_count', () => {
		const { sessionId } = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(attempt({ sessionId }));
		env.repo.appendAttempt(attempt({ sessionId }));
		t += 5000;
		env.repo.endSession({ userId: 'u1', sessionId, at: t });

		const kinds = env.repo.events('u1').map((e) => e.kind);
		expect(kinds).toEqual(['session_start', 'attempt', 'attempt', 'session_end']); // (at, id) order
		const row = env.sqlite
			.prepare('SELECT realized_count, ended_at FROM sessions WHERE id = ?')
			.get(sessionId) as { realized_count: number; ended_at: number | null };
		expect(row.realized_count).toBe(2);
		expect(row.ended_at).toBe(t);
	});
```

- [ ] **Step 5: Run the integration tests**

Run (from `app/packages/web/`): `pnpm test -- repo`
Expected: all `DrizzleReviewRepository` tests pass. (If better-sqlite3 fails to load under vitest, confirm `ssr.external: ['better-sqlite3']` from Task 0 Step 5.)

- [ ] **Step 6: Ignore local SQLite artifacts**

Append to `app/packages/web/.gitignore`:

```gitignore

# Slice C.1 local SQLite (dev). Migrations under drizzle/ stay COMMITTED.
*.sqlite
*.sqlite-wal
*.sqlite-shm
local.sqlite*
```

- [ ] **Step 7: Commit the repo + client + tests**

```bash
cd /Users/anthony.ho/workspace/transferencia
git add app/packages/web/src/lib/server/db app/packages/web/.gitignore
git commit -m "feat(web): DrizzleReviewRepository + connection/migrate/seed + integration tests (#14)"
```

---

## Task 4: Injectable clock + env-gated test control-plane (TDD)

**Files:**
- Create: `app/packages/web/src/lib/server/clock.ts`, `clock.test.ts`, `src/routes/__test__/clock/+server.ts`

- [ ] **Step 1: Write the failing clock test**

Create `app/packages/web/src/lib/server/clock.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import {
	advanceClock,
	clockNow,
	currentOffset,
	resetClock,
	setClock,
	testControlEnabled
} from './clock';

afterEach(() => {
	resetClock();
	delete process.env.LT_TEST_CONTROL;
});

describe('web clock + test control-plane (C.1)', () => {
	it('defaults to the wall clock (offset 0)', () => {
		expect(currentOffset()).toBe(0);
		expect(Math.abs(clockNow() - Date.now())).toBeLessThan(1000);
	});

	it('advance moves now forward by the offset', () => {
		advanceClock(DAY());
		expect(currentOffset()).toBe(DAY());
		expect(clockNow()).toBeGreaterThanOrEqual(Date.now() + DAY() - 1000);
	});

	it('set pins now near an absolute epoch', () => {
		setClock(5_000_000_000);
		expect(Math.abs(clockNow() - 5_000_000_000)).toBeLessThan(1000);
	});

	it('reset returns to the wall clock', () => {
		advanceClock(999_999);
		resetClock();
		expect(currentOffset()).toBe(0);
	});

	it('testControlEnabled reflects LT_TEST_CONTROL', () => {
		expect(testControlEnabled()).toBe(false);
		process.env.LT_TEST_CONTROL = '1';
		expect(testControlEnabled()).toBe(true);
		process.env.LT_TEST_CONTROL = '0';
		expect(testControlEnabled()).toBe(false);
	});
});

function DAY() {
	return 86_400_000;
}
```

- [ ] **Step 2: Run it — expect failure**

Run (from `app/packages/web/`): `pnpm test -- clock`
Expected: FAIL — cannot resolve `./clock`.

- [ ] **Step 3: Implement the clock module**

Create `app/packages/web/src/lib/server/clock.ts`:

```ts
import type { Clock } from '@lt/domain';

/**
 * Injectable clock (C.1 design §Clock). Prod = wall clock; a server-side singleton
 * `offset` (mutated ONLY via the env-gated /__test__/clock route) lets a Playwright
 * walkthrough advance time instantly. When LT_TEST_CONTROL is unset the route is a
 * no-op, so `offset` stays 0 and this is a pure wall clock — cannot ship live.
 */
let offset = 0;

export function clockNow(): number {
	return Date.now() + offset;
}

/** The domain Clock impl passed to the repo/scheduler. */
export const webClock: Clock = { now: clockNow };

export function advanceClock(ms: number): number {
	offset += ms;
	return offset;
}

export function setClock(epoch: number): number {
	offset = epoch - Date.now();
	return offset;
}

export function resetClock(): number {
	offset = 0;
	return offset;
}

export function currentOffset(): number {
	return offset;
}

/** The control route is active IFF this is true (Playwright's preview sets the flag). */
export function testControlEnabled(): boolean {
	return process.env.LT_TEST_CONTROL === '1';
}
```

- [ ] **Step 4: Run the clock test — expect green**

Run (from `app/packages/web/`): `pnpm test -- clock`
Expected: 5 passed.

- [ ] **Step 5: Add the env-gated control route**

Create `app/packages/web/src/routes/__test__/clock/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { advanceClock, currentOffset, resetClock, setClock, testControlEnabled } from '$lib/server/clock';

/**
 * Env-gated test control-plane (C.1 design §Clock). Active IFF LT_TEST_CONTROL=1;
 * otherwise the route 404s (absent/no-op — cannot ship live). Body:
 *   { action: 'advance', ms } | { action: 'set', epoch } | { action: 'reset' }
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!testControlEnabled()) error(404);
	const body = (await request.json().catch(() => ({}))) as {
		action?: string;
		ms?: number;
		epoch?: number;
	};
	switch (body.action) {
		case 'advance':
			advanceClock(Number(body.ms ?? 0));
			break;
		case 'set':
			setClock(Number(body.epoch ?? 0));
			break;
		case 'reset':
			resetClock();
			break;
		default:
			error(400, 'unknown clock action');
	}
	return json({ offset: currentOffset(), now: Date.now() + currentOffset() });
};
```

- [ ] **Step 6: Commit the clock + route**

```bash
cd /Users/anthony.ho/workspace/transferencia
git add app/packages/web/src/lib/server/clock.ts app/packages/web/src/lib/server/clock.test.ts app/packages/web/src/routes/__test__
git commit -m "feat(web): injectable clock + env-gated /__test__/clock control-plane (#14)"
```

---

## Task 5: locals.user seam (hooks + app.d.ts)

**Files:**
- Create: `app/packages/web/src/hooks.server.ts`
- Modify: `app/packages/web/src/app.d.ts`

- [ ] **Step 1: Extend App.Locals**

Replace `app/packages/web/src/app.d.ts` with:

```ts
// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** The seeded current user (C.1: constant u1; a session cookie later). */
			user: { id: string };
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
```

- [ ] **Step 2: Seed locals.user**

Create `app/packages/web/src/hooks.server.ts`:

```ts
import type { Handle } from '@sveltejs/kit';

/**
 * Multi-user seam from day one (design v2 §Multi-user): every request carries a
 * user. C.1 seeds the constant `u1` (also seeded in the DB); a real session cookie
 * lands later (not Lucia). Every repo query already filters by this id.
 */
export const handle: Handle = ({ event, resolve }) => {
	event.locals.user = { id: 'u1' };
	return resolve(event);
};
```

- [ ] **Step 3: Typecheck (svelte-kit sync regenerates $types with the new Locals)**

Run (from `app/packages/web/`): `pnpm check`
Expected: no errors (Locals.user now typed; routes can read `locals.user.id`).

- [ ] **Step 4: Commit**

```bash
cd /Users/anthony.ho/workspace/transferencia
git add app/packages/web/src/hooks.server.ts app/packages/web/src/app.d.ts
git commit -m "feat(web): seed locals.user (u1) via hooks + App.Locals type (#14)"
```

---

## Task 6: Repo-backed practice screen (replace the throwaway session-service)

**Files:**
- Delete: `app/packages/web/src/lib/server/session-service.ts`, `session-service.test.ts`
- Modify: `app/packages/web/src/routes/+page.server.ts`, `src/routes/+page.svelte`, `e2e/practice.e2e.ts`

- [ ] **Step 1: Remove the throwaway in-memory seam**

```bash
cd /Users/anthony.ho/workspace/transferencia
trash app/packages/web/src/lib/server/session-service.ts app/packages/web/src/lib/server/session-service.test.ts
```

- [ ] **Step 2: Rewrite the practice load + action to use the repo**

Replace `app/packages/web/src/routes/+page.server.ts` with:

```ts
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { eligibleItems, ratingFromAssessment, transformationType, type Direction } from '@lt/domain';
import { contentStore } from '$lib/server/content-loader';
import { getCurrentLesson } from '$lib/server/settings-service';
import { getRepo } from '$lib/server/db';
import { webClock } from '$lib/server/clock';

/**
 * Repo-backed practice (slice C.1). `load` opens a durable session and serves the
 * first gated seed item (planner is Epic D). `submit` grades in the domain, then
 * appendAttempt persists + reschedules the tested rule. No planner/dedup/due-filter
 * here — C.1 is the persistence spine.
 */
export const load: PageServerLoad = ({ locals }) => {
	const store = contentStore();
	const currentLesson = getCurrentLesson();
	const item = eligibleItems(store, currentLesson)[0];
	if (!item) {
		return { sessionId: null, itemId: null, direction: null, prompt: null, hint: null };
	}
	const ctx = { items: store, currentLesson, rng: () => 0.5 };
	const instrument = transformationType.paramEnumerator.paramsFor(item, ctx)[0];
	const prompt = transformationType.promptRenderer.render(item, instrument.params, ctx);
	const { sessionId } = getRepo().startSession({
		userId: locals.user.id,
		mode: 'practice',
		targetAttempts: 10,
		at: webClock.now()
	});
	return {
		sessionId,
		itemId: item.id,
		direction: prompt.direction,
		prompt,
		hint: item.hint ?? null
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

		// Credit only tested, schedulable rules (design: uses-role / non-schedulable skip).
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
	}
};
```

- [ ] **Step 3: Update the practice page (hidden itemId/direction + empty state)**

Replace `app/packages/web/src/routes/+page.svelte` with:

```svelte
<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Revealing the hint is client state. A revealed hint caps the SRS rating at
	// Hard (domain rating policy) — the hidden field carries the flag to the server.
	let hintRevealed = $state(false);
</script>

<main>
	<h1 data-testid="app-title">Language Transfer — practice</h1>

	{#if data.prompt && data.itemId}
		<section data-testid="prompt">
			<p data-testid="instruction">{data.prompt.instruction}</p>
			<p data-testid="given">{data.prompt.given}</p>
		</section>

		{#if data.prompt.hintAvailable && data.hint}
			<div>
				<button type="button" data-testid="reveal-hint" onclick={() => (hintRevealed = true)}>
					Reveal hint
				</button>
				{#if hintRevealed}
					<p data-testid="hint-text">{data.hint}</p>
				{/if}
			</div>
		{/if}

		<form method="POST" data-testid="answer-form">
			<input type="hidden" name="sessionId" value={data.sessionId} />
			<input type="hidden" name="itemId" value={data.itemId} />
			<input type="hidden" name="direction" value={data.direction} />
			<input type="hidden" name="hintRevealed" value={String(hintRevealed)} />
			<label>
				Your answer
				<input
					type="text"
					name="answer"
					data-testid="answer-input"
					autocomplete="off"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
				/>
			</label>
			<button type="submit" data-testid="submit">Submit</button>
		</form>
	{:else}
		<p data-testid="no-item">Nothing to practice — dial up a lesson in the inspector.</p>
	{/if}

	{#if form && 'verdict' in form}
		<section data-testid="result">
			<p data-testid="verdict">{form.verdict}</p>
			{#if form.detail}
				<p data-testid="detail">{form.detail}</p>
			{/if}
			<p>rating: <span data-testid="rating">{form.rating}</span></p>
			<p>answer: <span data-testid="reveal">{form.correctAnswer}</span></p>
			<p>you typed: <span data-testid="your-answer">{form.answer}</span></p>
		</section>
	{/if}
</main>
```

- [ ] **Step 4: Retarget the practice e2e to the seeded item**

Replace `app/packages/web/e2e/practice.e2e.ts` with:

```ts
import { expect, test, type Page } from '@playwright/test';

// The practice screen serves the first gated seed item; the dial is a process-global
// (slice B), so set a known lesson first. At L>=2 the first eligible item (order
// min_lesson, id) is `al-annual` (annual -> anual, rule L2#conv-al).
async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}

test('empty practice at lesson 1 (no eligible item)', async ({ page }) => {
	await setLesson(page, 1);
	await page.goto('/');
	await expect(page.getByTestId('no-item')).toBeVisible();
});

test('correct answer grades + persists (rating good)', async ({ page }) => {
	await setLesson(page, 2);
	await page.goto('/');
	await expect(page.getByTestId('instruction')).toHaveText('Translate to Spanish');
	await expect(page.getByTestId('given')).toHaveText('annual');

	await expect(page.getByTestId('result')).toHaveCount(0);
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();

	await expect(page.getByTestId('verdict')).toHaveText('correct');
	await expect(page.getByTestId('rating')).toHaveText('good');
	await expect(page.getByTestId('reveal')).toHaveText('anual');
});

test('wrong answer grades incorrect and reveals the expected answer', async ({ page }) => {
	await setLesson(page, 2);
	await page.goto('/');
	await page.getByTestId('answer-input').fill('gato');
	await page.getByTestId('submit').click();

	await expect(page.getByTestId('verdict')).toHaveText('incorrect');
	await expect(page.getByTestId('rating')).toHaveText('again');
	await expect(page.getByTestId('reveal')).toHaveText('anual');
});
```

(The accent-off e2e is dropped: the first eligible item `anual` has no accent, and accent-aware grading is already covered by domain unit tests — `grading.test.ts`, `text-match`. C.1 doesn't change the grader. Noted in the commit.)

- [ ] **Step 5: Run the web unit suite (session-service tests gone; repo/clock present)**

Run (from `app/packages/web/`): `pnpm test`
Expected: green. Suites now: id-manifest, domain-wiring, content-loader, settings-service, clock, db/repo (session-service removed).

- [ ] **Step 6: Commit the practice rewire**

```bash
cd /Users/anthony.ho/workspace/transferencia
git add app/packages/web/src/routes/+page.server.ts app/packages/web/src/routes/+page.svelte app/packages/web/e2e/practice.e2e.ts app/packages/web/src/lib/server/session-service.ts app/packages/web/src/lib/server/session-service.test.ts
git commit -m "feat(web): repo-backed durable practice screen, retire in-memory session-service (#14)"
```

---

## Task 7: Inspector scheduled-rules panel

**Files:**
- Modify: `app/packages/web/src/routes/inspector/+page.server.ts`, `src/routes/inspector/+page.svelte`

- [ ] **Step 1: Add scheduled rules to the inspector load**

Replace `app/packages/web/src/routes/inspector/+page.server.ts` with:

```ts
import type { Actions, PageServerLoad } from './$types';
import { eligibleItems, eligibleRules } from '@lt/domain';
import { contentStore } from '$lib/server/content-loader';
import { getCurrentLesson, getMaxLesson, setCurrentLesson } from '$lib/server/settings-service';
import { getRepo } from '$lib/server/db';
import { clockNow } from '$lib/server/clock';

export const load: PageServerLoad = ({ locals }) => {
	const store = contentStore();
	const currentLesson = getCurrentLesson();
	const now = clockNow();
	return {
		currentLesson,
		maxLesson: getMaxLesson(),
		// Defined ordering (min_lesson, id) comes from the domain LessonGate.
		items: eligibleItems(store, currentLesson).map((i) => ({
			id: i.id,
			front_en: i.front_en,
			back_es: i.back_es,
			min_lesson: i.min_lesson,
			rule_keys: i.rule_refs.filter((r) => r.role === 'tests').map((r) => r.key)
		})),
		rules: eligibleRules(store, currentLesson).map((r) => ({
			key: r.key,
			homeLesson: r.homeLesson
		})),
		// Durable scheduled-rules panel (C.1): one row per rule_state, ordered (due, rule_key).
		scheduledRules: getRepo()
			.ruleStates(locals.user.id)
			.map((r) => ({
				ruleKey: r.ruleKey,
				direction: r.direction,
				dueAt: r.due,
				dueNow: r.due <= now
			}))
	};
};

export const actions: Actions = {
	up: () => {
		setCurrentLesson(getCurrentLesson() + 1);
	},
	down: () => {
		setCurrentLesson(getCurrentLesson() - 1);
	},
	set: async ({ request }) => {
		const data = await request.formData();
		setCurrentLesson(Number(data.get('lesson')));
	}
};
```

- [ ] **Step 2: Render the scheduled-rules panel**

Append this `<section>` inside `<main>` (after the existing `queue` section) in `app/packages/web/src/routes/inspector/+page.svelte`:

```svelte
	<section data-testid="scheduled-rules" aria-label="scheduled rules">
		<p>scheduled rules: <span data-testid="scheduled-count">{data.scheduledRules.length}</span></p>
		<ol data-testid="scheduled-list">
			{#each data.scheduledRules as r (r.ruleKey + '|' + r.direction)}
				<li data-testid="rule-state-row" data-rule-key={r.ruleKey} data-due-now={r.dueNow}>
					<span data-testid="rule-key">{r.ruleKey}</span>
					<span data-testid="rule-direction">{r.direction}</span>
					<span data-testid="rule-due-at">{r.dueAt}</span>
					<span data-testid="rule-due-now">{r.dueNow}</span>
				</li>
			{/each}
		</ol>
	</section>
```

- [ ] **Step 3: Typecheck**

Run (from `app/packages/web/`): `pnpm check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/anthony.ho/workspace/transferencia
git add app/packages/web/src/routes/inspector/+page.server.ts app/packages/web/src/routes/inspector/+page.svelte
git commit -m "feat(web): inspector scheduled-rules panel (durable due-state, testids) (#14)"
```

---

## Task 8: M9 isomorphic-boundary tripwire test

**Files:**
- Create: `app/packages/web/src/lib/server/m9-boundary.test.ts`

- [ ] **Step 1: Write the tripwire test**

Create `app/packages/web/src/lib/server/m9-boundary.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

/**
 * M9 tripwire (final-review-report M9; issue #14 acceptance): the domain package's
 * no-restricted-imports rule must actually FIRE on a leaked persistence-driver import,
 * not merely exist. Plant a fixture that imports better-sqlite3 into the domain, run
 * the REAL domain lint, assert the rule fires, then clean up.
 */
it('domain lint (report M9) fails on a planted persistence-driver import', () => {
	const domainDir = resolve('../domain');
	const fixtureDir = resolve(domainDir, 'src/__m9_tripwire__');
	const fixtureRel = 'src/__m9_tripwire__/leak.ts';
	mkdirSync(fixtureDir, { recursive: true });
	writeFileSync(resolve(domainDir, fixtureRel), "import 'better-sqlite3';\nexport const leak = true;\n");

	let failed = false;
	let stdout = '';
	try {
		execFileSync('pnpm', ['exec', 'eslint', fixtureRel, '--format', 'json'], {
			cwd: domainDir,
			encoding: 'utf8'
		});
	} catch (e) {
		failed = true;
		stdout = (e as { stdout?: string }).stdout ?? '';
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
	}

	expect(failed).toBe(true); // eslint exits non-zero when the rule fires
	const results = JSON.parse(stdout) as { messages: { ruleId: string | null }[] }[];
	const ruleIds = results.flatMap((r) => r.messages.map((m) => m.ruleId));
	expect(ruleIds).toContain('no-restricted-imports');
});
```

- [ ] **Step 2: Run it — expect green (the rule fires on the leak)**

Run (from `app/packages/web/`): `pnpm test -- m9-boundary`
Expected: 1 passed (planted import triggers `no-restricted-imports`; fixture removed).

- [ ] **Step 3: Confirm no fixture leftover**

Run (from `app/`): `git status --porcelain packages/domain/src/__m9_tripwire__`
Expected: no output (cleaned).

- [ ] **Step 4: Commit**

```bash
cd /Users/anthony.ho/workspace/transferencia
git add app/packages/web/src/lib/server/m9-boundary.test.ts
git commit -m "test(web): M9 boundary tripwire — domain lint rejects planted persistence import (#14)"
```

---

## Task 9: Playwright wiring + the #C.3 walkthrough

**Files:**
- Modify: `app/packages/web/playwright.config.ts`
- Create: `app/packages/web/e2e/persistence.e2e.ts`

- [ ] **Step 1: Inject the test flag + in-memory DB into the preview server**

Replace `app/packages/web/playwright.config.ts` with:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'pnpm build && pnpm preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		// C.1: the /__test__/clock control-plane is active only with the flag; the e2e DB
		// is fresh in-memory per run (no file to accumulate/gitignore-race).
		env: { LT_TEST_CONTROL: '1', LT_DB_PATH: ':memory:' }
	},
	testMatch: '**/*.e2e.{ts,js}',
	// The lesson dial + clock offset + :memory: DB are process-globals on one server,
	// so e2e runs serially. (Revisit when per-user state lands in slice C.2.)
	workers: 1
});
```

- [ ] **Step 2: Write the #C.3 persistence walkthrough**

Create `app/packages/web/e2e/persistence.e2e.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

// Issue #C.3 acceptance: attempt -> reload (persisted) -> advance 1 day -> rule due.
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

const ROW = '[data-testid="rule-state-row"][data-rule-key="L2#conv-al"]';

test('attempt persists, survives reload, and comes due after advancing the clock', async ({ page }) => {
	await clock(page, { action: 'reset' });
	await setLesson(page, 2);

	// 1) attempt on the first gated item (annual -> anual, rule L2#conv-al)
	await page.goto('/');
	await expect(page.getByTestId('given')).toHaveText('annual');
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toHaveText('correct');

	// 2) persisted + observable: the scheduled-rules panel shows the rule, not due yet
	await page.goto('/inspector');
	await expect(page.locator(ROW)).toHaveCount(1);
	await expect(page.locator(ROW).getByTestId('rule-due-now')).toHaveText('false');

	// 3) survives a fresh navigation away and back (read from SQLite, not memory)
	await page.goto('/');
	await page.goto('/inspector');
	await expect(page.locator(ROW)).toHaveCount(1);

	// 4) advance one day -> the rule is due now
	await clock(page, { action: 'advance', ms: 86400000 });
	await page.goto('/inspector');
	await expect(page.locator(ROW).getByTestId('rule-due-now')).toHaveText('true');
});
```

- [ ] **Step 3: Ensure the Playwright browser is installed, then run e2e**

Run (from `app/packages/web/`): `pnpm exec playwright install chromium` (once), then `pnpm test:e2e`
Expected: all e2e pass — `inspector.e2e` (unchanged), `practice.e2e` (retargeted), `persistence.e2e` (#C.3). If the preview server fails to load better-sqlite3, re-check `ssr.external` + that the native build succeeded (Task 0).

- [ ] **Step 4: Commit**

```bash
cd /Users/anthony.ho/workspace/transferencia
git add app/packages/web/playwright.config.ts app/packages/web/e2e/persistence.e2e.ts
git commit -m "test(web): #C.3 persistence e2e + LT_TEST_CONTROL/:memory: preview env (#14)"
```

---

## Task 10: Full verification + real-UI walkthrough (evidence before "done")

**Files:** none (verification only)

- [ ] **Step 1: Full automated gate from the app root**

Run (from `app/`): `pnpm lint && pnpm check && pnpm -r build && pnpm test`
Expected: lint clean (incl. domain M9), svelte-check clean, both packages build (adapter-node build externalizes better-sqlite3), all unit/integration tests pass.

- [ ] **Step 2: e2e gate**

Run (from `app/`): `pnpm test:e2e`
Expected: all Playwright specs pass.

- [ ] **Step 3: Playwright MCP walkthrough of the REAL scrappy UI (AGENTS.md non-negotiable)**

Start a flagged dev server: from `app/packages/web/`, `LT_TEST_CONTROL=1 LT_DB_PATH=:memory: pnpm dev` (background). Then drive with the Playwright MCP tools:
1. Navigate `/inspector`; set lesson to 2; confirm `scheduled-rules` panel is empty (`scheduled-count` = 0).
2. Navigate `/`; confirm `given` = `annual`; fill `anual`; submit; confirm `verdict` = correct, `rating` = good.
3. Navigate `/inspector`; confirm a `rule-state-row` for `L2#conv-al` exists with `rule-due-now` = false.
4. Navigate `/` then back to `/inspector` (fresh reads); confirm the row persists (durable, not in-memory).
5. `POST /__test__/clock` with `{ "action": "advance", "ms": 86400000 }` (via the MCP browser fetch / `page.request`); reload `/inspector`; confirm `rule-due-now` = true for `L2#conv-al`.
Capture a screenshot at steps 3 and 5 as evidence. Stop the dev server.

- [ ] **Step 4: Confirm the prod-safety invariant (route absent without the flag)**

Start a dev server WITHOUT the flag: from `app/packages/web/`, `pnpm dev` (background). `POST /__test__/clock` `{ "action":"advance","ms":1 }` → expect HTTP 404. Stop the server. (Proves the control-plane cannot ship live.)

- [ ] **Step 5: Confirm the id-manifest snapshot is still green (content untouched)**

Run (from `app/packages/web/`): `pnpm test -- id-manifest`
Expected: pass (C.1 added no seed content).

- [ ] **Step 6: Final status + summary**

Run (from `app/`): `git -C .. status` and `git -C .. log --oneline -8`
Report: what shipped, the evidence (test counts + walkthrough screenshots), and the explicit C.1→C.2 handoff line. STOP — do not start C.2.

---

## Self-review (run against the spec)

**Spec coverage (C.1 design "YOUR CHUNK" 1–9):**
1. Ports in @lt/domain (Clock, Scheduler+trivial, ReviewLog kinds, ReviewRepository types) → Task 1. ✓
2. Drizzle/SQLite schema (review_log full frozen, rule_state, item_exposure, sessions, users; STRICT/WAL/busy_timeout/synchronous/foreign_keys; epoch-int; bool int; indexed due) → Task 2 + Task 3 (pragmas). ✓
3. Migrations (drizzle-kit generate → committed SQL under drizzle/; migrate() on boot + test setup; forward-only) → Task 2 + Task 3 client. ✓
4. ReviewRepository Drizzle: startSession/endSession/appendAttempt (one txn: log + rule_state upserts via Scheduler + exposure bump; stamps content_hash), dueRuleStates(ordered), ruleStates, itemExposure, events; user_id filtered everywhere → Task 3. ✓
5. Injectable Clock + env-gated POST /__test__/clock (advance/set/reset, active iff LT_TEST_CONTROL=1) → Task 4. ✓
6. locals.user via hooks.server.ts + app.d.ts → Task 5. ✓
7. M9 lint verified + tripwire test (plant import, run eslint, assert fires, clean up) → Task 8. ✓
8. Observability: inspector scheduled-rules panel (rule_key, direction, due_at, due_now, stable testids, order due/rule_key); practice persists attempts → Task 6 + Task 7. ✓
9. Tests: domain unit (trivial scheduler); web integration on fresh temp SQLite (persist+reschedule one txn; dueRuleStates vs clock; user_id isolation; STRICT rejects malformed; session open/close + realized_count); clock offset flips not-due→due (repo test via now cutoff + e2e clock advance); M9 tripwire; Playwright #C.3 → Tasks 1,3,4,8,9. ✓

**Edge cases from the design (owner-noted):** first attempt on never-seen rule (first_exposed_at=at, due=at+1d) → repo.test case 1; attempt crediting multiple rules (loop rule_keys) → repo impl + isolation test; same-day repeat re-ticks +1d harmlessly → repo.test case 2; empty/new user dueRuleStates [] → isolation test (u2 before writes) + inspector empty panel; caught up / empty due queue → dueRuleStates [] (repo test cutoff); prod clock safety (route absent) → Task 10 Step 4; empty practice at lesson 1 → practice.e2e "empty practice". ✓

**Placeholder scan:** the one intentional broken line in Task 3 Step 4 (`_.fullSchema` placeholder) is explicitly flagged with the corrected final test body immediately after — replace before running. No other TBD/TODO. ✓

**Type consistency:** `RuleStateRow`/`ItemExposureRow`/`ReviewLogRow` shapes = drizzle inferred rows (schema `$type<>()` aligns blob→SchedulerState, direction→Direction, rating→SrsRating). `sessionId: number` consistent across AttemptInput/SessionStartInput return/schema autoincrement/form Number(). `BOTH_DIRECTION='both'` used in repo upsert + asserted in repo.test + rendered in inspector. `webClock: Clock` consumed by getRepo + createTestDb. `getRepo()`/`getDb()` names consistent across db/index, +page.server, inspector. ✓

**Non-scope guard:** no ts-fsrs; no fold(); no EWMA/coverage; no set_lesson write (settings-service retained); no planner/star; no e2e parallelization. ✓
