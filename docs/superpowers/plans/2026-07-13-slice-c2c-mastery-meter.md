# Slice C.2c — EWMA mastery + coverage-K meter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an advisory rule-mastery meter (recency-weighted EWMA accuracy + distinct-instrument coverage + distinct-success-days spacing) that is a fold of the `ReviewLog`, materialized on `rule_state`, shown in the inspector — and that **never touches `due`**.

**Architecture:** One pure primitive (`applyMastery`) in `@lt/domain`, called by **both** `fold` and the write-path (`repo.appendAttempt`) — the structural-identity seam that keeps fold ≡ projection (the `scheduler.apply` pattern). Four additive `rule_state` columns (`mastery`, `coverage`, `seen_instruments`, `success_days`); the dedup sets are JSON accumulators beside the opaque `blob`. `masteryReady` is a **read-time** predicate over those raw signals — thresholds are Monte-Carlo-owned placeholders, never baked into the fold. Timing stays ≤1 tick/day (the M3 guard); **mastery eats every rep** — the divergence the extended rebuild proof asserts.

**Tech Stack:** TypeScript, `@lt/domain` (isomorphic, M9-clean), SvelteKit (`@lt/web`), Drizzle + better-sqlite3 (STRICT SQLite), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-13-slice-c2c-mastery-meter-design.md` (read it; this plan implements it).

**Conventions (from the repo):**
- Run everything from `app/`. Single-file unit run: `pnpm --filter @lt/domain exec vitest run <relpath>` (or `@lt/web`). `pnpm test -- <file>` does **not** filter in this repo — do not use it.
- Full gates from `app/`: `pnpm lint`, `pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:e2e`.
- **Stage by explicit path — never `git add -A`** (a second agent works `cards/` in this same working tree). Use `trash`, never `rm`.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
  ```

---

## File Structure

**Create:**
- `app/packages/domain/src/mastery/mastery.ts` — the pure primitive + knobs + predicate.
- `app/packages/domain/src/mastery/mastery.test.ts` — its unit tests.
- `app/packages/domain/src/mastery/index.ts` — re-exports.
- `app/packages/web/e2e/mastery.e2e.ts` — inspector mastery-panel walkthrough.
- `app/packages/web/drizzle/0002_*.sql` — generated ADD COLUMN migration (name auto-assigned).

**Modify:**
- `app/packages/domain/src/index.ts` — export the mastery module.
- `app/packages/domain/src/ports/repository.ts` — 4 fields on `RuleStateRow`; comment the inlined `keyRemap` type on `rebuild`.
- `app/packages/domain/src/fold/fold.ts` — materialize the 4 columns via `applyMastery`.
- `app/packages/domain/src/fold/fold.test.ts` — extend for mastery; fix the one full-`toEqual`.
- `app/packages/web/src/lib/server/db/schema.ts` — 4 columns on `ruleState`.
- `app/packages/web/src/lib/server/db/repo.ts` — `appendAttempt` + `rebuild` materialize the 4 columns; by-design comment on `rebuild`.
- `app/packages/web/src/lib/server/db/repo.test.ts` — integration proof + C.2b-nit tidy.
- `app/packages/web/src/routes/inspector/+page.server.ts` — map the columns + `masteryReady`.
- `app/packages/web/src/routes/inspector/+page.svelte` — mastery/coverage/mastered cells.

---

## Task 1: Pure mastery primitive (`@lt/domain/src/mastery/`)

**Files:**
- Create: `app/packages/domain/src/mastery/mastery.ts`
- Create: `app/packages/domain/src/mastery/mastery.test.ts`
- Create: `app/packages/domain/src/mastery/index.ts`
- Modify: `app/packages/domain/src/index.ts`

