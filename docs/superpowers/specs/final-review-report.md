# Final design review — Language Transfer practice app

**Reviewer role:** staff-level final adversarial pass before GitHub-issue breakdown.
**Inputs read:** `2026-07-09-language-transfer-design-v2.md`, `language-transfer-requirements.md`, `scheduler-monte-carlo-experiment.md`, `lesson-dependencies.md`, `AGENTS.md`, `webapp-spec-prompt.md`, `cross-references.md`, `README.md`, `card-design.md`, `lesson-bundles.md`, and sampled `lessons/lesson_{01,02,13}/rules.md`.
**Date:** 2026-07-09

---

## Verdict: **GREEN-LIGHT WITH CONDITIONS**

The architecture is sound and the increments are real. The spine — rule-grain SRS, ports, log-as-ground-truth, vertical slices, knobs-by-Monte-Carlo — holds up under stress. I am **not** asking to re-open any locked constraint.

Two conditions gate the issue breakdown, and both are cheap now / expensive later because they concern the one artifact this architecture cannot cheaply fix after the fact — the append-only `ReviewLog`:

- **B1 — `ReviewLog` is missing `param_key`.**
- **B2 — user annotations (star / known / lesson changes) are not log events**, so "all state is a fold of the log" is currently false.

Resolve B1+B2 (freeze the ground-truth schema correctly) before the slice-C issue is written. Everything else can be folded into slice issues as explicit acceptance criteria. Nine majors and nine minors follow, each with a failure scenario and a concrete fix.

---

## What is genuinely solid (credit before critique)

- **Rule-grain insight.** Scheduling/measuring the *rule* and treating items as variance instruments is the correct reading of the pedagogy, and it collapses the card-explosion + scale problem cleanly. This is the design's best move.
- **Ports + fold.** `Clock` / `ReviewRepository` / `Scheduler` / `SessionPlanner` as seams, with per-user state derived from the log, is exactly what makes retunes replays and makes the offline/multi-user stories additive. The abstraction is real, not decorative.
- **Vertical slices A–D.** Replacing "horizontal easiest-first" with end-to-end increments is right, and (with the caveats below) each slice is independently Playwright-verifiable.
- **Restraint.** "Don't invent decay math" (FSRS behind a port) + "knobs by Monte Carlo, not magic numbers" + id-manifest snapshot test + boot-validation-FATAL are the disciplined choices a reviewer hopes to see.
- **Dependency graph → topological claim.** `lesson-dependencies.md` earns its central claim: every hard edge in L1–30 points backward, so the teacher's numbering is a valid topological sort and the linear `current_lesson` dial needs no reordering. Verified against `cross-references.md`.

---

## Buildability / Maintainability / Modularity audit

| Subsystem | Buildable increment? | Maintainable? | Modular / dep surface | Verdict |
|---|---|---|---|---|
| **Content stores** (`Rule`/`Item`/`ExerciseType`/`ItemStore`) | Yes — slice B, YAML + glob/validate/index | Risk: `Rule.key` derived from **positional** `rules.md` numbering (M8) | Clean; read-only, disk→memory, no state dep | OK w/ M8 |
| **Exercise composability** (3 interfaces + payloads) | Yes — one type (`transformation`) in A | Good — `stableKey` owned by type; grader is `Prompt`-free | Excellent — `Item` blind to quizzing; `ctx` carries gating/distractors | Strong |
| **Grader** (normalized-match) | Yes — slice A | **Underspecified** for Spanish (M1) | Isolated behind `Grader<P>` | Needs M1 |
| **Scheduler** (FSRS timing + EWMA mastery) | Yes — slice C | Replay-safe **iff** port is a pure fold + log complete (B1/B2) | Good — opaque blob behind port; SM-2 escape hatch is real | OK w/ B1/B2, M3/M4/M6 |
| **SessionPlanner** (2-stage, seeded) | Yes — slice D | Deterministic under seed; testable | Good — port; consumes priority, emits plan | OK w/ M5 |
| **Persistence / Repo** (Drizzle/SQLite) | Yes — slice C | Forward-only migrations; STRICT/WAL — sound | Port w/ one impl; **but** isomorphic boundary unenforced (M9) | OK w/ M9 |
| **Identity & integrity** (manifest, `content_hash`) | Yes — incremental | Strong intent; `content_hash` scope caveat (m6); remap step unspecified (m7) | Self-contained | OK |
| **Multi-user seams** | Yes — free from day one | `user_id`+composite-UNIQUE+`locals.user` is the correct additive path | Content shared, state per-user — clean split | Strong |
| **Verification harness** (dist. tests + sim) | Separate tool; buildable | One invariant unsatisfiable as stated (M5); "CI" language imprecise (m2) | Reuses real ports — good | OK w/ M5 |

