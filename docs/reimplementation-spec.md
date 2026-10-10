# Language Transfer Practice App Reimplementation Spec

## Purpose

This document is a full product and design specification.

It tells another model how to reimplement this repository.

It covers the existing Anki and podcast pipeline.

It gives the new practice app as the primary product.

It records requirements, constraints, features, state, data, and deferred ideas.

It uses the current code and documentation as the source.

## Product Core

The product is a Spanish practice system for Language Transfer Complete Spanish.

Language Transfer teaches by mental transfer.

The learner derives Spanish from English with rules, patterns, and paradigms.

The product must reinforce that method.

The product must not reduce the course to rote word cards.

Rules are the unit of learning.

Items are varied instruments that exercise rules.

Many items can test one rule.

One item can test many rules.

One item can support many exercise types.

The learner must see a rule through varied examples and varied exercise types.

The learner is ready to continue when the rule generalizes.

The learner does not need to see every item in a rule group.

Mastery and retention are separate signals.

Retention answers this question: when must the app refresh this rule?

Mastery answers this question: how well does the learner generalize this rule?

The app uses spaced repetition for retention.

The app uses a separate mastery meter for competency.

The app uses the same append-only log for both signals.

## Product Surfaces

The repository has two product surfaces.

The older surface is an Anki and podcast pipeline.

The newer surface is the interactive practice app in `app/`.

The two surfaces must stay separate.

The app can reuse ideas from the older pipeline.

The app must not reuse `cards/*.yml` as its content source.

The app must not modify `build/`, `cards/`, `dist/`, `audio/`, or `podcast.xml` for app work.

## Repository Map

`lessons/lesson_NN/rules.md` is the primary course source.

`lessons/lesson_NN/transcript.md` is the verbatim lesson source.

`docs/grammar/*.md` describes the 27 bundle grammar structures.

`docs/lesson-bundles.md` defines the 27 bundle boundaries.

`docs/cross-references.md` defines course-wide concept threads.

`docs/lesson-dependencies.md` defines a draft graph for lessons 1-30.

`docs/card-design.md` defines the older card schema and quality bar.

`build/` contains the older Python build pipeline.

`app/packages/domain` contains isomorphic app domain logic.

`app/packages/web` contains the SvelteKit app and SQLite persistence.

## Existing Anki And Podcast Pipeline

The older pipeline builds one Anki package per bundle.

It reads `cards/*.yml`.

It writes `dist/bundle_<slug>.apkg`.

It can embed Spanish answer audio in Anki cards.

It renders per-bundle flashcard MP3 files in `audio/flashcards/`.

It writes `podcast.xml` for podcast clients.

The card schema has these fields:

- `id`
- `type`
- `tier`
- `front_en`
- `back_es`
- `hint`
- `rule_ref`
- `lessons`
- `directions`
- `notes`

The card types are:

- `transformation`
- `sentence`
- `conjugation`

The card tiers are:

- `primary`
- `extended`

The directions are:

- `en_es`
- `es_en`

The older generator tests all card files.

It requires global card IDs to be unique.

It requires required card fields.

It requires the card home lesson to be in the bundle range.

It applies a sentence word cap.

It tags cards by lesson, type, tier, direction, and rule.

The Anki model ID is locked.

Do not change `MODEL_ID` in `build/lib/anki.py`.

Changing that ID loses Anki review history.

The audio pipeline uses Piper by default.

Piper voices live under `build/.piper-voices/`.

The Spanish voice is slower than the English voice.

The MP3 renderer shuffles bundle exercises.

It splits each bundle into parts near 30 minutes.

It folds very short tail parts into the prior part.

It inserts an E-major-7 chime between cards.

The RSS generator reads `audio/flashcards/*.mp3`.

It uses `docs/lesson-bundles.md` for bundle descriptions.

The `clean` target must use `trash`, not `rm -rf`.

## App Product Scope

The app is the future primary practice product.

It must become a mobile-first installable PWA.

The current phase is backend and domain first.

The current UI is intentionally plain.

The UI must stay automatable.

Stable `data-testid` attributes are required for important flows.

