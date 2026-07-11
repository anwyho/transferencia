# Slice C.2a — pure fold + per-user lesson dial + rebuild proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure `fold(events, { scheduler, keyRemap }) -> FoldState` in `@lt/domain` proven (by a rebuild test) to reproduce C.1's incremental projection, and convert the lesson dial from a process-global into a per-user `set_lesson` event folded into `users.current_lesson`, retiring `settings-service`.

**Architecture:** `ReviewLog` is ground truth; the incremental apply-on-write projection C.1 shipped is a cache. `fold` walks events in `(at, id)` order and rebuilds the projection; equality holds under monotonic time (production wall-clock guarantee) — fold is canonical, the cache is a convenience. The dial becomes durable per-user DB state written in one transaction (event + cache), the same pattern C.1 uses for attempts.

**Tech Stack:** TypeScript, SvelteKit, Drizzle + better-sqlite3 (SQLite STRICT), Vitest, Playwright. `@lt/domain` is isomorphic (no Node/persistence imports — eslint M9 boundary) and is consumed by `@lt/web` directly from source (`exports: "./src/index.ts"`), so new domain exports are visible to web with no build step.

## Conventions (apply to every task)
- **Working dir:** domain commands run from `app/packages/domain`; web commands from `app/packages/web`. Paths below are repo-relative.
- **Commit trailer:** every commit message ends with the two-line trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
  ```
  Commit steps below show the subject/body; append this trailer each time.
- **Staging:** `git add <explicit paths>` (a second agent shares this workspace — never `git add -A`).
- **Deletions:** use `trash <path>`, never `rm`.
- **Green between tasks:** after each task, `pnpm --filter @lt/domain check` and `pnpm --filter @lt/web check` must pass (run from `app/`). Task-specific test commands are in each task.

---

## File Structure

**Domain (`app/packages/domain/`):**
- `src/ports/repository.ts` — *modify*: add `SessionRow` + `SetLessonInput` types; add four methods to `ReviewRepository`.
- `src/ports/index.ts` — *modify*: export the two new types.
- `src/fold/fold.ts` — *create*: `fold`, `rowToEvent`, `KeyRemap`, `FoldState`.
- `src/fold/index.ts` — *create*: re-export.
- `src/fold/fold.test.ts` — *create*: fold unit tests.
- `src/index.ts` — *modify*: `export * from './fold/index'`.

**Web (`app/packages/web/`):**
- `src/lib/server/db/schema.ts` — *modify*: add `users.current_lesson`.
- `drizzle/0001_*.sql` + `drizzle/meta/*` — *generated*: forward-only migration.
- `src/lib/server/db/repo.ts` — *modify*: implement the four repo methods.
- `src/lib/server/db/repo.test.ts` — *modify*: dial + reads tests + rebuild proof.
- `src/lib/server/content-loader.ts` — *modify*: add `maxLesson()`.
- `src/lib/server/content-loader.test.ts` — *modify*: `maxLesson` test.
- `src/routes/inspector/+page.server.ts` — *modify*: dial via repo.
- `src/routes/+page.server.ts` — *modify*: `currentLesson` via repo.
- `src/lib/server/settings-service.ts` + `settings-service.test.ts` — *delete*.
- `e2e/inspector.e2e.ts` — *modify*: dial-persistence test + comment.
- `e2e/practice.e2e.ts`, `e2e/persistence.e2e.ts`, `playwright.config.ts` — *modify*: stale-comment cleanup.

---

## Task 1: Domain types — `SessionRow` + `SetLessonInput`

**Files:**
- Modify: `app/packages/domain/src/ports/repository.ts`
- Modify: `app/packages/domain/src/ports/index.ts`

Type-only, non-breaking (no interface method added yet), so `@lt/domain` and `@lt/web` stay green. `fold` (Task 3) needs `SessionRow`; the repo methods (Task 4) need both.

- [ ] **Step 1: Add the two types to `repository.ts`**

Insert after the existing `ItemExposureRow` interface (before the `ReviewRepository` interface):

```ts
/** A session row (fold output + repo read-back). `endedAt` null until session_end. */
export interface SessionRow {
  id: number;
  userId: string;
  startedAt: number;
  endedAt: number | null;
  mode: string;
  targetAttempts: number;
  realizedCount: number;
}

