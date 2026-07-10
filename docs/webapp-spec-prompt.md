# Handoff prompt: Language Transfer practice app

> Copy everything below this line and give it to the agent that will spec and build the app.

---

## Your task

You're speccing and then building a Spanish-learning practice app for Anthony, modeled on Duolingo's practice loop and Mochi/Anki's spaced repetition, but grounded in [Language Transfer](https://www.languagetransfer.org/complete-spanish)'s "mental transfer" pedagogy (derive Spanish from English via rules — e.g. `-tion → -ción` — rather than rote memorization).

This repo (`transferencia`) is currently a personal study pipeline: 90 Language Transfer lessons, grouped into 27 "bundles," feeding an Anki deck + podcast-style MP3 drills. Read before doing anything else:

- `README.md` — what exists today and why
- `docs/card-design.md` — existing card schema, types (`transformation`/`sentence`/`conjugation`), tiers (`primary`/`extended`), directions. Prior art for tagging shape — **not** a content source for the new app (see constraints below).
- `docs/lesson-bundles.md` — the 27-bundle plan and lesson ranges
- `lessons/lesson_NN/rules.md` and `transcript.md` — the actual rule definitions and verbatim lesson audio transcripts. This is your grounding source for content generation and for rule-tagging (mirrors `rule_ref` in the existing schema).
- `build/generate_bundle_flashcards.py`, `build/generate_anki.py` — existing Piper TTS pipeline. Reusable prior art for the app's future listening/car-mode audio (Phase 2, see roadmap).
- `AGENTS.md` (repo root) — how you and any subagents you spawn should work. Read it and follow it; it is not optional.

The new app lives in a **new subdirectory of this repo** (you choose the name as part of your architecture proposal — e.g. `app/`). Do not modify the existing Anki/podcast pipeline (`build/`, `cards/`, `dist/`, `audio/`, `podcast.xml`).

## Hard constraints (already decided — do not re-litigate these)

**Audience & auth**
- Single user (Anthony) today, but the data model must have a real `User` concept from day one — not global-singleton state — because this may open up to other users later. Auth mechanism itself can be minimal for a single user; propose one.

**Domain model — interfaces first, non-negotiable**
- Decouple **content items** from **exercise types**. An `Item` (a word, a rule-instance, a sentence pattern, a confusable-pair, a false-friend-pair) is content data. An `ExerciseType` is an interface for rendering + grading an item (multiple-choice, fill-in-blank, listening, speaking/self-graded "car mode," speaking/ASR-graded later). The same item must be drillable through multiple exercise types without duplicating content.
- Every subsystem — item store, SRS scheduler, exercise-type renderers, lesson gating, session orchestrator, (later) ASR grading — sits behind its own contract: standalone, independently testable/mockable, swappable without touching neighbors. A new exercise type, a different SRS algorithm, or a different ASR backend must be able to plug in later without a rewrite. This is the architectural spine of the whole project.

**Lesson gating**
- A single, reversible `current_lesson` setting per user. An item is visible iff `min_lesson(item) <= current_lesson`. No completion checklist/history — moving the dial down immediately hides higher-lesson content; moving it up immediately reveals it.
- Review sessions can additionally filter by an ad-hoc lesson range (e.g. "only items introduced lessons 8–10") independent of the gating dial.

**Spaced repetition — the backbone, not a bolt-on**
- Every item gets a real SRS review schedule (due dates/intervals) starting from first exposure, running in the background. Use a known algorithm (SM-2 or a simplified variant) — do not invent one.
- Items sourced directly from the actual Language Transfer lesson audio (mirrors existing `tier: primary`) get boosted review frequency over generated/extended items, so the word stays associated with the podcast.
- New-item introduction is a **daily trickle, not a floodgate**: adaptive to due-queue backlog (Anki-style load balancing) — fewer/no new items when reviews are backed up, more when caught up.
- Users can flag/star any item for review.

