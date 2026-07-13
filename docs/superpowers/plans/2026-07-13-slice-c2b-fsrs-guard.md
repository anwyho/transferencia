# Slice C.2b — FSRS + same-day guard (M3) + SM-2 replay proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the trivial scheduler with FSRS (`ts-fsrs`) behind the fixed `Scheduler.apply` seam, enforce the M3 same-day guard (worst-of-day monotonic) via a shared decorator held in the opaque blob, add an SM-2-on-rule escape hatch + a `rebuild` replay proof (swap scheduler = re-fold, no migration), and swap the app to FSRS.

**Architecture:** `appendAttempt` and `fold` both call `scheduler.apply(prev, rating, at)` and never inspect the blob (established in C.1/C.2a), so all new timing behavior lives inside scheduler implementations + one new `rebuild` repo method — the write-path and fold are untouched. `sameDayGuard(core)` is a `Scheduler` decorator storing day-tracking in the blob; FSRS and SM-2 are cores wrapped by it. `rebuild` re-folds the immutable log and re-materializes `rule_state` only (the sole scheduler-dependent projection).

**Tech Stack:** TypeScript, `ts-fsrs` 5.4.1 (pure JS, isomorphic — first runtime dep of `@lt/domain`), SvelteKit, Drizzle + better-sqlite3 (SQLite STRICT), Vitest, Playwright. `@lt/web` consumes `@lt/domain` from source.