/** Payload for the per-user lesson dial (C.2a). `at` from the caller's Clock. */
export interface SetLessonInput {
  userId: string;
  lesson: number;
  at: number;
}
```

- [ ] **Step 2: Export them from `ports/index.ts`**

In the `export type { ... } from './repository';` block, add `SessionRow` and `SetLessonInput` to the list (keep alphabetical-ish grouping):

```ts
export type {
  AttemptInput,
  ItemExposureRow,
  ReviewRepository,
  RuleStateRow,
  SessionEndInput,
  SessionRow,
  SessionStartInput,
  SetLessonInput
} from './repository';
```

- [ ] **Step 3: Verify types compile**

Run (from `app/`): `pnpm --filter @lt/domain check && pnpm --filter @lt/web check`
Expected: both pass (no errors).

- [ ] **Step 4: Commit**

```bash
git add app/packages/domain/src/ports/repository.ts app/packages/domain/src/ports/index.ts
git commit -m "feat(domain): SessionRow + SetLessonInput port types for C.2a (#15)"
```

---

## Task 2: `users.current_lesson` column + forward-only migration

**Files:**
- Modify: `app/packages/web/src/lib/server/db/schema.ts`
- Generate: `app/packages/web/drizzle/0001_*.sql` + `drizzle/meta/*`

- [ ] **Step 1: Add the column to the `users` table**

Replace the `users` table definition:

```ts
export const users = sqliteTable('users', {
	id: text('id').primaryKey()
	// current_lesson added in C.2 with the folded per-user dial.
});
```

with:

```ts
export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	// Per-user lesson dial (C.2a): the folded cache of the last set_lesson event.
	currentLesson: integer('current_lesson').notNull().default(1)
});
```

- [ ] **Step 2: Generate the migration**

Run (from `app/packages/web`): `pnpm db:generate`
Expected: a new file `drizzle/0001_<random-name>.sql` is created and `drizzle/meta/_journal.json` gains an `idx: 1` entry.

- [ ] **Step 3: Verify the generated SQL**

Open the new `drizzle/0001_*.sql`. It must be exactly one statement:

```sql
ALTER TABLE `users` ADD `current_lesson` integer DEFAULT 1 NOT NULL;
```

No `STRICT` hand-edit is needed here (unlike the C.1 `0000` migration): `ALTER TABLE ADD COLUMN` carries no table-level `STRICT` clause, and `users` is already STRICT. The `DEFAULT 1` backfills the seeded `u1` row. If the file contains anything else (e.g. a table rebuild), stop and investigate.

- [ ] **Step 4: Verify migration applies cleanly**

Run (from `app/packages/web`): `pnpm test -- src/lib/server/db/repo.test.ts`
Expected: the existing C.1 integration suite still passes (it runs `migrate()` over `drizzle/`, now including `0001`).

- [ ] **Step 5: Commit**

```bash
git add app/packages/web/src/lib/server/db/schema.ts app/packages/web/drizzle
git commit -m "feat(web): users.current_lesson column + forward-only migration (#15)"
```

---

## Task 3: The pure `fold` + `rowToEvent` (domain, TDD)

**Files:**
- Create: `app/packages/domain/src/fold/fold.ts`
- Create: `app/packages/domain/src/fold/index.ts`
- Test: `app/packages/domain/src/fold/fold.test.ts`
- Modify: `app/packages/domain/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/packages/domain/src/fold/fold.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DAY_MS, trivialScheduler } from '../ports/scheduler';
import type { AttemptEvent, ReviewLogEvent, ReviewLogRow } from '../ports/review-log';
import { fold, rowToEvent } from './fold';

function attemptEv(over: Partial<AttemptEvent> = {}): AttemptEvent {
  return {
    kind: 'attempt',
    userId: 'u1',
    at: 1000,
    sessionId: 1,
    itemId: 'it1',
    ruleKeys: ['R1'],
    exerciseTypeKey: 'transformation',
    paramKey: '',
    direction: 'en>es',
    rating: 'good',
    assessment: { correct: true },
    hintRevealed: false,
    contentHash: 'h',
    ...over
  };
}

describe('fold (C.2a)', () => {
  it('empty log folds to the initial state', () => {
    expect(fold([], { scheduler: trivialScheduler })).toEqual({
      currentLesson: 1,
      ruleStates: [],
      itemExposures: [],
      sessions: []
    });
  });

  it('an attempt creates rule_state, exposure, and bumps the session', () => {
    const events: ReviewLogEvent[] = [
      { kind: 'session_start', userId: 'u1', at: 1000, sessionId: 1, sessionMode: 'practice', sessionTargetAttempts: 10 },
      attemptEv({ at: 1000, sessionId: 1 })
    ];
    const st = fold(events, { scheduler: trivialScheduler });
    expect(st.ruleStates).toHaveLength(1);
    expect(st.ruleStates[0]).toEqual({
      userId: 'u1',
      ruleKey: 'R1',
      direction: 'both',
      blob: { last: 1000 },
      due: 1000 + DAY_MS,
      firstExposedAt: 1000
    });
    expect(st.itemExposures[0]).toMatchObject({ itemId: 'it1', timesSeen: 1, lastSeenAt: 1000, lastRating: 'good', known: false, starred: false });
    expect(st.sessions[0]).toMatchObject({ id: 1, startedAt: 1000, endedAt: null, mode: 'practice', targetAttempts: 10, realizedCount: 1 });
  });

  it('a second attempt on the same rule keeps firstExposedAt, moves due, counts exposure', () => {
    const st = fold([attemptEv({ at: 1000 }), attemptEv({ at: 2000, rating: 'again' })], { scheduler: trivialScheduler });
    expect(st.ruleStates).toHaveLength(1);
    expect(st.ruleStates[0].firstExposedAt).toBe(1000);
    expect(st.ruleStates[0].due).toBe(2000 + DAY_MS);
    expect(st.itemExposures[0].timesSeen).toBe(2);
    expect(st.itemExposures[0].lastRating).toBe('again');
  });

  it('set_lesson is last-wins and floors at 1', () => {
    expect(fold([{ kind: 'set_lesson', userId: 'u1', at: 1, annotationLesson: 5 }], { scheduler: trivialScheduler }).currentLesson).toBe(5);
    expect(fold([
      { kind: 'set_lesson', userId: 'u1', at: 1, annotationLesson: 5 },
      { kind: 'set_lesson', userId: 'u1', at: 2, annotationLesson: 3 }
    ], { scheduler: trivialScheduler }).currentLesson).toBe(3);
    expect(fold([{ kind: 'set_lesson', userId: 'u1', at: 1, annotationLesson: 0 }], { scheduler: trivialScheduler }).currentLesson).toBe(1);
  });

  it('session_end sets endedAt; realized_count counts attempts under the session', () => {
    const st = fold([
      { kind: 'session_start', userId: 'u1', at: 1000, sessionId: 1, sessionMode: 'practice', sessionTargetAttempts: 10 },
      attemptEv({ at: 1100, sessionId: 1 }),
      attemptEv({ at: 1200, sessionId: 1, itemId: 'it2' }),
      { kind: 'session_end', userId: 'u1', at: 2000, sessionId: 1 }
    ], { scheduler: trivialScheduler });
    expect(st.sessions[0]).toMatchObject({ id: 1, startedAt: 1000, endedAt: 2000, realizedCount: 2 });
  });

  it('keyRemap collapses two raw keys onto one rule_state, folded in order', () => {
    const st = fold(
      [attemptEv({ at: 1000, ruleKeys: ['old-a'] }), attemptEv({ at: 2000, ruleKeys: ['old-b'] })],
      { scheduler: trivialScheduler, keyRemap: (k) => (k === 'old-a' || k === 'old-b' ? 'new' : k) }
    );
    expect(st.ruleStates).toHaveLength(1);
    expect(st.ruleStates[0].ruleKey).toBe('new');
    expect(st.ruleStates[0].firstExposedAt).toBe(1000);
    expect(st.ruleStates[0].due).toBe(2000 + DAY_MS);
  });

  it('star / set_known / unstar set exposure flags (create-if-missing, no lastSeenAt bump)', () => {
    const st = fold([
      { kind: 'star', userId: 'u1', at: 1000, itemId: 'it1' },
      { kind: 'set_known', userId: 'u1', at: 1100, itemId: 'it1', annotationKnown: true },
      { kind: 'unstar', userId: 'u1', at: 1200, itemId: 'it1' }
    ], { scheduler: trivialScheduler });
    expect(st.itemExposures[0]).toEqual({
      userId: 'u1', itemId: 'it1', timesSeen: 0, lastSeenAt: 1000, lastRating: null, known: true, starred: false
    });
  });

  it('rowToEvent narrows a valid attempt row and throws on a malformed one', () => {
    const row: ReviewLogRow = {
      id: 1, userId: 'u1', at: 1000, kind: 'attempt', itemId: 'it1', ruleKeys: ['R1'],
      exerciseTypeKey: 'transformation', paramKey: '', direction: 'en>es', rating: 'good',
      assessment: { correct: true }, hintRevealed: false, latencyMs: null, contentHash: 'h',
      sessionId: 1, annotationKnown: null, annotationLesson: null, sessionMode: null, sessionTargetAttempts: null
    };
    expect(rowToEvent(row)).toMatchObject({ kind: 'attempt', itemId: 'it1', ruleKeys: ['R1'], rating: 'good', latencyMs: undefined });
    expect(() => rowToEvent({ ...row, rating: null })).toThrow(/malformed attempt/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `app/packages/domain`): `pnpm test -- src/fold/fold.test.ts`
Expected: FAIL — `Cannot find module './fold'` (file not created yet).

- [ ] **Step 3: Implement `fold.ts`**

Create `app/packages/domain/src/fold/fold.ts`:

```ts
import { BOTH_DIRECTION } from '../ports/repository';
import type { ItemExposureRow, RuleStateRow, SessionRow } from '../ports/repository';
import type { ReviewLogEvent, ReviewLogRow } from '../ports/review-log';
import type { Scheduler } from '../ports/scheduler';

/** Applied fold-time to each tested rule key to collapse a rename's history (design v2 m7/M8). */
export type KeyRemap = (ruleKey: string) => string;

