# Learning System Overview

The card system has one source of truth (YAML per lesson and per topical bundle) feeding two delivery channels (Anki deck for desk study, MP3 tracks for the car). The point is to operationalize Language Transfer's "mental transfer + mental translation" approach with spaced repetition.

## Why two channels

Anki and audio drills do different jobs.

**Anki** is the discipline layer. It owns scheduling (SM-2 / FSRS), tracks per-card history, syncs to phone, and shows hints + lesson back-links. It's where you do focused 10-minute sessions at a desk with the answer hidden until you commit.

**Audio drills** are the volume layer. You can't safely look at a screen while driving, but your ears and your mouth are free for 30+ minutes a day. Pre-rendered MP3s play through CarPlay / Bluetooth and force you to produce out loud — no shortcut to flipping a card.

Both consume the same `cards.yml` files. Add a card once, get it on both surfaces.

## Two tiers of cards

### Primary

Cards drawn directly from `lesson_NN/rules.md`:

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

**Hard rule for extended cards:** they cannot use grammar introduced in a *later* lesson than the latest one in their `lessons:` array. The generator validates this. If you want to write "Es importante que vengas pronto" the card must live in a topical bundle whose `lessons:` includes the lesson where subjunctive-after-importante shows up.

## Three drill directions

Every card declares which directions it supports:

| Direction | Front | Back | Used for |
|-----------|-------|------|----------|
| `en_es` | English prompt | Spanish answer | All cards. The mental-translation core. Production direction. |
| `es_en` | Spanish prompt | English answer | All sentence + transformation cards. Recognition / listening. |
| `shadow` | Spanish sentence | (same Spanish sentence) | Sentence cards only. Pronounce it back — pronunciation muscle memory. |

In Anki, each direction is a separate card generated from the same note. In the audio tracks, all three directions get mixed into the same cumulative MP3 for variety.

Conjugation cards are `en_es`-only (recognition would be trivial).

## Topical bundles

Some content doesn't sit cleanly in one lesson. A sentence that combines L2's *es / no es* with L3's *-mente* with L4's *quiero* belongs in a bundle, not in any single lesson's file.

We group lessons into bundles of ≤4 lessons each, drawn from theme threads in `CROSS_REFERENCES.md`. Cards living in `cards_topical/topic_NN_MM_*.yml` carry an explicit `lessons: [N, M]` array and get tagged in Anki under both `lesson::NN` and `topic::NN_MM_<theme>`.

See [lesson-bundles.md](lesson-bundles.md) for the current bundle table.

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

- One subdeck per lesson (`Transferencia::Lesson 03`).
- One subdeck per topical bundle (`Transferencia::Topic::04-05 Verb Unlock`).
- Tags: `lesson::03`, `topic::04_05_verb_unlock`, `tier::primary`, `tier::extended`, `type::transformation`, `type::sentence`, `type::conjugation`, `direction::en_es`, etc.
- Custom card templates render hint + `rule_ref` footer on the back.
- Uses `genanki` Python library.
- Stable note IDs derived from the card's `id` field, so re-imports preserve scheduling history.

### `generate_audio.py`

Produces `audio/lesson_NN.mp3` (cumulative — track NN includes every card whose `max(lessons) ≤ NN`):

- Per card: TTS English prompt → 4-6 second silent pause → TTS Spanish answer → 0.5s gap → next.
- Mixes all three directions in a randomized order so you can't pattern-match.
- TTS adapter defaults to [Piper](https://github.com/rhasspy/piper) — free, on-device, Apache 2.0, with strong Spanish neural voices. Optional paid backends (OpenAI, Azure) plug in via the same adapter interface. macOS `say` kept as offline emergency fallback. See [tts-plan.md](tts-plan.md).
- Tracks land in `audio/`, gitignored. Sync to iPhone via iCloud Drive / Files / a private podcast feed; play in CarPlay.

### Phase 2: interactive mic-based drilling (planned, not initial scope)

An Apple Shortcut consumes a generated `cards.json`, speaks a prompt, opens dictation for your spoken answer, fuzzy-compares (accent-strip + Levenshtein), speaks the correct answer, and loops. CarPlay-runnable via "Hey Siri, Spanish drill". Same source, different consumer.

ChatGPT/Claude voice mode with `cards.md` pasted into a Project / Custom GPT also works as a zero-build escape hatch.

## Initial scope

Lessons 1-22, organized into 8 topical bundles. ~2000-2500 cards total. See [lesson-bundles.md](lesson-bundles.md).