**Daily session structure**
- A unified default session: auto-mixes new-item trickle + due reviews, randomizing exercise type.
- Plus a manual Review section: pick exercise type yourself, filter by lesson range, or hit "pick for me" for a randomized due-queue pull.

**Practice modes / exercise types required**
- Vocabulary/transformation (EN→ES, ES→EN)
- Listening
- Sentence structure, including fill-in-the-blank
- Speaking — ASR-graded, using a **self-hosted** model (no third-party API). Research and justify the actual model choice; don't assume any specific one works for Spanish out of the box.
- **Car mode**: a hands-free, audio-only exercise lens (hear prompt → answer aloud → hear correct answer → self-judge) over the *same* items as everything else. Ships as **self-graded** well before ASR exists; later upgrades to ASR-graded without changing the item model.
- **Confusable pairs** (e.g. ser/estar, por/para) and **false friends** (e.g. *exitado* ≠ "excited" — it means aroused/turned on; true equivalent is *emocionado*) as a dedicated "spot the trap" exercise type, over a **curated, bounded** list (hand/LLM-drafted then reviewed) — not mass-generated like regular vocabulary.

**Content strategy**
- A brand-new, fresh example bank — decoupled from `cards/*.yml` (that stays untouched, serving the existing Anki pipeline only).
- Deliberately exhaustive per grammar rule (e.g. the `-al` suffix gets essentially all its examples, not a curated sample). This intentionally reverses the "abandoned exhaustive target" call in `docs/card-design.md` — for this app only.
- Pre-generate and store (an offline/build-time LLM-assisted pipeline, conceptually like existing `build/generate_*.py` scripts) — not live per-request generation. Must work fully offline once synced.
- **Content generation scope ceiling: lessons 1–30 (bundles A through I) only.** Do not generate content beyond lesson 30 without an explicit, deliberate re-decision after the app is in daily use. This is a hard scope cut, not a suggestion.

**Gamification**
- Streaks: goal-based (5 sessions/week, not daily).
- Skill-tree/map visualizing progress across the 90 lessons / 27 bundles.
- XP, hearts/lives, and badges are explicitly **not required** for v1 — you may float them as options but they weren't asked for.

**Platform**
- Must end up as an installable PWA (Add to Home Screen, iOS + Android), mobile-first UI.
- But: **backend/domain model first.** Early phases deliver an API + a real automated test suite + a scrappy/unstyled debug UI — not a polished frontend. The real PWA comes later (see roadmap).

**Verification — standing requirement, every phase**
- Every phase's exit criteria gets checked two ways: automated unit/integration tests, *and* a Playwright MCP-driven walkthrough of the actual scrappy UI observing real behavior (e.g. dial the lesson setting and watch gating change in the UI; run a session and watch the due queue update the next day). The scrappy UI must have stable-enough structure for Playwright to drive — it doesn't need to look good, it needs to be automatable.
- Use the repo's `/verify` skill / equivalent discipline: exercise the actual flow end-to-end, don't just trust green tests.

## Roadmap (locked — build one phase at a time)

