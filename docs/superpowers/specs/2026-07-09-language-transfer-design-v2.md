# Language Transfer practice app — design (v2, authoritative)

**Status:** authoritative design. **Supersedes** `2026-07-09-language-transfer-app-design.md` (v1). Ready for GitHub issue breakdown after Anthony's review — **not implementation yet**.
**Date:** 2026-07-09
**Companions (read alongside):** `language-transfer-requirements.md` (living constraints/decisions ledger + backlog), `scheduler-monte-carlo-experiment.md` (scheduler tuning), `lesson-dependencies.md` (lesson/rule dependency graph), `AGENTS.md` (philosophy + standards), `webapp-spec-prompt.md` (original spec).

## How this doc came to be
v1 was a per-card (Anki/FSRS-style) design. Deep adversarial review + two scheduler studies reshaped it around one insight: **this pedagogy learns rules, not cards.** v2 is the coherent result. Every decision is logged in the ledger; this doc is the whole.

## Philosophy (full version in AGENTS.md)
Rules/patterns are the unit of learning; items are interchangeable variance instruments; variance is the mechanism, not noise; conceptual grasp over coverage; **mastery ≠ retention**; the scheduler is ours and tunable, not pure FSRS/Anki.

## Architecture at a glance
Two planes + explicit **ports** (the seams that make it modular, testable, swappable).
- **Content plane** (read-only, disk→memory): `Rule`, `Item`, `ExerciseType`, `ExerciseItem` (ephemeral render target).
- **State plane** (SQLite, per-user, **all a fold of `ReviewLog`**): `User`, `RuleState`, `ItemExposure`, `ReviewLog`, `Session`.
- **Ports:** `Clock`, `ReviewRepository`, `Scheduler`, `SessionPlanner`, current-user (`locals.user`).