The app content ceiling is lessons 1-30.

Content beyond lesson 30 needs a new explicit decision.

The app content must be a fresh bank.

The app content must be generated or authored from lesson rules and transcripts.

The app content must not come from `cards/*.yml`.

The content pipeline must pre-generate content offline.

The app must work offline after content sync in the PWA phase.

Live per-request generation is not allowed.

## Current App Status

The app is a pnpm workspace.

It has two packages:

- `@lt/domain`
- `@lt/web`

`@lt/domain` is the isomorphic core.

`@lt/domain` must not import Node built-ins.

`@lt/domain` must not import persistence drivers.

`@lt/domain` must not import Svelte or SvelteKit.

`@lt/domain` must not read ambient randomness or wall time.

Callers inject the clock and random number generator.

The lint rule enforces this boundary.

`@lt/web` is the SvelteKit layer.

`@lt/web` owns SQLite, Drizzle, file loading, Svelte routes, and test-only controls.

The current implemented exercise type is `transformation`.

The current seed content covers lessons 2-5.

The current seed content has 11 rules.

Seven current rules are schedulable.

Four current rules are dormant.

The current seed content has 32 transformation items.

The dormant rules are sentence-level rules.

They wait for P1 exercise types.

## Technical Stack

Use TypeScript for the app.

Use SvelteKit for the web app.

Use pnpm for package management.

Use Vitest for unit and integration tests.

Use Playwright for end-to-end tests.

Use SQLite for the current server state.

Use Drizzle for schema and queries.

Use `better-sqlite3` in the web package only.

Use `ts-fsrs` in the domain package.

Use adapter-node for SvelteKit.

The app requires Node 22 or newer.

## User Model And Auth

The app is single-user today.

The app must still have a real `User` concept.

Every per-user table must have `user_id`.

Every query must filter by `user_id`.

The current user is the constant `u1`.

`hooks.server.ts` sets `locals.user = { id: 'u1' }`.

A real session cookie can replace this later.

Do not use Lucia.

Use a current SvelteKit-compatible auth solution later.

Multi-user auth is deferred.

The data model must make multi-user auth additive.

## Content Source

Lesson rule files use this format:

- Summary
- Rules
- Vocabulary
- Examples or sentences
- Cross-references

Lesson 1 teaches the learning method.

Lesson 1 has no Spanish content.

Lessons 2-90 teach Spanish content and method.

The app content must use `rules.md` and `transcript.md` as grounding sources.

The grammar bundle docs can guide structure.

The dependency docs can guide related lessons.

The dependency graph for lessons 1-30 is draft.

Human review is required before that graph controls product logic.

The linear lesson order is valid for hard dependencies in lessons 1-30.

The graph supports the `current_lesson` dial.

The graph must not replace the dial with graph gating.

## Bundles

The course has 90 lessons.

The course is split into 27 bundles.

The bundle letters are A through Z plus Ñ.

The on-disk alias for Ñ is `nn`.

Bundles A-I cover lessons 1-30.

The app content ceiling maps to bundles A-I.

The full bundle sequence is:

- A: lessons 1-3, foundation.
- B: lessons 4-7, verb unlock.
- C: lessons 8-10, helpers and `saber`.
- D: lessons 11-13, regular present and `-go`.
- E: lessons 14-17, spine verbs and vowel splits.
- F: lessons 18-20, we-form and future by context.
- G: lessons 21-23, `haber` past and reflexive intro.
- H: lessons 24-27, indirect pronouns and `dar`.
- I: lessons 28-30, agreement and `ser`/`estar`.
- J through Z continue the full course.

The app must not generate beyond bundle I without a new decision.

## Content Model

`Rule` is first-class.

`Rule` is the SRS unit when `schedulable` is true.

`Rule.key` must be stable.

Rule keys must use semantic slugs.

Rule keys must not depend on positional numbering inside `rules.md`.

The rule key format is `L<lesson>#<slug>`.

`Rule.homeLesson` is the lesson that teaches the tested rule.

`Rule.bundle` is the bundle letter.

`Rule.kind` can be:

- `transformation`
- `paradigm`
- `lexical`
- `syntax`
- `confusable`
- `phonetic`
- `meta`

`Rule.importance` is a rollup weight.

`Rule.schedulable` controls SRS eligibility.

Meta and phonetic rules are dormant in text-only mode.

Some lexical and syntax rules are dormant in the current seed.

`Item` is content data.

`Item` must be blind to how the app quizzes it.

`Item.id` must be a short slug.

`Item.id` must never be the sentence text.

`Item.kind` is currently `transformation`.

Future kinds can include sentence patterns, confusable pairs, and false friends.

`Item.front_en` is the English prompt or source text.

`Item.back_es` is the Spanish answer or source text.

`Item.hint` is optional.

`Item.accepted_answers` stores valid answer variants.

`Item.min_lesson` controls visibility.

`Item.directions` lists valid directions.

`Item.rule_refs` is a list of rule references.

Each rule reference has a role.

The role is `tests` or `uses`.

Only `tests` earns mastery credit.

`uses` supports foreshadowing and related explanations.

`Item.tier` is `primary` or `extended`.

`Item.related_lessons` supports a future "read why" surface.

`content_hash` is derived, not authored.

It covers answer-defining fields.

It excludes hints.

Accent fixes can change the content hash.

## Content Store

The web package loads YAML with Vite raw globs.

Parsing and shape validation happen in the web package.

Cross-record validation happens in `@lt/domain`.

The store is built once and memoized.

The store indexes items by kind, tier, and rule.

The store indexes rules by key.

The store must fail boot on invalid content.

Fatal content errors include:

- duplicate rule keys
- duplicate item IDs
- unresolved rule references
- supported items with zero parameters
- schedulable rules with no eligible home-lesson instrument

An eligible home-lesson instrument must:

- test the rule
- be visible at the rule home lesson
- be supported by a registered exercise type
- enumerate at least one parameter

Parameter enumeration at boot is allowed.

Prompt rendering must stay lazy.

## Current Seed Content

The current `rules.yaml` covers lessons 2-5.

Schedulable rules are:

- `L2#conv-al`
- `L3#conv-ante-ente`
- `L3#conv-mente`
- `L3#conv-ible-able`
- `L4#conv-cion-noun`
- `L4#conv-acion-ar-verb`
- `L5#conv-encia-ancia`

Dormant rules are:

- `L4#spine-quiero`
- `L5#pron-me`
- `L5#pron-lo`
- `L5#emph-yo`

The seed deliberately scopes Phase 0 to word transformations.

The seed avoids sentence-level rules until sentence exercise types exist.

## Lesson Gating

Each user has one reversible `current_lesson` dial.

An item is visible when `item.min_lesson <= current_lesson`.

A rule is eligible when its home lesson is reached.

A rule also needs at least one visible tested item.

Moving the dial down hides later items immediately.

Moving the dial up reveals later items immediately.

Changing the dial must not delete state.

Changing the dial must not change SRS schedules.

The web route clamps the dial to `[1, maxLesson]`.

The fold floors logged lessons at 1.

Review sessions can later add a lesson-range filter.

That filter is separate from the global dial.

## Exercise Type Model

`ExerciseType` is code, not content.

It has a stable semantic key.

The current stable key is `transformation`.

An exercise type defines:

- `supports(item)`
- `inputModalities`
- `paramEnumerator`
- `promptRenderer`
- `grader`

`ParamEnumerator` owns the canonical `param_key`.

The empty parameter key is `''`.

`Direction` is a separate identity dimension.

The current directions are:

- `en>es`
- `es>en`

The current input modality is `text`.

`Prompt` and `Response` are discriminated unions.

They carry resolved content.

Graders must not depend on UI prompt objects.

The route logs the full instrument identity:

- `item_id`
- `exercise_type_key`
- `param_key`
- `direction`

## Current Transformation Exercise

The transformation exercise supports `Item.kind === 'transformation'`.

It enumerates one parameter per item direction.

It uses `param_key = ''`.

For `en>es`, it shows the English text.

For `es>en`, it shows the Spanish text.

