# Transferencia

A personal study repository for Mihalis Eleftheriou's free [Language Transfer — Complete Spanish](https://www.languagetransfer.org/complete-spanish) course (90 lessons), structured for spaced-repetition flashcards, hands-free audio drills, and bundle-grouped immersion stories.

## What's here

```
.
├── lessons/                    # one subdir per lesson, lesson_NN/, NN = 01..90
│   └── lesson_NN/
│       ├── rules.md            # the rules and patterns the teacher introduces
│       └── transcript.md       # verbatim transcript of the audio lesson
├── cards/                      # one yml per bundle, named <letter>_<theme>.yml
│                               # (a_foundation.yml … z_closeout.yml + ñ_line_past_full.yml)
├── stories/                    # one subdir per thematic group, <NN>_<group>/<NN>_<slug>.md
├── audio/                      # generated MP3s (tracked); audio/.cache + audio/.media ignored
│   ├── review_set_<letter>.mp3 # per-bundle 20-min drill MP3 (e.g. review_set_e.mp3)
│   └── stories/<group>/        # per-story MP3 (preface EN + body ES)
├── build/                      # generators: cards/*.yml → Anki, stories/*.md → MP3
├── docs/                       # design + content guidelines
│   ├── learning-system.md      # overview of the flashcard + audio drill system
│   ├── lesson-bundles.md       # the 27-bundle plan (A–Z + Ñ)
│   ├── card-design.md          # card schema, tiers, directions, quality bar
│   ├── audio-review-sets.md    # per-bundle review-set algorithm + CLI
│   ├── stories.md              # immersion-story file format + validator + voice/pace map
│   ├── study-routine.md        # daily flow: flashcards + audio time
│   ├── tts-plan.md             # TTS backend choice and progression plan
│   ├── build-notes.md          # implementation surprises and decisions
│   └── cross-references.md     # bird's-eye map of theme threads across all 90 lessons
└── Complete+Spanish+transcript+-+2019+final.pdf
```

## What it's for

Three outputs feeding the same source-of-truth files:

1. **An Anki deck** (`dist/transferencia.apkg`) for desk review, with one subdeck per bundle (e.g. `Transferencia::Bundle B Verb Unlock`), tagged so you can drill `lesson::03` or `bundle::b_verb_unlock` or the whole thing.
2. **Per-bundle review-set MP3s** (`audio/review_set_<letter>.mp3`) for the daily ~20-minute drive. Each set plays English prompt → silent pause for you to answer aloud → Spanish answer, with a "Siguiente." marker between cards. Direction is 70/30 EN→ES; the set is 70% current bundle + 30% prior-bundle review.
3. **Bundle-grouped immersion stories** (`audio/stories/<group>/<NN>_<slug>.mp3`) for exposure listening. Each story has an English orientation preface ("Listen for…") then the Spanish body. Tone: dialogue-driven, characters with edge.

Cards live in `cards/<letter>_<theme>.yml` — one bundle per Spanish-alphabet letter (A–Z + Ñ, 27 bundles, 9 fours + 18 threes = 90 lessons).

Stories live in `stories/<group_slug>/<NN>_<slug>.md` — nine hand-picked thematic groups along grammar arcs (see [docs/stories.md](docs/stories.md) for the map).

## Getting started

```bash
# Install Python deps
make install

# Download Piper voices (~120 MB)
build/scripts/fetch_piper_voices.sh

# Build everything
make all

# Outputs:
#   dist/transferencia.apkg                     → import into Anki
#   dist/cards.json                             → flat dump for Phase 2 / iOS Shortcut
#   audio/review_set_<letter>.mp3               → per-bundle 20-min drill
#   audio/stories/<group>/<NN>_<slug>.mp3       → immersion stories
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
- `make review-sets` — render all per-bundle review sets
- `make stories` — render all immersion stories
- `make validate-stories` — vocab-window check on stories (advisory warnings)

## Pedagogy

Following Language Transfer's method:

- **Mental transfer** — apply rules to derive Spanish from English (*-tion → -ción → -ar*), not rote vocab memorization.
- **Mental translation** — production direction (EN → ES) dominates. Hardest, most useful.
- **Reinforcement, not first exposure** — cards assume you've heard the lesson audio. Minimal rule-context on the card; lesson links for back-reference.
- **Two tiers per lesson** — *primary* (drawn directly from the lesson) and *extended* (real-world examples that apply the same rule, not in the lesson).
- **Immersion stories for exposure** — stories live entirely inside their group's grammar window, so a learner at L10 hears L10-level Spanish, and a learner at L49 hears the full conditional + line-past family at work.

See [docs/learning-system.md](docs/learning-system.md) for full design.

## Status

- ✅ Lesson rules + transcripts: 90/90
- ✅ Cross-references map: complete (`docs/cross-references.md`)
- ✅ Card system infrastructure: schema, parser, validator, Anki generator, review-set generator, story generator, Piper + macOS TTS adapters
- ✅ All 27 bundles (A–Z + Ñ) defined for L1–90 — see `docs/lesson-bundles.md`
- ✅ Bundles A–O cards built (L1–53)
- ✅ Stories: groups 1–5 (L1–49), 3 stories per group = 15 stories
- ⏳ Bundles P–Z cards (L54–90): defined; not yet built
- ⏳ Stories groups 6–9: deferred until bundles P–Z exist

## Daily routine

Target: 5–20 min flashcards + 20–40 min audio per day. See [docs/study-routine.md](docs/study-routine.md).

## Sync to phone

For now, the simplest path:

1. Drag `dist/transferencia.apkg` to Anki desktop, then sync to AnkiWeb. AnkiMobile pulls it automatically.
2. Drag `audio/review_set_*.mp3` and the `audio/stories/` tree into an iCloud Drive folder. Open them from Files on iPhone. CarPlay / Bluetooth play directly.

A private podcast feed is a future option for incremental auto-sync.

## Source

Audio + 2019 final transcript come from Language Transfer (free, donation-supported). The course itself is the work of Mihalis Eleftheriou.