## Content plane
**`Rule`** (first-class) — `{ key (stable, e.g. "L13#3"), homeLesson, bundle, kind (transformation|paradigm|lexical|syntax|confusable|phonetic|meta), label, schedulable, importance, parentKey? }`. Mirrors `rules.md` numbering. Meta + phonetic rules are `schedulable:false` now (a text app can't grade stress/sound); they hold a dormant home that activates when audio/car/ASR modes arrive. Mastery rolls up rule→lesson→bundle by importance weight ⇒ "how am I doing by lesson" for free, and the skill-tree node model later.

**`Item`** (content; blind to how it's quizzed) — `{ id (short slug, NEVER the sentence), kind, front_en, back_es, hint?, rule_refs[] (plural, many-to-many, each entry carries a role: tests|uses), related_lessons[] ("read why this answer"), min_lesson, tier (primary|extended), source (hand_authored|generated), directions[], difficulty? (P1+), content_hash (derived) }` + additive per-kind fields (`blankSpans?`, `pair?`, `audioRef?`). `hint` is optional — only where a transferable rule/mnemonic merits it.

**`ExerciseType`** (strategy, code not data) — `{ stableKey, supports(item), inputModalities[], paramEnumerator, promptRenderer, grader }`. Phase 0 registers one: `transformation`.

**`ExerciseItem`** (ephemeral render target) — `(Item × ExerciseType × params)`. Generated **on demand** for a session, **not persisted, not the SRS unit**. Identity from composite columns (item slug, type `stableKey`, canonical `paramKey`) — never a stored concatenated string.

**Stores** — `ItemStore` globs/validates/indexes (by lesson/kind/tier + a rule→items inverted index). ExerciseItems generated **lazily** (deterministic) — no boot cross-join, no materialization ⇒ memory bounded (see ledger scale analysis; lazy-load by lesson if ever needed).

## Exercise composability (3 interfaces + payload types)
```ts
type SrsRating = 'again' | 'hard' | 'good' | 'easy'
interface RenderContext { items: ItemStore; currentLesson: number; rng: () => number }
type GradeContext = Pick<RenderContext, 'items'>
interface ParamEnumerator<P> { paramsFor(item: Item, ctx: RenderContext): { key: string; params: P }[] } // type OWNS the stable key
interface PromptRenderer<P>  { render(item: Item, params: P, ctx: RenderContext): Prompt }  // ctx → distractors + per-blank gating
interface Grader<P>          { grade(item: Item, params: P, response: Response, ctx: GradeContext): Grade }
interface ExerciseType {
  stableKey: string
  supports(item: Item): boolean
  inputModalities: InputModality[]     // orchestrator filters by session mode (e.g. car mode) without branching on concrete types
  paramEnumerator: ParamEnumerator<unknown>
  promptRenderer: PromptRenderer<unknown>
  grader: Grader<unknown>
}
```
`Prompt`/`Response` are discriminated unions carrying **input modality** + **resolved content** (not raw indices — graders stay `Prompt`-free). `Grade = { correct, score?, detail? }` is the grader's *assessment*; the final `SrsRating` is derived by a **central rating policy** from `(assessment, signals)` where `signals = { hintRevealed, selfReport? }`. Rule: **stable** relations (a confusable partner) bake into `params`/id; **dynamic** picks (MCQ distractors) resolve at render from `ctx` and are never part of identity (else they stale / leak gated content).

## Scheduling & mastery (rule-grain — the spine)
The SRS unit is the **rule**. Every attempt on any instrument of a rule updates two **independent** states:

- **Retention (timing).** FSRS via `ts-fsrs`, rule as the "card" — drives *when to refresh*. Off-label but bounded to timing (Duolingo's half-life regression keys memory strength on a *tag* too). Rating: `correct→Good`, `wrong→Again`, **hint-revealed caps at Hard**, "too easy"→Easy. State stored as an **opaque versioned blob** behind the `Scheduler` port (+ a derived indexed `due`) — not FSRS-named columns.
- **Mastery (competency).** A separate, isolated, **advisory** meter: recency+difficulty-weighted accuracy EWMA + distinct-instrument **coverage**. Deliberately **lenient** (~5% ongoing miss tolerated), **slow** (~20 spaced *varied* successes, not ~3), **coverage-gated**. Never touches due dates; only nudges progression + the weakest-rules queue. A **mastered rule exits active drilling** → light maintenance only, freeing the daily budget for new lessons.

Selection primitive = per-rule **priority** = `f(retention_decay, mastery_gap, coverage_gap, overdue, starred, bears_primary, newness)`. So `due` is **one term, not the sole driver**. Every knob (EWMA `α`, coverage `K`, `M_ready`, miss-tolerance, priority weights, FSRS retention target) is set by the **Monte Carlo experiment**, not guessed. Escape hatch: **SM-2-on-rule** (grain-agnostic, no difficulty param) — swappable via **log replay**, since state is a fold of `ReviewLog`.

**"Don't invent one" honored:** FSRS reference impl does the decay math; we change only *what the card keys on* (a modeling decision). The one invented piece (EWMA mastery) is deterministic arithmetic — isolated, unit-testable, recomputable from the log (or swap for `ts-elo`).

## Session orchestration (`SessionPlanner` port)
~10-min budget → target attempts `N`. Two stages, **seeded RNG** (deterministic tests):
1. **Pick rules** to fill `N`: pools = due + weak (`mastery < threshold`) + new-trickle (adaptive; shrinks when backlog high) + starred-forced. Score by priority. **Even distribution = round-robin across lesson buckets** (not a global priority sort, which bombards one overdue lesson), with per-lesson/per-rule caps.
2. **Pick each rule's instrument** (the variance engine): eligible = `{items with rule ∈ rule_refs, min_lesson ≤ current_lesson} × {types where supports(item)} × {directions}`. Prefer low `times_seen` (fresh), rotate types/directions (per-type session cap), exposure cooldown, difficulty-targeted (near current mastery — P1+), star/recent-miss bias, small RNG jitter.

**Exercise-type selection** ("I want these types today") = filter Stage-2 instruments to allowed types; rules with ≥1 eligible instrument stay, others skip today. Falls out of `supports()` + Stage 2 — **zero new architecture**. Direction is an instrument dimension biased to production (EN→ES), with a per-rule `schedule_by_direction` escape hatch if logs show divergence.

**End-of-session:** re-drill everything missed this session before closing (open q: re-tick retention vs reinforcement-only). **Edge cases designed in:** rule with 1 instrument (cooldown allows re-show → degenerates to a flashcard, correctly); rule with 0 eligible instruments at the dial (skip; **content invariant:** every schedulable rule needs ≥1 instrument eligible at its `homeLesson`); dial dropped mid-session (plan is a snapshot; now-gated instruments skipped at render; state untouched → reversible); caught up (offer weak/maintenance or a short "done" session).

## State plane (all a fold of `ReviewLog`)

**Ground-truth schema FROZEN 2026-07-10 (issue #2 — resolves review B1 `param_key`, B2 annotations-as-events, M7 direction key).** `ReviewLog` is the one artifact that cannot be cheaply changed after rows exist; every other per-user table is a deterministic **fold** of it. Freezing it correctly is the precondition for slice C (implemented in #14/#15; the decision is locked here).

- `User { id, current_lesson (floor 1) }` — a cache of `fold(log).currentLesson`.
- `RuleState (user_id, rule_key, direction)` — **the SRS unit**: opaque versioned retention blob + derived `due` + `mastery` + `coverage` + `first_exposed_at`. **`direction` is always a column**, sentinel `'both'` when the rule is not scheduled by direction (M7 — the `schedule_by_direction` escape hatch flips the *value*, never the key arity).
- `ItemExposure (user_id, item_id)` — **light**: `times_seen, last_seen_at, last_rating, known, starred`. Per-item, not per-instrument (so no `param_key` here).
- `Session (id, user_id, started_at, ended_at, mode, target_attempts, realized_count)`.
- `ReviewLog` (append-only, **ground truth**) — a single **kind-discriminated event stream**:

  | column | on kinds | notes |
  |---|---|---|
  | `id` | all | surrogate autoincrement; total fold order is **`(at, id)`** — `at` alone ties on same-ms events |
  | `user_id` | all | multi-user seam (queries filter by user even at n=1) |
  | `at` | all | epoch-int UTC ms, from the injectable `Clock` |
  | `kind` | all | `attempt \| star \| unstar \| set_known \| set_lesson \| session_start \| session_end` |
  | `item_id` | attempt, star, unstar, set_known | short slug (never the sentence) |
  | `rule_keys` | attempt | JSON array of the **tested** (schedulable) rule keys this attempt credits; denormalized so edited/orphaned content stays analyzable |
  | `exercise_type_key` | attempt | `ExerciseType.stableKey` |
  | `param_key` | attempt | **canonical** paramKey (**B1**); the type's `ParamEnumerator` owns it; empty params encode as `''` — present, never null |
  | `direction` | attempt | concrete direction (`en>es` / `es>en`); never the `'both'` sentinel |
  | `rating` | attempt | final `SrsRating` from the central rating policy |
  | `assessment` | attempt | grader `Grade { correct, score?, detail? }` (JSON) |
  | `hint_revealed` | attempt | bool |
  | `latency_ms` | attempt | nullable |
  | `content_hash` | attempt | over answer-defining fields, captured at attempt time |
  | `session_id` | attempt, session_start, session_end | FK to `Session` |
  | `annotation_known` | set_known | bool payload |
  | `annotation_lesson` | set_lesson | int payload (fold floors at 1) |
  | `session_mode`, `session_target_attempts` | session_start | the planner's decision, recorded at start |

  Columns not applicable to a row's `kind` are null (single-table event log). The composite **instrument identity = `(item_id, exercise_type_key, param_key, direction)`** is stored as columns, not a fat concatenated string ⇒ native analytics and a correct distinct-instrument `coverage`. `rule_keys` is the one legitimately-plural denormalization (attribution, not identity).

**The fold** (pure, isomorphic, in `@lt/domain` — no I/O):
```
fold(events, { scheduler, keyRemap }) -> { currentLesson, ruleStates, itemExposures, sessions }
```
Walk events in `(at, id)` order:
- **attempt** → for each `rule_key` in `rule_keys` (mapped through the committed `keyRemap`, M8/m7): **(1) timing** — `ruleState.blob = scheduler.apply(prevBlob, ratingForTiming, at)`, except a **same-day / intra-session re-drill does not re-tick timing** (reinforcement-only, M3 — collapse to the day's worst rating); **(2) mastery** — EWMA update + add the instrument identity `(item_id, exercise_type_key, param_key, direction)` to the rule's distinct-instrument set; `coverage = |distinct instruments|`, mastered when `coverage ≥ K` **and** EWMA ≥ threshold (M6 — a **count**, not a % of the live catalog, so new P1 types cannot silently un-master a rule). Also bump `ItemExposure(item_id)` (`times_seen`, `last_seen_at`, `last_rating`).
- **star / unstar** → `ItemExposure(item_id).starred = true / false`.
- **set_known** → `ItemExposure(item_id).known = annotation_known`.
- **set_lesson** → `currentLesson = max(1, annotation_lesson)`.
- **session_start / session_end** → open / close the `Session`; `realized_count` = attempts folded under that `session_id`.

Because star / known / lesson are **events**, a full rebuild from the log restores them — **B2 closed**: "all state is a fold of the log" is now literally true, not just for scheduling/mastery. Because `param_key` is logged, distinct-instrument `coverage` is reconstructable — **B1 closed**. The log is **immutable**; a reviewed rule rename is applied as a `keyRemap` *at fold time* (never a row rewrite), so history survives (m7). Timing state is an **opaque blob** behind the `Scheduler` port ⇒ swapping FSRS→SM-2 is a **replay**, not a migration. **Star lives on the item** and boosts its rule's priority, resurfaced through varied types.

## Identity & integrity
- `ExerciseType.stableKey` immutable/semantic; Item ids short slugs + optional surrogate int via a committed `slug→int` manifest; **canonical pinned `paramKey` encoding**; committed **id-manifest snapshot test** (CI fails if a known id disappears — silent data-loss → reviewable event). Ban delimiter collisions in raw ids.
- `content_hash` over **answer-defining fields only** (`back_es`, graded `front_en`, cloze span, `kind`, `directions` — not `hint`), captured on attempts + `ReviewLog`. Typo fixes = no-op; answer changes flag a schedule semantically stale (policy — reset/supersede/flag — is P1; the **hash is captured in P0**, can't backfill a baseline).
- `ReviewLog` denormalizes `item_id` + `rule_keys` + `content_hash` ⇒ orphaned/edited content stays analyzable; orphan rows accepted (tombstone preferred over silent resurrection).
- **Boot validation FATAL** on: duplicate composite ids; supported-but-zero-params items (silently undrillable); unresolved `rule_refs`.

## Multi-user & persistence seams (owner: real multi-user eventually)
- `user_id` FK on every per-user table + composite `UNIQUE(user_id, …)` from day one; `locals.user` hook (seeded constant now → session cookie later — **not Lucia** [deprecated]; `@oslojs`/`@auth/sveltekit`). Every query filters by user id even at n=1.
- `ReviewRepository` port (Drizzle = one impl); **domain logic isomorphic** (no Node-only imports) ⇒ runs client-side in the offline PWA (P3) without a rewrite.
- SQLite hygiene: WAL, `busy_timeout=5000`, `synchronous=NORMAL`, `foreign_keys=ON`, STRICT tables, one txn/attempt, typed columns + indexed `due`, epoch-int UTC, **forward-only committed migrations** (not `push`). Portable schema; **tripwire = >1 host serving the API → Postgres**. `contentVersion` stamp for offline sync.

## Phase 0 scope + walking-skeleton slices
**Scope:** rule-grain foundation, one exercise type (`transformation`, **accent-aware match** — see ledger Grading decision), the two-signal scheduler (FSRS timing + EWMA mastery, difficulty OFF), 2-stage planner + adaptive trickle, star, lesson gating, seed rules+items for lessons 1–5, API + tests + Playwright. **Both ports + injectable clock + test control-plane from day one.** Cut: everything else (roadmap/backlog).

**Build as vertical slices** (replaces v1's horizontal "easiest first"), each end-to-end + Playwright-verified when it lands:
- **A — skeleton:** hardcoded item → transformation render + normalized grade → in-memory session API → scrappy screen. PW: load/type/submit/reveal. Builds the API+UI+PW harness behind stable seams (one throwaway route).
- **B — content + gating:** `Rule` + `Item` YAML + stores, pure `LessonGate`, settings screen, **queue-inspector debug panel** (stable `data-testid`s + a defined ordering). PW: dial lesson, watch queue change.
- **C — persist + FSRS + clock:** `ReviewRepository`/Drizzle, `RuleState` (opaque blob) + `ItemExposure`, `Scheduler` port (FSRS timing + EWMA), `Clock` + test control-plane. PW: attempt → reload → advance-1-day → rule back due.
- **D — planner + star:** 2-stage selection, adaptive trickle, star, priority ordering, end-of-session re-drill. PW: seed a due state, star, assert reorder + varied instrument + starred list.

**Exit criteria** (automated + Playwright, observable via the queue inspector + test clock): gating hide/reveal; attempt→schedule moves; star→priority+list; trickle sizing; mastery accrues over simulated days. Plus the scheduler **simulation harness** invariants (hard items don't rot / easy don't over-drill) and the id-manifest snapshot test.

## Roadmap
- **P1:** exercise-type breadth (cloze, sentence) as new instruments + difficulty tags → difficulty-weighted mastery/selection; Manual Review (type picker, lesson-range, weakest-rules queue); pilot content pipeline.
- **P2:** listening/car mode (Piper TTS) + confusables/false-friends; phonetic rules flip `schedulable`; streak + skill-tree as data (rollup gives the node model free).
- **P3:** real mobile-first installable PWA.
- **Backburner:** ASR-graded speaking; SoundCloud ingestion; in-app lesson playback + auto-advance `current_lesson`; multi-user auth; content beyond lesson 30; and the ledger backlog (multi-lesson dialogues, transcribe-at-speed, free-text-graded answers, exercise-type-selection UI).
- Composability tally holds: new types = new Renderers/Graders reusing `NormalizedTextGrader`; **zero scheduler/orchestrator changes**.

## Verification standard
Per AGENTS.md: automated tests + Playwright MCP walkthrough every slice; injectable clock for deterministic time; scheduler simulation harness for the invariants; **distribution property tests** (seeded statistical bounds over many simulated sessions — type entropy, lesson spread, per-type caps incl. **dialogue ≤ 1/session**, no cooldown-repeat, no starvation; see `scheduler-monte-carlo-experiment.md`); id-manifest snapshot test; **evidence before claims**.

## Next steps
1. Anthony reviews this v2 + the requirements ledger.
2. Convert Phase 0 slices A–D into **GitHub Issues** (`anwyho/transferencia`) via `gh` — one issue per slice + sub-issues; milestones for P1/P2/P3/backburner; fold the dependency graph into content-authoring issues.
3. Implement slice by slice, verifying each — **not before issues exist and Anthony has seen the breakdown.**