/** The projection `fold` rebuilds — the same state C.1's incremental write path materializes. */
export interface FoldState {
  currentLesson: number;
  ruleStates: RuleStateRow[];
  itemExposures: ItemExposureRow[];
  sessions: SessionRow[];
}

const IDENTITY: KeyRemap = (k) => k;

/**
 * Pure, isomorphic projection of the ReviewLog (design v2 §State plane). Walks `events`
 * AS GIVEN — the caller guarantees `(at, id)` order (the repo's `events()` does). Equality
 * with the incremental projection holds under monotonic time (contract A); under a backward
 * clock the cache may lag and this fold is authoritative. Never inspects the scheduler blob
 * (opaque) and performs no I/O. `rule_state` is keyed by rule with the `'both'` direction
 * sentinel (C.1/C.2a do not schedule by direction — M7).
 */
export function fold(events: ReviewLogEvent[], opts: { scheduler: Scheduler; keyRemap?: KeyRemap }): FoldState {
  const keyRemap = opts.keyRemap ?? IDENTITY;
  const { scheduler } = opts;

  let currentLesson = 1;
  const ruleStates = new Map<string, RuleStateRow>();
  const itemExposures = new Map<string, ItemExposureRow>();
  const sessions = new Map<number, SessionRow>();

  const exposureFor = (userId: string, itemId: string, at: number): ItemExposureRow => {
    let e = itemExposures.get(itemId);
    if (!e) {
      e = { userId, itemId, timesSeen: 0, lastSeenAt: at, lastRating: null, known: false, starred: false };
      itemExposures.set(itemId, e);
    }
    return e;
  };

  for (const ev of events) {
    switch (ev.kind) {
      case 'attempt': {
        for (const raw of ev.ruleKeys) {
          const ruleKey = keyRemap(raw);
          const prev = ruleStates.get(ruleKey);
          const { blob, due } = scheduler.apply(prev ? prev.blob : null, ev.rating, ev.at);
          ruleStates.set(ruleKey, {
            userId: ev.userId,
            ruleKey,
            direction: BOTH_DIRECTION,
            blob,
            due,
            firstExposedAt: prev ? prev.firstExposedAt : ev.at
          });
        }
        const e = exposureFor(ev.userId, ev.itemId, ev.at);
        e.timesSeen += 1;
        e.lastSeenAt = ev.at;
        e.lastRating = ev.rating;
        const s = sessions.get(ev.sessionId);
        if (s) s.realizedCount += 1;
        break;
      }
      case 'session_start':
        sessions.set(ev.sessionId, {
          id: ev.sessionId,
          userId: ev.userId,
          startedAt: ev.at,
          endedAt: null,
          mode: ev.sessionMode,
          targetAttempts: ev.sessionTargetAttempts,
          realizedCount: 0
        });
        break;
      case 'session_end': {
        const s = sessions.get(ev.sessionId);
        if (s) s.endedAt = ev.at;
        break;
      }
      case 'set_lesson':
        currentLesson = Math.max(1, ev.annotationLesson);
        break;
      case 'star':
        exposureFor(ev.userId, ev.itemId, ev.at).starred = true;
        break;
      case 'unstar':
        exposureFor(ev.userId, ev.itemId, ev.at).starred = false;
        break;
      case 'set_known':
        exposureFor(ev.userId, ev.itemId, ev.at).known = ev.annotationKnown;
        break;
    }
  }

  return {
    currentLesson,
    ruleStates: [...ruleStates.values()].sort(
      (a, b) => a.ruleKey.localeCompare(b.ruleKey) || a.direction.localeCompare(b.direction)
    ),
    itemExposures: [...itemExposures.values()].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    sessions: [...sessions.values()].sort((a, b) => a.id - b.id)
  };
}