For `en>es`, accepted answers include `back_es` plus `accepted_answers`.

For `es>en`, the expected answer is `front_en`.

The exercise uses text input.

The exercise uses the Spanish text matcher.

## Grading

The grader returns a `Grade`.

`Grade.correct` is the core correctness signal.

`Grade.detail` can carry advisory information.

The central rating policy converts `Grade` to `SrsRating`.

The current ratings are:

- `again`
- `hard`
- `good`
- `easy`

The policy is:

- Wrong answers become `again`.
- Correct answers with a revealed hint become `hard`.
- Correct answers with self-report `easy` become `easy`.
- Other correct answers become `good`.

Accent-off answers are correct.

Accent-off answers carry an advisory detail.

Accent-off answers do not lower the rating.

## Spanish Text Match

Accents carry meaning.

The matcher prefers accent-correct answers.

A capital vowel can stand for an accented vowel after position 0.

For example, `canciOn` matches `canción`.

Position 0 is special.

A sentence-initial capital can be ordinary capitalization.

At position 0, the matcher accepts either accent form without a note.

Whitespace is collapsed.

Matching is case-insensitive after the capital-vowel pass.

If base letters match but accents differ after position 0, the answer is correct with an accent note.

If base letters differ, the answer is wrong.

## Scheduling

The SRS unit is the schedulable rule.

Items do not get SRS schedules.

Items get light exposure tracking.

Timing uses the `Scheduler` port.

The scheduler state is an opaque JSON blob.

The domain must not inspect scheduler blob internals.

The current app scheduler is FSRS under a same-day guard.

FSRS comes from `ts-fsrs`.

The current FSRS version is `5.4.1`.

The current FSRS parameters are placeholders.

Monte Carlo must tune those parameters later.

The structural FSRS flags are:

- `enable_fuzz: false`
- `enable_short_term: false`

Fuzz is off for deterministic fold and rebuild output.

Short-term steps are off because the app schedules at day grain.

The current request retention is `0.9`.

That value is not tuned.

## Same-Day Guard

A rule can receive at most one effective timing tick per UTC day.

Same-day repeats still update mastery and exposure.

Same-day repeats do not append extra timing ticks.

The guard wraps any scheduler core.

The guard tracks its state inside the scheduler blob.

For each day, it uses the worst rating seen that day.

The rating order is:

- `again`
- `hard`
- `good`
- `easy`

A later good answer cannot undo an earlier same-day failure.

The first attempt time of the day anchors the timing tick.

This prevents due dates from drifting during same-day re-drill.

## SM-2 Escape Hatch

The domain includes an SM-2 scheduler core.

SM-2 is not wired into the app runtime.

SM-2 proves that scheduler swap is a replay.

A scheduler swap must refold the log.

It must not mutate the log.

It must not require a schema migration.

## Mastery

Mastery is an advisory meter.

Mastery must never change `due`.

Mastery must never use FSRS internal difficulty.

Mastery is folded from the same attempts as timing.

Mastery updates on every attempt.

Mastery stores three raw signals:

- EWMA accuracy
- distinct instrument coverage
- distinct success days

Coverage is a count.

Coverage is not a percentage of the live catalog.

Adding new exercise types must not un-master a rule by changing a denominator.

The current mastery knobs are placeholders.

Monte Carlo must tune them later.

Current placeholder values are:

- alpha: `0.1`
- again base: `0`
- hard base: `0.5`
- good base: `1`
- easy base: `1`
- coverage K: `8`
- readiness threshold: `0.85`
- success-day threshold: `3`

`masteryReady` is a read-time predicate.

It is not stored in the database.

Retuning thresholds must not require a database migration.

Retuning EWMA shape values requires a rebuild from the log.

## State Model

The append-only `ReviewLog` is ground truth.

All per-user state must be a fold of the log.

The materialized tables are caches.

The fold is authoritative when cache order and event order differ.

The event order is `(at, id)`.

The fold walks events as given.

The repository returns events ordered by `(at, id)`.

The fold produces:

- current lesson
- rule states
- item exposures
- sessions

The incremental write path must match the fold under monotonic time.

Backward time can make the cache differ.

