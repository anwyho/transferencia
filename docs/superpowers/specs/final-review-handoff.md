# Final design-review handoff — Language Transfer practice app

**Purpose:** a self-contained prompt + context bundle for a high-capability ("Opus Ultra") instance to do **one final critical pass** on this design before it becomes GitHub issues. Everything decided across a long design collaboration is captured here or in the companion docs.

---

## Your charge

You are a staff-level engineer doing a **final, adversarial-but-constructive review** of a fully-formed app design. The design is the product of extensive brainstorming + four adversarial critics + two deep scheduler studies + a lesson-dependency extraction. It is close to done. Your job:

1. **Find remaining holes.** Correctness, edge cases, contradictions, unverifiable claims, hidden coupling. Stress-test the riskiest decisions (listed under "Stress-test these" below).
2. **Audit the three engineering virtues the owner cares most about — buildability, maintainability, modularity.** For each subsystem: can it be built incrementally and shipped as an independently-verifiable increment? Can it be understood and changed in isolation? Is its dependency surface as small as honestly possible?
3. **Confirm the increments are real.** Each walking-skeleton slice (A–D) must be end-to-end, Playwright-verifiable, and compelling-as-far-as-it-goes on its own.
4. **Then decide:** green-light, or a **prioritized list of precise changes** (blocker / major / minor). If green, produce the **Phase-0 GitHub issue breakdown** (one issue per slice A–D + sub-issues; milestones for P1/P2/P3/backburner).

**Do NOT:** re-litigate locked constraints unless one is genuinely broken; expand scope (flag scope creep, route it to the backlog); write app code; treat "it would be nice" as "it must ship in Phase 0."

## What to read first (the context bundle), in order
1. `docs/superpowers/specs/2026-07-09-language-transfer-design-v2.md` — the authoritative design.
2. `docs/superpowers/specs/language-transfer-requirements.md` — living constraints/requirements/decisions ledger + backlog (the rubric to judge options against).
3. `docs/superpowers/specs/scheduler-monte-carlo-experiment.md` — scheduler tuning + distribution tests.
4. `docs/lesson-dependencies.md` — lesson/rule dependency graph (draft v1).
5. `AGENTS.md` — working standards + the learning & design philosophy.
6. `docs/webapp-spec-prompt.md` — the original spec (some parts amended — see below).
7. Repo grounding: `README.md`, `docs/card-design.md`, `docs/lesson-bundles.md`, and a few `lessons/lesson_*/rules.md`.

## The app in brief
A Spanish practice app grounded in **Language Transfer**'s pedagogy: derive Spanish from English via **rules/patterns/paradigms**, not rote memorization. Duolingo-like practice loop, Mochi/Anki-like spaced repetition — but the unit of learning (and scheduling) is the **rule**, exercised through many varied example items. Single user today; **real multi-user eventually**. Installable PWA eventually; backend-first now. Content ceiling: lessons 1–30. Lives in a new subdir; the existing Anki/podcast pipeline is untouched.

## Philosophy (front and center — the owner emphasized this)
**Engineering:**
- **Buildability** — ship in vertical, independently-verifiable increments; disciplined scope; no boil-the-ocean; each slice works and is provable before the next.
- **Maintainability** — the append-only `ReviewLog` is ground truth and **all state is a fold of it** (swaps/retunes are replays, not migrations); stable ids are sacred (renames are reviewed remaps, guarded by a manifest snapshot test); knobs are set by evidence (Monte Carlo), not magic numbers.
- **Modularity** — maximize the surface usable/testable with **zero dependency on the rest**; `Item` is blind to how it's quizzed; time, persistence, scheduling, and session composition each sit behind a **port**.

**Learning (drives the architecture):** rules are the unit, not cards; items are interchangeable variance instruments; **variance is the mechanism, not noise**; conceptual grasp over coverage; **mastery ≠ retention**; the scheduler is ours and tunable, not pure FSRS/Anki.