/**
 * Narrow a nullable read-back `ReviewLogRow` to the clean discriminated `ReviewLogEvent`.
 * Throws on a row whose `kind`-required columns are null — surfacing corruption instead of
 * folding garbage. `latency_ms` null maps to `undefined` (the optional event field).
 */
export function rowToEvent(row: ReviewLogRow): ReviewLogEvent {
  const base = { userId: row.userId, at: row.at };
  switch (row.kind) {
    case 'attempt':
      if (
        row.itemId == null || row.ruleKeys == null || row.exerciseTypeKey == null ||
        row.paramKey == null || row.direction == null || row.rating == null ||
        row.assessment == null || row.hintRevealed == null || row.contentHash == null ||
        row.sessionId == null
      ) {
        throw new Error(`malformed attempt row id=${row.id}`);
      }
      return {
        ...base,
        kind: 'attempt',
        sessionId: row.sessionId,
        itemId: row.itemId,
        ruleKeys: row.ruleKeys,
        exerciseTypeKey: row.exerciseTypeKey,
        paramKey: row.paramKey,
        direction: row.direction,
        rating: row.rating,
        assessment: row.assessment,
        hintRevealed: row.hintRevealed,
        latencyMs: row.latencyMs ?? undefined,
        contentHash: row.contentHash
      };
    case 'star':
      if (row.itemId == null) throw new Error(`malformed star row id=${row.id}`);
      return { ...base, kind: 'star', itemId: row.itemId };
    case 'unstar':
      if (row.itemId == null) throw new Error(`malformed unstar row id=${row.id}`);
      return { ...base, kind: 'unstar', itemId: row.itemId };
    case 'set_known':
      if (row.itemId == null || row.annotationKnown == null) throw new Error(`malformed set_known row id=${row.id}`);
      return { ...base, kind: 'set_known', itemId: row.itemId, annotationKnown: row.annotationKnown };
    case 'set_lesson':
      if (row.annotationLesson == null) throw new Error(`malformed set_lesson row id=${row.id}`);
      return { ...base, kind: 'set_lesson', annotationLesson: row.annotationLesson };
    case 'session_start':
      if (row.sessionId == null || row.sessionMode == null || row.sessionTargetAttempts == null) {
        throw new Error(`malformed session_start row id=${row.id}`);
      }
      return { ...base, kind: 'session_start', sessionId: row.sessionId, sessionMode: row.sessionMode, sessionTargetAttempts: row.sessionTargetAttempts };
    case 'session_end':
      if (row.sessionId == null) throw new Error(`malformed session_end row id=${row.id}`);
      return { ...base, kind: 'session_end', sessionId: row.sessionId };
    default:
      throw new Error(`unknown kind "${row.kind}" row id=${row.id}`);
  }
}
```

- [ ] **Step 4: Create the module barrel**

Create `app/packages/domain/src/fold/index.ts`:

```ts
export { fold, rowToEvent } from './fold';
export type { FoldState, KeyRemap } from './fold';
```

- [ ] **Step 5: Export the fold module from the domain entrypoint**

In `app/packages/domain/src/index.ts`, after the ports export line, add:

```ts
// Slice C.2a: pure fold — the canonical projection of the ReviewLog (rebuild/replay).
export * from './fold/index';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `app/packages/domain`): `pnpm test -- src/fold/fold.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Verify domain + web still type-check**

Run (from `app/`): `pnpm --filter @lt/domain check && pnpm --filter @lt/web check`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add app/packages/domain/src/fold app/packages/domain/src/index.ts
git commit -m "feat(domain): pure fold(events,{scheduler,keyRemap}) + rowToEvent (#15)"
```