In that case, the fold wins.

## Review Log Events

The log is a single kind-discriminated stream.

Event kinds are:

- `attempt`
- `star`
- `unstar`
- `set_known`
- `set_lesson`
- `session_start`
- `session_end`

Attempt events must record:

- user ID
- timestamp
- session ID
- item ID
- tested rule keys
- exercise type key
- parameter key
- direction
- rating
- assessment
- hint flag
- optional latency
- content hash

Star events record an item.

Unstar events record an item.

Known events record an item and a boolean.

Lesson events record a lesson value.

Session start events record a session ID, mode, and target attempt count.

Session end events record a session ID.

Rows can have nulls for columns that do not apply to their kind.

`rowToEvent` must throw on malformed rows.

It must not silently fold corrupt rows.

## Database Schema

The app uses SQLite tables:

- `users`
- `sessions`
- `review_log`
- `rule_state`
- `item_exposure`

All tables are STRICT in migrations.

All timestamps are epoch milliseconds in UTC.

Booleans are stored as integers.

`users` stores the current lesson cache.

`sessions` stores session state and attempt counts.

`review_log` stores the full frozen event stream.

`rule_state` stores timing and mastery projection.

`item_exposure` stores light per-item counters and flags.

`rule_state` primary key is:

- `user_id`
- `rule_key`
- `direction`

The default direction sentinel is `both`.

The sentinel keeps the key arity fixed.

If the app later schedules by direction, it changes the value.

It must not change the key shape.

`item_exposure` primary key is:

- `user_id`
- `item_id`

The database must use:

- WAL
- `busy_timeout = 5000`
- `synchronous = NORMAL`
- `foreign_keys = ON`

Migrations are forward-only.

Do not use `drizzle push`.

Use committed migration files.

## Repository Port

`ReviewRepository` is a domain interface.

The Drizzle implementation lives in `@lt/web`.

The repository starts sessions.

The repository ends sessions.

The repository appends attempts.

The repository reads due rule states.

The repository reads all rule states.

The repository reads item exposure.

The repository reads ordered log events.

The repository writes lesson changes.

The repository reads current lesson.

The repository reads sessions.

The repository reads the current unended practice session.

The repository reads session attempts.

The repository reads all item exposures.

The repository can rebuild `rule_state` from the log.

The repository can star and unstar items.

Attempt append must be one transaction.

It must append the attempt event.

It must update each tested rule state.

It must update item exposure.

It must increment session realized count.

Star and unstar must be one transaction.

They must append an event.

They must update item exposure.

Rebuild must rewrite `rule_state` only.

It must not rewrite sessions or item exposures.

Scheduler swap and rule rename replay use rebuild.

## Identity

Stable IDs are sacred.

The app has an ID manifest.

The manifest stores:

- exercise type keys
- rule keys
- item slugs with stable integers
- rule remaps
- item remaps

The manifest test must fail on silent ID disappearance.

A removed rule key must have a remap.

A removed item slug must have a remap.

A remap target must exist.

Exercise type keys must use a safe format.

Rule keys must use a safe format.

Item slugs must use a safe format.

Raw IDs must not contain delimiter characters that break composite keys.

Canonical parameter keys must percent-encode keys and values.

Empty parameters encode as `''`.

## Session Planner

The session planner is pure domain logic.

It uses injected context.

It uses injected seeded randomness.

It must not read the database.

It must not mutate state.

The planner output is a list of instruments.

Each instrument records:

- target rule key
- item ID
- exercise type key
- parameter key
- direction

The target rule key is for observability.

The attempt still credits all tested schedulable rules on the item.

Planner randomness must use `seededRng`.

The domain must not call `Math.random`.

The live route seeds the random generator from the session ID.

The inspector uses a fixed seed for deterministic preview.

## Planner Stage 1

Stage 1 chooses rules.

Candidate pools are:

- due
- weak
- new
- starred-forced

A new rule has no rule state row.

A due rule has `due <= now`.

A weak rule has mastery below the readiness threshold.

A starred-forced rule has a visible starred tested item.

Priority terms are:

- overdue
- mastery gap
- coverage gap
- starred
- newness

`due` is one priority term.

`due` is not the only driver.

The planner must distribute picks across lesson buckets.

It must not globally sort everything and overload one overdue lesson.

It enforces per-lesson and per-rule caps.

It enforces a cap on distinct new rules per session.

The current planner values are placeholders.

Monte Carlo must tune these values.

## Planner Stage 2

Stage 2 chooses an instrument for a rule.

Eligible instruments are visible items that test the rule.

The exercise type must support the item.

The exercise type must enumerate a parameter.

The current planner requires a valid direction in the parameter object.

Future exercise types must provide a generic direction accessor or equivalent.

Stage 2 ranks by:

- low times seen
- unused direction in this session
- exposure cooldown
- star bias
- recent-miss bias
- seeded jitter

If every candidate is in cooldown, the planner can show one anyway.

This lets one-instrument rules degenerate to a normal flashcard.

The current star effect is strong in Stage 1.

The current star effect is a low tie-breaker in Stage 2.

## Planner Knobs

Current planner knobs are placeholders.

They are:

- overdue weight: `1`
- mastery gap weight: `2`
- coverage gap weight: `1`
- starred weight: `3`
- newness weight: `1.5`
- per-lesson cap: `3`
- per-rule cap: `2`
- new-rule cap per session: `3`
- cooldown: `43_200_000` milliseconds
- target attempts: `10`
- redrill max misses per instrument: `2`

These values are not final.

The Monte Carlo tool must own them.

## Session Lifecycle

Practice sessions are bounded.

A session has a target attempt count.

The current target count is 10.

A session starts with an explicit `start` action.

Page load must not create sessions.

Page load must be read-only.

The session phase is pure domain logic.

The phases are:

- main
- redrill
- complete

Main phase serves the planner head while the budget remains.

If the planner has no head, the session can move to redrill or complete early.

Redrill phase serves unresolved misses.

Complete phase ends the session.

The submit action writes the attempt.

Then it recomputes the phase from live persisted state.

If the session is complete, it writes `session_end`.

A new start action ends any lingering open session first.

Then it starts a fresh session if an instrument is servable.

## Re-Drill

Re-drill is derived from session attempt log rows.

It is not stored as a queue.

It uses no random number generator.

A miss is rating `again`.

A hint-revealed correct answer is `hard`.

It is not a miss.

An unresolved miss is an instrument whose latest session attempt is `again`.

The instrument must still be eligible.

The miss count must be less than the cap.

The current cap is 2 misses per instrument.

That means a missed instrument can be redrilled once in the same session.

Stubborn misses return through normal due or weak flow later.

Re-drill is earliest-first-miss.

Same-day re-drill updates mastery and exposure.

Same-day re-drill does not add a second timing tick.

The same-day guard enforces this.

## Session Summary

The done screen shows session summary data.

The summary includes:

- attempt count
- correct count
- redrilled instrument count

Correct means rating is not `again`.

Redrilled means the same instrument appears more than once in the session.

## Star Feature

Stars live on items.

Star state is an event in the log.

Star state is cached in `item_exposure`.

Stars boost planner priority.

Stars also appear in the inspector starred list.

Starring an item must not change rule timing.

Starring an item must not create a rule state.

A never-seen starred item can create an item exposure row.

That row must have `timesSeen = 0`.

Cooldown must ignore never-seen star exposure rows.

## Current UI

The current UI is plain and automatable.

The practice page is `/`.

The inspector page is `/inspector`.

The practice page can show:

- start screen
- prompt
- hint reveal
- answer form
- star toggle
- result
- redrill badge
- session summary
- caught-up message

The inspector can show:

- lesson dial
- eligible item queue
- eligible rule count
- scheduled rule states
- mastery and coverage values
- deterministic planned queue
- starred items
- latest practice session panel
- current redrill queue for that session

The UI is not the final PWA design.

It must remain stable enough for Playwright.

## Test Controls

The test controls must be active only when `LT_TEST_CONTROL=1`.

`/__test__/clock` can reset, set, or advance the clock.

