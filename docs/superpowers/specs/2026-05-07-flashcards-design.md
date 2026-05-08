# Spec — Flashcard + Audio Drill + Story System

**Date:** 2026-05-07
**Owner:** Anthony Ho
**Status:** approved for implementation planning

This spec consolidates the brainstormed design for a Spanish flashcard + audio drill system built on top of the existing Language Transfer lesson notes in this repository. It is the formal handoff to the writing-plans skill.

It does not duplicate the user-facing design docs. Those live alongside the code:

- [`docs/learning-system.md`](../../learning-system.md) — the design's narrative overview
- [`docs/lesson-bundles.md`](../../lesson-bundles.md) — the 8 topical bundles for L1-22
- [`docs/card-design.md`](../../card-design.md) — YAML schema, card types, directions, quality bar
- [`docs/stories.md`](../../stories.md) — story system: gloss format, stretch budget, file layout
- [`docs/study-routine.md`](../../study-routine.md) — daily flow: flashcards + audio time
- [`docs/tts-plan.md`](../../tts-plan.md) — TTS backend evaluation and Piper-first commitment

This spec adds the implementation contract: scope, components, interfaces, milestones, acceptance criteria, open questions.

## Goal

Produce three artifacts from source-of-truth markdown:

1. **An Anki deck** (`dist/transferencia.apkg`) for spaced-repetition desk study, with subdecks per lesson and per topical bundle, multi-axis tags, and stable note IDs that survive edits.
2. **Cumulative MP3 drill tracks** (`audio/lesson_NN.mp3`) for hands-free practice in the car. Each track plays English prompt → silent pause → Spanish answer, mixing all three drill directions (production / recognition / shadow).
3. **Short Spanish story tracks** (`audio/stories/<topic_slug>__<NN>_<title-slug>.mp3`) for immersion-style listening. 5 stories per topical bundle, sourced from markdown files with a word-aligned literal English gloss layer. Pure Spanish audio, no English in the audio.

Initial scope: lessons 1-22, organized into 8 topical bundles. Estimated ~2000-2500 cards + 40 stories.

## Non-goals

- Not building an iOS app, web app, or browser-based study UI.
- Not building a full SRS engine — Anki owns scheduling.
- Not in initial scope: Phase 2 interactive Apple Shortcut, ChatGPT voice integration, lessons 23-90. Architected for, not implemented.

## Architecture

```
              ┌──────────────────────────────┐    ┌──────────────────────────────┐
              │ lesson_NN/cards.yml          │    │ stories/<topic>/NN_*.md      │
              │ cards_topical/topic_*.yml    │    │ (Spanish + literal gloss)    │
              └──────────────┬───────────────┘    └──────────────┬───────────────┘
                             │                                   │
                ┌────────────┴────────────┐                      │
                │                         │                      │
                ▼                         ▼                      ▼
       ┌──────────────────┐      ┌──────────────────────────────────────┐
       │ generate_anki.py │      │  generate_audio.py                   │
       │  (genanki)       │      │  --cards: cards.yml → drill tracks   │
       └────────┬─────────┘      │  --stories: stories.md → story tracks │
                │                │  (Piper TTS + pydub)                  │
                ▼                └────────────┬─────────────────────────┘
       dist/transferencia.apkg                │
       dist/cards.json (for Phase 2)          ▼
                              audio/lesson_NN.mp3 (cumulative drill)
                              audio/stories/<topic>__NN_<title>.mp3
```

The card generators read every `lesson_NN/cards.yml` and `cards_topical/topic_*.yml`. The story renderer reads every `stories/<topic_slug>/<NN>_<title>.md`. Parser, normalizer, and TTS adapter live under `build/lib/` and are shared.

## Components

### `build/lib/parse.py`

Loads + validates all card YAML files. Returns a flat list of `Card` dataclasses. Validates:

- Required fields present
- `id` globally unique
- `lessons` matches the file context (lesson file → `[NN]` only; topical → subset of `[AA..BB]`)
- For extended cards, `max(lessons)` matches the file's lesson context (no reaching forward)
- `rule_ref` points at rule numbers actually present in `rules.md`
- Sentence cards under length cap (≤8 words for L1-10, ≤12 for L11-22)

`generate_anki.py --validate-only` and `generate_audio.py --validate-only` both exit cleanly when validation passes, non-zero with a specific error otherwise.

### `build/lib/normalize.py`

Spanish-text utilities:

- `strip_accents(s)` — for fuzzy answer matching in Phase 2
- `levenshtein(a, b)` — same
- Normalization helpers shared by both generators

### `build/lib/tts/`

Backend-agnostic TTS adapter package. Protocol:

```python
class TTS(Protocol):
    def synth(self, text: str, lang: Literal["en", "es"], voice: str | None = None, pace: float = 1.0) -> Path:
        """Return path to a cached WAV fragment."""
```

Implementations:

- `piper.py` — default. Loads ONNX models from `build/.piper-voices/`.
- `mac_say.py` — offline fallback (`subprocess.run(["say", ...])`).
- `openai.py` — optional paid backend (premium quality).
- `azure.py` — written only if Stage 2 of TTS plan is triggered.

Caching: every (`text`, `voice`, `backend`) → SHA1 → `audio/.cache/<hash>.wav`. Generators never re-synthesize fragments that exist on disk.

### `build/generate_anki.py`

Inputs: parsed cards from `build/lib/parse.py`.

Outputs:
- `dist/transferencia.apkg`
- `dist/cards.json` (when `--export-json` flag set)

Behavior:
- One `genanki.Note` per card, multiple cards per note via templates conditioned on `directions`
- Stable note IDs: `int(sha1(card.id).hexdigest()[:15], 16)`
- Subdeck assignment: `Transferencia::Lesson NN` for lesson cards, `Transferencia::Topic::<NN-MM Theme>` for topical
- Tags applied per card: `lesson::NN`, `topic::NN_MM_<theme>`, `tier::<tier>`, `type::<type>`, `direction::<dir>`, `rule::L<N>-<rule>`

CLI:

```
build/generate_anki.py [--out PATH] [--lessons LIST] [--validate-only] [--export-json PATH]
```

### `build/generate_audio.py`

Single entry point with two modes: card drill tracks and story tracks.

#### Card drill mode (default)

Inputs: parsed cards + chosen TTS backend.

Outputs: one or more `audio/lesson_NN.mp3`, where each track is **cumulative** — track NN includes every card whose `max(card.lessons) ≤ NN`.

Per-card segment construction:
- `en_es`: TTS_en(front) → silence(pause) → TTS_es(back) → silence(0.5s)
- `es_en`: TTS_es(back) → silence(pause) → TTS_en(front) → silence(0.5s)
- `shadow`: TTS_es(back) → silence(pause - 1) → TTS_es(back) → silence(0.5s)

Pause defaults: 5s for sentences, 3s for transformation/conjugation. Configurable via `--pause`.

Track ordering: `random.Random(seed=lesson_N)` shuffle of all expanded segments — deterministic across re-runs, different per track.

Optional preamble: the first time a `rule_ref` appears in a track, prepend a one-time "from lesson three" English call-out at lower volume. Suppressible via `--no-preamble`.

Encoding: MP3, 96kbps CBR, mono.

#### Story mode (`--stories`)

Inputs: parsed story files from `stories/<topic_slug>/<NN>_<title>.md`. Each story file has YAML frontmatter (topic, lessons, title, title_en, order, target_minutes) and a `## Story` section with Spanish lines + italic literal-gloss lines + footnotes.

Outputs: `audio/stories/<topic_slug>__<NN>_<title-slug>.mp3` per story file.

Generation:
- Parse out only the Spanish lines (drop gloss, drop footnotes, drop free translation section).
- Concatenate paragraph by paragraph through Piper at `length_scale=1.15`.
- Insert 1.5s silence between paragraphs.
- Optional ≤5s royalty-free music intro/outro (off by default; `--story-music PATH` to enable).
- Encode MP3 same parameters as card tracks.

CLI:

```
build/generate_audio.py [--through N] [--all-tracks] [--backend BACKEND]
                       [--voice-es VOICE] [--voice-en VOICE] [--pace FLOAT]
                       [--pause SECONDS] [--no-preamble] [--validate-only]
                       [--stories] [--bundle TOPIC_SLUG] [--story-music PATH]
```

`--stories` switches to story mode. `--bundle topic_01_03_foundation` limits to one bundle (otherwise all 40). `--stories` is independent of `--through` / `--all-tracks` (those apply to card mode).

### `build/lib/validate_story.py`

Per-story-file validator:

- Parses frontmatter; confirms `topic`, `lessons`, `title`, `title_en`, `order` (1-5), `target_minutes`, `stretch_used_pct`.
- Tokenizes the Spanish lines (NFC-normalize, lowercase, strip punctuation, ignore proper nouns by capitalization heuristic + manual override list).
- Computes `unknown_count / total_count` against the union of allowed vocab from every `lesson_NN/rules.md` for `N ≤ max(lessons)`.
- Errors if the ratio exceeds the bundle's stretch budget (per `docs/stories.md` table).
- Warns with a list of stretch words used.

`make validate-stories` runs this against every file under `stories/`.

### `Makefile`

Standard targets: `install`, `validate`, `validate-stories`, `anki`, `cards-json`, `audio`, `audio-quick`, `stories`, `all`, `clean`. See [`docs/learning-system.md`](../../learning-system.md) for the contents.

## Repository changes

New top-level paths:

```
build/
├── generate_anki.py
├── generate_audio.py
├── lib/
│   ├── __init__.py
│   ├── parse.py
│   ├── normalize.py
│   └── tts/
│       ├── __init__.py
│       ├── piper.py
│       └── mac_say.py
├── scripts/
│   ├── fetch_piper_voices.sh
│   └── tts_compare.py
└── requirements.txt

cards_topical/
└── topic_*.yml         # 8 files for L1-22

lesson_NN/cards.yml     # 22 new files (one per lesson L1-22)

stories/
├── _world.md           # optional shared cast/setting bible
└── topic_*/            # 8 directories
    ├── 01_*.md         # 5 stories per directory
    ├── 02_*.md
    ├── 03_*.md
    ├── 04_*.md
    └── 05_*.md         # 40 story files total

dist/                   # gitignored
audio/                  # tracks gitignored, .cache/ gitignored
audio/stories/          # gitignored, generated
.env                    # gitignored
.env.example
Makefile
```

`.gitignore` additions:

```
audio/lesson_*.mp3
audio/.cache/
audio/eval/
build/.piper-voices/
build/__pycache__/
dist/
.env
.venv/
```

## Milestones

Each milestone delivers something usable. Order matters; later milestones depend on earlier ones.

### M1 — Schema, parser, scaffolding

- `build/requirements.txt` (genanki, PyYAML, pydub)
- `build/lib/parse.py` + `build/lib/normalize.py`
- `build/generate_anki.py --validate-only` works (no .apkg yet — exits 0 if YAML parses)
- `Makefile` with `install` and `validate` targets
- One handwritten `lesson_01/cards.yml` (~10 cards) as smoke test

### M2 — Bundle A cards (lessons 1-3)

- `lesson_01/cards.yml`, `lesson_02/cards.yml`, `lesson_03/cards.yml`
- `cards_topical/topic_01_03_foundation.yml`
- ~150-200 cards covering primary + extended
- Hand-authored to establish the quality bar; later bundles can mix LLM-drafted + hand-reviewed

### M3 — Anki generator end-to-end

- `build/generate_anki.py --out dist/transferencia.apkg` produces a working .apkg
- `build/generate_anki.py --export-json dist/cards.json` produces a flat JSON dump for Phase 2 consumers
- Subdecks render as expected
- Tags applied correctly
- Card templates render hint + rule_ref footer
- Re-importing after editing a card preserves SRS history
- Imported on Anki desktop + AnkiMobile

### M4 — TTS adapter + audio MVP

- `build/lib/tts/piper.py` and `build/lib/tts/mac_say.py`
- `build/scripts/fetch_piper_voices.sh` downloads default voices
- `build/generate_audio.py --through 3 --backend piper` produces `audio/lesson_03.mp3`
- Listen test: drive once with the track. Make notes per the TTS plan acceptance bar.
- A/B against `mac_say` to confirm Piper is the right default. If not, escalate to Stage 2 of the TTS plan.

### M5 — Bundles B-H cards (lessons 4-22)

- 7 more lesson card files + 7 more topical bundle files
- ~1800 more cards
- Workflow: LLM-draft extended cards from each lesson's `rules.md`, hand-review against the quality bar, commit

### M5.5 — Story system + Bundle A stories

- `build/lib/validate_story.py` (vocab budget validator)
- `build/generate_audio.py --stories` mode added
- Optional `stories/_world.md` cast/setting bible established
- 5 stories drafted for Bundle A in `stories/topic_01_03_foundation/`:
  - Spanish narrative + word-aligned literal gloss + free translation
  - Stretch-budget compliance (Bundle A = 0%)
  - Audio rendered into `audio/stories/topic_01_03_foundation__*.mp3`
- One drive-and-listen pass to validate pacing and intelligibility

### M6 — Cumulative audio for L1-22