- [ ] **Step 1: Write the failing test** — `app/packages/domain/src/mastery/mastery.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../ports/scheduler';
import {
  applyMastery,
  instrumentKey,
  masteryReady,
  MASTERY_KNOBS,
  type MasteryKnobs,
  type MasteryState
} from './mastery';

const K = (over: Partial<MasteryKnobs> = {}): MasteryKnobs => ({ ...MASTERY_KNOBS, ...over });
const inst = (i: string) => instrumentKey(i, 'transformation', '', 'en>es');

describe('instrumentKey', () => {
  it('is a collision-safe canonical encoding of the 4 identity fields', () => {
    // Naive delimiter joins collide; JSON encoding does not.
    expect(instrumentKey('a|b', 'transformation', '', 'en>es')).not.toBe(
      instrumentKey('a', 'b|transformation', '', 'en>es')
    );
    expect(instrumentKey('it1', 'transformation', '', 'en>es')).toBe(
      instrumentKey('it1', 'transformation', '', 'en>es')
    );
    // Direction is part of identity: the same item/type/param in two directions = two instruments.
    expect(instrumentKey('it1', 'transformation', '', 'en>es')).not.toBe(
      instrumentKey('it1', 'transformation', '', 'es>en')
    );
  });
});

describe('applyMastery — EWMA (eats every rep, no same-day guard)', () => {
  it('seeds from 0; a first good moves ewma to alpha*base(good)', () => {
    const s = applyMastery(null, 'good', inst('it1'), 1000, K({ alpha: 0.1 }));
    expect(s.ewma).toBeCloseTo(0.1, 10); // 0 + 0.1*(1 - 0)
  });

  it('updates on EVERY attempt, including a repeat of the same instrument', () => {
    let s = applyMastery(null, 'good', inst('it1'), 1000, K({ alpha: 0.1 }));
    s = applyMastery(s, 'good', inst('it1'), 1000, K({ alpha: 0.1 })); // same instrument, same day
    expect(s.ewma).toBeCloseTo(0.19, 10); // 0.1 + 0.1*(1 - 0.1)
    expect(s.instruments).toHaveLength(1); // coverage did NOT move (dedup)
  });

  it('a miss pulls ewma toward base(again)=0', () => {
    const good = applyMastery(null, 'good', inst('it1'), 1000);
    const then = applyMastery(good, 'again', inst('it2'), 1000);
    expect(then.ewma).toBeLessThan(good.ewma);
  });

  it('base keys on the rating', () => {
    const easy = applyMastery(null, 'easy', inst('x'), 1000, K({ base: { again: 0, hard: 0.5, good: 1, easy: 1 } }));
    const hard = applyMastery(null, 'hard', inst('x'), 1000, K({ base: { again: 0, hard: 0.5, good: 1, easy: 1 } }));
    expect(easy.ewma).toBeGreaterThan(hard.ewma);
  });
});

describe('applyMastery — coverage (distinct instruments)', () => {
  it('dedups the same instrument and counts distinct ones (sorted set)', () => {
    let s = applyMastery(null, 'good', inst('b'), 1000);
    s = applyMastery(s, 'good', inst('b'), 1000); // dup
    s = applyMastery(s, 'good', inst('a'), 1000); // distinct
    expect(s.instruments).toEqual([inst('a'), inst('b')]); // sorted, deduped
  });
});

describe('applyMastery — spacing (distinct success-days)', () => {
  it('adds a UTC day only on a success, deduping same-day successes', () => {
    let s = applyMastery(null, 'good', inst('i'), 5 * DAY_MS + 10); // day 5 success
    s = applyMastery(s, 'good', inst('j'), 5 * DAY_MS + 99); // same day success -> dedup
    s = applyMastery(s, 'again', inst('k'), 6 * DAY_MS + 1); // day 6 NOT a success
    s = applyMastery(s, 'good', inst('l'), 7 * DAY_MS + 1); // day 7 success
    expect(s.successDays).toEqual([5, 7]);
  });
});

describe('masteryReady — read-time predicate (all thresholds must hold)', () => {
  const full: MasteryState = {
    ewma: 0.9,
    instruments: Array.from({ length: 8 }, (_, i) => inst('i' + i)),
    successDays: [1, 2, 3]
  };
  it('is true only when coverage>=K AND ewma>=mReady AND |successDays|>=S', () => {
    expect(masteryReady(full, K({ K: 8, mReady: 0.85, S: 3 }))).toBe(true);
  });
  it('is false if any single signal is below threshold', () => {
    expect(masteryReady({ ...full, instruments: full.instruments.slice(0, 7) }, K({ K: 8, mReady: 0.85, S: 3 }))).toBe(false);
    expect(masteryReady({ ...full, ewma: 0.84 }, K({ K: 8, mReady: 0.85, S: 3 }))).toBe(false);
    expect(masteryReady({ ...full, successDays: [1, 2] }, K({ K: 8, mReady: 0.85, S: 3 }))).toBe(false);
  });
});

describe('MasteryState determinism', () => {
  it('round-trips through JSON (sorted arrays, plain scalars)', () => {
    const s = applyMastery(applyMastery(null, 'good', inst('b'), 1000), 'hard', inst('a'), 1000);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lt/domain exec vitest run src/mastery/mastery.test.ts`
Expected: FAIL — `Cannot find module './mastery'` (file not created yet).

- [ ] **Step 3: Write the primitive** — `app/packages/domain/src/mastery/mastery.ts`

