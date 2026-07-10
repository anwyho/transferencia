# Language Transfer practice app — whole-system sketch + Phase 0 design

**Status:** SUPERSEDED by `2026-07-09-language-transfer-design-v2.md` (rule-grain reshape). Kept for history. Read v2 + `language-transfer-requirements.md` instead.
**Date:** 2026-07-09
**Produced by:** brainstorming session following `docs/webapp-spec-prompt.md`.

## How to use this doc

This is the output of the brainstorming step `docs/webapp-spec-prompt.md` (process step 3) asked for: a whole-system entity sketch, then a full design for Phase 0 alone. It does **not** replace `docs/webapp-spec-prompt.md` — read that first, and `AGENTS.md` before touching anything. This doc records the decisions made resolving that spec's open questions, plus the concrete Phase 0 design that follows from them.

**Next step is explicitly not implementation.** Convert Phase 0 (and a light milestone-level roadmap of the rest) into GitHub Issues/Milestones in `anwyho/transferencia` via `gh`, per `docs/webapp-spec-prompt.md` process step 4. Implementation happens later, issue by issue. Do not start writing app code from this doc directly.

If you're picking this up fresh: the constraints in `docs/webapp-spec-prompt.md` are locked and not up for re-litigation (that doc says so explicitly). What follows fills in the "genuinely open" items that doc called out, plus the architecture that satisfies its "interfaces first, non-negotiable" mandate.

## Decisions made (resolving `docs/webapp-spec-prompt.md`'s open questions, partially)

| Area | Decision | Why |
|---|---|---|
| Hosting | Local-only for Phase 0-2 (localhost / LAN / Tailscale). Deploy to a small VPS/PaaS only when Phase 3's real PWA needs HTTPS install on iOS/Android. | No cloud bill before there's anything worth showing; matches single-user personal-use scope. |
| Stack | TypeScript full-stack, SvelteKit. | One language for API + eventual PWA — Phase 0's "API + scrappy UI" is already the same stack Phase 3 ships for real, no rewrite. PWA/service-worker tooling is native to the ecosystem. Existing Python pipeline (Piper TTS) stays reusable via subprocess/CLI in Phase 2 regardless of app language. |
| Auth | Real `User` row from day one (not global-singleton state), but no login screen — single hardcoded/seeded user, fixed session. | Single-user today; satisfies the "real User concept" hard constraint without auth-building work the single-user MVP doesn't need. Add real auth if this ever gets exposed beyond localhost/Tailscale or gets a second user. |
| SRS algorithm | FSRS via `ts-fsrs` (`open-spaced-repetition/ts-fsrs`, npm). | Chosen over hand-rolled SM-2 after an explicit supply-chain check: `ts-fsrs` is the *reference* implementation from the algorithm's own inventors, zero runtime deps, MIT, ~90k weekly downloads, actively maintained (FSRS-6.0). Hand-rolling FSRS's math (17 fitted parameters) risks subtle bugs a reference implementation avoids; hand-rolling was the safer call for SM-2 specifically because that algorithm is trivial, but FSRS is not. |
| DB / data access | SQLite + Drizzle ORM. | Structural type safety: schema is TS, types inferred directly with no separate generate step to forget (unlike Prisma's separate `schema.prisma` DSL + codegen, which can silently drift). No bundled query-engine binary (smaller supply-chain surface than Prisma). Fits a single-file local DB. |
| Flag/star mechanics | Hybrid: starred items get a priority boost inside the normal due queue, **and** a separate always-browsable "starred" list independent of due status. Both read off one boolean on `ReviewState`. | Anthony wants both drill-priority and free browsing; one flag serves both without double bookkeeping. |
| Package manager / test tooling | pnpm, Vitest (unit/integration), Playwright (e2e). | Vitest is SvelteKit's de facto default; Playwright is `AGENTS.md`'s explicit verification mandate and already available in this environment. |

Still open, deliberately deferred to their own phase's detailed spec (per `AGENTS.md`: "don't speculatively design ahead"):
- Exact self-hosted ASR model choice + what "grading a spoken answer" means — backburner phase.
- Content-pipeline mechanics (which LLM, QA/review step, versioning) — Phase 1.
- Skill-tree/map data model — Phase 2 (data-only) / Phase 3 (visuals).
- Exact taxonomy of multiple-choice/word-bank/audio-dictation exercise types beyond what's designed below — the *interface seam* for these is designed now (see ExerciseType composability); which ones actually get built and their exact UX is a Phase 1/2 decision.

## Whole-system entity sketch

Two planes, deliberately separate subsystems (own interface, own tests, mockable, swappable — per `AGENTS.md`):

### Content plane — YAML on disk → in-memory at boot, read-only at runtime

Mirrors this repo's existing `cards/<letter>_<theme>.yml` precedent, but in a new directory decoupled from `cards/` (per the hard constraint that the app's content bank is brand-new, not reused from `cards/*.yml`).

