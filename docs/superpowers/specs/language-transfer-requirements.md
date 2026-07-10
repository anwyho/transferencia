# Language Transfer app — requirements & constraints ledger (LIVING)

**Status:** living document. Updated as decisions land. **Judge every design option against this.**
**Companions:** `2026-07-09-language-transfer-app-design.md` (design doc, being revised), `webapp-spec-prompt.md` (original spec), `scheduler-monte-carlo-experiment.md` (tuning experiment), `AGENTS.md` (working standards + philosophy).

## How to use this doc
- Every design option is scored against the Constraints + Requirements below. If it violates a hard constraint, it's out. If it serves more requirements with less coupling, it wins.
- The Decisions log records what we chose, why, and which requirements it serves.
- The Backlog is the scope-creep parking lot: captured deliberately, deferred deliberately, never lost.

## Hard constraints (from spec; amendments flagged)
- **Users:** single user now; **real `User` from day one**; owner wants **real/public multi-user + auth + per-user isolation eventually** → build multi-user seams additively now.
- **Decoupling:** content `Item`s decoupled from `ExerciseType`s; interfaces-first; each subsystem standalone, testable, mockable, swappable.
- **Lesson gating:** one reversible `current_lesson`; item visible iff `min_lesson ≤ current_lesson`.
- **SRS backbone.** [AMENDED 2026-07-09] "every *item* gets a schedule" → **"every schedulable *rule* gets a schedule; items get light exposure tracking."** Intent preserved (nothing important falls through; primary/LT-audio items stay warm via rule coverage + primary priority).
- **Content:** brand-new bank, decoupled from `cards/*.yml`; exhaustive per rule; pre-generated offline; **ceiling lessons 1–30**.
- **Platform:** installable PWA eventually; backend-first; scrappy UI + tests + Playwright each phase.
- **Verification non-negotiable:** automated tests + Playwright MCP walkthrough of real behavior, every phase.

## Derived requirements (from planning)
- **[MOD]** Maximize the surface that is useful with zero dependency on the rest. Ports for clock, persistence (repo), scheduler, session-planner. `Item` is blind to how it's quizzed.
- **[GRAIN]** Schedule + measure mastery against **rules/patterns/paradigms**, not cards. Items = interchangeable **variance instruments**.
- **[MASTERY]** Rule mastery ≠ card mastery. Rule mastery = **generalization** across varied items: ~20 spaced varied successes; **~5% miss tolerated**; a separate, isolated, advisory signal — never FSRS's internal difficulty, never blocks.
- **[FLEX]** Scheduler is **tunable / alternatively configurable**; explicitly **not pure FSRS/Anki**. Knobs set empirically, not guessed (see Monte Carlo).
- **[VARIETY]** ~10-min daily sessions; even distribution across lessons + exercise types (not bombarded); keep drilling **new lessons** while tracking **mastered** ones.
- **[LOG]** append-only `ReviewLog` is ground truth; all per-user state is a **fold of the log** → algorithm/grain swaps = replay, not migration.
- **[ELIGIBILITY]** rule ↔ exercise-type ↔ item is **many-to-many**. Some rules only support types {A,B,C}; some items only {D,E}. Eligibility is computed, not assumed.
- **[SELECT]** user can choose "these exercise types today" → system computes eligible rules + instruments under that filter.
- **[RELATED]** each item carries **related lessons**; user can read *why* an answer is what it is.
- **[DEPS]** lesson/rule **dependency graph** stored in the repo (e.g. past-tense depends on `haber` verbs).
- **[SCALE]** content is shared, loaded once (see Scale analysis); lazy-load by lesson if ever needed; **DB row growth is not a concern** (owner).
- **[DIST]** Selection is randomized (seeded), so we test **expected distribution over many simulated sessions**, not single sessions. Hard caps (per-type per-session — e.g. **dialogue ≤ 1/session**; no repeat within cooldown; due never skipped) + soft statistical bounds (type entropy, lesson-coverage spread, due/weak/new fractions, item freshness, no starvation). Lives in the simulation harness — see `scheduler-monte-carlo-experiment.md`.

## Scale analysis (napkin math)
Worst case = **all 90 lessons, exhaustive per rule** (real ceiling is lesson 30).
- Rules: ~10–15 schedulable/lesson × 90 ≈ **900–1,350** → trivial (<10 MB).
- Items: exhaustive; productive-suffix rules have hundreds of cognates, irregular-verb rules few. Aggregate envelope **~100k–300k** items. Hydrated ~0.5–1.5 KB each (short strings, **slug ids never full sentences**) → **~150 MB realistic, ~450 MB worst**.
- **ExerciseItems are NOT materialized** — ephemeral render targets, generated on demand → the cross-join explosion is off the table.
- Indexes (rule→items, lesson→items): tens of MB.
- **Resident content worst case ≈ 300–500 MB.** Node heap 2 GB default (raise to 4–8). Fine on a 2–4 GB server.
- **Permanent escape valve:** lazy-load items **by lesson** (gating already caps to ≤ `current_lesson`). A user on lesson 20 holds ~20/90 lessons resident, not all. Content shared across users (loaded once, not per-user).
- **Concerning only at ~1M+ items (~1–1.5 GB)** — unreachable for 90 lessons even exhaustive. Not a real risk. Rule-grain keeps per-user state tiny + due-queries sub-ms regardless.