```ts
import { DAY_MS } from '../ports/scheduler';
import type { Direction, SrsRating } from '../exercise/types';

/**
 * The advisory mastery meter (design C.2c; two-signal model, ledger 2026-07-10). A fold of the
 * ReviewLog, materialized on rule_state — NEVER a driver of `due`. Three raw signals:
 *   ewma         — recency-weighted accuracy (isolated; not FSRS's internal difficulty)
 *   instruments  — distinct instrument identities seen (coverage = length; M6: a count, not a %)
 *   successDays  — distinct UTC days with a success (the "not blitzable" spacing signal)
 * `coverage` is materialized to its own rule_state column as `instruments.length`.
 */
export interface MasteryState {
  ewma: number;
  instruments: string[]; // sorted dedup set of canonical instrument keys
  successDays: number[]; // sorted dedup set of UTC day-keys
}

/** Advisory thresholds + inputs — ALL Monte-Carlo-owned placeholders (scheduler-sim owns the values). */
export interface MasteryKnobs {
  alpha: number; // EWMA learning rate; low => slow (~20 spaced reps to saturate, not ~3)
  base: Record<SrsRating, number>; // per-rating accuracy contribution
  isSuccess: (r: SrsRating) => boolean; // what counts as a "success" for the spacing signal
  K: number; // distinct-instrument coverage threshold
  mReady: number; // EWMA readiness threshold
  S: number; // distinct-success-days (spacing) threshold
}

// Monte-Carlo-owned — placeholder defaults, NOT tuned. The scheduler-sim experiment sets these
// (docs/superpowers/specs/scheduler-monte-carlo-experiment.md). Retuning alpha/base is a `rebuild`
// (re-fold); retuning K/mReady/S is a pure read-time change (masteryReady).
export const MASTERY_KNOBS: MasteryKnobs = {
  alpha: 0.1, // Monte-Carlo-owned
  base: { again: 0, hard: 0.5, good: 1, easy: 1 }, // Monte-Carlo-owned
  isSuccess: (r) => r === 'good' || r === 'easy', // Monte-Carlo-owned
  K: 8, // Monte-Carlo-owned
  mReady: 0.85, // Monte-Carlo-owned
  S: 3 // Monte-Carlo-owned
};

const EMPTY: MasteryState = { ewma: 0, instruments: [], successDays: [] };

/**
 * Collision-safe canonical instrument key over the frozen identity (design v2 §Identity bans
 * delimiter joins). The CONCRETE `direction` is part of the key — coverage counts across both
 * directions into the single 'both' rule_state row.
 */
export function instrumentKey(
  itemId: string,
  exerciseTypeKey: string,
  paramKey: string,
  direction: Direction
): string {
  return JSON.stringify([itemId, exerciseTypeKey, paramKey, direction]);
}

function addSortedStr(set: string[], v: string): string[] {
  if (set.includes(v)) return set;
  return [...set, v].sort();
}
function addSortedNum(set: number[], v: number): number[] {
  if (set.includes(v)) return set;
  return [...set, v].sort((a, b) => a - b);
}

/**
 * Fold one attempt into a rule's mastery meter. Called by BOTH `fold` and the write-path
 * (structural identity — the scheduler.apply pattern) so the incremental projection can never
 * drift from the fold. Eats EVERY rep (no same-day guard, unlike timing): the EWMA always
 * updates; a distinct instrument bumps coverage; a success on a new UTC day bumps spacing.
 * Pure/deterministic — no Date.now/Math.random. Takes `at` (not a pre-derived dayKey) so the
 * day math lives in one place, not duplicated across the two callers.
 */
export function applyMastery(
  prev: MasteryState | null,
  rating: SrsRating,
  instrKey: string,
  at: number,
  knobs: MasteryKnobs = MASTERY_KNOBS
): MasteryState {
  const p = prev ?? EMPTY;
  const ewma = p.ewma + knobs.alpha * (knobs.base[rating] - p.ewma);
  const instruments = addSortedStr(p.instruments, instrKey);
  const successDays = knobs.isSuccess(rating)
    ? addSortedNum(p.successDays, Math.floor(at / DAY_MS))
    : p.successDays;
  return { ewma, instruments, successDays };
}

/**
 * Read-time advisory predicate. NEVER stored — retuning K/mReady/S must not force a re-fold.
 * All three signals must clear their threshold ("mastered" is coverage AND accuracy AND spacing).
 */
export function masteryReady(s: MasteryState, knobs: MasteryKnobs = MASTERY_KNOBS): boolean {
  return s.instruments.length >= knobs.K && s.ewma >= knobs.mReady && s.successDays.length >= knobs.S;
}
```

- [ ] **Step 4: Write the module index** — `app/packages/domain/src/mastery/index.ts`

```ts
export { applyMastery, masteryReady, instrumentKey, MASTERY_KNOBS } from './mastery';
export type { MasteryState, MasteryKnobs } from './mastery';
```

- [ ] **Step 5: Export from the domain entrypoint** — `app/packages/domain/src/index.ts`

Add this line at the end (after the `./scheduler/index` export):

```ts
// Slice C.2c: advisory mastery meter (EWMA + coverage + spacing) — a fold of the log, never `due`.
export * from './mastery/index';
```

- [ ] **Step 6: Run tests + check + lint to verify pass**

Run: `pnpm --filter @lt/domain exec vitest run src/mastery/mastery.test.ts`
Expected: PASS (all cases).

Run: `pnpm --filter @lt/domain run check && pnpm --filter @lt/domain run lint`
Expected: PASS (M9 isomorphic-boundary lint clean — the module is pure arithmetic + array ops, no `node:*`/persistence/Svelte imports).

- [ ] **Step 7: Commit**

```bash
git add app/packages/domain/src/mastery/mastery.ts app/packages/domain/src/mastery/mastery.test.ts app/packages/domain/src/mastery/index.ts app/packages/domain/src/index.ts
git commit -F - <<'EOF'
feat(domain): mastery primitive — EWMA + distinct-instrument coverage + spacing (#15)

Pure applyMastery (eats every rep) + read-time masteryReady predicate + collision-safe
instrumentKey. Knobs are Monte-Carlo-owned placeholders. Advisory only; never touches due.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 2: Materialize the 4 columns end-to-end (type + fold + schema + write-path)

This is one atomic change: `RuleStateRow` gains 4 required fields, so its two producers (`fold` and the Drizzle repo) and the schema must move together or the build breaks. Driven by the fold unit tests.

**Files:**
- Modify: `app/packages/domain/src/ports/repository.ts`
- Modify: `app/packages/domain/src/fold/fold.ts`
- Modify: `app/packages/domain/src/fold/fold.test.ts`
- Modify: `app/packages/web/src/lib/server/db/schema.ts`
- Create: `app/packages/web/drizzle/0002_*.sql` (generated)
- Modify: `app/packages/web/src/lib/server/db/repo.ts`

- [ ] **Step 1: Write the failing fold tests** — edit `app/packages/domain/src/fold/fold.test.ts`

(a) Add the mastery import at the top (extend the existing import from `../ports/scheduler`):

```ts
import { DAY_MS, trivialScheduler } from '../ports/scheduler';
import { instrumentKey } from '../mastery/mastery';
```

(b) Replace the existing full-object assertion in the test `'an attempt creates rule_state, exposure, and bumps the session'` (the `expect(st.ruleStates[0]).toEqual({...})` block) with one that includes the 4 new fields:

```ts
    expect(st.ruleStates[0]).toEqual({
      userId: 'u1',
      ruleKey: 'R1',
      direction: 'both',
      blob: { last: 1000 },
      due: 1000 + DAY_MS,
      firstExposedAt: 1000,
      mastery: 0.1, // alpha 0.1 * base(good) 1, from seed 0
      coverage: 1,
      seenInstruments: [instrumentKey('it1', 'transformation', '', 'en>es')],
      successDays: [0] // floor(1000 / DAY_MS)
    });