- **Item** — content, not exercise-specific. Fields: `id` (stable, never rename — SRS history keys on it, same discipline as the existing pipeline's `id` field), `kind` (`vocabulary` | `sentence_pattern` | `confusable_pair` | `false_friend_pair`), `front_en`, `back_es`, `hint`, `rule_ref` (string, mirrors `rules.md` numbering — no normalized `Rule` table yet; that's deferred until/unless the per-rule-mastery idea gets picked up), `min_lesson` (drives gating), `tier` (`primary` | `extended`), `source` (`hand_authored` | `generated`), `directions` (subset of `[en_es, es_en]` — reused verbatim from the existing card schema; an item declaring only `en_es` is how conjugation-shaped items work, no separate kind needed).
- **ItemStore** — loader that globs the content directory, validates (unique ids, schema, `rule_ref`s resolve), builds `Map<id, Item>` plus lookup indexes (by `min_lesson`, `kind`, `tier`). No DB round-trip to read content, ever.
- **ExerciseItem** — a specific (Item, ExerciseType, params) combination; the actual trackable review unit. See composability section below for why this exists as its own concept.
- **ExerciseItemStore** — at boot, cross-joins `ItemStore × registered ExerciseTypes (filtered by exerciseType.supports(item)) × each surviving type's paramsFor(item)`, producing deterministic ids `${item.id}::${exerciseType.id}::${paramKey}`. In-memory, O(1) lookup.

### State plane — SQLite, mutable, per-user

- **User** — real row, `current_lesson` int (floor 1) as the lesson-gating dial.
- **ReviewState** — one row per (User, ExerciseItem): FSRS state (stability, difficulty, due date, reps, lapses), `starred` boolean, `first_exposed_at` (drives the primary-tier boosted-frequency multiplier). Keys on `exercise_item_id` (string), not raw `Item.id`.
- **ReviewLog** — append-only, one row per attempt: user, exercise_item_id, timestamp, grade, raw response. Independent of `ReviewState`'s current snapshot — matters for "fix a bad example without breaking SRS history" and any future per-rule mastery analytics.
- **Session** — groups attempts: `started_at`/`ended_at`, `mode`, item count. Backbone for streak counting later (Phase 2+).

**Edge case, accepted not fixed:** if a content edit removes a declared direction or renames an item id, its `ExerciseItem` stops being generated and the matching `ReviewState`/`ReviewLog` rows go silently orphaned — harmless, never surfaced again, no cleanup job needed. Renaming ids is a "don't" by discipline, same as the existing pipeline already assumes.

## ExerciseType composability — the architectural spine

The hard constraint ("decouple content from exercise types... interfaces first, non-negotiable... a new exercise type must plug in later without a rewrite") is satisfied by decomposing `ExerciseType` into three small, single-purpose interfaces — composed, not inherited, in the same spirit as Go's small interfaces (`io.Reader`/`io.Writer`) satisfied structurally with no explicit `implements` (TypeScript object literals satisfy an interface shape the same way).

```ts
interface PromptRenderer { render(item, params): Prompt }
interface Grader         { grade(item, params, response): Grade }
interface ParamEnumerator{ paramsFor(item): Params[] }

interface ExerciseType {
  id: string
  supports(item: Item): boolean
  paramEnumerator: ParamEnumerator
  promptRenderer: PromptRenderer
  grader: Grader
}
```

`supports(item)` is a cheap eligibility check — `item.kind` against the kinds that ExerciseType declares it handles, plus any required optional field being present (e.g. `cloze` requires a declared blank span). It's what keeps the cross-join above from producing nonsense combinations like "spot-the-trap over a plain vocabulary item."

