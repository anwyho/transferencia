# AGENTS.md

How agents — and any subagents they spawn — should work in this repo, especially on the new Language Transfer practice app (see `docs/webapp-spec-prompt.md`). This is a team of staff engineers, not a pool of task-followers. Act like it.

## Mindset

- **Own correctness, not just completion.** Finishing a task ≠ the task being right. Before calling something done, ask: does this actually work, does it handle the edge cases, would I sign off on this in review? If a requirement seems wrong or contradicts an earlier decision, say so instead of silently implementing it.
- **Think through edge cases as part of the work, not after.** Empty states, boundary values (lesson 0, lesson 30 exactly, an item with no examples yet), concurrent access, malformed input, the lesson-gating dial moving mid-session, a due-queue with zero items. Treat "what breaks this" as a design step, not a bug-report step.
- **Design for modularity on purpose.** Every subsystem (item store, SRS scheduler, exercise-type renderer, lesson gating, session orchestrator, ASR grading) is standalone: a clear interface, its own tests, mockable in isolation, replaceable without touching neighbors. Before writing a module, be able to answer: what does it do, how do you use it, what does it depend on. If you can't answer cleanly, the boundary is wrong — fix that before writing more code.
- **Cut scope like it costs you personally.** This project has a documented, deliberate scope cut (see the roadmap in `docs/webapp-spec-prompt.md`): one phase at a time, content capped at lessons 1–30, ASR/audio-ingestion/real-frontend-polish deliberately backburnered. Don't quietly expand scope because a feature is easy to add "while you're in there." Flag scope creep instead of absorbing it.
- **Don't speculatively design ahead.** Sketch the whole system's entities once; write detailed specs one phase at a time. A phase-3 detail decided during phase-0 work is usually wrong by the time you get there.

## When working with subagents

- Give subagents the same standard you'd want applied to your own work: a clear scope, the relevant constraints from `docs/webapp-spec-prompt.md`, and the expectation that they push back on ambiguity rather than guess.
- A subagent's job is not "do exactly what the prompt says and stop" — it's "do what the prompt is trying to achieve, correctly, and flag anything that doesn't add up."
- Don't let a subagent report success without evidence. See Verification below — this applies to subagent output exactly as much as your own.

## Verification (non-negotiable)

For any change:
1. Run the relevant automated tests (unit/integration).
2. Exercise the real behavior — for anything touching the app, that means a Playwright MCP-driven walkthrough of the actual scrappy UI, observing the real outcome (e.g. move the lesson dial, confirm gated items actually change in the UI; complete a session, confirm the due queue updated). The scrappy UI needs to stay automatable (stable structure), not pretty.
3. Don't claim something works from reading the code or trusting green tests alone. Evidence before assertions.

## Where things live

- `docs/webapp-spec-prompt.md` — the app's vision, hard constraints, and phase roadmap. Read it before making architectural decisions.
- `lessons/lesson_NN/{rules.md,transcript.md}` — grounding source for content generation and rule-tagging. The app's content is fresh and generated; it does not reuse `cards/*.yml`.
- `cards/`, `build/`, `dist/`, `audio/`, `podcast.xml` — the existing Anki/podcast pipeline. Prior art to read (especially the Piper TTS scripts, reused in Phase 2), but do not modify for app work.
- `app/` — the practice app: a pnpm + SvelteKit workspace, fully separate from the pipeline above. `app/packages/domain` (`@lt/domain`) is the **isomorphic** core — no `node:*`, persistence, or Svelte(Kit) imports (eslint-enforced, report M9); `app/packages/web` (`@lt/web`) is the SvelteKit layer. See `app/README.md`. Run app checks from `app/` (`pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm check`). Do not couple app work to `build/`/`cards/`/`dist/`/`audio/`/`podcast.xml`.

## Learning philosophy (why the app is shaped the way it is)

The pedagogy is Language Transfer's: **derive Spanish from English via rules, patterns, and paradigms — not rote memorization.** Every architectural choice serves that. When a design decision is ambiguous, the option that serves these first principles wins.

- **Rules/patterns are the unit of learning, not cards.** We schedule and measure mastery against *rules/paradigms*, exercised through many varied example items. Individual items are interchangeable *variance instruments*, not the thing being learned. Don't optimize per-card recall at the expense of rule generalization.
- **Variance is the mechanism, not noise.** Seeing a rule through many different items and exercise types is *how* it's learned; repetition of the same card is the weak form. Prefer fresh instruments and rotating exercise types over re-showing the same item.
- **Conceptual grasp over coverage.** A learner is ready to move on when they've grasped the *pattern*, not when they've seen every word in a group. Mastery is generalization: tolerant of the occasional miss, earned over many spaced varied exposures. Don't gate progress on exhaustive item coverage.
- **Mastery ≠ retention.** "How well do you know this rule" (mastery — advisory, lenient) and "when should we refresh it" (retention/timing) are separate signals. Never collapse them; never let the timing algorithm's internals stand in for competency.
- **The scheduler is ours and tunable — not pure FSRS/Anki.** FSRS supplies the decay math behind a port; the rule-mastery and selection layers on top are tunable and set by *evidence* (the Monte Carlo experiment), not by guesswork or Anki convention.

## Design tenets

- **Maximize the dependency-free surface.** As much of the system as possible should be useful and testable with zero dependency on the rest. `Item` is blind to how it's quizzed. Time, persistence, scheduling, and session composition each sit behind a port. Before writing a module, be able to state what it does, how it's used, and what it depends on — and keep that dependency list as short as honestly possible.
- **The append-only `ReviewLog` is ground truth; all state is a fold of it.** Any per-user state (schedules, mastery, exposure) must be rederivable by replaying the log. This is what makes swapping the scheduler, changing the grain, or retuning knobs a *replay*, not a migration.
- **Stable identities are sacred.** SRS history keys on stable ids (`item.id`, `ExerciseType.stableKey`, canonical param keys). Renaming any is a deliberate, reviewed remap — never a silent refactor. A committed id manifest + snapshot test turns accidental id drift into a failing build, not silent data loss.
- **Judge options against the requirements ledger.** `docs/superpowers/specs/language-transfer-requirements.md` is the living rubric. New ideas go to its backlog (deferred, not lost); design choices are scored against its constraints + requirements.
- **Multi-user and offline are additive, not retrofitted.** Every per-user table carries `user_id` and every query filters by it from day one; domain logic stays isomorphic (no server-only imports) so it can run client-side in the eventual offline PWA.
