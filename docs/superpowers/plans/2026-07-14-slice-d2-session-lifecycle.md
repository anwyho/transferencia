# Slice D.2 — bounded-session lifecycle + re-drill + caught-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a practice session a bounded ~10-min unit: it serves the planner's greedy head until the `targetAttempts` budget is spent (or the plan empties), then re-drills this session's unresolved misses, then ends (`session_end`) and shows a done/caught-up screen with an explicit "Start another." Reconciles D.1's open-ended reuse-session divergence.

**Architecture:** Two pure, isomorphic domain functions in a new `@lt/domain/src/session/` module — `sessionPhase(...)` (the `main → redrill → complete` state machine, budget enforced by a `realized < target` gate) and `redrillQueue(...)` (the unresolved-miss set, derived statelessly from the session's persisted `attempt` log, tail-bounded) — plus `sessionSummary(...)`. A shared web helper `computePhase(...)` composes them so the practice route's `load` (render) and `submit` (decide-to-end) agree on completion. `load` becomes side-effect-free; session creation moves to an explicit `?/start` action (kills the first-load race). No `ReviewLog` schema/event change — `session_end` is a frozen kind the fold already handles.

**Tech Stack:** TypeScript, `@lt/domain` (isomorphic, M9-clean), SvelteKit (`@lt/web`), Drizzle + better-sqlite3, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-14-slice-d2-session-lifecycle-design.md` (read it; this plan implements it). **No DB migration** in D.2.

**Conventions:**
- Run from `app/`. Single-file unit run: `pnpm --filter @lt/domain exec vitest run <relpath>` (or `@lt/web`). `pnpm test -- <file>` does NOT filter — don't use it.
- Full gates from `app/`: `pnpm lint`, `pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:e2e`.
- **Stage by explicit path — never `git add -A`** (a co-agent works `cards/` in the shared main tree). Use `trash`, never `rm`.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
  ```

---

## Implementation deltas (shipped code is authoritative)
During the build, adversarial review + one Anthony decision refined several literals below. The **shipped code on `d2-session-lifecycle` is authoritative**; the task code blocks are retained as the original drafts. Key deltas:
- **Re-drill tail bounds by MISSES, not attempts** (Anthony's call): the knob is `redrillMaxMissesPerInstrument` (renamed) and `redrillQueue` gates on the group's `again`-count (`misses >= cap`), not `group.length`. It also fails loud on a degenerate cap and sorts its input by `at` (order-independent).
- **`RedrillAttempt`/`RedrillKnobs` ship as `Pick<>` projections** of `AttemptEvent`/`PlannerKnobs`; `toRedrillAttempts` narrows via the domain's loud `rowToEvent` (not silent `!`).
- **`computePhase` uses the live `sessionAttempts(...).length`** (not the `open.realizedCount` snapshot) + guards `open.userId`; `submit` `fail(409)`s on a stale/mismatched form `sessionId`.
- **The inspector panel** (Task 7) sources its session via the latest *practice* session, not `currentSession` (unended-only), so it shows the just-ended session.

## File Structure

**Create (domain):**
- `app/packages/domain/src/session/phase.ts` — `Phase`, `PhaseInput`, `sessionPhase`.
- `app/packages/domain/src/session/phase.test.ts`
- `app/packages/domain/src/session/redrill.ts` — `RedrillAttempt`, `RedrillKnobs`, `redrillQueue`.
- `app/packages/domain/src/session/redrill.test.ts`
- `app/packages/domain/src/session/summary.ts` — `SessionSummary`, `sessionSummary`.
- `app/packages/domain/src/session/summary.test.ts`
- `app/packages/domain/src/session/index.ts`

**Create (web):**
- `app/packages/web/src/lib/server/session-ctx.ts` — `toRedrillAttempts` + `computePhase` (shared by `load` + `submit` + inspector).
- `app/packages/web/src/lib/server/session-ctx.test.ts` — full-lifecycle integration test (real test DB + content store).
- `app/packages/web/e2e/session-lifecycle.e2e.ts`

**Modify (domain):**
- `app/packages/domain/src/planner/planner.ts` — add `redrillMaxAttemptsPerInstrument` to `PlannerKnobs` + `PLANNER_KNOBS`.
- `app/packages/domain/src/index.ts` — export the session module.
- `app/packages/domain/src/ports/repository.ts` — retitle `currentSession` (unended) + add `sessionAttempts`.

**Modify (web):**
- `app/packages/web/src/lib/server/db/repo.ts` — `currentSession` unended filter + implement `sessionAttempts`.
- `app/packages/web/src/lib/server/db/repo.test.ts` — currentSession-unended, sessionAttempts, endSession fold-parity.
- `app/packages/web/src/routes/+page.server.ts` — read-only `load` (phase machine), `submit` end-on-complete, `?/start` action.
- `app/packages/web/src/routes/+page.svelte` — re-drill badge + idle/done/caught-up screen + Start form.
- `app/packages/web/src/routes/inspector/+page.server.ts` — current-session panel + re-drill queue.
- `app/packages/web/src/routes/inspector/+page.svelte` — session panel render.
- `app/packages/web/e2e/practice.e2e.ts` — **rework**: explicit Start; `no-item` → `caught-up`.
- `app/packages/web/e2e/persistence.e2e.ts` — **rework**: explicit Start before the attempt.
- `app/packages/web/e2e/mastery.e2e.ts` — **rework**: explicit Start inside `attempt()`.
- `app/packages/web/e2e/planner-star.e2e.ts` — **rework**: explicit Start before starring.

> **Why the e2e rework:** D.2 makes `load` side-effect-free — a session is now created only by the `?/start` action, so cold start renders a "Start practicing" screen instead of auto-serving a question. Every e2e that navigates to `/` expecting a prompt gains a Start click (via a small `start(page)` helper that clicks the button only when the idle screen is showing, so mid-session loads are unaffected). `inspector.e2e.ts` is unchanged (its panels don't drive practice). The lesson-1 "empty" case is now `caught-up` (no Start offered when nothing is servable).

---

## Task 1: Session phase state machine (`@lt/domain/src/session/phase.ts`)

**Files:** Create `phase.ts`, `phase.test.ts`.

**Context:** Pure/isomorphic. The correctness lever of the whole slice: `load` and `submit` share this one function so they never disagree on whether a session is complete. Uses `Instrument` from the planner (Stage-2 output type).

- [ ] **Step 1: Write the failing test** — `app/packages/domain/src/session/phase.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { sessionPhase } from './phase';
import type { Instrument } from '../planner/planner';

const inst = (itemId: string): Instrument => ({
  ruleKey: 'R',
  itemId,
  exerciseTypeKey: 'transformation',
  paramKey: '',
  direction: 'en>es'
});

describe('sessionPhase', () => {
  it('main while under budget with a servable head', () => {
    expect(sessionPhase({ realizedCount: 3, targetAttempts: 10, head: inst('a'), redrill: [] })).toEqual({
      kind: 'main',
      pick: inst('a')
    });
  });

  it('re-drill when the budget is spent and a miss remains', () => {
    expect(
      sessionPhase({ realizedCount: 10, targetAttempts: 10, head: inst('a'), redrill: [inst('m')] })
    ).toEqual({ kind: 'redrill', pick: inst('m') });
  });

  it('re-drill when the plan empties before the budget but a miss remains', () => {
    expect(
      sessionPhase({ realizedCount: 4, targetAttempts: 10, head: null, redrill: [inst('m')] })
    ).toEqual({ kind: 'redrill', pick: inst('m') });
  });

  it('complete when the budget is spent and no misses remain', () => {
    expect(
      sessionPhase({ realizedCount: 10, targetAttempts: 10, head: inst('a'), redrill: [] })
    ).toEqual({ kind: 'complete' });
  });

  it('complete when the plan empties before the budget and no misses (light day)', () => {
    expect(sessionPhase({ realizedCount: 2, targetAttempts: 10, head: null, redrill: [] })).toEqual({
      kind: 'complete'
    });
  });

  it('budget gate is exclusive: never main at exactly the target', () => {
    expect(
      sessionPhase({ realizedCount: 10, targetAttempts: 10, head: inst('a'), redrill: [] }).kind
    ).not.toBe('main');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lt/domain exec vitest run src/session/phase.test.ts`
Expected: FAIL — `Cannot find module './phase'`.

- [ ] **Step 3: Implement** — `app/packages/domain/src/session/phase.ts`

```ts
import type { Instrument } from '../planner/planner';

/** The practice session's current phase — a pure function of persisted state (design D.2). */
export type Phase =
  | { kind: 'main'; pick: Instrument }
  | { kind: 'redrill'; pick: Instrument }
  | { kind: 'complete' };

export interface PhaseInput {
  realizedCount: number;
  targetAttempts: number;
  /** the planSession greedy head at the current state; null if the plan is empty */
  head: Instrument | null;
  /** unresolved-miss instruments, eligibility-filtered + ordered (from redrillQueue) */
  redrill: readonly Instrument[];
}

/**
 * Shared by the practice route's `load` (render) and `submit` (decide-to-end) so both agree on
 * completion. Budget is enforced HERE (the realized<target gate), NOT by threading N into the
 * planner (the greedy head is n-independent). A null head — the plan emptied before the budget was
 * spent — falls straight through to the re-drill tail / completion, so a light day is a short one.
 */
export function sessionPhase(i: PhaseInput): Phase {
  if (i.realizedCount < i.targetAttempts && i.head) return { kind: 'main', pick: i.head };
  if (i.redrill.length > 0) return { kind: 'redrill', pick: i.redrill[0] };
  return { kind: 'complete' };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @lt/domain exec vitest run src/session/phase.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/packages/domain/src/session/phase.ts app/packages/domain/src/session/phase.test.ts
git commit -F - <<'EOF'
feat(domain): session phase state machine (main/redrill/complete) (#16)

Pure sessionPhase(realized,target,head,redrill): budget enforced by the realized<target gate
(greedy head stays n-independent); a null head falls through to the re-drill tail/completion.
Shared by load+submit so they agree on when a session is done.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 2: Stateless re-drill queue (`@lt/domain/src/session/redrill.ts`) + knob

**Files:** Create `redrill.ts`, `redrill.test.ts`; modify `planner.ts` (add the knob).

**Context:** Pure/isomorphic. Derives the unresolved-miss set from the session's `attempt` rows (no in-memory state, no store — an eligibility predicate is injected). Reuses `instrumentKey` (the mastery module's canonical `(item,type,param,dir)` key) so grouping matches the coverage key. A miss is a `again` rating; the tail is bounded per instrument so a stubborn miss can't loop.

- [ ] **Step 1: Write the failing test** — `app/packages/domain/src/session/redrill.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { redrillQueue, type RedrillAttempt } from './redrill';

const A = (over: Partial<RedrillAttempt> = {}): RedrillAttempt => ({
  itemId: 'a',
  exerciseTypeKey: 'transformation',
  paramKey: '',
  direction: 'en>es',
  ruleKeys: ['R'],
  rating: 'again',
  at: 1,
  ...over
});
const all = () => true;
const KNOBS = { redrillMaxAttemptsPerInstrument: 2 };

describe('redrillQueue', () => {
  it('includes an instrument whose latest attempt is a miss', () => {
    expect(redrillQueue([A({ at: 1 })], all, KNOBS).map((i) => i.itemId)).toEqual(['a']);
  });

  it('excludes a miss later resolved (latest is not "again")', () => {
    expect(redrillQueue([A({ at: 1, rating: 'again' }), A({ at: 2, rating: 'good' })], all, KNOBS)).toEqual([]);
  });

  it('excludes a never-missed instrument', () => {
    expect(redrillQueue([A({ rating: 'good' })], all, KNOBS)).toEqual([]);
  });

  it('bounds the tail: drops an instrument at the attempt cap', () => {
    // two attempts, cap 2 -> length 2 >= cap -> already re-drilled once -> dropped
    expect(redrillQueue([A({ at: 1 }), A({ at: 2 })], all, KNOBS)).toEqual([]);
  });

  it('treats distinct directions as distinct instruments', () => {
    const q = redrillQueue([A({ direction: 'en>es', at: 1 }), A({ direction: 'es>en', at: 2 })], all, KNOBS);
    expect(q.map((i) => i.direction).sort()).toEqual(['en>es', 'es>en']);
  });

  it('excludes an instrument whose item is no longer eligible', () => {
    expect(redrillQueue([A({ itemId: 'gone' })], (id) => id !== 'gone', KNOBS)).toEqual([]);
  });

  it('orders earliest-first-miss', () => {
    const q = redrillQueue([A({ itemId: 'a', at: 5 }), A({ itemId: 'b', at: 2 })], all, KNOBS);
    expect(q.map((i) => i.itemId)).toEqual(['b', 'a']);
  });

  it('carries the first ruleKey onto the instrument (observability)', () => {
    expect(redrillQueue([A({ ruleKeys: ['R7', 'R8'] })], all, KNOBS)[0].ruleKey).toBe('R7');
  });

  it('throws on a degenerate cap (unbounded-tail guard)', () => {
    expect(() => redrillQueue([A()], all, { redrillMaxAttemptsPerInstrument: 0 })).toThrow(/>= 1/);
    expect(() => redrillQueue([A()], all, { redrillMaxAttemptsPerInstrument: NaN })).toThrow(/integer/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lt/domain exec vitest run src/session/redrill.test.ts`
Expected: FAIL — `Cannot find module './redrill'`.

- [ ] **Step 3: Implement** — `app/packages/domain/src/session/redrill.ts`

```ts
import { instrumentKey } from '../mastery/mastery';
import type { Instrument } from '../planner/planner';
import type { Direction, SrsRating } from '../exercise/types';

/** The projection of one session's `attempt` rows the re-drill logic needs (the web route maps rows to this). */
export interface RedrillAttempt {
  itemId: string;
  exerciseTypeKey: string;
  paramKey: string;
  direction: Direction;
  ruleKeys: string[];
  rating: SrsRating;
  at: number;
}

export interface RedrillKnobs {
  redrillMaxAttemptsPerInstrument: number;
}

/**
 * The ordered set of this session's UNRESOLVED misses to re-drill before closing. Pure: a function
 * of the session's attempt rows (in (at,id) order) + an eligibility predicate. No store, no rng.
 *
 * A miss = a `again` rating (the only 'incorrect'; a hint-revealed-but-correct answer caps at `hard`,
 * which is not a miss). An instrument is a candidate iff: its LATEST attempt this session is `again`
 * (currently failing), it has been attempted fewer than `redrillMaxAttemptsPerInstrument` times
 * (bounds the tail — a stubborn miss re-drills at most cap-1 times, then waits for a future session),
 * and it is still eligible. Ordered earliest-first-miss.
 */
export function redrillQueue(
  attempts: readonly RedrillAttempt[],
  isEligible: (itemId: string) => boolean,
  knobs: RedrillKnobs
): Instrument[] {
  const cap = knobs.redrillMaxAttemptsPerInstrument;
  // A NaN/negative cap makes `length >= cap` never fire -> an UNBOUNDED re-drill tail (the route
  // would loop forever). Fail loud, matching the planner's degenerate-knob discipline.
  if (!Number.isInteger(cap) || cap < 1) {
    throw new Error(`redrillQueue: redrillMaxAttemptsPerInstrument must be an integer >= 1, got ${cap}`);
  }
  const groups = new Map<string, RedrillAttempt[]>();
  for (const a of attempts) {
    const key = instrumentKey(a.itemId, a.exerciseTypeKey, a.paramKey, a.direction);
    const g = groups.get(key);
    if (g) g.push(a);
    else groups.set(key, [a]);
  }
  const candidates: { at: number; inst: Instrument }[] = [];
  for (const g of groups.values()) {
    const last = g[g.length - 1];
    if (last.rating !== 'again') continue; // resolved (or never missed)
    if (g.length >= cap) continue; // tail-bound: already re-drilled to the cap
    if (!isEligible(last.itemId)) continue; // gated out since the miss
    const firstAgain = g.find((a) => a.rating === 'again')!; // last is 'again', so one exists
    candidates.push({
      at: firstAgain.at,
      inst: {
        ruleKey: last.ruleKeys[0] ?? '', // observability only; the route re-credits the full tested ruleKeys
        itemId: last.itemId,
        exerciseTypeKey: last.exerciseTypeKey,
        paramKey: last.paramKey,
        direction: last.direction
      }
    });
  }
  candidates.sort((a, b) => a.at - b.at); // earliest-first-miss (stable for equal `at`)
  return candidates.map((c) => c.inst);
}
```

- [ ] **Step 4: Add the knob** — `app/packages/domain/src/planner/planner.ts`

(a) In the `PlannerKnobs` interface, after `targetAttempts: number;`, add:

```ts
  redrillMaxAttemptsPerInstrument: number; // D.2 re-drill tail bound; a missed instrument re-drills at most (cap-1) times
```

(b) In the `PLANNER_KNOBS` const, after `targetAttempts: 10` — add a trailing comma to that line and a new line:

```ts
  targetAttempts: 10, // ~10-min budget — Monte-Carlo-owned
  redrillMaxAttemptsPerInstrument: 2 // Monte-Carlo-owned — D.2 re-drill tail bound
```

- [ ] **Step 5: Run tests + check + lint**

Run: `pnpm --filter @lt/domain exec vitest run src/session/redrill.test.ts` → Expected: PASS.
Run: `pnpm --filter @lt/domain exec vitest run src/planner/planner.test.ts` → Expected: PASS (the spread-based knob literals at planner.test.ts:188/195 auto-include the new field; no other `PlannerKnobs` literal exists).
Run: `pnpm --filter @lt/domain run check && pnpm --filter @lt/domain run lint` → Expected: PASS (M9-clean).

- [ ] **Step 6: Commit**

```bash
git add app/packages/domain/src/session/redrill.ts app/packages/domain/src/session/redrill.test.ts app/packages/domain/src/planner/planner.ts
git commit -F - <<'EOF'
feat(domain): stateless re-drill queue (log-derived, tail-bounded) (#16)

Pure redrillQueue(attempts, isEligible, knobs): unresolved misses (latest 'again') grouped by
instrument, bounded by redrillMaxAttemptsPerInstrument (fail-loud on a degenerate cap to prevent
an unbounded tail), eligibility-filtered, ordered earliest-first-miss. New MC-owned knob placeholder.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 3: Session summary + module wiring (`summary.ts`, `session/index.ts`, domain export)

**Files:** Create `summary.ts`, `summary.test.ts`, `session/index.ts`; modify `app/packages/domain/src/index.ts`.

- [ ] **Step 1: Write the failing test** — `app/packages/domain/src/session/summary.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { sessionSummary } from './summary';
import type { RedrillAttempt } from './redrill';

const A = (over: Partial<RedrillAttempt> = {}): RedrillAttempt => ({
  itemId: 'a',
  exerciseTypeKey: 'transformation',
  paramKey: '',
  direction: 'en>es',
  ruleKeys: ['R'],
  rating: 'good',
  at: 1,
  ...over
});

describe('sessionSummary', () => {
  it('counts attempts + correct (rating !== again)', () => {
    const s = sessionSummary([A({ rating: 'good' }), A({ rating: 'again' }), A({ rating: 'hard' })]);
    expect(s.attempts).toBe(3);
    expect(s.correct).toBe(2); // good + hard; again is the only miss
  });

  it('counts re-drilled instruments (served more than once)', () => {
    const s = sessionSummary([
      A({ itemId: 'a', at: 1 }),
      A({ itemId: 'a', at: 2 }), // a served twice -> re-drilled
      A({ itemId: 'b', at: 3 })
    ]);
    expect(s.redrilled).toBe(1);
  });

  it('empty session', () => {
    expect(sessionSummary([])).toEqual({ attempts: 0, correct: 0, redrilled: 0 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lt/domain exec vitest run src/session/summary.test.ts`
Expected: FAIL — `Cannot find module './summary'`.

- [ ] **Step 3: Implement** — `app/packages/domain/src/session/summary.ts`

```ts
import { instrumentKey } from '../mastery/mastery';
import type { RedrillAttempt } from './redrill';

export interface SessionSummary {
  attempts: number;
  correct: number; // rating !== 'again'
  redrilled: number; // instruments served more than once this session
}

/** Pure end-of-session summary over the session's attempt rows (the done-screen numbers). */
export function sessionSummary(attempts: readonly RedrillAttempt[]): SessionSummary {
  const perInstrument = new Map<string, number>();
  let correct = 0;
  for (const a of attempts) {
    if (a.rating !== 'again') correct += 1;
    const key = instrumentKey(a.itemId, a.exerciseTypeKey, a.paramKey, a.direction);
    perInstrument.set(key, (perInstrument.get(key) ?? 0) + 1);
  }
  let redrilled = 0;
  for (const count of perInstrument.values()) if (count > 1) redrilled += 1;
  return { attempts: attempts.length, correct, redrilled };
}
```

- [ ] **Step 4: Write the module index** — `app/packages/domain/src/session/index.ts`

```ts
export { sessionPhase } from './phase';
export type { Phase, PhaseInput } from './phase';
export { redrillQueue } from './redrill';
export type { RedrillAttempt, RedrillKnobs } from './redrill';
export { sessionSummary } from './summary';
export type { SessionSummary } from './summary';
```

- [ ] **Step 5: Export from the domain entrypoint** — `app/packages/domain/src/index.ts`

Add at the end (after the `./planner/index` export):

```ts
// Slice D.2: bounded-session lifecycle — pure phase machine + stateless re-drill + summary.
export * from './session/index';
```

- [ ] **Step 6: Run tests + check + lint**

Run: `pnpm --filter @lt/domain exec vitest run src/session/summary.test.ts` → Expected: PASS.
Run: `pnpm --filter @lt/domain run check && pnpm --filter @lt/domain run lint` → Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/packages/domain/src/session/summary.ts app/packages/domain/src/session/summary.test.ts app/packages/domain/src/session/index.ts app/packages/domain/src/index.ts
git commit -F - <<'EOF'
feat(domain): session summary + session module wiring (#16)

Pure sessionSummary(attempts) -> {attempts, correct (non-again), redrilled (served>1)} for the
done screen. Wires @lt/domain/session (phase + redrill + summary) into the domain entrypoint.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 4: Session lifecycle repo reads (`currentSession` unended + `sessionAttempts`)

**Files:** Modify `ports/repository.ts`, `db/repo.ts`, `db/repo.test.ts`.

- [ ] **Step 1: Write the failing tests** — append inside the top `describe('DrizzleReviewRepository (C.1 integration)', ...)` block in `app/packages/web/src/lib/server/db/repo.test.ts` (e.g. after the star/unstar test)

```ts
	it('currentSession returns the latest UNENDED practice session', () => {
		const s1 = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		expect(env.repo.currentSession('u1')?.id).toBe(s1.sessionId);
		env.repo.endSession({ userId: 'u1', sessionId: s1.sessionId, at: t + 1 });
		expect(env.repo.currentSession('u1')).toBeUndefined(); // ended -> no open session
		const s2 = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t + 2 });
		expect(env.repo.currentSession('u1')?.id).toBe(s2.sessionId);
	});

	it('sessionAttempts returns only this session\'s attempts, ordered', () => {
		const { sessionId } = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		const other = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t + 1 });
		env.repo.appendAttempt(attempt({ sessionId, direction: 'en>es' }));
		env.repo.appendAttempt(attempt({ sessionId: other.sessionId, direction: 'es>en' }));
		const rows = env.repo.sessionAttempts('u1', sessionId);
		expect(rows).toHaveLength(1);
		expect(rows[0].direction).toBe('en>es');
		expect(rows.every((r) => r.kind === 'attempt' && r.sessionId === sessionId)).toBe(true);
	});

	it('endSession appends session_end and folds identically (ended + realized_count)', () => {
		const { sessionId } = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(attempt({ sessionId }));
		env.repo.appendAttempt(attempt({ sessionId }));
		env.repo.endSession({ userId: 'u1', sessionId, at: t + 100 });

		const folded = fold(env.repo.events('u1').map(rowToEvent), { scheduler: trivialScheduler });
		expect(folded.sessions).toEqual(env.repo.sessions('u1'));
		const s = folded.sessions.find((x) => x.id === sessionId)!;
		expect(s.endedAt).toBe(t + 100);
		expect(s.realizedCount).toBe(2);
	});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lt/web exec vitest run src/lib/server/db/repo.test.ts`
Expected: FAIL — `currentSession` returns the ended session (assertion fails) and/or `env.repo.sessionAttempts is not a function`.

- [ ] **Step 3: Update the port** — `app/packages/domain/src/ports/repository.ts`

Replace the `currentSession` doc + declaration, and add `sessionAttempts` after it:

```ts
  /**
   * The user's latest UNENDED (`endedAt` null) practice session, or undefined. D.2 ends sessions,
   * so "current" means the one open session (there is at most one) — a fresh `?/start` follows an end.
   */
  currentSession(userId: string): SessionRow | undefined;
  /** This session's `attempt` rows ordered (at, id) — the re-drill + summary input (filters user_id). */
  sessionAttempts(userId: string, sessionId: number): ReviewLogRow[];
```

- [ ] **Step 4: Implement** — `app/packages/web/src/lib/server/db/repo.ts`

(a) Add `isNull` to the `drizzle-orm` import:

```ts
import { and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm';
```

(b) In `currentSession`, add the unended filter to the `where`:

```ts
	currentSession(userId: string): SessionRow | undefined {
		return this.db
			.select()
			.from(sessions)
			.where(
				and(eq(sessions.userId, userId), eq(sessions.mode, 'practice'), isNull(sessions.endedAt))
			)
			.orderBy(desc(sessions.id))
			.limit(1)
			.get();
	}
```

(c) Add `sessionAttempts` immediately after `currentSession` (before `itemExposures`):

```ts
	sessionAttempts(userId: string, sessionId: number): ReviewLogRow[] {
		return this.db
			.select()
			.from(reviewLog)
			.where(
				and(
					eq(reviewLog.userId, userId),
					eq(reviewLog.sessionId, sessionId),
					eq(reviewLog.kind, 'attempt')
				)
			)
			.orderBy(asc(reviewLog.at), asc(reviewLog.id))
			.all() as ReviewLogRow[];
	}
```

- [ ] **Step 5: Run tests + check**

Run: `pnpm --filter @lt/web exec vitest run src/lib/server/db/repo.test.ts` → Expected: PASS.
Run: `pnpm check` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/packages/domain/src/ports/repository.ts app/packages/web/src/lib/server/db/repo.ts app/packages/web/src/lib/server/db/repo.test.ts
git commit -F - <<'EOF'
feat: session lifecycle repo reads (currentSession unended + sessionAttempts) (#16)

currentSession now returns the latest UNENDED practice session (the one-open-session invariant);
sessionAttempts(user, session) reads that session's attempt rows for re-drill + summary. endSession
folds identically (session_end + realized_count) — rebuild parity intact, no schema change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 5: `computePhase` web helper + full-lifecycle integration test

**Files:** Create `app/packages/web/src/lib/server/session-ctx.ts`, `session-ctx.test.ts`.

**Context:** `computePhase` composes the planner head + `redrillQueue` + `sessionPhase` from the live repo/store — the single place `load` and `submit` both call. The integration test drives a real session through it against a real test DB + the real content store (lesson 2 = the single rule `L2#conv-al`), controlling the phase via crafted attempt sequences (the specific instrument the planner serves is irrelevant to the phase assertions).

- [ ] **Step 1: Write the helper** — `app/packages/web/src/lib/server/session-ctx.ts`

```ts
import {
	isVisible,
	planSession,
	PLANNER_KNOBS,
	redrillQueue,
	seededRng,
	sessionPhase,
	type ItemStore,
	type Phase,
	type RedrillAttempt,
	type ReviewLogRow,
	type SessionRow
} from '@lt/domain';
import { buildPlannerCtx } from './planner-ctx';
import type { DrizzleReviewRepository } from './db/repo';

/** Map this session's `attempt` log rows to the pure re-drill/summary projection. */
export function toRedrillAttempts(rows: ReviewLogRow[]): RedrillAttempt[] {
	return rows.map((r) => ({
		itemId: r.itemId!,
		exerciseTypeKey: r.exerciseTypeKey!,
		paramKey: r.paramKey ?? '',
		direction: r.direction!,
		ruleKeys: r.ruleKeys ?? [],
		rating: r.rating!,
		at: r.at
	}));
}

/**
 * The single completion decision, shared by the practice route's `load` (render) and `submit`
 * (end-on-complete). Composes the planner greedy head + the re-drill queue + sessionPhase from the
 * user's current persisted state. Pure inputs in; a Phase out.
 */
export function computePhase(
	store: ItemStore,
	repo: DrizzleReviewRepository,
	userId: string,
	now: number,
	open: SessionRow
): Phase {
	const currentLesson = repo.currentLesson(userId);
	const head = planSession(buildPlannerCtx(store, repo, userId, now, seededRng(open.id)), 1)[0] ?? null;
	const isEligible = (itemId: string) => {
		const it = store.get(itemId);
		return !!it && isVisible(it, currentLesson);
	};
	const redrill = redrillQueue(toRedrillAttempts(repo.sessionAttempts(userId, open.id)), isEligible, {
		redrillMaxAttemptsPerInstrument: PLANNER_KNOBS.redrillMaxAttemptsPerInstrument
	});
	return sessionPhase({
		realizedCount: open.realizedCount,
		targetAttempts: open.targetAttempts,
		head,
		redrill
	});
}
```

- [ ] **Step 2: Write the integration test** — `app/packages/web/src/lib/server/session-ctx.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLANNER_KNOBS, type AttemptInput, type Clock } from '@lt/domain';
import { createTestDb } from './db/test-db';
import { contentStore } from './content-loader';
import { computePhase } from './session-ctx';

let t = 1_700_000_000_000;
const clock: Clock = { now: () => t };
let env: ReturnType<typeof createTestDb>;
const store = contentStore();

beforeEach(() => {
	t = 1_700_000_000_000;
	env = createTestDb(clock);
	env.repo.setLesson({ userId: 'u1', lesson: 2, at: t }); // lesson 2 -> the single rule L2#conv-al
});
afterEach(() => env.cleanup());

function open() {
	return env.repo.currentSession('u1')!;
}
function append(direction: 'en>es' | 'es>en', rating: AttemptInput['rating']) {
	env.repo.appendAttempt({
		userId: 'u1',
		sessionId: open().id,
		itemId: 'al-annual',
		ruleKeys: ['L2#conv-al'],
		exerciseTypeKey: 'transformation',
		paramKey: '',
		direction,
		rating,
		assessment: { correct: rating !== 'again' },
		hintRevealed: false,
		contentHash: ''
	});
}

describe('computePhase (lifecycle integration)', () => {
	it('main on a fresh servable session', () => {
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		expect(computePhase(store, env.repo, 'u1', t, open()).kind).toBe('main');
	});

	it('complete once the budget is spent with no unresolved miss', () => {
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		for (let i = 0; i < PLANNER_KNOBS.targetAttempts; i++) append('en>es', 'good');
		expect(computePhase(store, env.repo, 'u1', t, open()).kind).toBe('complete');
	});

	it('re-drill once the budget is spent with an unresolved miss (distinct instrument under the cap)', () => {
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		for (let i = 0; i < PLANNER_KNOBS.targetAttempts - 1; i++) append('en>es', 'good');
		append('es>en', 'again'); // realized == target; es>en instrument: 1 attempt, latest miss -> unresolved
		const phase = computePhase(store, env.repo, 'u1', t, open());
		expect(phase.kind).toBe('redrill');
		expect(phase.kind === 'redrill' && phase.pick.itemId).toBe('al-annual');
		expect(phase.kind === 'redrill' && phase.pick.direction).toBe('es>en');
	});

	it('re-drill resolves to complete after a correct re-attempt', () => {
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		for (let i = 0; i < PLANNER_KNOBS.targetAttempts - 1; i++) append('en>es', 'good');
		append('es>en', 'again');
		append('es>en', 'good'); // latest on es>en now non-again -> resolved
		expect(computePhase(store, env.repo, 'u1', t, open()).kind).toBe('complete');
	});
});
```

- [ ] **Step 3: Run tests + check + lint**

Run: `pnpm --filter @lt/web exec vitest run src/lib/server/session-ctx.test.ts` → Expected: PASS.
Run: `pnpm check && pnpm --filter @lt/web run lint` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/packages/web/src/lib/server/session-ctx.ts app/packages/web/src/lib/server/session-ctx.test.ts
git commit -F - <<'EOF'
feat(web): computePhase helper + full-lifecycle integration test (#16)

computePhase composes planner head + redrillQueue + sessionPhase from live repo/store — the single
completion decision shared by load + submit. Integration test drives main -> budget -> re-drill ->
resolve -> complete against a real test DB + content store.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 6: Bounded-session practice route + UI + explicit-start e2e rework

**Files:** Rewrite `app/packages/web/src/routes/+page.server.ts`; modify `+page.svelte`; **rework** `e2e/practice.e2e.ts`, `e2e/persistence.e2e.ts`, `e2e/mastery.e2e.ts`, `e2e/planner-star.e2e.ts`.

**Context:** `load` becomes read-only (renders the phase); `submit` ends the session when the attempt completes it; `?/start` ends any lingering open session and starts a fresh one (guarded by servability). The four practice-touching e2e gain an explicit Start. Do the implementation (Steps 1–3) first, then the e2e rework (Steps 4–7), then verify (Step 8).

- [ ] **Step 1: Rewrite the practice loader + actions** — replace all of `app/packages/web/src/routes/+page.server.ts` with:

```ts
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	planSession,
	PLANNER_KNOBS,
	ratingFromAssessment,
	seededRng,
	sessionSummary,
	transformationType,
	type Direction,
	type ItemStore
} from '@lt/domain';
import { contentStore } from '$lib/server/content-loader';
import { getRepo } from '$lib/server/db';
import { buildPlannerCtx } from '$lib/server/planner-ctx';
import { computePhase, toRedrillAttempts } from '$lib/server/session-ctx';
import type { DrizzleReviewRepository } from '$lib/server/db/repo';
import { webClock } from '$lib/server/clock';

/**
 * Bounded-session practice (slice D.2). `load` is READ-ONLY: it derives the session phase from the
 * user's persisted state and renders it (main/redrill = a pick; complete/idle = the done/caught-up
 * screen). Session creation lives in `?/start`; `submit` writes `session_end` when the attempt
 * completes the session. No plan/session-plan persistence; no side effects in `load` (this kills
 * the D.1 first-load race).
 */

/** True if the planner can serve at least one instrument now (seed-independent emptiness — fixed seed). */
function servable(store: ItemStore, repo: DrizzleReviewRepository, userId: string, now: number): boolean {
	return !!planSession(buildPlannerCtx(store, repo, userId, now, seededRng(0)), 1)[0];
}

export const load: PageServerLoad = ({ locals }) => {
	const store = contentStore();
	const repo = getRepo();
	const userId = locals.user.id;
	const now = webClock.now();
	const currentLesson = repo.currentLesson(userId);

	// The idle (no active pick) view: the most-recent session's summary (if any) + whether Start shows.
	const idle = () => {
		const last = repo.sessions(userId).at(-1);
		const summary = last
			? sessionSummary(toRedrillAttempts(repo.sessionAttempts(userId, last.id)))
			: null;
		return {
			phase: 'idle' as const,
			sessionId: null,
			itemId: null,
			direction: null,
			prompt: null,
			hint: null,
			starred: false,
			canStart: servable(store, repo, userId, now),
			summary
		};
	};

	const open = repo.currentSession(userId); // latest UNENDED practice session
	if (!open) return idle();

	const phase = computePhase(store, repo, userId, now, open);
	// Rare: an open session that's complete-by-derivation (a non-attempt cause emptied the plan). Render
	// the done screen read-only; the next ?/start ends it before creating the fresh one (design edge).
	if (phase.kind === 'complete') return idle();

	const pick = phase.pick;
	const item = store.get(pick.itemId)!;
	// Salt the render seed (+1) so render randomness never replays the planner's stream.
	const renderCtx = { items: store, currentLesson, rng: seededRng(open.id + 1) };
	const prompt = transformationType.promptRenderer.render(item, { direction: pick.direction }, renderCtx);
	return {
		phase: phase.kind, // 'main' | 'redrill'
		sessionId: open.id,
		itemId: item.id,
		direction: pick.direction,
		prompt,
		hint: item.hint ?? null,
		starred: repo.itemExposure(userId, item.id)?.starred ?? false,
		canStart: false,
		summary: null
	};
};

/** Narrow a posted form value to a valid Direction (mirrors content-loader's DIRECTIONS set). */
function isDirection(d: string): d is Direction {
	return d === 'en>es' || d === 'es>en';
}

export const actions: Actions = {
	// Named (not `default`): SvelteKit forbids a default action alongside named actions; the practice
	// form targets ?/submit. `load` renders the next phase after the action re-runs it.
	submit: async ({ request, locals }) => {
		const data = await request.formData();
		const sessionId = Number(data.get('sessionId'));
		const itemId = String(data.get('itemId') ?? '');
		const answer = String(data.get('answer') ?? '');
		const hintRevealed = data.get('hintRevealed') === 'true';
		const direction = String(data.get('direction') ?? 'en>es');

		const store = contentStore();
		const repo = getRepo();
		const item = store.get(itemId);
		if (!item || Number.isNaN(sessionId) || !isDirection(direction)) {
			return fail(400, { error: 'unknown item, session, or direction' });
		}

		const grade = transformationType.grader.grade(
			item,
			{ direction },
			{ modality: 'text', text: answer },
			{ items: store }
		);
		const rating = ratingFromAssessment(grade, { hintRevealed });

		const ruleKeys = item.rule_refs
			.filter((r) => r.role === 'tests' && (store.getRule(r.key)?.schedulable ?? false))
			.map((r) => r.key);

		repo.appendAttempt({
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

		// End-of-session: if this attempt completed the session (budget spent / pool exhausted, no
		// unresolved misses left), write session_end. Shared computePhase keeps this in lockstep with load.
		const now = webClock.now();
		const open = repo.currentSession(locals.user.id);
		if (open && computePhase(store, repo, locals.user.id, now, open).kind === 'complete') {
			repo.endSession({ userId: locals.user.id, sessionId: open.id, at: now });
		}

		return {
			verdict: grade.correct ? 'correct' : 'incorrect',
			detail: grade.detail ?? null,
			rating,
			answer,
			correctAnswer: item.back_es,
			hintRevealed
		};
	},

	// Start a fresh session: end any lingering open one first (idempotent; handles the rare
	// complete-but-open edge), then create — but only if something is servable (no empty sessions).
	start: ({ locals }) => {
		const store = contentStore();
		const repo = getRepo();
		const userId = locals.user.id;
		const now = webClock.now();
		const open = repo.currentSession(userId);
		if (open) repo.endSession({ userId, sessionId: open.id, at: now });
		if (servable(store, repo, userId, now)) {
			repo.startSession({ userId, mode: 'practice', targetAttempts: PLANNER_KNOBS.targetAttempts, at: now });
		}
	},

	star: async ({ request, locals }) => {
		const itemId = String((await request.formData()).get('itemId') ?? '');
		if (itemId && contentStore().get(itemId)) {
			getRepo().star({ userId: locals.user.id, itemId, at: webClock.now() });
		}
	},

	unstar: async ({ request, locals }) => {
		const itemId = String((await request.formData()).get('itemId') ?? '');
		if (itemId && contentStore().get(itemId)) {
			getRepo().unstar({ userId: locals.user.id, itemId, at: webClock.now() });
		}
	}
};
```

- [ ] **Step 2: Add the re-drill badge** — `app/packages/web/src/routes/+page.svelte`

Immediately after the opening `{#if data.prompt && data.itemId}` line (before `<section data-testid="prompt">`), add:

```svelte
		{#if data.phase === 'redrill'}
			<p data-testid="redrill-badge">Reviewing a miss</p>
		{/if}
```

- [ ] **Step 3: Replace the `{:else}` idle block** — `app/packages/web/src/routes/+page.svelte`

Replace the existing `{:else}` branch (the single `<p data-testid="no-item">…</p>`) with:

```svelte
	{:else}
		<section data-testid="idle">
			{#if data.summary}
				<div data-testid="session-summary">
					<p>Session done.</p>
					<p>attempts: <span data-testid="summary-attempts">{data.summary.attempts}</span></p>
					<p>correct: <span data-testid="summary-correct">{data.summary.correct}</span></p>
					<p>re-drilled: <span data-testid="summary-redrilled">{data.summary.redrilled}</span></p>
				</div>
			{/if}
			{#if data.canStart}
				<form method="POST" action="?/start" data-testid="start-form">
					<button type="submit" data-testid="start-session">
						{data.summary ? 'Start another session' : 'Start practicing'}
					</button>
				</form>
			{:else}
				<p data-testid="caught-up">
					All caught up — nothing to practice. Dial up a lesson in the inspector.
				</p>
			{/if}
		</section>
	{/if}
```

- [ ] **Step 4: Rework** `app/packages/web/e2e/practice.e2e.ts` — replace the whole file:

```ts
import { expect, test, type Page } from '@playwright/test';
import { PLANNER_KNOBS } from '@lt/domain';

// D.2: `load` is side-effect-free — a session is created only by ?/start, so cold start shows a
// "Start practicing" screen. `start(page)` clicks it only when idle (mid-session loads are
// unaffected). Lesson 1 (nothing servable) is `caught-up` with no Start. Each test resets the DB.
async function reset(page: Page) {
	await page.request.post('/__test__/db', { data: { action: 'reset' } });
	await page.request.post('/__test__/clock', { data: { action: 'reset' } });
}
async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}
async function start(page: Page) {
	const btn = page.getByTestId('start-session');
	if (await btn.isVisible().catch(() => false)) await btn.click();
}

test('caught up at lesson 1 (no eligible rule, no Start offered)', async ({ page }) => {
	await reset(page);
	await setLesson(page, 1);
	await page.goto('/');
	await expect(page.getByTestId('caught-up')).toBeVisible();
	await expect(page.getByTestId('start-session')).toHaveCount(0);
});

test('planner serves a prompt after Start; a wrong answer grades incorrect and reveals', async ({
	page
}) => {
	await reset(page);
	await setLesson(page, 5);
	await page.goto('/');
	await start(page);
	await expect(page.getByTestId('instruction')).toBeVisible();
	await expect(page.getByTestId('given')).toBeVisible();
	await page.getByTestId('answer-input').fill('zzzzz-not-a-word');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toHaveText('incorrect');
	await expect(page.getByTestId('rating')).toHaveText('again');
	await expect(page.getByTestId('reveal')).not.toBeEmpty();
});

test('a correct answer grades correct (rating good) and reveals the answer', async ({ page }) => {
	await reset(page);
	await setLesson(page, 2);
	// Only "annual"->"anual" matches the fixed answer; loop until the planner serves al-annual (bounded
	// by the budget). start(page) handles the first idle load + any mid-loop completion.
	let verdict = '';
	for (let i = 0; i < PLANNER_KNOBS.targetAttempts && verdict !== 'correct'; i++) {
		await page.goto('/');
		await start(page);
		await page.getByTestId('answer-input').fill('anual');
		await page.getByTestId('submit').click();
		await expect(page.getByTestId('verdict')).toBeVisible();
		verdict = (await page.getByTestId('verdict').textContent()) ?? '';
	}
	expect(verdict).toBe('correct');
	await expect(page.getByTestId('rating')).toHaveText('good');
	await expect(page.getByTestId('reveal')).toHaveText('anual');
});

test('the star toggle flips on the served item and persists across the reload', async ({ page }) => {
	await reset(page);
	await setLesson(page, 5);
	await page.goto('/');
	await start(page);
	const toggle = page.getByTestId('star-toggle');
	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await toggle.click();
	await expect(page.getByTestId('star-toggle')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('star-toggle')).toHaveText('★ starred');
});
```

- [ ] **Step 5: Rework** `app/packages/web/e2e/persistence.e2e.ts` — add the `start` helper and click it before the attempt. Change the helper block (after `setLesson`) to add:

```ts
async function start(page: Page) {
	const btn = page.getByTestId('start-session');
	if (await btn.isVisible().catch(() => false)) await btn.click();
}
```

and in the test, replace the first practice block:

```ts
	await page.goto('/');
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toBeVisible(); // graded (correct or not)
```

with:

```ts
	await page.goto('/');
	await start(page);
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toBeVisible(); // graded (correct or not)
```

(The later `await page.goto('/')` mid-test is a reload of the still-open session — it serves the next pick and needs no Start; leave it unchanged.)

- [ ] **Step 6: Rework** `app/packages/web/e2e/mastery.e2e.ts` — add the `start` helper and call it inside `attempt()`. Add after `setLesson`:

```ts
async function start(page: Page) {
	const btn = page.getByTestId('start-session');
	if (await btn.isVisible().catch(() => false)) await btn.click();
}
```

and change `attempt` to Start-if-idle before filling:

```ts
async function attempt(page: Page): Promise<string> {
	await page.goto('/');
	await start(page);
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toBeVisible();
	return (await page.getByTestId('verdict').textContent()) ?? '';
}
```

- [ ] **Step 7: Rework** `app/packages/web/e2e/planner-star.e2e.ts` — add a `start` helper and click it before reading the star form. Add after the existing `setLesson`/`reset` helpers:

```ts
async function start(page: Page) {
	const btn = page.getByTestId('start-session');
	if (await btn.isVisible().catch(() => false)) await btn.click();
}
```

and in the second test (`starring the practice item …`), after `await page.goto('/');` insert `await start(page);` before the `star-form` read:

```ts
	await page.goto('/');
	await start(page);
	const itemId = await page.getByTestId('star-form').locator('input[name="itemId"]').inputValue();
```

(The first test — the fixed-seed planned-queue preview on `/inspector` — does not touch practice; leave it unchanged.)

- [ ] **Step 8: Run the reworked e2e + check + lint**

Run: `pnpm --filter @lt/web exec playwright test practice.e2e.ts persistence.e2e.ts mastery.e2e.ts planner-star.e2e.ts inspector.e2e.ts`
Expected: PASS (inspector unchanged + green; the four reworked files green).
Run: `pnpm check && pnpm --filter @lt/web run lint` → Expected: PASS (run `prettier --write` on touched files if flagged).

- [ ] **Step 9: Commit**

```bash
git add app/packages/web/src/routes/+page.server.ts app/packages/web/src/routes/+page.svelte app/packages/web/e2e/practice.e2e.ts app/packages/web/e2e/persistence.e2e.ts app/packages/web/e2e/mastery.e2e.ts app/packages/web/e2e/planner-star.e2e.ts
git commit -F - <<'EOF'
feat(web): bounded-session route (read-only load, end-on-complete, start action) + explicit-start e2e (#16)

load derives + renders the session phase (main/redrill/done) with no side effects; submit writes
session_end when computePhase says complete; ?/start ends any lingering open session and starts a
fresh one (servability-guarded). Cold start now shows a Start screen -> the four practice-touching
e2e gain an explicit start(); lesson-1 empty is now caught-up.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 7: Inspector session panel + lifecycle e2e

**Files:** Modify `app/packages/web/src/routes/inspector/+page.server.ts`, `+page.svelte`; create `app/packages/web/e2e/session-lifecycle.e2e.ts`.

- [ ] **Step 1: Extend the inspector loader** — `app/packages/web/src/routes/inspector/+page.server.ts`

(a) Extend the `@lt/domain` import to add `isVisible` + `redrillQueue`:

```ts
import {
	eligibleItems,
	eligibleRules,
	isVisible,
	masteryReady,
	planSession,
	PLANNER_KNOBS,
	redrillQueue,
	seededRng
} from '@lt/domain';
```

(b) Add the ctx-builder import (below the existing `$lib/server/planner-ctx` import):

```ts
import { toRedrillAttempts } from '$lib/server/session-ctx';
```

(c) In the returned object of `load`, after `starredItems: …`, add the session panel data:

```ts
		// Current-session panel (D.2 lifecycle observability): the one open session + its re-drill queue.
		session: (() => {
			const open = repo.currentSession(locals.user.id);
			return open
				? {
						id: open.id,
						realizedCount: open.realizedCount,
						targetAttempts: open.targetAttempts,
						ended: open.endedAt != null
					}
				: null;
		})(),
		sessionRedrill: (() => {
			const open = repo.currentSession(locals.user.id);
			if (!open) return [];
			return redrillQueue(
				toRedrillAttempts(repo.sessionAttempts(locals.user.id, open.id)),
				(itemId) => {
					const it = store.get(itemId);
					return !!it && isVisible(it, currentLesson);
				},
				{ redrillMaxAttemptsPerInstrument: PLANNER_KNOBS.redrillMaxAttemptsPerInstrument }
			).map((i) => ({ itemId: i.itemId, direction: i.direction }));
		})()
```

- [ ] **Step 2: Render the panel** — `app/packages/web/src/routes/inspector/+page.svelte`

Before the closing `</main>`, add:

```svelte
	<section data-testid="session-panel" aria-label="current session">
		{#if data.session}
			<p>session: <span data-testid="session-id">{data.session.id}</span></p>
			<p>
				realized: <span data-testid="session-realized">{data.session.realizedCount}</span>
				/ <span data-testid="session-target">{data.session.targetAttempts}</span>
			</p>
			<p>ended: <span data-testid="session-ended">{String(data.session.ended)}</span></p>
			<ol data-testid="session-redrill-list">
				{#each data.sessionRedrill as r, i (i)}
					<li data-testid="session-redrill-item" data-item-id={r.itemId}>{r.itemId} {r.direction}</li>
				{/each}
			</ol>
		{:else}
			<p data-testid="session-none">no active session</p>
		{/if}
	</section>
```

- [ ] **Step 3: Create the lifecycle e2e** — `app/packages/web/e2e/session-lifecycle.e2e.ts`

```ts
import { expect, test, type Page } from '@playwright/test';
import { PLANNER_KNOBS } from '@lt/domain';

async function reset(page: Page) {
	await page.request.post('/__test__/db', { data: { action: 'reset' } });
	await page.request.post('/__test__/clock', { data: { action: 'reset' } });
}
async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}

test('caught up at lesson 1 shows the caught-up screen with no Start', async ({ page }) => {
	await reset(page);
	await setLesson(page, 1);
	await page.goto('/');
	await expect(page.getByTestId('caught-up')).toBeVisible();
	await expect(page.getByTestId('start-session')).toHaveCount(0);
});

test('a session bounds at the budget, re-drills misses, ends with a summary, and a fresh one starts', async ({
	page
}) => {
	await reset(page);
	await setLesson(page, 2);
	await page.goto('/');
	await page.getByTestId('start-session').click(); // explicit start (cold)

	// Answer every prompt 'anual' (correct only for al-annual->anual; every other instrument misses),
	// so the budget is spent with unresolved misses -> a re-drill tail. Loop until the done screen
	// (bounded: budget + a per-instrument-capped tail, so it always terminates).
	let sawRedrill = false;
	for (let i = 0; i < 60; i++) {
		if (await page.getByTestId('session-summary').isVisible().catch(() => false)) break;
		if (await page.getByTestId('redrill-badge').isVisible().catch(() => false)) sawRedrill = true;
		const input = page.getByTestId('answer-input');
		if (!(await input.isVisible().catch(() => false))) break;
		await input.fill('anual');
		await page.getByTestId('submit').click();
	}

	await expect(page.getByTestId('session-summary')).toBeVisible();
	expect(Number(await page.getByTestId('summary-attempts').textContent())).toBeGreaterThanOrEqual(
		PLANNER_KNOBS.targetAttempts
	);
	expect(sawRedrill).toBe(true); // the budget was spent with unresolved misses -> a re-drill tail ran

	// The inspector shows the session ended.
	await page.goto('/inspector');
	await expect(page.getByTestId('session-ended')).toHaveText('true');

	// Start another -> a fresh session (ended=false, realized reset below the target).
	await page.goto('/');
	await page.getByTestId('start-session').click();
	await page.goto('/inspector');
	await expect(page.getByTestId('session-ended')).toHaveText('false');
	expect(Number(await page.getByTestId('session-realized').textContent())).toBeLessThan(
		PLANNER_KNOBS.targetAttempts
	);
});
```

- [ ] **Step 4: Run the e2e + check + lint**

Run: `pnpm --filter @lt/web exec playwright test session-lifecycle.e2e.ts inspector.e2e.ts` → Expected: PASS.
Run: `pnpm check && pnpm --filter @lt/web run lint` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/packages/web/src/routes/inspector/+page.server.ts app/packages/web/src/routes/inspector/+page.svelte app/packages/web/e2e/session-lifecycle.e2e.ts
git commit -F - <<'EOF'
feat(web): inspector session panel + session-lifecycle e2e (#16)

Inspector shows the open session (id / realized-of-target / ended) + its re-drill queue —
deterministic lifecycle observability. e2e: caught-up at lesson 1 (no Start); a full session bounds
at the budget, re-drills a miss, ends with a summary, and a fresh session starts.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LxCotCUoTtf9nRMrCEARsk
EOF
```

---

## Task 8: Full gate + Playwright MCP walkthrough (verification, per AGENTS.md)

**No new files.** Evidence-before-claims over the whole slice.

- [ ] **Step 1: Full automated gate** (from `app/`)

```bash
pnpm lint
pnpm check
pnpm build
pnpm test
pnpm test:e2e
```
Expected: all green. Capture the domain + web unit counts and the e2e count. The new domain suites (`session/phase`, `session/redrill`, `session/summary`) + web `session-ctx` integration + `session-lifecycle.e2e.ts` should appear; the four reworked e2e should pass. Counts must be ≥ the D.1 baseline (domain 113, web 34, e2e 13) plus the new tests — no regressions.

- [ ] **Step 2: M9 boundary + tripwire**

Confirm `pnpm --filter @lt/web exec vitest run src/lib/server/m9-boundary.test.ts` passes (the new `session/` module is pure domain — no node/persistence/svelte leaked; `computePhase`/`session-ctx` live in `@lt/web` server, correctly outside the domain).

- [ ] **Step 3: Playwright MCP walkthrough of the real built UI**

```bash
cd app/packages/web && LT_TEST_CONTROL=1 LT_DB_PATH=:memory: pnpm build && LT_TEST_CONTROL=1 LT_DB_PATH=:memory: pnpm preview --port 4173
```
Then via the Playwright MCP tools: reset the DB + clock; set lesson 1 → open `/` and confirm the **caught-up** screen (no Start). Set lesson 5 → open `/`, confirm the **Start practicing** screen; click Start; answer a few prompts; open `/inspector` and read the **session panel** (realized climbing toward target, ended=false). Answer 'anual' repeatedly (creating misses) until the practice screen shows the **re-drill badge**, then the **done summary**; confirm `/inspector` shows `session-ended=true`. Back on `/`, click **Start another** and confirm a fresh session (`session-ended=false`, realized reset). Screenshot the done summary + the inspector session panel; report observed values as evidence. **Clean up:** kill the preview (`lsof -ti tcp:4173 | xargs kill`) and `trash` any stray `.playwright-mcp/` + screenshots written to the repo root. Both trees clean.

---

## Self-Review (author) — spec coverage

- **Pure `sessionPhase` (main/redrill/complete; budget gate; null-head fall-through)** → Task 1.
- **Pure `redrillQueue` (miss = latest `again`; resolution; per-instrument cap w/ fail-loud; eligibility filter; earliest-first order; observability ruleKey)** → Task 2. **New MC-owned knob `redrillMaxAttemptsPerInstrument`** (marked placeholder) → Task 2.
- **Pure `sessionSummary` (attempts / correct / re-drilled)** + **domain module wiring** → Task 3.
- **Repo: `currentSession` unended + `sessionAttempts` + `endSession` fold parity** → Task 4.
- **Shared `computePhase` (load/submit agreement lever) + toRedrillAttempts + full-lifecycle integration test** → Task 5.
- **Read-only `load` (phase render), `submit` end-on-complete, `?/start` (ends lingering + servability-guarded), UI (re-drill badge, done/caught-up/Start)** → Task 6. **Explicit-start e2e rework** (practice/persistence/mastery/planner-star) → Task 6.
- **Inspector session panel + re-drill queue** + **lifecycle e2e** (caught-up; budget→redrill→done→start-another) → Task 7.
- **Full gate + M9 + MCP walkthrough** → Task 8.
- **No migration; no `due`/scheduler/planner-logic change; no `ReviewLog` schema/event change (frozen `session_end` reused); fold ≡ projection (rebuild parity re-asserted in Task 4); domain isomorphic/deterministic; per-user reads filter user_id (new `sessionAttempts`)** → by construction across Tasks 1–7.
- **First-load race eliminated** (load creates nothing; session birth is the `?/start` POST) → Task 6.
- **Deferred (D.3/P1)** — adaptive trickle, persisted/resumable nav, advance-lesson nudge, difficulty, type-selection, MC-tuned values — absent from every task.