## Decisions log
**2026-07-10**
- **ReviewLog ground-truth schema FROZEN** [issue #2; resolves report B1/B2/M7]: a single append-only **kind-discriminated** event log (`attempt | star | unstar | set_known | set_lesson | session_start | session_end`) — chosen over "attempt-log + separate annotation stream" — so **all** per-user state (incl. `starred`, `known`, `current_lesson`, sessions) is a deterministic fold of one ground truth (**B2 closed**). **`param_key` is a first-class column** (canonical encoding; empty params → `''`, never null), so distinct-instrument `coverage` is reconstructable (**B1 closed**). Instrument identity = `(item_id, exercise_type_key, param_key, direction)` stored as columns; `rule_keys` (the tested rules) is a denormalized JSON attribution array. Fold total order = `(at, id)`. `direction` is always a column with a `'both'` sentinel (**M7** — escape hatch flips value, not key arity). Rule renames apply as a committed `keyRemap` at fold time; log rows immutable (m7/M8). Timing = opaque blob behind the `Scheduler` port (FSRS→SM-2 = replay). Full schema + the pure `fold(events, { scheduler, keyRemap }) -> state` signature live in design-v2 §State plane. *Decided now to unblock slice C; implemented in #14/#15. Touchpoint in slice A: the `transformation` `ParamEnumerator` already emits the canonical `param_key` (`''`) so the log encoding is honest from the first attempt.*

**2026-07-09**
- **Stack:** SvelteKit + TS; SQLite + Drizzle (portable; tripwire = >1 host serving API → Postgres); pnpm/Vitest/Playwright. *(serves multi-user additively, offline-PWA-consistent)*
- **SRS:** FSRS via `ts-fsrs`, applied **at rule grain (timing only)** + a separate mastery meter. Honors "don't invent decay math." Escape hatch: **SM-2-on-rule** (grain-agnostic, no difficulty param).
- **Grain:** `RuleState` = SRS unit; `ItemExposure` = light counters; `ExerciseItem` = ephemeral render target (not persisted). *(serves [GRAIN][SCALE][VARIETY])*
- **Rating:** 4-level (Again/Hard/Good/Easy) from day one; hint-revealed caps at Hard; "too easy"→Easy; retry after reveal; **end-of-session re-drill of misses**.
- **Grading (accents)** [DECIDED 2026-07-09, resolves report M1]: answers graded **accent-aware** — accents carry meaning (*sí/si, él/el, -ción*). Users are **assumed able to type accents**. Typing convenience: a **capital vowel = its accented form** (*canciOn → canción*, *El → él*) so a Spanish keyboard isn't required. Sentence-initial capitals are ambiguous (*El* = "the" capitalized vs *él*) → the capital-as-accent rule **excludes position 0**; at sentence start accept either form. `Item` may carry `accepted_answers[]` for legitimately-variant answers; an accent-off answer grades **correct** with an accent-mismatch note in `Grade.detail` (does **not** lower `SrsRating`).
- **Identity:** `ExerciseType.stableKey` (immutable, semantic); **composite-column keys, not fat concatenated strings**; Item ids = short slugs (never the sentence) + optional surrogate int via a `slug→int` manifest.
- **Star:** on the **item** (star an example); boosts its rule's priority; resurfaced through **varied** types. *(serves [MASTERY] variance)*
- **Seams:** `user_id` on every per-user table + composite `UNIQUE`; `locals.user` hook; `ReviewRepository` port; **isomorphic domain logic** (no Node-only imports) for offline PWA; injectable `Clock` + env-gated test control-plane; `content_hash` over answer-defining fields.
- **Delivery:** vertical **walking-skeleton slices A–D**, not horizontal "easiest first."
- **Content gating/attribution invariant** (from `lesson-dependencies.md`): `rule_refs` entries carry a **role (`tests` | `uses`)**; `min_lesson` = the lesson teaching the *tested* rule, never raised by incidental foreshadowing (LT uses forms before formally teaching them — e.g. L8 uses `quiere` seven lessons before L15 explains the vowel split); **mastery credits only `tests` rules**. Dependency graph extracted: `lesson-dependencies.md` (draft v1 — 75 edges, 11 concept threads, lessons 1–30; teacher's lesson numbering is already a valid topological sort, so the gating dial needs no reordering).

## Open questions
- FSRS config + mastery knobs → **Monte Carlo** (`scheduler-monte-carlo-experiment.md`).
- Final rule-granularity taxonomy (schedulable flag; meta + phonetic rules dormant until audio modes).
- Direction as instrument dimension vs scheduled dimension (per-rule `schedule_by_direction` escape hatch) — decide from real logs.
- End-of-session re-drill: re-tick retention, or reinforcement-only?

## Backlog (scope-creep parking lot — deferred, NOT lost)
- **Exercise type:** transcribe speech **at speed, then slowly** (from real videos/audio).
- **Exercise type:** **free-text answer to a question** — grade grammaticality + does-it-answer. Harder to attribute to a rule (attempt still logs `rule_refs`; grader returns correctness/score, attribution is orthogonal; needs richer `Grade.detail`).
- **User-selectable exercise types per session** — model already supports it (falls out of `supports()` + 2-stage selection); UI later.
- **Related-lessons per item** + a "read why this answer" affordance.
- **Lesson/rule dependency graph** (research in progress → artifact in repo).
- **Exercise type: multi-lesson dialogues (Babbel-style).** A short, characterful two-person dialogue with multiple blanks; each blank carries `{rule_ref, min_lesson, answer}`. Per-blank gating via the render `ctx.currentLesson`: blanks above the dial are auto-filled (shown, not asked), blanks at/below are answerable. One dialogue = an instrument for *several* rules; each answered blank logs an attempt against its own rule. Fit: new `dialogue` content kind + renderer, **zero scheduler change** (validated by the ctx-based gating + multi-rule attribution already in the model). Way down the line.
- ASR-graded speaking; car mode; listening; confusables/false-friends; skill-tree; streaks; content beyond lesson 30 — per roadmap phases.