Do **not** write a detailed spec for every phase up front. Sketch the whole-system entities once (just enough that Phase 0 won't need a rewrite), then write a full spec + implementation plan for **one phase at a time**, in order. Each phase must be independently shippable and independently verifiable per the rule above.

**Phase 0 — Foundation.** Core entities (`Item`, `ExerciseType` interface with exactly one implementation — vocabulary/transformation, exact-match grading — `ReviewState`/SRS, `User`, `LessonGate`, `Session`). Real adaptive trickle + unified session logic, built now, not deferred. Flag/star. Seed content: ~20–50 items, **hand-authored**, not generated — don't conflate proving the domain model with proving the content pipeline. API + tests + scrappy UI. Cut: ASR, listening, fill-in-blank/sentence-structure, false friends, car mode, skill-tree/streak visuals, real auth, audio ingestion, generation pipeline.

**Phase 1 — Exercise-type breadth + pilot content pipeline.** Add fill-in-the-blank and sentence-structure as new `ExerciseType`s on the *same* items (proves the decoupling). Build the generation pipeline, run it on **one pilot bundle only**. Add primary/extended SRS weighting. Manual Review section (exercise-type picker, lesson-range filter, "pick for me").

**Phase 2 — Cheap wins via existing infra.** Listening mode via the existing Piper TTS pipeline. Car mode (self-graded, same TTS, no ASR). False friends/confusables (curate list + one new exercise type). Streak + skill-tree as data only, no visuals. Decide whether/how to scale content generation further (still capped at lesson 30) based on Phase 1 findings.

**Phase 3 — Real frontend.** Replace the scrappy UI with the actual mobile-first installable PWA: session screen, review screen with filters, skill-tree map, streaks.

**Backburner — no committed phase, revisit only once Phase 3 is solid and in daily use:**
- Real ASR-graded speaking (self-hosted Spanish model — research candidates like Whisper large-v3/faster-whisper, NVIDIA Canary, MMS; don't assume Parakeet works for Spanish without checking).
- `yt-dlp` ingestion of Language Transfer's [SoundCloud "Complete Spanish" set](https://soundcloud.com/languagetransfer/sets/complete-spanish) into this repo, for personal offline listening only (LT is free/donation-supported — this is personal-use archival, not redistribution; don't publish the audio).
- In-app hosting/playback of that lesson audio, with finishing a lesson auto-advancing `current_lesson` — end goal: replace the standalone Language Transfer iOS app as the single interface for listening + practice.
- Multi-user/auth expansion beyond personal use.
- Content generation beyond lesson 30.

## Open questions you must resolve (research and/or ask Anthony — don't skip these)

- Self-hosted ASR model + what "grading a spoken answer" actually means (transcription exact-match? fuzzy match? phoneme-level pronunciation scoring?).
- Exact exercise-type taxonomy within each mode (word-bank reorder? multiple choice? free-type? audio dictation?) beyond what's specified above.
- Concrete auth mechanism for "single user now, maybe more later."
- Tech stack + hosting, including where ASR inference runs (CPU-viable model vs GPU requirement).
- Content-pipeline mechanics: which LLM, how examples tie to specific rules (mirroring `rule_ref`), a QA/review step before an example enters the live bank, and how a bad example gets fixed/versioned later without breaking SRS history tied to it.
- Data model for the skill-tree/map UI and how bundles/lessons map onto tree nodes.
- Exact flag/star review mechanics (separate from the SRS due queue, or folded into it with a priority boost?).

## Ideas worth considering (suggestions, not requirements)

- Per-rule mastery meter (not just per-lesson) — since the pedagogy is rule-transfer, tracking accuracy by rule is more diagnostic than lesson-level alone, and could drive an auto "weakest rules" queue.
- Difficulty/frequency tagging on generated examples, so session-picking can weight harder/rarer examples for advanced review.

## Process

1. Read the files listed above and `AGENTS.md`.
2. Confirm your understanding of the constraints above with Anthony before designing — ask clarifying questions one at a time, propose 2–3 options with trade-offs for the genuinely open items (ASR model, tech stack, SRS algorithm specifics), don't dump a giant questionnaire.
3. Write a short whole-system sketch (entities + phase boundaries only), then a full spec + implementation plan for Phase 0 alone. Get explicit approval before writing code.
4. Track work as GitHub Issues/Milestones in `anwyho/transferencia` via `gh` (already authenticated with `repo` scope). A Kanban Project board already exists (github.com/users/anwyho/projects/2) but the current token lacks the `project` scope — ask Anthony to run `gh auth refresh -s project` if you want to use it instead of plain issues.
5. Build, verify (tests + Playwright against the scrappy UI), ship Phase 0. Only then repeat this process for Phase 1.