```

(c) Append a new `describe` block for the mastery-specific fold behavior:

```ts
describe('fold — mastery meter (C.2c)', () => {
  it('materializes ewma/coverage/seen/successDays; same instrument repeat does not bump coverage', () => {
    const st = fold(
      [
        attemptEv({ at: 1000, itemId: 'it1', rating: 'good' }),
        attemptEv({ at: 2000, itemId: 'it1', rating: 'good' }) // same instrument (dedup)
      ],
      { scheduler: trivialScheduler }
    );
    expect(st.ruleStates[0].coverage).toBe(1);
    expect(st.ruleStates[0].seenInstruments).toEqual([instrumentKey('it1', 'transformation', '', 'en>es')]);
    expect(st.ruleStates[0].mastery).toBeCloseTo(0.19, 10); // ate both reps
    expect(st.ruleStates[0].successDays).toEqual([0]);
  });

  it('distinct instruments raise coverage; both directions count distinctly', () => {
    const st = fold(
      [
        attemptEv({ at: 1000, itemId: 'it1', direction: 'en>es' }),
        attemptEv({ at: 1000, itemId: 'it2', direction: 'en>es' }),
        attemptEv({ at: 1000, itemId: 'it1', direction: 'es>en' }) // same item/param, other direction
      ],
      { scheduler: trivialScheduler }
    );
    expect(st.ruleStates[0].coverage).toBe(3);
  });

  it('keyRemap merges two raw keys: coverage is the union, ewma folds over both in order', () => {
    const st = fold(
      [
        attemptEv({ at: 1000, ruleKeys: ['old-a'], itemId: 'it1', rating: 'good' }),
        attemptEv({ at: 2000, ruleKeys: ['old-b'], itemId: 'it2', rating: 'good' })
      ],
      { scheduler: trivialScheduler, keyRemap: (k) => (k === 'old-a' || k === 'old-b' ? 'new' : k) }
    );
    expect(st.ruleStates).toHaveLength(1);
    expect(st.ruleStates[0].coverage).toBe(2); // union of the two instruments
    expect(st.ruleStates[0].mastery).toBeCloseTo(0.19, 10);
  });

  it('an attempt citing multiple rules updates each rule’s meter independently', () => {
    const st = fold([attemptEv({ at: 1000, itemId: 'it1', ruleKeys: ['R1', 'R2'], rating: 'good' })], {
      scheduler: trivialScheduler
    });
    expect(st.ruleStates.map((r) => r.ruleKey)).toEqual(['R1', 'R2']);
    // The one instrument is credited to BOTH cited rules.
    for (const r of st.ruleStates) {
      expect(r.coverage).toBe(1);
      expect(r.seenInstruments).toEqual([instrumentKey('it1', 'transformation', '', 'en>es')]);
      expect(r.mastery).toBeCloseTo(0.1, 10);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lt/domain exec vitest run src/fold/fold.test.ts`
Expected: FAIL — TypeScript errors ("Object literal ... property 'mastery' is missing" is expected because `fold` does not yet set the fields, and `RuleStateRow` lacks them), or assertion failures on `coverage`/`mastery`.

- [ ] **Step 3: Add the 4 fields to `RuleStateRow`** — `app/packages/domain/src/ports/repository.ts`

In the `RuleStateRow` interface, after `firstExposedAt: number;`, add:

```ts
  /**
   * C.2c advisory mastery meter — a fold of the log; NEVER affects `due`. `masteryReady`
   * (read-time) compares these raw signals against the Monte-Carlo-owned thresholds.
   */
  mastery: number; // EWMA accuracy
  coverage: number; // = seenInstruments.length (materialized)
  seenInstruments: string[]; // distinct instrument keys (dedup set, sorted)
  successDays: number[]; // distinct UTC success-day keys (dedup set, sorted)
```

- [ ] **Step 4: Materialize in `fold`** — `app/packages/domain/src/fold/fold.ts`

(a) Add the import (after the existing `import type { Scheduler } ...` line):

```ts
import { applyMastery, instrumentKey } from '../mastery/mastery';
import type { MasteryState } from '../mastery/mastery';
```

(b) Replace the whole `case 'attempt':` block body's per-key loop so each cited rule also folds mastery. The new block:

```ts
      case 'attempt': {
        for (const raw of ev.ruleKeys) {
          const ruleKey = keyRemap(raw);
          const prev = ruleStates.get(ruleKey);
          const { blob, due } = scheduler.apply(prev ? prev.blob : null, ev.rating, ev.at);
          const prevMastery: MasteryState | null = prev
            ? { ewma: prev.mastery, instruments: prev.seenInstruments, successDays: prev.successDays }
            : null;
          const m = applyMastery(
            prevMastery,
            ev.rating,
            instrumentKey(ev.itemId, ev.exerciseTypeKey, ev.paramKey, ev.direction),
            ev.at
          );
          ruleStates.set(ruleKey, {
            userId: ev.userId,
            ruleKey,
            direction: BOTH_DIRECTION,
            blob,
            due,
            firstExposedAt: prev ? prev.firstExposedAt : ev.at,
            mastery: m.ewma,
            coverage: m.instruments.length,
            seenInstruments: m.instruments,
            successDays: m.successDays
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
```

- [ ] **Step 5: Add the 4 columns to the schema** — `app/packages/web/src/lib/server/db/schema.ts`

(a) Add `real` to the drizzle import on line 1:

```ts
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
```

(b) In the `ruleState` table, after `firstExposedAt: integer('first_exposed_at').notNull()`, add (note the trailing comma on the existing line):

```ts
			firstExposedAt: integer('first_exposed_at').notNull(),
			// C.2c advisory mastery meter — a fold of the log; never affects `due`. JSON dedup sets
			// sit beside the opaque `blob` (same precedent). rebuild (rule_state-only) rewrites them.
			mastery: real('mastery').notNull().default(0),
			coverage: integer('coverage').notNull().default(0),
			seenInstruments: text('seen_instruments', { mode: 'json' }).$type<string[]>().notNull().default([]),
			successDays: text('success_days', { mode: 'json' }).$type<number[]>().notNull().default([])
```

- [ ] **Step 6: Generate the migration and verify the JSON defaults**

Run: `pnpm --filter @lt/web db:generate`
Expected: a new `app/packages/web/drizzle/0002_*.sql` with four `ALTER TABLE 'rule_state' ADD ...;` lines.

Read the generated file. **Verify** the two JSON columns emit a constant string default:
```sql
ALTER TABLE `rule_state` ADD `mastery` real DEFAULT 0 NOT NULL;
ALTER TABLE `rule_state` ADD `coverage` integer DEFAULT 0 NOT NULL;
ALTER TABLE `rule_state` ADD `seen_instruments` text DEFAULT '[]' NOT NULL;
ALTER TABLE `rule_state` ADD `success_days` text DEFAULT '[]' NOT NULL;
```
If drizzle-kit emitted anything other than `DEFAULT '[]'` for the two JSON columns (e.g. a bare `[]`, `(json_array())`, or no default), **hand-edit the SQL** so each reads `DEFAULT '[]' NOT NULL` (a constant literal — required for a STRICT-table `ADD COLUMN` backfill of the seed `u1` row). `ADD COLUMN` needs no STRICT clause (cf. C.2a's `0001_good_paibok.sql`). Do not touch the `meta/` snapshot beyond what `db:generate` wrote.

- [ ] **Step 7: Materialize in the write-path** — `app/packages/web/src/lib/server/db/repo.ts`

(a) Extend the `@lt/domain` import block to add `applyMastery` + `instrumentKey`:

```ts
import {
	applyMastery,
	BOTH_DIRECTION,
	fold,
	instrumentKey,
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

(b) In `appendAttempt`, inside the `for (const ruleKey of i.ruleKeys)` loop, after the `const { blob, due } = this.deps.scheduler.apply(...)` and `const firstExposedAt = ...` lines, compute mastery:

```ts
				const m = applyMastery(
					existing
						? { ewma: existing.mastery, instruments: existing.seenInstruments, successDays: existing.successDays }
						: null,
					i.rating,
					instrumentKey(i.itemId, i.exerciseTypeKey, i.paramKey, i.direction),
					at
				);
```

(c) In that same loop, replace the `tx.insert(ruleState).values({...}).onConflictDoUpdate({...})` call so both the insert values and the update set carry the 4 columns:

```ts
				tx.insert(ruleState)
					.values({
						userId: i.userId,
						ruleKey,
						direction: BOTH_DIRECTION,
						blob,
						due,
						firstExposedAt,
						mastery: m.ewma,
						coverage: m.instruments.length,
						seenInstruments: m.instruments,
						successDays: m.successDays
					})
					.onConflictDoUpdate({
						target: [ruleState.userId, ruleState.ruleKey, ruleState.direction],
						set: {
							blob,
							due,
							mastery: m.ewma,
							coverage: m.instruments.length,
							seenInstruments: m.instruments,
							successDays: m.successDays
						}
					})
					.run();
```

(d) In `rebuild`, extend the `tx.insert(ruleState).values({...})` to carry the 4 columns from the folded row:

```ts
					tx.insert(ruleState)
						.values({
							userId: rs.userId,
							ruleKey: rs.ruleKey,
							direction: rs.direction,
							blob: rs.blob,
							due: rs.due,
							firstExposedAt: rs.firstExposedAt,
							mastery: rs.mastery,
							coverage: rs.coverage,
							seenInstruments: rs.seenInstruments,
							successDays: rs.successDays
						})
						.run();
```

- [ ] **Step 8: Run domain + web unit tests + checks to verify pass**

Run: `pnpm --filter @lt/domain exec vitest run src/fold/fold.test.ts`
Expected: PASS (mastery folds; the updated full-`toEqual` matches).

Run: `pnpm --filter @lt/web exec vitest run src/lib/server/db/repo.test.ts`
Expected: PASS — the existing C.2a/C.2b fold≡projection parity tests still hold (both sides now materialize identical mastery, so `toEqual` still matches); the C.1 field-access assertions are unaffected.

Run: `pnpm check`
Expected: PASS (domain `tsc` + web `svelte-check` — `RuleStateRow` producers all satisfy the 4 fields).

- [ ] **Step 9: Commit** (stage the migration by its actual generated filename)

```bash
git add app/packages/domain/src/ports/repository.ts app/packages/domain/src/fold/fold.ts app/packages/domain/src/fold/fold.test.ts app/packages/web/src/lib/server/db/schema.ts app/packages/web/src/lib/server/db/repo.ts app/packages/web/drizzle/
git commit -F - <<'EOF'
feat: materialize mastery meter on rule_state (fold + write-path + migration) (#15)

RuleStateRow gains mastery/coverage/seen_instruments/success_days; fold and appendAttempt
both fold them via the shared applyMastery (structural identity). rebuild re-materializes
them for free (rule_state-only). Timing stays 1 tick/day; mastery eats every rep.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 3: Integration proof (divergence + replay + keyRemap) & C.2b test-nit tidy

Extend `repo.test.ts`. All production code already works after Task 2 — these are test additions plus a tidy of the C.2b `describe` blocks (fold in the deferred nits that touch this file).

**Files:**
- Modify: `app/packages/web/src/lib/server/db/repo.test.ts`

- [ ] **Step 1: Write the failing/extended tests** — edit `app/packages/web/src/lib/server/db/repo.test.ts`

(a) Update the top import to pull the shipped `fsrsScheduler` singleton (C.2b nit: tests meaning "the app's actual scheduler" import it rather than reconstructing `sameDayGuard(fsrsCore)`), keeping `fsrsCore`/`sameDayGuard` only where a raw core is genuinely needed (none here) and `sm2Core` for the swap:

```ts
import {
	DAY_MS,
	fold,
	fsrsScheduler,
	rowToEvent,
	sameDayGuard,
	sm2Core,
	trivialScheduler,
	type AttemptInput,
	type Clock
} from '@lt/domain';
```

(b) In the `describe('C.2b rebuild — re-fold rule_state (replay, not migration)', ...)` block, **tidy the env2 pattern** (C.2b nit) into a shared `beforeEach`/`afterEach`, and strengthen the swap assertions to `.every` + mastery-invariance (C.2c). Replace the entire block with:

```ts
describe('C.2b/C.2c rebuild — replay changes due, leaves mastery invariant', () => {
	const sm2 = sameDayGuard(sm2Core);
	let renv: ReturnType<typeof createTestDb>;

	beforeEach(() => {
		t = 1_700_000_000_000;
		renv = createTestDb(clock, fsrsScheduler);
		const { sessionId } = renv.repo.startSession({
			userId: 'u1',
			mode: 'practice',
			targetAttempts: 10,
			at: t
		});
		renv.repo.appendAttempt(
			attempt({ sessionId, itemId: 'al-annual', ruleKeys: ['L2#conv-al'], rating: 'good' })
		);
		t += DAY_MS;
		renv.repo.appendAttempt(
			attempt({ sessionId, itemId: 'mente-lento', ruleKeys: ['L3#conv-mente'], rating: 'good' })
		);
	});
	afterEach(() => renv.cleanup());

	it('swap FSRS->SM-2 changes every rule’s due but leaves mastery/coverage/sets identical', () => {
		const liveFsrs = renv.repo.ruleStates('u1');
		const expBefore = renv.repo.itemExposures('u1');
		const sessBefore = renv.repo.sessions('u1');

		renv.repo.rebuild('u1', { scheduler: sm2 });
		const afterSm2 = renv.repo.ruleStates('u1');

		expect(afterSm2.map((r) => r.ruleKey).sort()).toEqual(liveFsrs.map((r) => r.ruleKey).sort());
		for (const r of afterSm2) {
			const live = liveFsrs.find((l) => l.ruleKey === r.ruleKey)!;
			expect(r.due).not.toBe(live.due); // .every row's due differs (FSRS ~+3d vs SM-2 +1d)
			expect(r.mastery).toBe(live.mastery); // scheduler-independent
			expect(r.coverage).toBe(live.coverage);
			expect(r.seenInstruments).toEqual(live.seenInstruments);
			expect(r.successDays).toEqual(live.successDays);
		}
		expect(renv.repo.itemExposures('u1')).toEqual(expBefore); // untouched
		expect(renv.repo.sessions('u1')).toEqual(sessBefore); // untouched
	});

	it('rebuild through the same scheduler is idempotent (== live incremental projection)', () => {
		const liveFsrs = renv.repo.ruleStates('u1');
		renv.repo.rebuild('u1', { scheduler: sm2 }); // perturb
		renv.repo.rebuild('u1', { scheduler: fsrsScheduler }); // replay back
		expect(renv.repo.ruleStates('u1')).toEqual(liveFsrs);
	});

	it('rebuild with a keyRemap merges renamed rules (coverage = union)', () => {
		// Rename L3#conv-mente -> L2#conv-al: the two rules collapse into one merged row.
		renv.repo.rebuild('u1', {
			scheduler: fsrsScheduler,
			keyRemap: (k) => (k === 'L3#conv-mente' ? 'L2#conv-al' : k)
		});
		const rs = renv.repo.ruleStates('u1');
		expect(rs).toHaveLength(1);
		expect(rs[0].ruleKey).toBe('L2#conv-al');
		expect(rs[0].coverage).toBe(2); // union of al-annual + mente-lento instruments
	});
});
```

(c) In the `describe('C.2b FSRS same-day guard + fold parity through the real write path', ...)` block, replace `const fsrs = sameDayGuard(fsrsCore);` with use of the singleton and extend the same-day test to assert the **divergence** (coverage climbs while due collapses). Replace that describe block with:

```ts
describe('C.2c divergence + fold parity through the real write path', () => {
	it('same-day drills: due collapses to one tick, but mastery eats every rep (coverage climbs)', () => {
		const env2 = createTestDb(clock, fsrsScheduler);
		try {
			const { sessionId } = env2.repo.startSession({
				userId: 'u1',
				mode: 'practice',
				targetAttempts: 10,
				at: t
			});
			// Rule R, 3 DISTINCT instruments same day: good, again, good -> worst = again (one tick).
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-annual', ruleKeys: ['R'], rating: 'good' }));
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-normal', ruleKeys: ['R'], rating: 'again' }));
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-legal', ruleKeys: ['R'], rating: 'good' }));
			// Rule S once same day with 'again' — the day's worst for R.
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-total', ruleKeys: ['S'], rating: 'again' }));

			const rs = env2.repo.ruleStates('u1');
			const R = rs.find((r) => r.ruleKey === 'R')!;
			const S = rs.find((r) => r.ruleKey === 'S')!;
			expect(R.due).toBe(S.due); // timing: R's 3 same-day attempts collapsed to a single 'again' tick == S
			expect(R.coverage).toBe(3); // mastery: ate all 3 distinct instruments
			expect(S.coverage).toBe(1);
			expect(R.seenInstruments).toHaveLength(3);
		} finally {
			env2.cleanup();
		}
	});

	it('fold reproduces the incremental FSRS projection incl. mastery columns', () => {
		const env2 = createTestDb(clock, fsrsScheduler);
		try {
			const { sessionId } = env2.repo.startSession({
				userId: 'u1',
				mode: 'practice',
				targetAttempts: 10,
				at: t
			});
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-annual', ruleKeys: ['L2#conv-al'], rating: 'good' }));
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'al-normal', ruleKeys: ['L2#conv-al'], rating: 'again' }));
			t += DAY_MS;
			env2.repo.appendAttempt(attempt({ sessionId, itemId: 'mente-lento', ruleKeys: ['L3#conv-mente'], rating: 'good' }));

			const state = fold(env2.repo.events('u1').map(rowToEvent), { scheduler: fsrsScheduler });
			const byRule = (a: { ruleKey: string }, b: { ruleKey: string }) => a.ruleKey.localeCompare(b.ruleKey);
			expect([...state.ruleStates].sort(byRule)).toEqual([...env2.repo.ruleStates('u1')].sort(byRule));
			expect(state.itemExposures).toEqual(env2.repo.itemExposures('u1'));
		} finally {
			env2.cleanup();
		}
	});
});
```

- [ ] **Step 2: Run it to verify it passes** (production code already satisfies these)

Run: `pnpm --filter @lt/web exec vitest run src/lib/server/db/repo.test.ts`
Expected: PASS (all blocks). If the `.every` due-differs assertion fails on any row, that is a real signal FSRS and SM-2 produced the same interval for that seed — investigate before proceeding (do not weaken the assertion).

- [ ] **Step 3: Commit**

```bash
git add app/packages/web/src/lib/server/db/repo.test.ts
git commit -F - <<'EOF'
test(web): C.2c divergence + replay-invariance proofs; tidy C.2b rebuild block (#15)

Same-day distinct instruments -> coverage climbs while due collapses to one guarded tick.
Scheduler swap changes every due but leaves mastery/coverage/sets byte-identical. keyRemap
merges to a union coverage. Import fsrsScheduler singleton; fold C.2b env2 into beforeEach.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 4: Inspector mastery panel + e2e

**Files:**
- Modify: `app/packages/web/src/routes/inspector/+page.server.ts`
- Modify: `app/packages/web/src/routes/inspector/+page.svelte`
- Create: `app/packages/web/e2e/mastery.e2e.ts`

- [ ] **Step 1: Write the failing e2e** — `app/packages/web/e2e/mastery.e2e.ts`

```ts
import { expect, test, type Page } from '@playwright/test';

// The practice screen serves the first gated item (al-annual, rule L2#conv-al) every visit —
// the SAME instrument. So repeated attempts are a live demo of the C.2c divergence: coverage
// stays 1 (dedup) while mastery keeps moving (eats every rep). Relative assertions keep this
// robust to the Monte-Carlo-owned knob VALUES and to shared-server state from other e2e.
const ROW = '[data-testid="rule-state-row"][data-rule-key="L2#conv-al"]';

async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}

async function attemptAnnual(page: Page) {
	await page.goto('/');
	await expect(page.getByTestId('given')).toHaveText('annual');
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toHaveText('correct');
}

async function mastery(page: Page): Promise<number> {
	await page.goto('/inspector');
	return Number(await page.locator(ROW).getByTestId('rule-mastery').textContent());
}

test('inspector shows the folded mastery meter; coverage dedups, mastery eats every rep', async ({
	page
}) => {
	await page.request.post('/__test__/clock', { data: { action: 'reset' } });
	await setLesson(page, 2);

	await attemptAnnual(page);
	await page.goto('/inspector');
	await expect(page.locator(ROW).getByTestId('rule-coverage')).toHaveText('1');
	await expect(page.locator(ROW).getByTestId('rule-mastered')).toBeVisible();
	const m1 = await mastery(page);
	expect(m1).toBeGreaterThan(0);

	// Second attempt on the SAME instrument: coverage stays 1 (dedup), mastery strictly climbs.
	await attemptAnnual(page);
	await page.goto('/inspector');
	await expect(page.locator(ROW).getByTestId('rule-coverage')).toHaveText('1');
	const m2 = await mastery(page);
	expect(m2).toBeGreaterThan(m1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lt/web exec playwright test mastery.e2e.ts`
Expected: FAIL — `rule-mastery` / `rule-coverage` / `rule-mastered` locators not found (the panel does not render them yet).
(If Playwright browsers are missing, run `pnpm --filter @lt/web run e2e:install` first.)

- [ ] **Step 3: Map the columns in the loader** — `app/packages/web/src/routes/inspector/+page.server.ts`

(a) Add `masteryReady` to the `@lt/domain` import on line 2:

```ts
import { eligibleItems, eligibleRules, masteryReady } from '@lt/domain';
```

(b) Replace the `scheduledRules` mapping in the returned object with one that surfaces the meter:

```ts
		// Durable scheduled-rules panel (C.1); C.2c adds the advisory mastery meter (never affects due).
		scheduledRules: repo.ruleStates(locals.user.id).map((r) => ({
			ruleKey: r.ruleKey,
			direction: r.direction,
			dueAt: r.due,
			dueNow: r.due <= now,
			mastery: r.mastery,
			coverage: r.coverage,
			mastered: masteryReady({
				ewma: r.mastery,
				instruments: r.seenInstruments,
				successDays: r.successDays
			})
		}))
```

- [ ] **Step 4: Render the cells** — `app/packages/web/src/routes/inspector/+page.svelte`

Inside the `scheduled-list` `<li data-testid="rule-state-row" ...>`, after the existing `rule-due-now` span, add three cells:

```svelte
					<span data-testid="rule-mastery">{r.mastery.toFixed(2)}</span>
					<span data-testid="rule-coverage">{r.coverage}</span>
					<span data-testid="rule-mastered">{r.mastered}</span>
```

- [ ] **Step 5: Run the e2e to verify it passes**

Run: `pnpm --filter @lt/web exec playwright test mastery.e2e.ts`
Expected: PASS.

- [ ] **Step 6: Run check + lint (the loader/svelte types)**

Run: `pnpm check && pnpm --filter @lt/web run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/packages/web/src/routes/inspector/+page.server.ts app/packages/web/src/routes/inspector/+page.svelte app/packages/web/e2e/mastery.e2e.ts
git commit -F - <<'EOF'
feat(web): inspector mastery panel (mastery/coverage/mastered) + e2e (#15)

Loader maps the folded meter and computes mastered via the read-time masteryReady. The e2e
demonstrates the divergence in the real UI: repeating one instrument keeps coverage at 1 while
mastery climbs every rep. Assertions are relative (robust to Monte-Carlo knob values).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 5: C.2b deferred non-test nits (code comments)

Two small comment-only clarifications carried over from the C.2b review (the test-side nits landed in Task 3).

**Files:**
- Modify: `app/packages/domain/src/ports/repository.ts`
- Modify: `app/packages/web/src/lib/server/db/repo.ts`

- [ ] **Step 1: Comment the inlined `keyRemap` type** — `app/packages/domain/src/ports/repository.ts`

Replace the `rebuild` JSDoc + signature at the end of the `ReviewRepository` interface with:

```ts
	/**
	 * Re-fold the log + re-materialize rule_state only (scheduler swap / rename = replay, not
	 * migration). `keyRemap`'s type is inlined (not imported from ../fold) to avoid a ports->fold
	 * import cycle — ports is a leaf the fold depends on, never the reverse.
	 */
	rebuild(userId: string, opts: { scheduler: Scheduler; keyRemap?: (ruleKey: string) => string }): void;
```

- [ ] **Step 2: Add the by-design coordinated-swap note** — `app/packages/web/src/lib/server/db/repo.ts`

Directly above the `rebuild(` method definition, add:

```ts
	/**
	 * Replay mechanism: fold the immutable log through `opts.scheduler` and rewrite rule_state
	 * (the only scheduler/keyRemap-dependent projection; it has no inbound FK). By design a
	 * COORDINATED swap — `rebuild(otherScheduler)` must be paired with swapping the app's injected
	 * scheduler, because `apply` never hydrates a foreign blob (C.2b decision 5). Mastery columns
	 * are scheduler-independent, so a scheduler swap leaves them unchanged; a keyRemap merges them.
	 * Phase-0 dev DB is disposable; no boot-time auto-rebuild.
	 */
```

- [ ] **Step 3: Verify nothing broke** (comment-only, but confirm the build)

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/packages/domain/src/ports/repository.ts app/packages/web/src/lib/server/db/repo.ts
git commit -F - <<'EOF'
docs(domain,web): C.2b review nits — rebuild keyRemap-cycle + coordinated-swap notes (#15)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 6: Full gate + Playwright MCP walkthrough (verification, per AGENTS.md)

**No new files.** This is the evidence-before-claims gate run over the whole slice.

- [ ] **Step 1: Full automated gate** (from `app/`)

```bash
pnpm lint
pnpm check
pnpm build
pnpm test
pnpm test:e2e
```
Expected: all green. Capture the unit test counts (domain + web) and the e2e count; expect the new mastery domain suite + the new `mastery.e2e.ts` to appear.

- [ ] **Step 2: M9 isomorphic-boundary lint + tripwire**

Confirm `pnpm --filter @lt/web exec vitest run src/lib/server/m9-boundary.test.ts` passes (the mastery module is pure domain — no `node:*`/persistence/Svelte imports leaked).

- [ ] **Step 3: Playwright MCP walkthrough of the real built UI**

Build + preview with the test control-plane on:
```bash
cd app/packages/web && LT_TEST_CONTROL=1 LT_DB_PATH=:memory: pnpm build && LT_TEST_CONTROL=1 LT_DB_PATH=:memory: pnpm preview
```
Then, via the Playwright MCP tools, drive the real UI: reset the clock, set lesson 2, submit an attempt on `annual -> anual`, open `/inspector`, and observe the `L2#conv-al` row now shows `rule-mastery` > 0 and `rule-coverage` = 1. Drill the same item again and confirm coverage stays 1 while mastery climbs (the divergence), and that `rule-due-at` still reflects FSRS timing (unchanged by mastery). Screenshot the inspector panel. Report the observed values as evidence.

---

## Self-Review (author) — spec coverage

- **EWMA + coverage + spacing primitive** → Task 1. **Read-time `masteryReady`** → Task 1 + wired in Task 4.
- **Four rule_state columns + migration** → Task 2. **Fold materializes; write-path materializes; rebuild re-materializes** → Task 2.
- **fold ≡ projection on new columns; divergence; scheduler-swap invariance (`.every` + mastery unchanged); keyRemap union** → Task 3.
- **Inspector panel + Playwright** → Task 4 + Task 6.
- **C.2b deferred nits** → Task 3 (fsrsScheduler import, env2 tidy, `.every`) + Task 5 (rebuild comments).
- **Knobs Monte-Carlo-owned placeholders; mastery never touches due; no ReviewLog change** → enforced in Task 1 (`// Monte-Carlo-owned`) and by construction (no scheduler/`due`/`review_log` edits anywhere in the plan).
- **Verification standard (evidence, MCP walkthrough)** → Task 6.