## Conventions (apply to every task)
- **Working dir:** the isolated worktree the executor creates (branch `slice/c2b-fsrs-guard`). Paths below are repo-relative. Domain commands run from `app/packages/domain`; web from `app/packages/web`; workspace-wide from `app/`.
- **Commit trailer:** every commit message ends with a blank line then:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
  ```
  Use `git commit -m "$(cat <<'EOF' ... EOF)"`.
- **Staging:** `git add <explicit paths>` (never `-A`). **Deletions:** `trash`, never `rm`.
- **Single-file test run:** `npx vitest run <path>` (note `pnpm test -- <path>` does NOT filter in this repo — it runs the whole package suite, which is also fine). Whole package: `pnpm test`.
- **Green between tasks:** after each task, `pnpm --filter @lt/domain check` + `pnpm --filter @lt/web check` pass, and the relevant test command is green.

---

## File Structure

**Domain (`app/packages/domain/`):**
- `package.json` — *modify*: add `dependencies: { "ts-fsrs": "5.4.1" }`.
- `src/scheduler/same-day-guard.ts` — *create*: `sameDayGuard`, `worseOf`.
- `src/scheduler/fsrs.ts` — *create*: `fsrsCore`, `fsrsScheduler` (= guarded).
- `src/scheduler/sm2.ts` — *create*: `sm2Core`.
- `src/scheduler/index.ts` — *create*: barrel.
- `src/scheduler/*.test.ts` — *create*: co-located tests.
- `src/index.ts` — *modify*: `export * from './scheduler/index'`.
- `src/fold/fold.test.ts` — *modify*: add the unordered-input test (C.2a carry-forward M3).

**Web (`app/packages/web/`):**
- `src/lib/server/db/test-db.ts` — *modify*: `createTestDb(clock, scheduler = trivialScheduler)`.
- `src/lib/server/db/index.ts` — *modify*: app scheduler = `fsrsScheduler`.
- `src/lib/server/db/repo.ts` — *modify*: add `rebuild`; fix the `realized_count` `userId` predicate (C.2a M1).
- `src/lib/server/db/repo.test.ts` — *modify*: rebuild + replay proof + same-day-via-write-path + fold-vs-projection-under-FSRS.
- `e2e/persistence.e2e.ts` — *modify*: advance past the FSRS-computed due.

**Domain port:**
- `src/ports/repository.ts` — *modify*: add `rebuild` to `ReviewRepository`; import `Scheduler`.

---

## Task 1: `sameDayGuard` decorator + `worseOf` (domain, TDD)

**Files:**
- Create: `app/packages/domain/src/scheduler/same-day-guard.ts`, `app/packages/domain/src/scheduler/index.ts`, `app/packages/domain/src/scheduler/same-day-guard.test.ts`
- Modify: `app/packages/domain/src/index.ts`, `app/packages/domain/src/fold/fold.test.ts`

- [ ] **Step 1: Write the failing guard tests**

Create `app/packages/domain/src/scheduler/same-day-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../ports/scheduler';
import type { Scheduler } from '../ports/scheduler';
import { sameDayGuard, worseOf } from './same-day-guard';

// Fake core: blob.ticks counts applies FROM the given prev; due encodes ticks so we can observe
// how many times the core effectively advanced and with which rating.
const fakeCore: Scheduler = {
  apply(prev, rating, at) {
    const ticks = ((prev as { ticks?: number } | null)?.ticks ?? 0) + 1;
    return { blob: { ticks, lastRating: rating }, due: at + ticks };
  }
};

const DAY0 = 5 * DAY_MS; // some UTC day boundary
const guard = sameDayGuard(fakeCore);

describe('worseOf', () => {
  it('returns the lower-ranked (worse) rating: again < hard < good < easy', () => {
    expect(worseOf('again', 'good')).toBe('again');
    expect(worseOf('easy', 'hard')).toBe('hard');
    expect(worseOf('good', 'good')).toBe('good');
    expect(worseOf('easy', 'again')).toBe('again');
  });
});

describe('sameDayGuard (M3 worst-of-day, monotonic)', () => {
  it('first-ever attempt ticks the core from null', () => {
    const r = guard.apply(null, 'good', DAY0 + 100);
    expect((r.blob as { core: { ticks: number; lastRating: string } }).core).toEqual({ ticks: 1, lastRating: 'good' });
    expect((r.blob as { dayKey: number }).dayKey).toBe(5);
    expect((r.blob as { worstToday: string }).worstToday).toBe('good');
    expect((r.blob as { dayBaseline: unknown }).dayBaseline).toBeNull();
  });

  it('same-day re-tick recomputes from the day baseline with the WORST rating (one tick/day)', () => {
    const r1 = guard.apply(null, 'good', DAY0 + 100);
    const r2 = guard.apply(r1.blob, 'again', DAY0 + 200); // same day, worse
    const r3 = guard.apply(r2.blob, 'good', DAY0 + 300); // same day, better -> stays worst
    // core recomputed from baseline (null) each time => ticks stays 1, rating = worst = again
    expect((r3.blob as { core: { ticks: number; lastRating: string } }).core).toEqual({ ticks: 1, lastRating: 'again' });
    expect((r3.blob as { worstToday: string }).worstToday).toBe('again');
    expect(r3.due).toBe(r2.due); // monotonic: later 'good' did not change the tick
  });

  it('a new day advances from the prior day’s core state', () => {
    const r1 = guard.apply(null, 'good', DAY0 + 100); // day 5, core.ticks=1
    const r2 = guard.apply(r1.blob, 'good', DAY0 + DAY_MS + 100); // day 6
    // new-day baseline = prior core (ticks=1) -> core advances to ticks=2
    expect((r2.blob as { core: { ticks: number } }).core.ticks).toBe(2);
    expect((r2.blob as { dayKey: number }).dayKey).toBe(6);
    expect((r2.blob as { worstToday: string }).worstToday).toBe('good');
  });

  it('blob is JSON-round-trippable', () => {
    const r = guard.apply(null, 'hard', DAY0 + 1);
    expect(JSON.parse(JSON.stringify(r.blob))).toEqual(r.blob);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run (from `app/packages/domain`): `npx vitest run src/scheduler/same-day-guard.test.ts`
Expected: FAIL — cannot resolve `./same-day-guard`.

- [ ] **Step 3: Implement `same-day-guard.ts`**

> **CORRECTION (post-implementation):** the code block below has a bug the Step-1 test correctly rejects — the same-day re-tick must anchor on the day's FIRST-tick time, not the current `at`, or `due` drifts forward on each same-day re-drill. `GuardedState` gains a `dayAt: number` field, and the same-day branch calls `core.apply(g.dayBaseline, worstToday, g.dayAt)` (new-day branch sets `dayAt: at`). See the corrected design doc §"The same-day guard (M3)" and the committed `same-day-guard.ts` for the authoritative version.

Create `app/packages/domain/src/scheduler/same-day-guard.ts`:

```ts
import { DAY_MS } from '../ports/scheduler';
import type { Scheduler, SchedulerState } from '../ports/scheduler';
import type { SrsRating } from '../exercise/types';

const RANK: Record<SrsRating, number> = { again: 0, hard: 1, good: 2, easy: 3 };

/** The worse (lower-ranked) of two ratings — again < hard < good < easy. */
export function worseOf(a: SrsRating, b: SrsRating): SrsRating {
  return RANK[a] <= RANK[b] ? a : b;
}

interface GuardedState {
  v: 1;
  core: SchedulerState;
  dayBaseline: SchedulerState | null;
  dayKey: number;
  worstToday: SrsRating;
}

/**
 * M3 same-day / re-drill guard (design C.2b). Wraps any core `Scheduler` so a rule gets at
 * most ONE effective tick per UTC day (`floor(at / DAY_MS)`), computed from that day's baseline
 * with the day's WORST rating so far (monotonic — a later 'good' never undoes an earlier
 * 'again'). All day-tracking lives in the opaque blob, so `appendAttempt` and `fold` inherit
 * the guard through the single `apply` seam with no change to either.
 */