**Bottom line:** modularity is the strongest axis (the ports are real). Buildability is good (slices are genuine, though C is overloaded — m9). Maintainability is the one with holes, and they cluster on the **log schema** (B1/B2) and on **id stability** (M8) — precisely the "sacred, un-backfillable" surfaces the design says it cares most about.

---

## BLOCKERS (resolve before the slice-C issue / before anything writes to the log)

### B1 — `ReviewLog` omits `param_key`
`ExerciseItem` identity is defined as *(item slug, type `stableKey`, canonical `paramKey`)* (+ direction), but `ReviewLog` stores only `item_id, exercise_type_key, direction`. `paramKey` is dropped.

- **Failure scenario:** A `ParamEnumerator` returns several params per item (e.g. a confusable rule tested against different partners; a conjugation type enumerating person/number). Two attempts log identical `(item, type, direction)` but were different instruments. Coverage (distinct-instrument count) folded from the log is now **wrong** — it under-counts instruments, so a rule reaches `M_ready`/coverage-`K` prematurely, and "distinct-instrument coverage" (a mastery gate) is unreconstructable. Directly violates "composite keys stored as columns → native analytics."
- **Fix:** add `param_key` as a first-class column on `ReviewLog` (and on `ItemExposure` if exposure is meant to be per-instrument). Enforce the canonical paramKey encoding in slice A even though only one trivial param exists then.

### B2 — user annotations are not log events → "all state is a fold of the log" is false today
`ReviewLog` is an **attempt** record (no event-kind field). But `starred` lives on `ItemExposure`, `known` is a user override, and `current_lesson` is mutable user state. None are appended to the log. AGENTS.md explicitly requires "any per-user state (schedules, mastery, **exposure**) rederivable by replaying the log."

- **Failure scenario:** Rebuild `RuleState`/`ItemExposure` from the log (the stated retune/grain-swap path) → **every star is lost**, so priority boosts and the starred list silently reset. The flagship maintainability guarantee is violated by its own headline feature.
- **Fix (choose one, decide now):**
  - **(a) True event log** — add `kind` to `ReviewLog` (`attempt | star | unstar | set_known | set_lesson`), non-attempt events carry null grading fields. Cleanest; keeps one ground truth. *Recommended.*
  - **(b) Carve-out** — restate the invariant as "all *scheduling/mastery* state folds from the attempt log; user annotations are a separate append-only stream," and add that second stream. Then the "fold" claim is honest and star survives replay.

*(B1 and B2 are one decision in practice: get the append-only ground truth right before slice C writes the first immutable row.)*

---

## MAJORS (fold into the named slice's issue as acceptance criteria)

### M1 — Grading policy for Spanish is undefined; "normalized-match" is wrong in both directions *(slice A)*
Accents *are* meaning in this course (L2 stress, L67 accent rules, `sí/si`, `él/el`, `-ción`). And many prompts have multiple valid answers (formality `quieres/quiere`, word-order/pronoun-placement variants). `Item` carries a single `back_es`.