Building a new `ExerciseType` is almost always plugging together *existing* Renderers/Graders, not writing new ones. Worked examples, resolving several of `docs/webapp-spec-prompt.md`'s open taxonomy questions in the process:

- **Direction (ES→EN vs EN→ES)** — one `Item`, one ExerciseType (`transformation`), `ParamEnumerator` emits one param per declared direction. Two `ExerciseItem`s, two independent FSRS schedules (recall difficulty genuinely differs by direction — this is why Anki generates a separate card per direction from one note; this repo's own `directions` field already assumes it).
- **Conjugation** — not a new kind or ExerciseType. `vocabulary` kind, `transformation` ExerciseType, `directions: [en_es]` only (no reverse — matches existing card-design.md rationale that the reverse is trivial). Purely data-driven.
- **Fill-in-blank vs. translate-to-English over the same sentence** — one `sentence_pattern` Item (full sentence + designated blank span, stored once), two ExerciseTypes (`cloze`, `sentence_translate`) each rendering their own view of the same stored fields. No content duplication.
- **Listening — transcribe vs. translate** — same `AudioPromptRenderer`, two params (`mode: transcribe` grades against `back_es`; `mode: translate` grades against `front_en`). New Renderer, zero new Graders — reuses `NormalizedTextGrader` (case/accent/whitespace-insensitive text match).
- **Multiple-choice** — not its own exercise category. A response-mode + grader swap applicable to *any* prompt: `ChoicePromptRenderer` (needs a small `DistractorPicker` sampling wrong answers from same-kind/nearby-lesson items) + `ChoiceEqualityGrader`. Composes onto transformation, sentence_translate, confusables alike.
- **Word-bank reorder** — `WordBankPromptRenderer` (tokenizes `back_es`, shuffles) + `SequenceEqualityGrader`. No new Item field; tokens derive from the existing string.
- **Car mode → ASR upgrade** (the hard constraint's explicit ask) — `car_mode` = `AudioPromptRenderer` (reused from listening) + `SelfReportGrader` (trivial: trusts a `selfMarkedCorrect` flag from the UI). Upgrading to ASR later = swap `SelfReportGrader` → `ASRGrader`. Renderer and ParamEnumerator untouched — this is the literal mechanism behind "upgrades to ASR-graded without changing the item model."

Tally across the *entire* roadmap (not just Phase 0): **2 new Renderers** (Audio; Choice/WordBank/Cloze-family), **~3 new Graders** (SelfReport, ChoiceEquality, SequenceEquality — ASRGrader later), and `NormalizedTextGrader` alone covers transformation, sentence_translate, cloze, and listening. The session orchestrator only ever calls `grader.grade()` — it never branches on "is this mode self-graded," which is the actual swappability test `AGENTS.md` asks for.

## Phase 0 design

Scope per `docs/webapp-spec-prompt.md`: `Item`, `ExerciseType` interface with exactly one implementation (vocabulary/transformation, exact-match grading), `ReviewState`/SRS, `User`, `LessonGate`, `Session`, real adaptive trickle + unified session, flag/star, ~20-50 hand-authored seed items, API + tests + scrappy UI. Cut: everything else (ASR, listening, fill-in-blank/sentence-structure, false friends, car mode, skill-tree/streak visuals, real auth, audio ingestion, generation pipeline).

### Session orchestrator

Unified session only — Manual Review section is explicitly Phase 1, not built now. Due queue = `ExerciseItem`s where `ReviewState.due <= now`. New-item trickle = `Item`s with no `ReviewState` row yet and `min_lesson <= current_lesson`, ordered stably (lesson, then id), count adaptive to backlog size (Anki-style load balancing — backlog above a threshold shrinks trickle toward 0). Orchestrator picks a random *eligible* ExerciseType per item from the exercise-item pool — with one type registered this is a no-op today, but Phase 1 adding types requires zero orchestrator changes.

### Lesson gating

`User.current_lesson` (int, floor 1). Visibility is a query-time filter, not a data mutation: `item.min_lesson <= current_lesson`. Lowering the dial hides items from due-queue/trickle immediately; `ReviewState` rows are untouched, so raising it back un-hides with full history intact.

### API surface (shape, not a final route contract — route naming is an implementation-plan detail)

- `GET /api/session/today` — merged new+due queue for today.
- `POST /api/session/:id/attempt` — grades one exercise-item, updates `ReviewState` via FSRS, appends `ReviewLog`.
- `POST /api/items/:id/star` — toggle starred.
- `GET /api/items/starred` — the separate browsable starred list.
- `GET`/`PUT /api/settings/current-lesson` — the gating dial.

### Seed content

~20-50 hand-authored `vocabulary` items, YAML, drawn fresh from lessons 1-5 `rules.md` (gives the lesson dial something real to move for Playwright verification). Explicitly not generated — proving the domain model and proving the content pipeline are separate concerns (Phase 1 builds the pipeline).

### Scrappy UI

Unstyled but structurally stable (stable `data-testid`s, not pretty) per `AGENTS.md`'s Playwright mandate. Three screens: session (prompt/input/submit/reveal), settings (lesson dial), starred list.

### Directory + tooling

New `app/` subdirectory (SvelteKit project root), separate from the existing Anki/podcast pipeline (`build/`, `cards/`, `dist/`, `audio/`, `podcast.xml` — untouched).

```
app/
  src/lib/content/          # Item schema, YAML loader, ItemStore
  src/lib/exercise-types/   # Renderer/Grader/ParamEnumerator + registry + ExerciseItemStore
  src/lib/srs/              # ts-fsrs wrapper
  src/lib/db/               # Drizzle schema/migrations
  content/items/*.yml       # seed data
  tests/                    # Vitest
  e2e/                      # Playwright
```

pnpm as package manager.

### Build order — easiest first (this ordering should shape the GitHub issue breakdown directly)

1. Item schema + YAML loader + `ItemStore` — pure, no DB, no framework.
2. `ExerciseType` composition (3 interfaces) + one concrete `transformation` type + `ExerciseItemStore` cross-join — still pure.
3. ts-fsrs wrapper + `ReviewState` Drizzle schema/migrations — persistence enters.
4. Session orchestrator (due-queue + adaptive trickle).
5. API routes wrapping 1-4 + attempt recording + star + lesson-dial.
6. Scrappy UI screens.
7. Playwright + remaining unit/integration coverage.

### Verification (Phase 0 exit criteria — both automated and Playwright-driven, per `AGENTS.md`'s non-negotiable verification standard)

- **Unit:** FSRS state transitions, `ItemStore`/`ExerciseItemStore` construction from fixture YAML, lesson-gating filter, trickle sizing logic, `NormalizedTextGrader` edge cases (accents/case/whitespace).
- **Integration:** full attempt flow — `POST attempt` → `ReviewState` updates → due date moves forward correctly.
- **Playwright:** (1) dial the lesson setting down and up, watch gated items disappear/reappear in the UI; (2) run a full session, reload, confirm the due queue reflects it; (3) star an item, confirm it surfaces in both the boosted due-queue ordering and the separate starred list.

## Roadmap (unchanged from `docs/webapp-spec-prompt.md`, restated for self-containedness — not redesigned here)

Phase 1 (exercise-type breadth + pilot content pipeline), Phase 2 (listening/car-mode/confusables via existing TTS infra, streak+skill-tree as data only), Phase 3 (real mobile-first PWA), Backburner (ASR, SoundCloud ingestion, in-app lesson playback, multi-user, content beyond lesson 30) — see that doc for full detail per phase. Cross-check against the composability model above: Phase 1 needs new Renderers only, reusing `NormalizedTextGrader`; Phase 2 needs `AudioPromptRenderer` + `SelfReportGrader` + `ChoicePromptRenderer`, zero orchestrator/session changes; Backburner's ASR upgrade is a single Grader swap. The interface seam designed for Phase 0 holds without a rewrite at every subsequent phase, which is the actual test of the "interfaces first, non-negotiable" hard constraint.

## Next steps

1. Self-review this doc for placeholders/contradictions/ambiguity (done inline, see commit history if anything changed after review).
2. Anthony reviews this file.
3. Convert Phase 0's build order into GitHub Issues in `anwyho/transferencia` via `gh` (one issue roughly per build-order step above, finer-grained where useful), plus lightweight Milestones for Phase 1/2/3/Backburner mirroring the roadmap. **Do not start implementation until issues exist and Anthony has seen the breakdown.**