`/__test__/db` can reset mutable per-user tables.

When the flag is absent, these routes must return 404.

Playwright uses `LT_DB_PATH=:memory:`.

Playwright currently runs serially.

The shared in-memory DB and clock offset are process globals.

Parallel Playwright needs per-test user, per-test clock, or per-worker server isolation.

## Verification Requirements

Every code change must have automated tests.

Every app behavior change must have a Playwright walkthrough of the real UI.

Green unit tests alone are not enough for app behavior.

The scrappy UI must expose enough state for Playwright to observe outcomes.

Important test commands from `app/` are:

- `pnpm test`
- `pnpm check`
- `pnpm lint`
- `pnpm build`
- `pnpm test:e2e`

The domain package must keep the M9 boundary lint green.

The ID manifest test must stay green.

The persistence tests must prove fold and projection agreement.

The scheduler tests must prove same-day guard behavior.

The planner tests must prove deterministic selection and distribution invariants.

The session tests must prove bounded lifecycle and redrill behavior.

## Distribution And Monte Carlo

The planner is seeded-random.

Distribution must be tested across many seeded sessions.

Single-session output is not enough.

Hard planner invariants include:

- budget respected
- per-rule caps respected
- per-lesson caps respected
- cooldown respected unless all candidates are in cooldown
- no non-due displacement when due backlog exceeds budget
- no starvation over repeated sessions

Soft distribution goals include:

- lesson spread
- exercise type entropy
- due, weak, and new mix near target values
- balanced item freshness
- healthy new-rule introduction

The Monte Carlo tool is not implemented yet.

When built, it must live under `experiments/scheduler-sim/`.

It must reuse real scheduler and planner ports.

It must simulate learners over lessons 1-30.

It must tune FSRS, mastery, priority, and budget knobs.

It must reject knob sets where hard items rot.

It must reject knob sets where easy items are over-drilled.

It must test interval stability under mixed item difficulty.

## Roadmap

### Phase 0

Phase 0 is the foundation.

The current code implements most of this foundation.

Phase 0 includes:

- domain and web scaffold
- one exercise type
- accent-aware grading
- content and lesson gating
- event log
- SQLite persistence
- FSRS timing
- same-day guard
- mastery meter
- planner
- star
- bounded sessions
- re-drill
- inspector

Adaptive new-lesson trickle sizing remains a deferred Phase 0 slice.

### Phase 1

Phase 1 adds exercise breadth and pilot content generation.

It must add cloze and sentence structure types.

These types must use the same item model.

It must build a content generation pipeline.

It must run that pipeline on one pilot bundle first.

It must add primary or source weighting.

It must add manual review.

Manual review must support:

- exercise type picker
- lesson range filter
- pick-for-me flow
- weakest rules queue

It can add difficulty tags.

Difficulty can feed mastery and selection later.

### Phase 2

Phase 2 adds lower-cost modes with existing infrastructure.

It must add listening mode through Piper TTS.

It must add car mode with self-grading.

Car mode must use the same items.

Car mode must be able to upgrade to ASR later.

It must add curated confusables and false friends.

It must add streak and skill-tree data.

It must decide whether to scale content generation farther.

The content ceiling is still lesson 30 unless a new decision changes it.

### Phase 3

Phase 3 adds the real mobile-first PWA.

It replaces the scrappy UI.

It must include a session screen.

It must include a review screen with filters.

It must include a skill-tree or map.

It must include streak surfaces.

It must be installable on iOS and Android.

It must preserve the domain boundary for offline use.

## Deferred And Backlog Ideas

ASR-graded speaking is deferred.

The ASR model must be self-hosted.

Candidate models need real research.

Do not assume a model works for Spanish without tests.

Car mode is self-graded before ASR.

SoundCloud lesson ingestion is deferred.

If built, it is for personal offline listening only.

Do not redistribute Language Transfer audio.

In-app lesson playback is deferred.

Auto-advance of `current_lesson` after lesson listening is deferred.

Multi-user auth is deferred.

Content beyond lesson 30 is deferred.

Fold snapshots are deferred.

Snapshots must be disposable derived state.