## Hard constraints (locked; amendments flagged)
- Single user now; **real `User` from day one**; multi-user + auth + isolation eventually → build seams additively now.
- Decouple content `Item`s from `ExerciseType`s; interfaces-first; each subsystem standalone/testable/mockable/swappable.
- Lesson gating: one reversible `current_lesson`; visible iff `min_lesson ≤ current_lesson`.
- **SRS backbone. [AMENDED]** "every *item* gets a schedule" → **"every schedulable *rule* gets a schedule; items get light exposure tracking."**
- Content: brand-new bank, decoupled from `cards/*.yml`; exhaustive per rule; pre-generated offline; **ceiling lessons 1–30**.
- Installable PWA eventually; backend-first; scrappy but automatable UI.
- **Verification non-negotiable:** automated tests + Playwright MCP walkthrough of real behavior every phase.

## Derived requirements (judge every option against these)
`[MOD]` dependency-free surface + ports · `[GRAIN]` schedule/measure against rules, items = instruments · `[MASTERY]` rule mastery ≠ card mastery (generalization; ~20 spaced varied successes; ~5% miss tolerated; separate, advisory, never blocks) · `[FLEX]` scheduler tunable, not pure FSRS/Anki; knobs set empirically · `[VARIETY]` 10-min sessions, even distribution across lessons+types, keep drilling new lessons while tracking mastered · `[LOG]` append-only ground-truth log, all state a fold of it · `[ELIGIBILITY]` rule↔type↔item many-to-many · `[SELECT]` user can pick "these types today" → compute eligible rules+instruments · `[RELATED]` items carry related lessons ("read why") · `[DEPS]` lesson/rule dependency graph in repo · `[SCALE]` content shared/loaded-once, lazy-load by lesson if needed, DB rows not a concern · `[DIST]` test *expected* distribution over many seeded sessions (hard caps incl. dialogue ≤1/session + soft statistical bounds).

## Domain model (summary — full detail in v2)
- **Content (read-only):** `Rule` (first-class, `kind`, `homeLesson`, `schedulable`, `importance`), `Item` (blind to quizzing; `rule_refs[]` each with role `tests`|`uses`; `related_lessons[]`; slug id, never a sentence), `ExerciseType` (strategy: `stableKey`, `supports`, `inputModalities`, + 3 composed interfaces `ParamEnumerator`/`PromptRenderer`/`Grader` taking a `ctx`), `ExerciseItem` (ephemeral render target — generated on demand, NOT persisted, NOT the SRS unit).
- **State (SQLite, per-user, a fold of `ReviewLog`):** `User`, **`RuleState`** (the SRS unit — opaque retention blob + mastery + coverage), **`ItemExposure`** (light counters + `starred`), `ReviewLog` (append-only ground truth, denormalized `item_id`/`rule_keys`/`content_hash`), `Session`.
- **Ports:** `Clock`, `ReviewRepository`, `Scheduler`, `SessionPlanner`, current-user (`locals.user`).
- **Payload types:** `Prompt`/`Response` discriminated unions (carry input modality + resolved content); `Grade = {correct, score?, detail?}`; a central rating policy derives the 4-level `SrsRating` from `(assessment, {hintRevealed, selfReport})`.

