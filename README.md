# Transferencia

A personal study repository for Mihalis Eleftheriou's free [Language Transfer — Complete Spanish](https://www.languagetransfer.org/complete-spanish) course (90 lessons), structured for spaced-repetition flashcards and hands-free audio drills.

## What's here

```
.
├── lessons/                    # one subdir per lesson, lesson_NN/, NN = 01..90
│   └── lesson_NN/
│       ├── rules.md            # the rules and patterns the teacher introduces
│       └── transcript.md       # verbatim transcript of the audio lesson
├── cards/                      # one yml per bundle, named <letter>_<theme>.yml
│                               # (a_foundation.yml … z_closeout.yml + ñ_line_past_full.yml)
├── audio/                      # generated drill MP3s (gitignored)
├── build/                      # generators: cards/*.yml → Anki, → MP3
├── docs/                       # design + content guidelines
│   ├── learning-system.md      # overview of the flashcard + audio drill system
│   ├── lesson-bundles.md       # the 27-bundle plan (A–Z + Ñ)
│   ├── card-design.md          # card schema, tiers, directions, quality bar
│   ├── study-routine.md        # daily flow: flashcards + audio time
│   ├── tts-plan.md             # TTS backend choice and progression plan
│   ├── build-notes.md          # implementation surprises and decisions
│   └── cross-references.md     # bird's-eye map of theme threads across all 90 lessons
└── Complete+Spanish+transcript+-+2019+final.pdf
```

## What it's for

Two outputs feeding the same source-of-truth YAML:

1. **An Anki deck** for desk review, with one subdeck per bundle (e.g. `Transferencia::Bundle B Verb Unlock`), tagged so you can drill `lesson::03` or `bundle::b_verb_unlock` or the whole thing.
2. **Cumulative MP3 drill tracks** for hands-free practice in the car. Each track plays English prompt → silent pause for you to answer aloud → Spanish answer, mixing both directions (production + recognition).

Cards live in `cards/<letter>_<theme>.yml` — one bundle per Spanish-alphabet letter (A–Z + Ñ, 27 bundles, 9 fours + 18 threes = 90 lessons).

## Getting started

```bash
# Install Python deps
make install

# Download Piper voices (~100 MB)
build/scripts/fetch_piper_voices.sh

# Build everything
make all

# Outputs:
#   dist/transferencia.apkg                     → import into Anki
#   dist/cards.json                             → flat dump for Phase 2 / iOS Shortcut
#   audio/lesson_NN.mp3                         → cumulative drill tracks
```

If `python3.11` isn't on your PATH, override with `make PYTHON=python3 install` and use a virtualenv:

```bash
python3 -m venv .venv
.venv/bin/pip install -r build/requirements.txt
make PYTHON=.venv/bin/python install   # or any other make target
```

Useful targets while iterating:

- `make validate` — parse all card YAML
- `make anki` — build `dist/transferencia.apkg`
- `make audio-quick` — build `audio/lesson_03.mp3` via macOS `say` (fast smoke test)

## Pedagogy

Following Language Transfer's method:

- **Mental transfer** — apply rules to derive Spanish from English (*-tion → -ción → -ar*), not rote vocab memorization.
- **Mental translation** — production direction (EN → ES) dominates. Hardest, most useful.
- **Reinforcement, not first exposure** — cards assume you've heard the lesson audio. Minimal rule-context on the card; lesson links for back-reference.
- **Two tiers per lesson** — *primary* (drawn directly from the lesson) and *extended* (real-world examples that apply the same rule, not in the lesson).

See [docs/learning-system.md](docs/learning-system.md) for full design.

## Status

- ✅ Lesson rules + transcripts: 90/90
- ✅ Cross-references map: complete (`docs/cross-references.md`)
- ✅ Card system infrastructure: schema, parser, validator, Anki generator, MP3 generator, Piper + macOS TTS adapters
- ✅ All 27 bundles (A–Z + Ñ) defined for L1–90 — see `docs/lesson-bundles.md`
- ✅ Bundles A–I cards built (L1–28): ~2500 cards total
- ⏳ Bundles J–Z (L29–90): defined; cards not yet built

## Daily routine

Target: 5–20 min flashcards + 20–40 min audio drill per day. See [docs/study-routine.md](docs/study-routine.md).

## Sync to phone

For now, the simplest path:

1. Drag `dist/transferencia.apkg` to Anki desktop, then sync to AnkiWeb. AnkiMobile pulls it automatically.
2. Drag `audio/lesson_*.mp3` into an iCloud Drive folder. Open them from Files on iPhone. CarPlay / Bluetooth play directly.

A private podcast feed is a future option for incremental auto-sync.

## Source

Audio + 2019 final transcript come from Language Transfer (free, donation-supported). The course itself is the work of Mihalis Eleftheriou.