export function sameDayGuard(core: Scheduler): Scheduler {
  return {
    apply(prev: SchedulerState | null, rating: SrsRating, at: number) {
      const day = Math.floor(at / DAY_MS);
      const g = prev as GuardedState | null;
      if (g && g.dayKey === day) {
        const worstToday = worseOf(g.worstToday, rating);
        const r = core.apply(g.dayBaseline, worstToday, at);
        const blob: GuardedState = { v: 1, core: r.blob, dayBaseline: g.dayBaseline, dayKey: day, worstToday };
        return { blob, due: r.due };
      }
      const dayBaseline = g ? g.core : null;
      const r = core.apply(dayBaseline, rating, at);
      const blob: GuardedState = { v: 1, core: r.blob, dayBaseline, dayKey: day, worstToday: rating };
      return { blob, due: r.due };
    }
  };
}
```

- [ ] **Step 4: Create the barrel + domain export**

Create `app/packages/domain/src/scheduler/index.ts`:

```ts
export { sameDayGuard, worseOf } from './same-day-guard';
```

In `app/packages/domain/src/index.ts`, after the fold export line, add:

```ts
// Slice C.2b: real schedulers (FSRS + SM-2) behind the apply seam, and the M3 same-day guard.
export * from './scheduler/index';
```

- [ ] **Step 5: Run, verify PASS**

Run (from `app/packages/domain`): `npx vitest run src/scheduler/same-day-guard.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the C.2a carry-forward — unordered-input fold test**

In `app/packages/domain/src/fold/fold.test.ts`, add inside the `describe('fold (C.2a)', ...)` block:

```ts
  it('walks events as given (does not re-sort) — caller owns (at, id) order', () => {
    // Two attempts on one rule, array order NEWER-first (not (at,id) order).
    const st = fold([attemptEv({ at: 2000, rating: 'again' }), attemptEv({ at: 1000, rating: 'good' })], {
      scheduler: trivialScheduler
    });
    // trivial due = last-PROCESSED at (array order) => 1000; firstExposedAt = first processed => 2000.
    expect(st.ruleStates[0].due).toBe(1000 + DAY_MS);
    expect(st.ruleStates[0].firstExposedAt).toBe(2000);
  });
```

- [ ] **Step 7: Run domain suite + type-check**

Run (from `app/`): `pnpm --filter @lt/domain test && pnpm --filter @lt/domain check && pnpm --filter @lt/domain lint && pnpm --filter @lt/web check`
Expected: all green (domain gains the guard tests + 1 fold test).

- [ ] **Step 8: Commit**

```bash
git add app/packages/domain/src/scheduler/same-day-guard.ts app/packages/domain/src/scheduler/same-day-guard.test.ts app/packages/domain/src/scheduler/index.ts app/packages/domain/src/index.ts app/packages/domain/src/fold/fold.test.ts
git commit -m "feat(domain): sameDayGuard decorator (M3 worst-of-day) + fold order test (#15)"
```

---

## Task 2: `ts-fsrs` dependency + `fsrsCore` (domain, TDD)

**Files:**
- Modify: `app/packages/domain/package.json`
- Create: `app/packages/domain/src/scheduler/fsrs.ts`, `app/packages/domain/src/scheduler/fsrs.test.ts`
- Modify: `app/packages/domain/src/scheduler/index.ts`

- [ ] **Step 1: Add the dependency**

Add a `dependencies` block to `app/packages/domain/package.json` (it currently has only `devDependencies`; keep alphabetical, place `dependencies` before `devDependencies`):

```json
  "dependencies": {
    "ts-fsrs": "5.4.1"
  },
```

Then install from `app/`: `pnpm install`
Expected: `ts-fsrs` added to the lockfile.

- [ ] **Step 2: Write the failing FSRS tests (behavior-pinned, not internal-field)**

Create `app/packages/domain/src/scheduler/fsrs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fsrsCore } from './fsrs';

const T = 1_700_000_000_000;

describe('fsrsCore', () => {
  it('a first good review schedules a due strictly in the future (multi-day)', () => {
    const r = fsrsCore.apply(null, 'good', T);
    expect(r.due).toBeGreaterThan(T);
    expect(r.due - T).toBeGreaterThan(60_000); // not seconds — a real spaced interval
  });

  it('orders first-review intervals by rating: again <= hard <= good <= easy', () => {
    const dAgain = fsrsCore.apply(null, 'again', T).due;
    const dHard = fsrsCore.apply(null, 'hard', T).due;
    const dGood = fsrsCore.apply(null, 'good', T).due;
    const dEasy = fsrsCore.apply(null, 'easy', T).due;
    expect(dAgain).toBeLessThanOrEqual(dHard);
    expect(dHard).toBeLessThanOrEqual(dGood);
    expect(dGood).toBeLessThanOrEqual(dEasy);
  });

  it('blob is JSON-round-trippable and rehydrates to the same next state', () => {
    const first = fsrsCore.apply(null, 'good', T);
    const roundTripped = JSON.parse(JSON.stringify(first.blob));
    expect(roundTripped).toEqual(first.blob);
    // A follow-up review from the rehydrated blob must be deterministic + equal to using the blob directly.
    const next1 = fsrsCore.apply(first.blob, 'good', T + 5 * 86_400_000);
    const next2 = fsrsCore.apply(roundTripped, 'good', T + 5 * 86_400_000);
    expect(next2).toEqual(next1);
  });

  it('is deterministic (fuzz disabled)', () => {
    expect(fsrsCore.apply(null, 'good', T)).toEqual(fsrsCore.apply(null, 'good', T));
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

Run (from `app/packages/domain`): `npx vitest run src/scheduler/fsrs.test.ts`
Expected: FAIL — cannot resolve `./fsrs`.

- [ ] **Step 4: Implement `fsrs.ts`**

Create `app/packages/domain/src/scheduler/fsrs.ts`. **VERIFY the `ts-fsrs` 5.4.1 API against `node_modules/ts-fsrs` types before finalizing:** confirm `fsrs`, `generatorParameters`, `createEmptyCard`, `Rating`, and `type Card` are exported and that `f.next(card, now, grade)` returns `{ card: Card, log }`. The serialization below is generic (spreads all `Card` fields, special-casing only the `Date` fields `due`/`last_review`), so it is robust to field-name differences; if v5.4.1's `Card` has additional `Date` fields, convert them too. The tests pin behavior — do NOT change assertions to match a wrong API; fix the wiring.

```ts
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade } from 'ts-fsrs';
import { sameDayGuard } from './same-day-guard';
import type { Scheduler } from '../ports/scheduler';
import type { SrsRating } from '../exercise/types';