- **Failure scenario:** Strip accents → `cancion` graded correct for `canción` (teaches the wrong thing in an app whose thesis is accents/derivation). Keep accents strict → a learner on a phone without a Spanish keyboard is marked wrong constantly. Single-string exact-match false-rejects `quiere` when `quieres` was typed and both are valid.
- **Fix:** decide the grader contract now — accent-*aware* correctness with an accent-mismatch soft signal in `Grade.detail` (correct-but-flagged, not "Again"), and give `Item` an `accepted_answers[]` (or a normalization that accepts declared variants). The `SrsRating` policy consumes the soft signal. This is the literal core of slice A; it cannot stay implicit.
- **RESOLVED (2026-07-09):** accent-aware grading; users assumed to type accents; **capital vowel = accented vowel** as a no-accent-keyboard affordance (`canciOn`→`canción`, `El`→`él`), **excluded at sentence-initial position** (ambiguous — accept either form there); `accepted_answers[]` on `Item`; accent-off answer = **correct** + `Grade.detail` note, no `SrsRating` penalty. Recorded in the requirements ledger; implemented in issue A.2.

### M2 — Phase-0 seed (L1–5) vs. a single word-level exercise type → boot invariant will FATAL *(slice B/D + content)*
`transformation` (per `card-design.md`) is single-word EN→ES derivation. But L4 `quiero`/spine verbs and L5 `me/te/lo` placement are **sentence-level** rules with no word-level transformation instrument. The design's own boot validation is FATAL on "supported-but-zero-params" and requires "every schedulable rule needs ≥1 instrument eligible at its `homeLesson`."

- **Failure scenario:** Seed all schedulable L1–5 rules → L4/L5 spine + pronoun rules have zero transformation instruments → boot FATAL, or they sit undrillable and the slice-D planner over "lessons 1–5" silently can't touch the most interesting rules.
- **Fix:** either (a) scope Phase-0 seed rules to the transformation-eligible subset (the convertible-word suffix rules `-al`/`-ant/-ent`/`-ible`/`-mente`/`-ación→-ar`/`-encia`; mark spine/pronoun rules `schedulable:false` *for Phase 0* with a dormant home, same pattern as meta/phonetic), or (b) define `transformation`'s grader to accept short phrases and seed a few phrase items. Pick (a) — it keeps slice A's grader trivially honest and defers sentence-grading to P1 where it belongs.

### M3 — FSRS same-day repeats / end-of-session re-drill corrupt intervals *(slice C/D)*
The open question "re-drill re-ticks retention or not?" is really an FSRS-integrity question. FSRS assumes ~one review per due event; feeding it a second same-day rating (`elapsed_days≈0`) distorts stability.