## Scheduling & mastery (the spine — stress-test hard)
Rule is the SRS unit. Two **independent** per-rule signals: **retention/timing** = FSRS (`ts-fsrs`) with the rule as the "card" (off-label, bounded to timing; Duolingo's half-life regression keys memory strength on a tag too), state stored as an **opaque versioned blob** behind the `Scheduler` port; **mastery/competency** = a separate, isolated, **advisory** EWMA + coverage meter (lenient — ~5% miss OK; slow — ~20 spaced varied successes; coverage-gated; mastered ⇒ exits active drilling → maintenance). Selection primitive = per-rule **priority** = `f(retention_decay, mastery_gap, coverage_gap, overdue, starred, bears_primary, newness)` — `due` is one term, not the sole driver. All knobs set by the **Monte Carlo** (invariants: hard items don't rot, easy don't over-drill). Escape hatch: **SM-2-on-rule**, swappable via log replay. Rating: correct→Good, wrong→Again, **hint-revealed caps at Hard**, "too easy"→Easy.

## Session orchestration + distribution
`SessionPlanner` port, 2 stages, seeded RNG: (1) pick rules to fill the ~10-min budget — due + weak + new-trickle + starred-forced, scored by priority, spread by **round-robin across lesson buckets** (not a global priority sort); (2) pick each rule's instrument for **variance** — fresh item, rotate type/direction, cooldown, difficulty-targeted, star/miss bias. Exercise-type selection and per-blank dialogue gating fall out of `supports()` + `ctx.currentLesson` with zero new architecture. **Distribution is guaranteed by tests** (see `[DIST]` + the MC doc): seeded statistical property tests over many simulated sessions — hard caps (dialogue ≤ 1/session, no cooldown-repeat, due-never-skipped) + soft bounds (type entropy, lesson spread, due/weak/new fractions, no starvation). End-of-session: re-drill misses.

## Identity, integrity, multi-user, offline
Composite keys stored **as columns** (not fat strings) → native analytics; `ExerciseType.stableKey` + slug ids (+ optional surrogate int) + canonical param keys + **id-manifest snapshot test**; `content_hash` over answer-defining fields (fix-bad-example without breaking history — hash captured P0, policy P1). `user_id` on every per-user table + composite `UNIQUE` + `locals.user` hook from day one; `ReviewRepository` port + isomorphic domain logic (no Node-only imports) → offline PWA runs it client-side without a rewrite. SQLite hygiene (WAL, busy_timeout, STRICT, indexed `due`, forward-only migrations); portable schema; tripwire = >1 host → Postgres.

## Delivery — walking-skeleton slices (Phase 0)
**A** skeleton (hardcoded item → transform render + normalized grade → in-mem session API → scrappy screen; PW load/type/submit/reveal). **B** content + gating (Rule/Item YAML + stores, pure `LessonGate`, settings, queue-inspector panel; PW dial lesson). **C** persist + FSRS + clock (repo/Drizzle, RuleState/ItemExposure, Scheduler port, injectable Clock + test control-plane; PW attempt→reload→advance-day→due). **D** planner + star (2-stage selection, trickle, star, priority, end-of-session re-drill; PW seed→star→reorder + starred list). Each end-to-end + Playwright-verified when it lands.

## Open questions (resolve or confirm deferral)
FSRS/mastery knob values (→ MC); final rule-granularity taxonomy (meta/phonetic dormant); direction as instrument vs scheduled dim (per-rule escape hatch); end-of-session re-drill re-ticks retention or not; pre-existing doc bug: `docs/cross-references.md` lists L21 building on "6 (haber)" but `haber` is introduced in L21 (L6 = silent-h) — fix label.

## Backlog (all ideas captured; deferred, not lost)
Multi-lesson **dialogues** (Babbel-style; per-blank gating via `ctx`; ≤1/session); **transcribe speech at speed then slowly** (from real video/audio); **free-text answer to a question** (grade grammaticality + does-it-answer; richer `Grade.detail`; rule attribution via `rule_refs`); **user-selectable exercise types** UI; **related-lessons "read why"** affordance; per-rule mastery meter + weakest-rules queue; ASR/car/listening/confusables/skill-tree/streaks; content beyond lesson 30.

## Your deliverable
A concise report: (1) buildability/maintainability/modularity audit per subsystem; (2) prioritized findings (blocker/major/minor) with concrete failure scenarios + fixes; (3) a verdict; (4) if green, the Phase-0 issue breakdown (slices A–D + sub-issues + milestones). Stress-test especially: **FSRS-off-label-on-rule** (does the timing stay sane? is the SM-2 escape hatch real?), the **rule-grain state-as-a-fold-of-log** claim, the **distribution guarantees**, the **multi-user + offline "additive, not rewrite"** claims, and whether Phase-0 slices are genuinely independently verifiable.