// Monte-Carlo-owned — placeholder defaults, tuned by the scheduler-sim experiment (ledger).
// enable_fuzz MUST stay false: the fold + rebuild/replay proofs require deterministic output.
const PARAMS = generatorParameters({ request_retention: 0.9, enable_fuzz: false });
const F = fsrs(PARAMS);

const GRADE: Record<SrsRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy
};

// The opaque blob: a ts-fsrs Card with its Date fields serialized to epoch ms (JSON-safe),
// tagged with a version. Generic spread keeps it lossless across ts-fsrs field changes.
type FsrsBlob = { v: 1 } & Omit<Card, 'due' | 'last_review'> & { due: number; last_review: number | null };

function toCard(b: FsrsBlob): Card {
  const { v: _v, due, last_review, ...rest } = b;
  return {
    ...(rest as Omit<Card, 'due' | 'last_review'>),
    due: new Date(due),
    last_review: last_review == null ? undefined : new Date(last_review)
  } as Card;
}

function fromCard(c: Card): FsrsBlob {
  return {
    ...(c as Card),
    v: 1,
    due: c.due.getTime(),
    last_review: c.last_review ? c.last_review.getTime() : null
  };
}

/**
 * FSRS timing core (design v2 §Scheduling; C.2b). Rule-grain: the "card" is the rule. Opaque
 * versioned blob behind the port so FSRS->SM-2 is a replay, not a migration. Pure/isomorphic
 * (ts-fsrs is pure JS) so it runs inside the fold client-side (P3).
 */
export const fsrsCore: Scheduler = {
  apply(prev, rating, at) {
    const card = prev ? toCard(prev as FsrsBlob) : createEmptyCard(new Date(at));
    const { card: next } = F.next(card, new Date(at), GRADE[rating]);
    return { blob: fromCard(next), due: next.due.getTime() };
  }
};

/** The app's live scheduler: FSRS under the M3 same-day guard. */
export const fsrsScheduler: Scheduler = sameDayGuard(fsrsCore);
```

- [ ] **Step 5: Run, verify PASS**

Run (from `app/packages/domain`): `npx vitest run src/scheduler/fsrs.test.ts`
Expected: PASS (4 tests). If a test fails because of a ts-fsrs API mismatch, fix `fsrs.ts` wiring (not the tests).

- [ ] **Step 6: Export from the barrel**

In `app/packages/domain/src/scheduler/index.ts`, add:

```ts
export { fsrsCore, fsrsScheduler } from './fsrs';
```

- [ ] **Step 7: Type-check + lint (confirm ts-fsrs passes the M9 boundary)**

Run (from `app/`): `pnpm --filter @lt/domain check && pnpm --filter @lt/domain lint && pnpm --filter @lt/web check`
Expected: all green. (`ts-fsrs` is pure JS, so the domain `no-restricted-imports` M9 rule does not flag it.)

- [ ] **Step 8: Commit**

```bash
git add app/packages/domain/package.json app/packages/domain/src/scheduler/fsrs.ts app/packages/domain/src/scheduler/fsrs.test.ts app/packages/domain/src/scheduler/index.ts app/pnpm-lock.yaml
git commit -m "feat(domain): FSRS scheduler core (ts-fsrs) + guarded fsrsScheduler (#15)"
```

---

## Task 3: `sm2Core` escape hatch (domain, TDD)

**Files:**
- Create: `app/packages/domain/src/scheduler/sm2.ts`, `app/packages/domain/src/scheduler/sm2.test.ts`
- Modify: `app/packages/domain/src/scheduler/index.ts`

- [ ] **Step 1: Write the failing SM-2 tests**

Create `app/packages/domain/src/scheduler/sm2.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../ports/scheduler';
import { sm2Core } from './sm2';

