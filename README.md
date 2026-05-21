# Transferencia

A personal study repository for Mihalis Eleftheriou's free [Language Transfer — Complete Spanish](https://www.languagetransfer.org/complete-spanish) course (90 lessons), structured for spaced-repetition flashcards and hands-free audio drills.

## What's here

```
.
├── lessons/                # one subdir per lesson, lesson_NN/ (NN = 01..90)
│   └── lesson_NN/
│       ├── rules.md        # the rules and patterns the teacher introduces
│       └── transcript.md   # verbatim transcript of the audio lesson
├── cards/                  # one yml per bundle, <letter>_<theme>.yml
│                           # (a_foundation.yml … z_closeout.yml + nn_line_past_full.yml for Ñ)
├── audio/
│   └── flashcards/         # per-bundle drill MP3s, bundle_<letter>_pt<NN>.mp3
├── build/                  # generators (Anki, flashcards, podcast feed) + lib + tests
├── docs/                   # design + content guidelines
│   ├── lesson-bundles.md
│   ├── card-design.md
│   ├── tts-plan.md
│   ├── build-notes.md
│   └── cross-references.md
├── dist/transferencia.apkg # generated Anki deck
├── podcast.xml             # RSS feed for podcast clients (Pocket Casts etc.)
└── Complete+Spanish+transcript+-+2019+final.pdf
```

## What it's for

Two outputs feeding the same source-of-truth YAML cards:

1. **An Anki deck** (`dist/transferencia.apkg`) for desk review. One subdeck per bundle (e.g. `Transferencia::Bundle B Verb Unlock`), tagged so you can drill `lesson::03`, `bundle::b_verb_unlock`, or the whole thing.
2. **Per-bundle flashcard MP3s** (`audio/flashcards/bundle_<letter>_pt<NN>.mp3`) for hands-free listening — car, walk, dishwashing. Each bundle's cards are shuffled and split into ≤30-min parts. Three exercise shapes interleaved:
   - **EN → ES** sentence/transformation: English prompt → Spanish answer.
   - **ES → EN** sentence/transformation: Spanish prompt (spoken twice for sentences) → English answer.
   - **Conjugation**: spliced `"Conjugate the I form for"` (EN) + `"dormir."` (ES) → after pause, `"duermo."` → after second pause, `"duermo means I sleep."` (mini second flashcard for meaning).

A two-tone E-major-7 chime separates cards. An accompanying `podcast.xml` makes the bundle MP3s subscribable in Pocket Casts / Overcast / Apple Podcasts.

## Getting started

```bash
python3 -m venv .venv
.venv/bin/pip install -r build/requirements.txt

# Download Piper voices (~120 MB)
build/scripts/fetch_piper_voices.sh

# Build everything
make all

# Outputs:
#   dist/transferencia.apkg                          → import into Anki or Mochi
#   audio/flashcards/bundle_<letter>_pt<NN>.mp3      → per-bundle drill audio
#   podcast.xml                                      → RSS feed for podcast clients
```

The Makefile defaults `PYTHON` to `.venv/bin/python`. Override with `make PYTHON=python3 install` if you prefer system Python.

Useful targets:

- `make validate` — parse all card YAML
- `make anki` — build `dist/transferencia.apkg`
- `make flashcards` — render all bundle drill MP3s (Piper TTS, on-disk cache)
- `make podcast` — emit `podcast.xml` pointing at the rendered MP3s
- `make clean` — trash dist + audio outputs (preserves Piper cache)

### Rendering a single bundle

```bash
.venv/bin/python build/generate_bundle_flashcards.py --bundle e
```

## Pedagogy

Following Language Transfer's method:

- **Mental transfer** — apply rules to derive Spanish from English (*-tion → -ción → -ar*), not rote vocab memorization.
- **Mental translation** — production direction (EN → ES) dominates.
- **Reinforcement, not first exposure** — cards assume you've heard the lesson audio. Minimal rule-context on the card; lesson links for back-reference.
- **Two tiers per lesson** — *primary* (drawn directly from the lesson) and *extended* (real-world examples that apply the same rule, not in the lesson).
- **Deferred meaning on conjugations** — the conjugation drill speaks the Spanish answer first, then later spells out the English meaning. Lets you self-test the form *and* the gloss as two passes through the same card.

See [docs/card-design.md](docs/card-design.md) for card schema + tier conventions, and [docs/lesson-bundles.md](docs/lesson-bundles.md) for the 27-bundle plan.

## Sync to phone

**Pocket Casts (private feed)**: subscribe to the GitHub-hosted `podcast.xml` once it's pushed. New parts surface as new episodes; speed adjustment + auto-download work as with any podcast.

**Files-on-iPhone fallback**: drag `audio/flashcards/` into iCloud Drive. Open from Files app on iPhone; CarPlay / Bluetooth play directly. Pocket Casts can also import from a local folder.

`dist/transferencia.apkg` → Anki desktop → sync to AnkiWeb → AnkiMobile pulls it.

## Source

Audio + 2019 final transcript come from Language Transfer (free, donation-supported). The course itself is the work of Mihalis Eleftheriou.