Snapshots must never live in `ReviewLog`.

Session navigation is deferred.

The backlog includes back, forward, revise, stop, resume, and keep-answering flows.

Revision must append a new attempt.

Advance-lesson prompts are deferred.

The prompt must use a lenient current-lesson accuracy signal.

It must be separate from the mastered predicate.

Review-old-lessons UI is deferred.

Lowering the dial already resurfaces older eligible material.

A dedicated revisit control can be added later.

User-selectable exercise types are deferred.

The architecture already supports this by filtering Stage 2.

Multi-lesson dialogues are deferred.

Dialogue blanks must carry their own rule attribution.

Above-dial blanks must be auto-filled, not asked.

Dialogue instruments must cap at one per session.

Transcribe-at-speed then slowly is deferred.

Free-text answer grading is deferred.

It needs richer grammar and answer assessment.

Related-lessons explanations are deferred.

Items already carry `related_lessons`.

## Confusables And False Friends

Confusables and false friends must be curated.

They must not be mass-generated like regular vocabulary.

They need a dedicated exercise type.

Examples include `ser` versus `estar` and `por` versus `para`.

False friend examples include `exitado` and English "excited".

The list must be bounded.

Human review is required before items enter the live bank.

## Skill Tree And Streaks

The skill tree must roll up from rules to lessons and bundles.

Rule importance can weight the rollup.

The skill tree visual is deferred to Phase 3.

Skill-tree data can land earlier.

Streaks must be goal-based.

The target is five sessions per week.

Daily streaks are not the required model.

XP, hearts, lives, and badges are not required for version 1.

They can stay optional ideas.

## Offline And PWA

Offline support must be additive to the domain.

The domain already avoids server-only imports.

The PWA still needs new client infrastructure.

Offline needs client persistence.

Offline needs content sync and storage.

Offline needs append-log merge behavior.

Offline needs conflict handling for multi-device use.

The domain can run in the client.

That does not make offline free.

## Content Generation Pipeline Requirements

The generator must use lesson rules and transcripts.

It must produce fresh app items.

It must not copy `cards/*.yml`.

It must attach rule references with `tests` or `uses`.

It must set `min_lesson` to the tested rule lesson.

It must preserve foreshadowing.

If an item only uses a later rule as a memorized form, it must not test that later rule.

It must attach related lessons.

It must assign stable item slugs.

It must compute content hashes.

It must write authored YAML or another reviewable artifact.

It must include human review before live use.

It must include a way to fix bad examples without losing history.

Answer-defining changes must be visible through content hash changes.

The first generated pilot must cover only one bundle.

## App Non-Goals For Current Scope

Do not build ASR in Phase 0.

Do not build listening in Phase 0.

Do not build car mode in Phase 0.

Do not build false friends in Phase 0.

Do not build polished frontend design in Phase 0.

Do not build real auth in Phase 0.

Do not generate full lesson 1-30 content before the pilot pipeline proves itself.

Do not couple the app to the older Anki pipeline.

Do not modify generated `dist/` or `audio/` artifacts for app work.

## Reimplementation Checklist

Build the domain package first.

Make the domain package isomorphic.

Add lint rules for Node, persistence, Svelte, `Math.random`, and wall-clock access.

Define content types and validation.

Define exercise type contracts.

Implement transformation exercise.

Implement accent-aware text matching.

Implement central rating policy.

Implement lesson gating.

Implement the ID manifest.

Implement the event model.

Implement the fold.

Implement the scheduler port.

Implement FSRS core and same-day guard.

Implement SM-2 core for replay proof.

Implement mastery functions.

Implement planner functions and seeded RNG.

Implement session phase, re-drill, and summary functions.

Build the web package after the domain works.

Load YAML content in the web package.

Open SQLite with migrations and pragmas.

Seed user `u1`.

Implement the Drizzle repository.

Wire SvelteKit routes to the repository and domain.

Keep page loads read-only when possible.

Add test-only controls behind `LT_TEST_CONTROL=1`.

Add the practice page.

Add the inspector page.

Add Playwright tests for real behavior.

Run the full app gate before you claim completion.