const T = 1_700_000_000_000;

describe('sm2Core (grain-agnostic SM-2 escape hatch)', () => {
  it('again resets to a 1-day interval', () => {
    const r = sm2Core.apply(null, 'again', T);
    expect(r.due).toBe(T + DAY_MS);
    expect((r.blob as { reps: number }).reps).toBe(0);
  });

  it('successive passes grow the interval (1 -> 6 -> ~ef*6 days)', () => {
    const r1 = sm2Core.apply(null, 'good', T);
    expect(r1.due).toBe(T + 1 * DAY_MS);
    const r2 = sm2Core.apply(r1.blob, 'good', T);
    expect(r2.due).toBe(T + 6 * DAY_MS);
    const r3 = sm2Core.apply(r2.blob, 'good', T);
    expect((r3.due - T) / DAY_MS).toBeGreaterThan(6); // interval = round(6 * ef), ef ~2.5
  });

  it('ef floors at 1.3 under repeated hard ratings', () => {
    let blob = sm2Core.apply(null, 'hard', T).blob;
    for (let i = 0; i < 10; i++) blob = sm2Core.apply(blob, 'hard', T).blob;
    expect((blob as { ef: number }).ef).toBeGreaterThanOrEqual(1.3);
  });

  it('blob is JSON-round-trippable', () => {
    const r = sm2Core.apply(null, 'good', T);
    expect(JSON.parse(JSON.stringify(r.blob))).toEqual(r.blob);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run (from `app/packages/domain`): `npx vitest run src/scheduler/sm2.test.ts`
Expected: FAIL — cannot resolve `./sm2`.

- [ ] **Step 3: Implement `sm2.ts`**

Create `app/packages/domain/src/scheduler/sm2.ts`:

```ts
import { DAY_MS } from '../ports/scheduler';
import type { Scheduler } from '../ports/scheduler';
import type { SrsRating } from '../exercise/types';

interface Sm2Blob {
  v: 1;
  ef: number;
  reps: number;
  intervalDays: number;
}

// SM-2 quality (0..5) per rating; 'again' is a lapse (reset).
const QUALITY: Record<SrsRating, number> = { again: 2, hard: 3, good: 4, easy: 5 };

/**
 * Grain-agnostic SM-2 on the rule (design v2 escape hatch): classic ease-factor + interval,
 * NO per-item difficulty. Exists to prove "swap scheduler = replay" (the C.2b replay proof);
 * not wired into the app runtime. Opaque versioned blob behind the same `apply` seam as FSRS.
 */
export const sm2Core: Scheduler = {
  apply(prev, rating, at) {
    const p = (prev as Sm2Blob | null) ?? { v: 1, ef: 2.5, reps: 0, intervalDays: 0 };
    const q = QUALITY[rating];
    let reps = p.reps;
    let intervalDays: number;
    if (rating === 'again') {
      reps = 0;
      intervalDays = 1;
    } else {
      reps += 1;
      intervalDays = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(p.intervalDays * p.ef);
    }
    const ef = Math.max(1.3, p.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    return { blob: { v: 1, ef, reps, intervalDays }, due: at + intervalDays * DAY_MS };
  }
};
```

- [ ] **Step 4: Run, verify PASS**

Run (from `app/packages/domain`): `npx vitest run src/scheduler/sm2.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Export from the barrel**

In `app/packages/domain/src/scheduler/index.ts`, add:

```ts
export { sm2Core } from './sm2';
```

- [ ] **Step 6: Type-check**

Run (from `app/`): `pnpm --filter @lt/domain check && pnpm --filter @lt/web check`
Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add app/packages/domain/src/scheduler/sm2.ts app/packages/domain/src/scheduler/sm2.test.ts app/packages/domain/src/scheduler/index.ts
git commit -m "feat(domain): SM-2-on-rule escape hatch core for the replay proof (#15)"
```

---

## Task 4: Wire FSRS into the app + test harness, keep all gates green (web)

**Files:**
- Modify: `app/packages/web/src/lib/server/db/test-db.ts`, `app/packages/web/src/lib/server/db/index.ts`, `app/packages/web/e2e/persistence.e2e.ts`

- [ ] **Step 1: Parameterize the test-db scheduler (default stays trivial)**

In `app/packages/web/src/lib/server/db/test-db.ts`:
- Add `Scheduler` to the `@lt/domain` type import: `import { trivialScheduler, type Clock, type Scheduler } from '@lt/domain';`
- Change the signature + repo construction:

```ts
export function createTestDb(
	clock: Clock,
	scheduler: Scheduler = trivialScheduler
): {
	db: Db;
	sqlite: Database.Database;
	repo: DrizzleReviewRepository;
	cleanup: () => void;
} {
```

and

```ts
	const repo = new DrizzleReviewRepository(db, { clock, scheduler });
```

(Existing callers pass only `clock`, so they keep the trivial scheduler — C.1/C.2a `due === at + DAY_MS` assertions stay valid.)

- [ ] **Step 2: Swap the app scheduler to FSRS**

In `app/packages/web/src/lib/server/db/index.ts`:
- Change the import `import { trivialScheduler } from '@lt/domain';` to `import { fsrsScheduler } from '@lt/domain';`
- In `getRepo()`, change the construction to:

```ts
		_repo = new DrizzleReviewRepository(getDb(), { clock: webClock, scheduler: fsrsScheduler });
```

- [ ] **Step 3: Update the persistence e2e to advance past the FSRS due**

The C.1 #C.3 test advances exactly 1 day, but FSRS's first interval is multiple days. In `app/packages/web/e2e/persistence.e2e.ts`, replace the final "advance one day" section (the `await clock(page, { action: 'advance', ms: 86400000 });` step and its follow-up assertion) with a read-the-due-then-set approach:

```ts
	// 4) advance PAST the FSRS-computed due (first interval is multi-day, not 1) -> rule due now
	const dueAt = Number(await page.locator(ROW).getByTestId('rule-due-at').textContent());
	await clock(page, { action: 'set', epoch: dueAt + 1000 });
	await page.goto('/inspector');
	await expect(page.locator(ROW).getByTestId('rule-due-now')).toHaveText('true');
```

(The `clock` helper already POSTs `/__test__/clock`; `set` sets the absolute epoch. `ROW` and the earlier steps are unchanged. The rule is still `L2#conv-al` from answering `annual→anual`.)

- [ ] **Step 4: Verify the full unit + e2e gate is green under FSRS**

Run (from `app/packages/web`): `pnpm test && pnpm check && pnpm lint`
Expected: unit green (existing tests use trivial via test-db default). Then `pnpm test:e2e`
Expected: **8 passed** — including the updated persistence test now advancing past the real FSRS due.

- [ ] **Step 5: Commit**

```bash
git add app/packages/web/src/lib/server/db/test-db.ts app/packages/web/src/lib/server/db/index.ts app/packages/web/e2e/persistence.e2e.ts
git commit -m "feat(web): swap app to FSRS scheduler; test-db scheduler param; e2e advances past FSRS due (#15)"
```

---

## Task 5: `repo.rebuild` + realized_count userId fix (web, TDD)

**Files:**
- Modify: `app/packages/domain/src/ports/repository.ts` (interface)
- Modify: `app/packages/web/src/lib/server/db/repo.ts` (impl + M1 fix)
- Test: `app/packages/web/src/lib/server/db/repo.test.ts`

- [ ] **Step 1: Write the failing rebuild test**

In `app/packages/web/src/lib/server/db/repo.test.ts`, extend the `@lt/domain` import to add `sameDayGuard`, `fsrsCore`, `sm2Core` (keep the existing named imports). Then add a new top-level `describe` after the existing blocks:

```ts
describe('C.2b rebuild — re-fold rule_state (replay, not migration)', () => {
	const fsrs = sameDayGuard(fsrsCore);
	const sm2 = sameDayGuard(sm2Core);

	function seed() {
		const env2 = createTestDb(clock, fsrs);
		const { sessionId } = env2.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-annual', ruleKeys: ['L2#conv-al'], rating: 'good' }));
		t += DAY_MS;
		env2.repo.appendAttempt(attempt({ sessionId, itemId: 'mente-lento', ruleKeys: ['L3#conv-mente'], rating: 'good' }));
		return env2;
	}

	it('rebuild only rewrites rule_state; exposure/sessions untouched; swap changes due', () => {
		const env2 = seed();
		try {
			const liveFsrs = env2.repo.ruleStates('u1');
			const expBefore = env2.repo.itemExposures('u1');
			const sessBefore = env2.repo.sessions('u1');

			env2.repo.rebuild('u1', { scheduler: sm2 });
			const afterSm2 = env2.repo.ruleStates('u1');

			expect(afterSm2.map((r) => r.ruleKey).sort()).toEqual(liveFsrs.map((r) => r.ruleKey).sort()); // same rules
			expect(afterSm2.some((r) => r.due !== liveFsrs.find((l) => l.ruleKey === r.ruleKey)!.due)).toBe(true); // due differs
			expect(env2.repo.itemExposures('u1')).toEqual(expBefore); // scheduler-independent
			expect(env2.repo.sessions('u1')).toEqual(sessBefore);
		} finally {
			env2.cleanup();
		}
	});

	it('rebuild through the same scheduler is idempotent (== live incremental projection)', () => {
		const env2 = seed();
		try {
			const liveFsrs = env2.repo.ruleStates('u1');
			env2.repo.rebuild('u1', { scheduler: sm2 }); // perturb
			env2.repo.rebuild('u1', { scheduler: fsrs }); // replay back
			expect(env2.repo.ruleStates('u1')).toEqual(liveFsrs);
		} finally {
			env2.cleanup();
		}
	});
});
```

- [ ] **Step 2: Run, verify FAIL**

Run (from `app/packages/web`): `npx vitest run src/lib/server/db/repo.test.ts`
Expected: FAIL — `env2.repo.rebuild is not a function`.

- [ ] **Step 3: Add `rebuild` to the `ReviewRepository` interface**

In `app/packages/domain/src/ports/repository.ts`:
- Add `Scheduler` to the `./scheduler` type import: `import type { Scheduler, SchedulerState } from './scheduler';`
- Inside `interface ReviewRepository`, after `itemExposures(...)`, add:

```ts
  /** Re-fold the log + re-materialize rule_state only (scheduler swap / rename = replay, not migration). */
  rebuild(userId: string, opts: { scheduler: Scheduler; keyRemap?: (ruleKey: string) => string }): void;
```

- [ ] **Step 4: Implement `rebuild` + fix the realized_count predicate in `repo.ts`**

In `app/packages/web/src/lib/server/db/repo.ts`:
- Add `fold` and `rowToEvent` to the `@lt/domain` import (they are values, not types):

```ts
import {
	BOTH_DIRECTION,
	fold,
	rowToEvent,
	type AttemptInput,
	type Clock,
	type ItemExposureRow,
	type ReviewLogRow,
	type ReviewRepository,
	type RuleStateRow,
	type Scheduler,
	type SessionEndInput,
	type SessionRow,
	type SessionStartInput,
	type SetLessonInput
} from '@lt/domain';
```

- **M1 fix:** in `appendAttempt`, change the `realized_count` update to also filter `userId`:

```ts
			tx.update(sessions)
				.set({ realizedCount: sql`${sessions.realizedCount} + 1` })
				.where(and(eq(sessions.userId, i.userId), eq(sessions.id, i.sessionId)))
				.run();
```

- Add the `rebuild` method (after `itemExposures(...)`):

```ts
	rebuild(userId: string, opts: { scheduler: Scheduler; keyRemap?: (ruleKey: string) => string }): void {
		const state = fold(this.events(userId).map(rowToEvent), opts);
		this.db.transaction((tx) => {
			tx.delete(ruleState).where(eq(ruleState.userId, userId)).run();
			for (const rs of state.ruleStates) {
				tx.insert(ruleState)
					.values({
						userId: rs.userId,
						ruleKey: rs.ruleKey,
						direction: rs.direction,
						blob: rs.blob,
						due: rs.due,
						firstExposedAt: rs.firstExposedAt
					})
					.run();
			}
		});
	}
```

- [ ] **Step 5: Run, verify PASS**

Run (from `app/packages/web`): `npx vitest run src/lib/server/db/repo.test.ts`
Expected: PASS (all existing + the 2 rebuild tests). If the idempotence test fails, the fold and incremental FSRS projection disagree — investigate the scheduler/guard, do NOT weaken the assertion.

- [ ] **Step 6: Type-check both packages**

Run (from `app/`): `pnpm --filter @lt/domain check && pnpm --filter @lt/web check`
Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add app/packages/domain/src/ports/repository.ts app/packages/web/src/lib/server/db/repo.ts app/packages/web/src/lib/server/db/repo.test.ts
git commit -m "feat(web): repo.rebuild (re-fold rule_state) + realized_count user_id fix (#15)"
```

---

## Task 6: Same-day guard through the real write path + fold==projection under FSRS (web, TDD)

**Files:**
- Test: `app/packages/web/src/lib/server/db/repo.test.ts`

- [ ] **Step 1: Write the integration tests**

In `app/packages/web/src/lib/server/db/repo.test.ts`, add a new top-level `describe` after the rebuild block:

```ts
describe('C.2b FSRS same-day guard + fold parity through the real write path', () => {
	const fsrs = sameDayGuard(fsrsCore);

	it('same-day drills collapse to one worst-of-day tick; exposure still counts every rep', () => {
		const env2 = createTestDb(clock, fsrs);
		try {
			const { sessionId } = env2.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
			// Rule R drilled 3x same day: good, again, good -> worst = again.
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-annual', ruleKeys: ['R'], rating: 'good' }));
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-normal', ruleKeys: ['R'], rating: 'again' }));
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-legal', ruleKeys: ['R'], rating: 'good' }));
			// Rule S drilled once same day with 'again' — the day's worst for R.
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-total', ruleKeys: ['S'], rating: 'again' }));

			const rs = env2.repo.ruleStates('u1');
			const R = rs.find((r) => r.ruleKey === 'R')!;
			const S = rs.find((r) => r.ruleKey === 'S')!;
			expect(R.due).toBe(S.due); // R's 3 same-day attempts collapsed to a single 'again' tick == S
		} finally {
			env2.cleanup();
		}
	});

	it('fold reproduces the incremental FSRS projection (divergence guard under the real scheduler)', () => {
		const env2 = createTestDb(clock, fsrs);
		try {
			const { sessionId } = env2.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-annual', ruleKeys: ['L2#conv-al'], rating: 'good' }));
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-normal', ruleKeys: ['L2#conv-al'], rating: 'again' }));
			t += DAY_MS;
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'mente-lento', ruleKeys: ['L3#conv-mente'], rating: 'good' }));

			const state = fold(env2.repo.events('u1').map(rowToEvent), { scheduler: fsrs });
			const byRule = (a: { ruleKey: string }, b: { ruleKey: string }) => a.ruleKey.localeCompare(b.ruleKey);
			expect([...state.ruleStates].sort(byRule)).toEqual([...env2.repo.ruleStates('u1')].sort(byRule));
			expect(state.itemExposures).toEqual(env2.repo.itemExposures('u1'));
		} finally {
			env2.cleanup();
		}
	});
});
```

- [ ] **Step 2: Run, verify PASS**

Run (from `app/packages/web`): `npx vitest run src/lib/server/db/repo.test.ts`
Expected: PASS. The worst-of-day test proves M3 through the real transaction path; the parity test re-proves fold==projection under FSRS (the C.2a guard, now with the real scheduler + same-day guard). If parity fails, fix the scheduler determinism (fuzz must be off), not the assertion.

- [ ] **Step 3: Commit**

```bash
git add app/packages/web/src/lib/server/db/repo.test.ts
git commit -m "test(web): FSRS same-day worst-of-day guard + fold parity via write path (#15)"
```

---

## Task 7: Full-gate verification + Playwright MCP walkthrough (controller)

**Files:** none (verification only).

- [ ] **Step 1: Run every gate**

Run (from `app/`): `pnpm -r lint && pnpm -r check && pnpm -r build && pnpm -r test`
Expected: all green (domain gains guard/fsrs/sm2 suites; web gains rebuild + FSRS integration). Then (from `app/packages/web`): `pnpm test:e2e` — 8 green.

- [ ] **Step 2: Playwright MCP walkthrough on the real built UI (evidence before claims — AGENTS.md)**

Start the preview with the control-plane:

```bash
cd app/packages/web && LT_TEST_CONTROL=1 LT_DB_PATH=:memory: pnpm build && LT_TEST_CONTROL=1 LT_DB_PATH=:memory: pnpm preview --port 4173
```

Drive + screenshot:
1. `/inspector` → set dial 3 → reload → still 3 (per-user, unchanged from C.2a).
2. `/` → answer `annual → anual` → correct.
3. `/inspector` → scheduled rule `L2#conv-al`, `due_now` false, and note `due_at` is now a **multi-day FSRS interval** (not `at + 1d`).
4. Advance the clock **past** that `due_at` (read the value, `POST /__test__/clock {action:'set', epoch: dueAt+1000}`) → reload → `due_now` true.
5. (M3 evidence) Back on `/`, answer the same rule again the same day → `/inspector` shows the rule's `due_at` reflects one worst-of-day tick, not a per-attempt reschedule.

- [ ] **Step 3: Report evidence**

Summarize with actual command output + screenshots. State explicitly: FSRS intervals are live, the same-day guard holds, `rebuild` replay is proven, all gates green. No success claim without observed output.

---

## Self-Review (completed while writing)

**Spec coverage:** sameDayGuard worst-of-day monotonic (Task 1) ✓ · worseOf (Task 1) ✓ · unordered-fold C.2a-M3 carry-forward (Task 1) ✓ · FSRS via ts-fsrs, defaults/fuzz-off/MC-marked, versioned JSON blob (Task 2) ✓ · guard is a shared decorator wrapping cores (Tasks 1-3) ✓ · SM-2 test-only escape hatch (Task 3) ✓ · app swap to FSRS + test-db param, existing tests stay on trivial (Task 4) ✓ · FSRS-interval e2e fix (Task 4) ✓ · rebuild = rule_state only (Task 5) ✓ · C.2a-M1 realized_count userId fix (Task 5) ✓ · replay proof: swap→due differs, idempotent re-swap, exposure/sessions untouched (Task 5) ✓ · same-day via write path + fold parity under FSRS (Task 6) ✓ · full gate + MCP with FSRS-aware advance (Task 7) ✓.

**Placeholder scan:** none. The only external-API uncertainty (`ts-fsrs` field names) is handled by generic lossless serialization + an explicit VERIFY-against-installed-types step in Task 2; behavior is pinned by tests.

**Type consistency:** `sameDayGuard`/`worseOf`/`fsrsCore`/`fsrsScheduler`/`sm2Core` names consistent across scheduler module, barrel, domain index, and consumers. `rebuild(userId, {scheduler, keyRemap?})` signature identical in the port interface (Task 5 Step 3) and impl (Step 4); `keyRemap` typed structurally as `(ruleKey: string) => string` to avoid a ports→fold import cycle (fold's `KeyRemap` is structurally identical). `createTestDb(clock, scheduler?)` default `trivialScheduler` keeps every prior test valid. `fold`/`rowToEvent` imported as values in repo.ts.