- `make audio` produces all 22 cumulative card tracks
- Sync flow documented (iCloud Drive folder works for one user)
- Drive routine established

### M6.5 — Bundles B-H stories

- 35 more story files: 5 per bundle for B through H
- Each bundle's 5 stories climb in difficulty within the bundle (story 1 ≈ 0% stretch, story 5 = full bundle budget)
- All validated against bundle stretch budgets per `docs/stories.md`
- All 40 story tracks rendered: `make stories`
- Workflow: LLM-draft Spanish narrative under bundle vocab + stretch budget, hand-write literal gloss layer, hand-review free translation, validate, render

### M7 (optional, post-spec) — Phase 2 interactive

- `cards.json` export (already implemented in M3)
- Apple Shortcut prototype documented in a new `docs/phase-2-interactive.md`
- ChatGPT voice path documented as zero-build escape hatch

M1-M3 form the first usable artifact: ~150 cards plus the generator. Ship that and study before continuing. M5.5 (Bundle A stories) is the next standalone delivery — after it lands, you have ~25 minutes of immersion audio for the bundle you've been studying with cards.

## Acceptance criteria

A milestone passes when:

| Milestone | Criteria |
|-----------|----------|
| M1 | `make validate` exits 0 on the smoke-test YAML; non-zero with a clear error on intentional malformed YAML. |
| M2 | All YAML in Bundle A files passes validation; primary cards cover 100% of vocab + examples in `lesson_01/02/03/rules.md`; extended cards are 2-3× the primary count. |
| M3 | Imported `.apkg` shows correct subdeck tree in Anki; sample card renders with hint and rule footer; re-import after editing one card preserves the rest's review history. |
| M4 | `audio/lesson_03.mp3` plays on iPhone via CarPlay; intelligible end-to-end; mispronunciations under 1 in 50 lesson-vocab words; Piper passes the TTS plan acceptance bar. |
| M5 | All 22 lesson card files + 8 topical files validate; `make anki` produces a deck with ~2000-2500 cards. |
| M5.5 | `make validate-stories` passes for Bundle A; 5 story MP3s render under `audio/stories/topic_01_03_foundation__*.mp3`; cold-listen test passes (intelligible at the bundle's vocab cap, pace appropriate). |
| M6 | All 22 cumulative tracks build with `make audio`; total runtime under 5 minutes (cache warm); each track under 60 minutes of audio. |
| M6.5 | All 40 story files validate within their bundle's stretch budget; `make stories` produces 40 MP3s; each story within ±20% of its `target_minutes`. |

## Open questions

These don't block the plan but should be resolved during implementation.

1. **Bundle B-H boundary verification.** The bundles in `docs/lesson-bundles.md` are derived from theme threads in `CROSS_REFERENCES.md` plus rules.md summaries. Verify each boundary while authoring the actual cards — if a bundle feels wrong in practice, redraw before committing 200 cards to it.
2. **LLM drafting workflow for extended cards.** M5 assumes LLM-draft + hand-review for the bulk of extended cards. Decide on a prompt template before starting M5. Likely a per-lesson prompt that takes `rules.md` + the quality bar from `docs/card-design.md` and outputs candidate YAML.
3. **Audio sync mechanism.** Stage 1 assumes "drag mp3s to iCloud Drive folder, play in Files app on iPhone." Validate that CarPlay handles this cleanly. If not, fall back to a private podcast feed (host audio/ on a static server, generate `feed.xml`).
4. **Phase 2 trigger.** Decide *after* a few weeks of using pre-rendered MP3s whether the pause-pattern feels stale enough to warrant the Apple Shortcut work. Don't pre-build it.
5. **Story cast continuity.** Decide whether `stories/_world.md` (shared cast / setting) is worth establishing up front, or whether it should accrete organically as stories are written. Recommend: write a sketch when authoring Bundle A's first story, refine as more land.
6. **Story drafting workflow.** LLM-drafted Spanish narrative + hand-written literal gloss is the proposed default, but the gloss layer is craft-heavy. After Bundle A's 5 stories, evaluate whether the time-per-story is sustainable or whether to invest in tooling (e.g. a gloss-assist script that runs the Spanish through a tagger and pre-fills word-by-word skeleton).

## References

- Project README: `../../../README.md`
- Cross-references map: `../../../CROSS_REFERENCES.md`
- Language Transfer course: https://www.languagetransfer.org/complete-spanish
- Piper: https://github.com/rhasspy/piper
- genanki: https://github.com/kerrickstaley/genanki