---

## Task 4: Repo methods — `setLesson` / `currentLesson` / `sessions` / `itemExposures` (TDD)

**Files:**
- Modify: `app/packages/domain/src/ports/repository.ts` (interface)
- Modify: `app/packages/web/src/lib/server/db/repo.ts` (impl)
- Test: `app/packages/web/src/lib/server/db/repo.test.ts`

Interface + impl land together so `@lt/web check` stays green.

- [ ] **Step 1: Write the failing tests**

In `app/packages/web/src/lib/server/db/repo.test.ts`, add this block inside the top-level `describe('DrizzleReviewRepository (C.1 integration)', () => { ... })` (after the last `it`):

```ts
	it('setLesson appends a set_lesson event and updates the current_lesson cache', () => {
		expect(env.repo.currentLesson('u1')).toBe(1); // seeded default
		env.repo.setLesson({ userId: 'u1', lesson: 4, at: t });
		expect(env.repo.currentLesson('u1')).toBe(4);
		const ev = env.repo.events('u1').find((e) => e.kind === 'set_lesson');
		expect(ev?.annotationLesson).toBe(4);
		expect(ev?.at).toBe(t);
	});

	it('set_lesson is last-wins on the cache and per-user', () => {
		env.db.insert(users).values({ id: 'u2' }).run();
		env.repo.setLesson({ userId: 'u1', lesson: 4, at: t });
		env.repo.setLesson({ userId: 'u1', lesson: 2, at: t + 1 });
		expect(env.repo.currentLesson('u1')).toBe(2);
		expect(env.repo.currentLesson('u2')).toBe(1); // isolated default
	});

	it('sessions() and itemExposures() read back per-user rows', () => {
		const { sessionId } = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(attempt({ sessionId, itemId: 'al-annual' }));
		const ss = env.repo.sessions('u1');
		expect(ss).toHaveLength(1);
		expect(ss[0]).toMatchObject({ id: sessionId, mode: 'practice', targetAttempts: 10, realizedCount: 1, endedAt: null });
		expect(env.repo.itemExposures('u1').map((e) => e.itemId)).toEqual(['al-annual']);
	});
```

- [ ] **Step 2: Run to verify failure**

Run (from `app/packages/web`): `pnpm test -- src/lib/server/db/repo.test.ts`
Expected: FAIL — `env.repo.setLesson is not a function` (and TS errors on the missing methods).

- [ ] **Step 3: Add the four methods to the `ReviewRepository` interface**

In `app/packages/domain/src/ports/repository.ts`, inside `interface ReviewRepository`, after the `events(userId: string): ReviewLogRow[];` line, add:

```ts
  /** Append a set_lesson event + update the users.current_lesson cache in one txn (C.2a). */
  setLesson(i: SetLessonInput): void;
  /** Read the per-user current_lesson cache (folds to max(1, last set_lesson)); default 1. */
  currentLesson(userId: string): number;
  /** All sessions for the user, ordered by id — for the rebuild comparison + future use. */
  sessions(userId: string): SessionRow[];
  /** All item exposures for the user, ordered by item_id — for the rebuild comparison. */
  itemExposures(userId: string): ItemExposureRow[];
```

- [ ] **Step 4: Implement them in `repo.ts`**

In `app/packages/web/src/lib/server/db/repo.ts`, add `SessionRow` and `SetLessonInput` to the `@lt/domain` type import list, and add `users` to the schema import:

```ts
import { itemExposure, reviewLog, ruleState, sessions, users } from './schema';
```

Then add these methods to the `DrizzleReviewRepository` class (after `events(...)`):

```ts
	setLesson(i: SetLessonInput): void {
		this.db.transaction((tx) => {
			tx.insert(reviewLog)
				.values({ userId: i.userId, at: i.at, kind: 'set_lesson', annotationLesson: i.lesson })
				.run();
			tx.update(users).set({ currentLesson: i.lesson }).where(eq(users.id, i.userId)).run();
		});
	}

	currentLesson(userId: string): number {
		const row = this.db
			.select({ currentLesson: users.currentLesson })
			.from(users)
			.where(eq(users.id, userId))
			.get();
		return row?.currentLesson ?? 1;
	}

	sessions(userId: string): SessionRow[] {
		return this.db
			.select()
			.from(sessions)
			.where(eq(sessions.userId, userId))
			.orderBy(asc(sessions.id))
			.all();
	}

	itemExposures(userId: string): ItemExposureRow[] {
		return this.db
			.select()
			.from(itemExposure)
			.where(eq(itemExposure.userId, userId))
			.orderBy(asc(itemExposure.itemId))
			.all();
	}
```

