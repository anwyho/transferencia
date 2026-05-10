# Learning System Overview

The card system has one source of truth (YAML per topical bundle, one file per Spanish-alphabet letter) feeding two delivery channels (Anki deck for desk study, MP3 tracks for the car). The point is to operationalize Language Transfer's "mental transfer + mental translation" approach with spaced repetition.

## Why two channels

Anki and audio drills do different jobs.

**Anki** is the discipline layer. It owns scheduling (SM-2 / FSRS), tracks per-card history, syncs to phone, and shows hints + lesson back-links. It's where you do focused 10-minute sessions at a desk with the answer hidden until you commit.

**Audio drills** are the volume layer. You can't safely look at a screen while driving, but your ears and your mouth are free for 30+ minutes a day. Pre-rendered MP3s play through CarPlay / Bluetooth and force you to produce out loud — no shortcut to flipping a card.

Both consume the same `cards/<letter>_<theme>.yml` bundle files. Add a card once, get it on both surfaces.

## Two tiers of cards

### Primary

Cards drawn directly from `lessons/lesson_NN/rules.md`:

- The Vocabulary section becomes vocab and transformation cards.
- The Examples / Sentences section becomes sentence cards (often verbatim).
- The Rules section seeds transformation patterns and key conjugation drills.

Goal: every word, sentence, and conjugation the teacher actually says out loud in the lesson is reviewable as a card.

### Extended

Cards applying the *same rule* to material the lesson didn't cover:

- Real-world cognates the teacher didn't enumerate (lesson 3 covers *importante / diferente / constante*; extended adds *evidente, suficiente, interesante, permanente*).
- Sentences that combine the lesson's new construct with vocab from earlier lessons (mental compounding).
- Common everyday phrases native speakers actually use.
- Variants of lesson sentences (negate, swap pronouns, flip word order).

Goal: 2-3× the volume of primary, so the rule is exercised across many real surface forms instead of just the handful the teacher had time for.

**Hard rule for extended cards:** the card's `lessons:` array names every lesson whose grammar the card relies on. The card's *latest* lesson must fall inside the bundle's lesson range — that's the bundle's "home." Earlier lessons in the array can reference prior bundles. If you want to write "Es importante que vengas pronto" the card belongs in the bundle whose range includes the lesson where mood-after-*importante* lands (V, L74–77).

## Three drill directions

Every card declares which directions it supports:

| Direction | Front | Back | Used for |
|-----------|-------|------|----------|
| `en_es` | English prompt | Spanish answer | All cards. The mental-translation core. Production direction. |
| `es_en` | Spanish prompt | English answer | All sentence + transformation cards. Recognition / listening. |

In Anki, each direction is a separate card generated from the same note. In the audio tracks, both directions get mixed into the same cumulative MP3 for variety.

Conjugation cards are `en_es`-only (recognition would be trivial).

## Topical bundles

We group all 90 lessons into 27 bundles, one per Spanish-alphabet letter (A–Z + Ñ). Each bundle is 3 or 4 lessons (9 fours + 18 threes = 90). Boundaries follow the theme threads in `cross-references.md`.

Each bundle file at `cards/<letter>_<theme>.yml` is the single source of truth for every card whose latest lesson falls inside that bundle. The file frontmatter declares the lesson range:

```yaml
bundle: A
title: "Foundation: vowels, es / no es, convertible-word rules"
lessons: [1, 2, 3]
cards: [...]
```

A card whose `lessons: [2, 3]` lives in bundle A. A card whose `lessons: [3, 4]` (max=4) lives in bundle B even though it leans on grammar from A. Cards get Anki-tagged with `lesson::NN` for every lesson in their array and `bundle::A` for the home bundle.

See [lesson-bundles.md](lesson-bundles.md) for the full 27-bundle table.

## Reinforcement, not first exposure

The audio lessons do the teaching. Cards do the retention. So:

- Cards assume you've already heard the lesson and understood the rule.
- The card front is short. No long rule statements crowding the prompt.
- A `rule_ref` field on every card points back to the relevant rule(s) in `rules.md` — Anki shows it as a footer link, audio mentions it once per track when introducing new material.
- Hints (when present) are minimal nudges (`-ent → -ente`), never the full answer.

If you've never heard the audio for a lesson, don't unlock its cards yet. Listen first.

## Generators

Two scripts under `build/` consume the YAML:

### `generate_anki.py`

Produces `dist/transferencia.apkg`:

- One subdeck per bundle (`Transferencia::Bundle B Verb Unlock`).
- Tags: `lesson::03`, `bundle::a_foundation`, `tier::primary`, `tier::extended`, `type::transformation`, `type::sentence`, `type::conjugation`, `direction::en_es`, etc.
- Custom card templates render hint + `rule_ref` footer on the back.
- Uses `genanki` Python library.
- Stable note IDs derived from the card's `id` field, so re-imports preserve scheduling history.

### `generate_audio.py`

Produces `audio/lesson_NN.mp3` (cumulative — track NN includes every card whose `max(lessons) ≤ NN`):

- Per card: TTS English prompt → 4-6 second silent pause → TTS Spanish answer → 0.5s gap → next.
- Mixes both directions in a randomized order so you can't pattern-match.
- TTS adapter defaults to [Piper](https://github.com/rhasspy/piper) — free, on-device, Apache 2.0, with strong Spanish neural voices. Optional paid backends (OpenAI, Azure) plug in via the same adapter interface. macOS `say` kept as offline emergency fallback. See [tts-plan.md](tts-plan.md).
- Tracks land in `audio/`, gitignored — regenerate locally with `make audio`. Sync to iPhone via iCloud Drive / Files / a private podcast feed; play in CarPlay.

### Phase 2: interactive mic-based drilling (planned, not initial scope)

An Apple Shortcut consumes a generated `cards.json`, speaks a prompt, opens dictation for your spoken answer, fuzzy-compares (accent-strip + Levenshtein), speaks the correct answer, and loops. CarPlay-runnable via "Hey Siri, Spanish drill". Same source, different consumer.

ChatGPT/Claude voice mode with `cards.md` pasted into a Project / Custom GPT also works as a zero-build escape hatch.

## Daily routine

Target: 5–20 min flashcards + 20–40 min audio drill per day. See [study-routine.md](study-routine.md) for the suggested weekly rhythm.

## Status

Bundles A–I built (lessons 1–28, ~2500 cards). Bundles J–Z (lessons 29–90) defined but cards not yet authored. See [lesson-bundles.md](lesson-bundles.md) for the full 27-bundle table and [cross-references.md](cross-references.md) for theme threads.