- **Failure scenario:** Miss a rule → re-drill at session end → second "Good" same day → FSRS treats it as a successful review at ~0 elapsed → stability/interval math skews; a rule you just failed drifts to a longer interval.
- **Fix:** decide **reinforcement-only** — re-drills and any intra-session second exposure update `ItemExposure` + mastery but do **not** emit a second FSRS rating for the rule that day (or collapse to the day's worst rating). Make it a `Scheduler`-port rule, not planner-local.

### M4 — FSRS-on-rule interval oscillation under heterogeneous item difficulty (difficulty OFF in P0) *(MC + slice C)*
Each attempt is a *different* item of varying difficulty, but Phase 0 has no difficulty signal into FSRS. Ratings are then a blur of easy-cognate "Good" and irregular-exception "Again."

- **Failure scenario:** planner shows an easy item → Good → interval lengthens → next shows a hard item → Again → stability collapses → interval thrashes, driven by *sampling*, not memory. The MC's "hard items don't rot" invariant tests the *mastery* meter, not *interval stability*.
- **Fix:** add an explicit MC invariant/objective — **interval stability under heterogeneous sampling** (bounded variance of successive intervals per rule; no thrash). If it fails, either move difficulty into FSRS earlier than P1 or damp the rating→FSRS mapping.

### M5 — "A due item is never skipped" is unsatisfiable under a fixed budget *(distribution tests)*
Stated as a hard invariant, but a ~10-min budget (N attempts) with more-than-N due rules **must** skip some. Round-robin + per-lesson caps make it worse.

- **Failure scenario:** 40 rules due, budget 25 → 15 due rules unserved today → the invariant is literally false → the property test is either written to fail or quietly weakened to nothing.
- **Fix:** restate as two testable claims: (1) **no due rule is displaced by a non-due (new-trickle/variety) selection while due backlog > budget**; (2) **overdue rules are served in priority order and backlog carries forward** (bounded, no starvation). These are assertable on every seeded session; the absolute version is not.

### M6 — Mastery `coverage` denominator undefined → non-monotonic across content releases *(scheduler/mastery + MC)*
"Coverage-gated" mastery needs a denominator. If it's "% of all currently-eligible instruments," adding types in P1 dilutes every rule's coverage overnight.

- **Failure scenario:** rules "mastered" in P0 (over transformation instruments) drop below coverage when P1 adds cloze/sentence → mass re-activation → sessions flood with supposedly-mastered rules.
- **Fix:** the MC knob list already says "coverage min **K** per rule kind" — commit to that reading explicitly: coverage = **count of distinct instruments seen ≥ K**, not a percentage of the live catalog. Then new types don't un-master. State it in the design so the %-interpretation can't creep in.

### M7 — `RuleState (user_id, rule_key[, direction])` has a variable-shape primary key
The optional `direction` (per-rule `schedule_by_direction` escape hatch) means the PK is sometimes `(user,rule)` and sometimes `(user,rule,direction)`.

- **Failure scenario:** turning the escape hatch on for one rule reshapes the table's key semantics; composite-UNIQUE and fold logic must special-case two key arities; the "composite columns not fat strings" principle is quietly bent.
- **Fix:** fixed schema — always store a `direction` column with a canonical sentinel (`'both'`) when not scheduling by direction. Escape hatch flips the value, never the key arity.

### M8 — `Rule.key` "mirrors `rules.md` numbering" but that numbering is positional and unstable *(content identity)*
`rules.md` is a plain ordered markdown list that **mixes pedagogy and grammar** (L13: rules 1/4/10 are method, 3/9 are grammar; L1/L2 are largely method). Inserting or reordering a rule renumbers everything below it.

- **Failure scenario:** author inserts a clarifying rule into `lesson_13/rules.md` → old `L13#3` (s/n endings) becomes `L13#4` → every `RuleState`/`ReviewLog` row keyed `L13#3` now points at the wrong rule. The "stable ids are sacred" apparatus is defeated at its source.
- **Fix:** freeze `Rule.key` in an **independent committed manifest** (part of the id-manifest snapshot test), decoupled from `rules.md` ordinals. `rules.md` is grounding/inspiration, not the key space. Renames go through the reviewed-remap table (see m7).

### M9 — Isomorphic domain boundary is asserted but not enforced *(slice C)*
The offline story depends on domain logic having no server-only imports. Nothing stops a `better-sqlite3`/`node:fs` import from leaking into the domain package.

- **Failure scenario:** by P3 the "runs client-side without a rewrite" claim is quietly false because months of domain code imported Node APIs.
- **Fix:** add an enforced module-boundary lint (domain package forbids `node:*`, `better-sqlite3`, `fs`, SvelteKit server modules) when the repo/Drizzle split lands in slice C. Cheap, and it keeps the claim true continuously.

---

## MINORS (note / clarify / backlog)

- **m1 — hint-reveal→Hard (FSRS timing).** Hard still grows stability and pushes the due date out; a hint-dependent rule can drift long. Consider hint-reveal→**Again** for *timing* while the mastery meter takes the graded penalty, or make it an MC knob (it's already a mastery knob; it's hard-coded for timing).
- **m2 — distribution-test "confidence interval" language.** With a pinned seed corpus the tests are **deterministic golden checks**, not statistical. Call them that; a failure = a real regression, not flake. Reserve true CIs for the offline MC search, not CI.
- **m3 — round-robin level.** Define whether stage-1 round-robin is across *lessons*, *bundles*, or *rules*. Even-across-lessons starves rules in rule-dense lessons (rules are the unit). Ensure the MC "no starvation" objective targets **rule-level** coverage.
- **m4 — offline "no rewrite" oversells.** P3 needs three net-new pieces behind existing ports: a client persistence adapter (IndexedDB/WASM-SQLite), content sync + client-side content storage (150–450 MB envelope; lazy-by-lesson), and append-log **merge/conflict-resolution** for multi-device. Additive, yes; free, no. Qualify the claim.
- **m5 — "no boot cross-join" vs "boot-validate every supported item has ≥1 param."** These read as contradictory. Distinguish param **enumeration** (cheap, at boot, for validation) from prompt **rendering/materialization** (lazy). State it.
- **m6 — `content_hash` "typo fixes = no-op" is over-broad.** Spanish accent corrections are *answer-defining* → they churn the hash by design. Expected, but document it so accent fixes aren't mistaken for a bug in the "typo = no-op" claim.
- **m7 — rule-key remap application in the fold.** Specify that replay applies a committed key-remap table so historical log rows survive a reviewed rename (pairs with M8/B2).
- **m8 — known doc bug.** `cross-references.md` per-lesson table lists L21 building on "6 (*haber*)"; `haber` debuts in L21, L6 is silent-h. `lesson-dependencies.md` §c(1) already flags it — fix the label to "6 (silent h)."
- **m9 — slice C is overloaded** (persist + FSRS + EWMA + clock in one increment). Sub-split: **C1** repo/Drizzle/migrations/`ItemExposure` + injectable clock with a *trivial* scheduler (always due +1d); **C2** swap in FSRS timing + EWMA mastery. Two thin, separately verifiable increments.

---

## Stress-test scorecard (the five the charge named)

1. **FSRS-off-label-on-rule — CONDITIONALLY SOUND.** Timing stays sane only after M3 (same-day/re-drill) and M4 (oscillation invariant) are addressed; hint mapping (m1) worth tuning. The **SM-2 escape hatch is real**: the log holds ordered `(rule_key, rating, at)`, the `Scheduler` port is an opaque-blob fold, so SM-2 replays from scratch — provided the port is specified as a pure fold in slice C and the log is complete (B1/B2).
2. **State-as-a-fold-of-log — BROKEN AS WRITTEN, FIXABLE.** True for FSRS/mastery/coverage/exposure-counters; **false for `starred` and other annotations** (B2) and **lossy without `param_key`** (B1). Fix the log schema and the claim becomes true.
3. **Distribution guarantees — SOUND EXCEPT ONE INVARIANT.** Hard caps (dialogue ≤1, cooldown, budget) are deterministically assertable and solid. "Due never skipped" is unsatisfiable as stated (M5). Clarify the deterministic-golden framing (m2) and round-robin level (m3).
4. **Multi-user + offline "additive, not rewrite" — MULTI-USER SOUND, OFFLINE OVERSOLD BUT CORRECTLY-SEAMED.** The `user_id`/composite-UNIQUE/`locals.user` path is genuinely additive. Offline's *seams* are right (ports + isomorphic logic), but it needs three non-trivial new pieces (m4) and an enforced boundary now (M9), so "without a rewrite" should be scoped to the domain layer.
5. **Phase-0 slice independence — REAL, with two caveats.** A/B/C/D are each end-to-end and Playwright-verifiable via the queue-inspector + test clock. Caveats: C is overloaded (m9) and D depends on resolving the re-drill question (M3). No slice is a horizontal dead-end.

---

## Phase-0 GitHub issue breakdown (`anwyho/transferencia`)

Proposed on green-with-conditions. **Do B1/B2 first (issue 0.2 blocks slice C).** One epic per slice + sub-issues; majors appear as acceptance criteria on the slice they belong to.

**Milestone: Phase 0 — Foundation**

- **#0.1 Repo scaffold** — new app subdir, SvelteKit+TS, pnpm/Vitest/Playwright, package layout with a **domain package** (isomorphic). *AC: `make`/scripts + empty test run green in CI.*
- **#0.2 Freeze the ground-truth schema (BLOCKER)** — resolve B1+B2: `ReviewLog` event model with `param_key` + `kind` (or attempt-log + annotation-stream); canonical `paramKey` encoding; decide star/known/lesson as events. *AC: a fold reconstructs `RuleState`+`ItemExposure`+`starred` from a hand-written log fixture.* **Blocks #C.**
- **#0.3 Identity manifest + snapshot test** — committed `Rule.key` manifest (M8, independent of `rules.md`), item `slug→int`, remap table (m7), id-manifest CI test. *AC: deleting a known id fails CI.*
- **Epic #A — Walking skeleton.** hardcoded item → `transformation` render → grader → in-mem session API → scrappy screen.
  - #A.1 `ExerciseType`/`Prompt`/`Response`/`Grade` interfaces + `transformation` (one).
  - #A.2 **Grader policy (M1)** — accent-aware correctness + `accepted_answers[]` + soft accent signal.
  - #A.3 in-mem session API + scrappy screen + `data-testid`s.
  - #A.4 Playwright: load/type/submit/reveal.
- **Epic #B — Content + gating.** `Rule`/`Item` YAML + `ItemStore` (glob/validate/index + rule→item inverted index); pure `LessonGate`; settings; **queue-inspector** (stable testids + defined order).
  - #B.1 schemas + stores + boot validation (FATAL cases).
  - #B.2 **seed L1–5 scoped to transformation-eligible rules (M2)**; spine/pronoun rules `schedulable:false` for P0.
  - #B.3 `LessonGate` + settings + inspector panel.
  - #B.4 Playwright: dial lesson, watch queue change.
- **Epic #C — Persist + scheduler + clock.** (Blocked by #0.2.)
  - #C.1 `ReviewRepository`/Drizzle, migrations (forward-only, STRICT/WAL), `ItemExposure`, injectable `Clock` + test control-plane, **trivial scheduler**; **domain-boundary lint (M9)**.
  - #C.2 `Scheduler` port = pure fold; FSRS timing (opaque blob) + EWMA mastery; **coverage=count≥K (M6)**; **re-drill reinforcement-only (M3)**; direction-sentinel key (M7).
  - #C.3 Playwright: attempt → reload → advance-1-day → rule back due.
- **Epic #D — Planner + star.** 2-stage seeded selection; adaptive trickle; star→priority+list; **priority-ordering distribution invariants (M5)**; end-of-session re-drill.
  - #D.1 stage-1 rule pick (round-robin, caps — define level, m3) + adaptive trickle.
  - #D.2 stage-2 instrument pick (freshness/rotation/cooldown/star bias).
  - #D.3 star + starred list; priority function (`due` = one term).
  - #D.4 Playwright: seed due → star → assert reorder + varied instrument + starred list.
- **#0.4 Scheduler simulation + distribution harness** (separate tool, `experiments/scheduler-sim/`) — invariants (hard-items-don't-rot, easy-don't-over-drill, **interval-stability M4**) + deterministic distribution golden tests (m2). *Not app runtime; can land alongside C/D.*

**Later milestones (labels/placeholders only, per "don't spec ahead"):**
- **P1** — exercise-type breadth (cloze, sentence as new instruments); difficulty tags → difficulty-weighted mastery/selection; Manual Review (type picker, lesson-range, weakest-rules); pilot content pipeline; `content_hash` staleness policy.
- **P2** — listening/car mode (Piper TTS reuse); confusables/false-friends; phonetic rules flip `schedulable`; streak + skill-tree as data.
- **P3** — real installable PWA; offline (client persistence adapter, content sync/storage, log merge — m4).
- **Backburner** — ASR speaking; SoundCloud ingestion; in-app lesson playback + auto-advance; multi-user auth; content beyond L30; ledger backlog (dialogues, transcribe-at-speed, free-text-graded).

**Content-authoring issues** — fold `lesson-dependencies.md` in: each seed rule tagged with its dependency thread for the "related lessons" surface; `max(lessons)` (home) honors the `tests`-vs-`uses` role so foreshadowing (`quiere`@L8, `me duermo`@L16) never gates early; fix the m8 label.

---

## Open questions to resolve (or confirm deferral)

- **Resolve before slice C:** B1/B2 log schema; M3 re-drill/FSRS; M6 coverage denominator.
- **Resolve before slice A ships:** M1 grader policy.
- **Resolve before content issues:** M2 Phase-0 rule scope; M8 rule-key manifest.
- **Confirm deferral:** difficulty→FSRS (P1, but watch M4); `schedule_by_direction` (from real logs); `content_hash` staleness *policy* (P1; hash captured P0); offline pieces (P3, m4).
- **MC-owned (already deferred correctly):** all knob values, plus the new M4 interval-stability invariant.