(`SessionRow` and `SetLessonInput` join the existing `type { ... }` import from `@lt/domain` at the top of the file.)

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `app/packages/web`): `pnpm test -- src/lib/server/db/repo.test.ts`
Expected: PASS (all C.1 tests + the 3 new ones).

- [ ] **Step 6: Type-check**

Run (from `app/`): `pnpm --filter @lt/domain check && pnpm --filter @lt/web check`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add app/packages/domain/src/ports/repository.ts app/packages/web/src/lib/server/db/repo.ts app/packages/web/src/lib/server/db/repo.test.ts
git commit -m "feat(web): repo setLesson/currentLesson/sessions/itemExposures (#15)"
```

---

## Task 5: Rebuild proof — `fold(events(u))` == live projection

**Files:**
- Test: `app/packages/web/src/lib/server/db/repo.test.ts`

The divergence guard: drive the real repo, then assert the fold reproduces it. This should pass once Tasks 2–4 are correct; a failure is a real fold/write-path disagreement to fix.

- [ ] **Step 1: Add the rebuild-proof test**

In `app/packages/web/src/lib/server/db/repo.test.ts`:

- Extend the imports from `@lt/domain` to include `fold`, `rowToEvent`, `trivialScheduler`:

```ts
import { DAY_MS, fold, rowToEvent, trivialScheduler, type AttemptInput, type Clock } from '@lt/domain';
```

- Add a new top-level `describe` block after the existing one:

```ts
describe('C.2a rebuild proof — fold reproduces the incremental projection', () => {
	const byRule = (a: { ruleKey: string; direction: string }, b: { ruleKey: string; direction: string }) =>
		a.ruleKey.localeCompare(b.ruleKey) || a.direction.localeCompare(b.direction);

	it('deep-equals the live projection under monotonic time', () => {
		const { sessionId } = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(attempt({ sessionId, itemId: 'al-annual', ruleKeys: ['L2#conv-al'], rating: 'good' }));
		env.repo.appendAttempt(attempt({ sessionId, itemId: 'al-normal', ruleKeys: ['L2#conv-al'], rating: 'again' }));
		t += DAY_MS; // monotonic advance
		env.repo.appendAttempt(attempt({ sessionId, itemId: 'al-annual', ruleKeys: ['L2#conv-al'], rating: 'good' }));
		env.repo.appendAttempt(attempt({ sessionId, itemId: 'mente-lento', ruleKeys: ['L3#conv-mente'], rating: 'good' }));
		env.repo.setLesson({ userId: 'u1', lesson: 4, at: t });
		env.repo.endSession({ userId: 'u1', sessionId, at: t + 1000 });

		const state = fold(env.repo.events('u1').map(rowToEvent), { scheduler: trivialScheduler });

		expect(state.currentLesson).toBe(env.repo.currentLesson('u1'));
		expect([...state.ruleStates].sort(byRule)).toEqual([...env.repo.ruleStates('u1')].sort(byRule));
		expect(state.itemExposures).toEqual(env.repo.itemExposures('u1'));
		expect(state.sessions).toEqual(env.repo.sessions('u1'));
	});

	it('folds only the requested user (no cross-user leak)', () => {
		env.db.insert(users).values({ id: 'u2' }).run();
		const s1 = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		const s2 = env.repo.startSession({ userId: 'u2', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(attempt({ userId: 'u1', sessionId: s1.sessionId, ruleKeys: ['L2#conv-al'] }));
		env.repo.appendAttempt(attempt({ userId: 'u2', sessionId: s2.sessionId, ruleKeys: ['L3#conv-mente'] }));

		const u1 = fold(env.repo.events('u1').map(rowToEvent), { scheduler: trivialScheduler });
		expect(u1.ruleStates.map((r) => r.ruleKey)).toEqual(['L2#conv-al']);
	});
});
```

- [ ] **Step 2: Run the proof**

Run (from `app/packages/web`): `pnpm test -- src/lib/server/db/repo.test.ts`
Expected: PASS. If `ruleStates`/`itemExposures`/`sessions` mismatch, the fold disagrees with the write path — fix `fold.ts` (Task 3) until it matches; do not weaken the assertion.

- [ ] **Step 3: Commit**

```bash
git add app/packages/web/src/lib/server/db/repo.test.ts
git commit -m "test(web): C.2a rebuild proof — fold reproduces the projection (#15)"
```

---

## Task 6: Retire `settings-service` — per-user dial in the routes

**Files:**
- Modify: `app/packages/web/src/lib/server/content-loader.ts` (add `maxLesson`)
- Test: `app/packages/web/src/lib/server/content-loader.test.ts`
- Modify: `app/packages/web/src/routes/inspector/+page.server.ts`
- Modify: `app/packages/web/src/routes/+page.server.ts`
- Delete: `app/packages/web/src/lib/server/settings-service.ts` + `settings-service.test.ts`

- [ ] **Step 1: Write the failing `maxLesson` test**

In `app/packages/web/src/lib/server/content-loader.test.ts`, add (adjust the existing import line if `contentStore`/`maxLesson` aren't already imported):

```ts
import { contentStore, maxLesson } from './content-loader';

describe('maxLesson', () => {
	it('is the highest seeded home lesson (seed spans L1–5)', () => {
		const expected = contentStore()
			.allRules()
			.reduce((m, r) => Math.max(m, r.homeLesson), 1);
		expect(maxLesson()).toBe(expected);
		expect(maxLesson()).toBe(5);
	});
});
```

(If `describe`/`it`/`expect` are not already imported in this file, add `import { describe, expect, it } from 'vitest';`.)

- [ ] **Step 2: Run to verify failure**

Run (from `app/packages/web`): `pnpm test -- src/lib/server/content-loader.test.ts`
Expected: FAIL — `maxLesson` is not exported.

- [ ] **Step 3: Add `maxLesson` to `content-loader.ts`**

At the end of `app/packages/web/src/lib/server/content-loader.ts`, add:

```ts
/**
 * The content-derived lesson ceiling (highest seeded home lesson): the dial's upper clamp
 * bound. Not per-user, not persisted, not folded — purely a UI/route concern (C.2a moved
 * this off the retired settings-service). Extends to the L30 content ceiling in production.
 */
export function maxLesson(): number {
	return contentStore()
		.allRules()
		.reduce((max, rule) => Math.max(max, rule.homeLesson), 1);
}
```

- [ ] **Step 4: Run to verify the test passes**

Run (from `app/packages/web`): `pnpm test -- src/lib/server/content-loader.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire the inspector route**

Replace the entire contents of `app/packages/web/src/routes/inspector/+page.server.ts` with:

```ts
import type { Actions, PageServerLoad } from './$types';
import { eligibleItems, eligibleRules } from '@lt/domain';
import { contentStore, maxLesson } from '$lib/server/content-loader';
import { getRepo } from '$lib/server/db';
import { clockNow } from '$lib/server/clock';

export const load: PageServerLoad = ({ locals }) => {
	const store = contentStore();
	const repo = getRepo();
	const currentLesson = repo.currentLesson(locals.user.id);
	const now = clockNow();
	return {
		currentLesson,
		maxLesson: maxLesson(),
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
		scheduledRules: repo.ruleStates(locals.user.id).map((r) => ({
			ruleKey: r.ruleKey,
			direction: r.direction,
			dueAt: r.due,
			dueNow: r.due <= now
		}))
	};
};

// The dial is a per-user set_lesson event + current_lesson cache (C.2a). The route clamps
// to [1, maxLesson] before emitting; the fold independently floors at 1 (design decision 2).
export const actions: Actions = {
	up: ({ locals }) => {
		const repo = getRepo();
		const next = Math.min(maxLesson(), repo.currentLesson(locals.user.id) + 1);
		repo.setLesson({ userId: locals.user.id, lesson: next, at: clockNow() });
	},
	down: ({ locals }) => {
		const repo = getRepo();
		const next = Math.max(1, repo.currentLesson(locals.user.id) - 1);
		repo.setLesson({ userId: locals.user.id, lesson: next, at: clockNow() });
	},
	set: async ({ request, locals }) => {
		const data = await request.formData();
		const requested = Math.floor(Number(data.get('lesson')));
		const lesson = Math.min(maxLesson(), Math.max(1, Number.isFinite(requested) ? requested : 1));
		getRepo().setLesson({ userId: locals.user.id, lesson, at: clockNow() });
	}
};
```

- [ ] **Step 6: Rewire the practice route**

In `app/packages/web/src/routes/+page.server.ts`:
- Remove the import line `import { getCurrentLesson } from '$lib/server/settings-service';`.
- Replace `const currentLesson = getCurrentLesson();` with:

```ts
	const currentLesson = getRepo().currentLesson(locals.user.id);
```

(`getRepo` is already imported; `load` already receives `{ locals }`.)

- [ ] **Step 7: Delete the settings-service**

```bash
trash app/packages/web/src/lib/server/settings-service.ts app/packages/web/src/lib/server/settings-service.test.ts
```

- [ ] **Step 8: Verify unit tests + type-check + lint**

Run (from `app/packages/web`): `pnpm test && pnpm check && pnpm lint`
Expected: all pass; no dangling `settings-service` import remains (`check` would flag one).

- [ ] **Step 9: Commit**

```bash
git add app/packages/web/src/lib/server/content-loader.ts app/packages/web/src/lib/server/content-loader.test.ts app/packages/web/src/routes/inspector/+page.server.ts app/packages/web/src/routes/+page.server.ts app/packages/web/src/lib/server/settings-service.ts app/packages/web/src/lib/server/settings-service.test.ts
git commit -m "refactor(web): per-user lesson dial via repo, retire settings-service (#15)"
```

---

## Task 7: e2e dial-persistence test + stale-comment cleanup

**Files:**
- Modify: `app/packages/web/e2e/inspector.e2e.ts`
- Modify: `app/packages/web/e2e/practice.e2e.ts`
- Modify: `app/packages/web/e2e/persistence.e2e.ts`
- Modify: `app/packages/web/playwright.config.ts`

- [ ] **Step 1: Add the dial-persistence test**

In `app/packages/web/e2e/inspector.e2e.ts`, append a new test at the end of the file:

```ts
test('lesson dial persists across reload (DB-backed per-user, C.2a)', async ({ page }) => {
	await setLesson(page, 3);
	await page.reload();
	await expect(page.getByTestId('current-lesson')).toHaveText('3');
	await expect(page.getByTestId('queue-count')).toHaveText('28'); // L3 eligible count
});
```

- [ ] **Step 2: Refresh the stale "process-global (slice B)" comment in `inspector.e2e.ts`**

Replace the header comment above `setLesson`:

```ts
// The lesson dial is a single process-global (slice B), so each test sets a known
// starting lesson before asserting rather than assuming order.
```

with:

```ts
// The lesson dial is a per-user DB value (C.2a); e2e still shares one seeded user on a
// serial run, so each test sets a known starting lesson before asserting.
```

- [ ] **Step 3: Refresh the same stale comment in `practice.e2e.ts` and `persistence.e2e.ts`**

In both files, change the phrase `the dial is a process-global (slice B)` to `the dial is a per-user DB value (C.2a)` within the `setLesson` header comment (leave the rest of each comment intact).

- [ ] **Step 4: Update the `playwright.config.ts` comment (workers pin rationale)**

Replace:

```ts
	// The lesson dial + clock offset + :memory: DB are process-globals on one server,
	// so e2e runs serially. (Revisit when per-user state lands in slice C.2.)
	workers: 1
```

with:

```ts
	// The dial is now per-user in the DB (C.2a), but the clock offset and the shared
	// :memory: DB + seed user u1 remain process-globals on one preview server, so e2e
	// still runs serially. Dropping this needs per-test clock + DB isolation (separate task).
	workers: 1
```

- [ ] **Step 5: Run the e2e suite**

Run (from `app/packages/web`): `pnpm test:e2e`
Expected: PASS — all prior e2e (practice, inspector, persistence #C.3) plus the new dial-persistence test.

- [ ] **Step 6: Commit**

```bash
git add app/packages/web/e2e/inspector.e2e.ts app/packages/web/e2e/practice.e2e.ts app/packages/web/e2e/persistence.e2e.ts app/packages/web/playwright.config.ts
git commit -m "test(web): e2e dial persists across reload; refresh workers:1 rationale (#15)"
```

---

## Task 8: Full-gate verification + Playwright MCP walkthrough

**Files:** none (verification only).

- [ ] **Step 1: Run every gate**

Run (from `app/`):

```bash
pnpm -r lint && pnpm -r check && pnpm -r build && pnpm -r test
```

Expected: all green — domain (fold + ports) and web (repo + routes + content-loader). Then (from `app/packages/web`): `pnpm test:e2e` — all green.

- [ ] **Step 2: Playwright MCP walkthrough on the real built UI (evidence before claims — AGENTS.md)**

Start the preview with the test control-plane, then drive the real browser (MCP), capturing screenshots:

```bash
cd app/packages/web && LT_TEST_CONTROL=1 LT_DB_PATH=:memory: pnpm build && LT_TEST_CONTROL=1 LT_DB_PATH=:memory: pnpm preview
```

Walkthrough to verify and screenshot:
1. `/inspector` → set the dial to **3** → `current-lesson` shows `3`, queue count updates.
2. **Reload** `/inspector` → dial still `3` (proves DB-backed per-user, not process-global).
3. `/` → answer the first item (`annual` → `anual`) → `verdict` correct.
4. `/inspector` → the scheduled-rules panel shows `L2#conv-al`, `due_now` false.
5. `POST /__test__/clock` advance 1 day → reload `/inspector` → `due_now` true.

- [ ] **Step 3: Report evidence**

Summarize with the actual command output and screenshots. State explicitly that the rebuild proof passes (fold == projection) and the dial survives reload. No success claim without the observed output.

---

## Self-Review (completed while writing)

**Spec coverage:** fold (Task 3) ✓ · rowToEvent (Task 3) ✓ · rebuild proof / contract A (Task 5) ✓ · keyRemap identity + collapse test (Task 3) ✓ · all-7-kinds interpreter (Task 3) ✓ · per-user set_lesson event + current_lesson cache (Tasks 2,4,6) ✓ · dial clamp split — route clamps, fold floors (Tasks 3,6) ✓ · retire settings-service + relocate maxLesson (Task 6) ✓ · new repo reads sessions/itemExposures/currentLesson (Task 4) ✓ · migration (Task 2) ✓ · inspector/practice rewire (Task 6) ✓ · workers:1 stays, comment corrected (Task 7) ✓ · full gate + MCP walkthrough (Task 8) ✓.

**Placeholder scan:** none — every code step shows complete code; the only non-literal artifact is the drizzle-generated `0001_*.sql` filename, whose exact expected content is given in Task 2 Step 3.

**Type consistency:** `SessionRow`/`SetLessonInput` defined (Task 1) before use (Tasks 3,4). `fold` / `rowToEvent` / `FoldState` / `KeyRemap` names match across Tasks 3 and 5. `currentLesson` (schema field, repo method) and `setLesson` (repo method) spelled consistently in schema, port, impl, and routes. `maxLesson` consistent in content-loader and both routes.
