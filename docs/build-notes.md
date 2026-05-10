# Build Notes

Notes captured during the initial implementation pass (`feature/flashcards-stories-system`). Anything that deviated from the plan or surprised the runtime ends up here.

## Deletes: use `trash`, not `rm -rf`

We never delete with `rm -rf` in this repo. Two options for getting files out of the way:

1. **`trash <path>`** — system CLI at `/usr/bin/trash` on macOS, sends files to the macOS Trash so they're recoverable. Preferred for files you genuinely want gone.
2. **`.trash/`** — project-local folder (gitignored) for staging things you might want close at hand. `mv path .trash/$(date +%s)-name` is the idiom. Good for build outputs, caches, half-experiments.

The `Makefile` `clean` target uses `trash` for this reason. Also lets autonomous agents do cleanup without stopping for approval, since `trash` is reversible.

## Python version

The plan's `Makefile` defaults to `python3.11`. Local development on this Mac happens with Python 3.14, so most of the implementation runs with `make PYTHON=.venv/bin/python <target>` against a `.venv/` virtualenv. Both work — the pin is overridable via the `PYTHON` make variable. If 3.11 is later installed, no changes needed.

## Audio embed (--with-audio) and the MODEL_ID bump

Adding the `AudioEs` field to the Anki note model required bumping
`MODEL_ID` (`1735000001 → 1735000002`). Anki keys per-card review history
on a `(model_id, note_guid)` pair, so changing `model_id` invalidates
existing review state. We did this once early enough that no real review
history existed; downstream we should treat `MODEL_ID` as locked.

The `--with-audio` flag synthesizes one Spanish answer mp3 per card with
the `en_es` direction (Strategy A from the embed tradeoff). 48 kbps mono
mp3 hits ~12–30 KB per card; ~3 MB Bundle A; ~75 MB at full course scale.
Files land in `audio/.media/` (gitignored, idempotent) and ship as
`Package.media_files` inside the `.apkg`.

## Piper install

Piper is **not** on Homebrew (despite the README's earlier hint). Install via pip instead:

```bash
.venv/bin/pip install piper-tts
```

The Piper binary lands at `.venv/bin/piper`. To pick it up via the adapter (which uses `shutil.which("piper")`), either activate the venv or prepend `.venv/bin` to `PATH`. The included `build/scripts/fetch_piper_voices.sh` then downloads the two default voices (`es_MX-claude-high`, `en_US-amy-medium`) from HuggingFace into `build/.piper-voices/` (~120 MB on disk).

CLI flag note: Piper 1.4.x accepts `--output-file` and `--length-scale` (hyphenated). The original adapter used the underscored form for `--length_scale`; only the hyphenated form is recognized. Adapter updated to use `--output-file` and `--length-scale`.

`piper-tts>=1.4` is now in `build/requirements.txt`.

## audioop-lts shim

Python 3.14 removed `audioop` from the stdlib. `pydub` still imports it, so `build/requirements.txt` includes:

```
audioop-lts>=0.2 ; python_version >= "3.13"
```

The `python_version >= "3.13"` marker keeps the install lightweight on older interpreters. Stays in even if we go back to 3.11.

## Lesson 1 has no Spanish content

Bundle A spans lessons 1–3 in the design, but `lessons/lesson_01/rules.md` is purely meta-instructional (no Vocabulary, no Examples). We deliberately have no L1 cards; the bundle file `cards/a_foundation.yml` still claims `lessons: [1, 2, 3]` because L1's framing (no memorizing, pause and answer) is the spirit of the bundle even though no surface vocab comes from L1.

## Story stretch budget — proper-noun extension

`build/lib/validate_story.py`'s `DEFAULT_STOPWORDS` was extended with three proper nouns (`maría`, `daniel`, `lina`) when authoring Bundle A's stories. Bundle A's 0% stretch budget required either restructuring stories to avoid any character names or adding the names to stopwords. We chose the latter — recurring cast is part of the story-bible design, and tracking proper nouns as stretch words doesn't add learning value.

If new bundles introduce more recurring characters, extend the same list. Document each new name in `stories/_world.md`.

## Slug-stripping accents

The story-track filename slug originally produced `topic_01_03_foundation__01_a-morning-at-the-caf.mp3` because the `é` in *café* hit the `[^a-z0-9]+` regex without first being normalized. Fixed to accent-strip via `normalize.strip_accents` before the regex pass. Now produces `…__01_a-morning-at-the-cafe.mp3` as intended.

## Manual verification gates not automatable

A few acceptance steps need a human and a phone:

- Importing `dist/transferencia.apkg` into Anki desktop and visually verifying subdecks/templates.
- Syncing to AnkiMobile via AnkiWeb.
- Driving with a story or drill MP3 to gauge pacing and intelligibility.
- Comparing Piper voices against macOS `say` (Stage 2 of `docs/tts-plan.md`).

These remain on the user's end — the plan can't run them.

## Output sizes (initial Bundle A)

| Output | Size | Notes |
|--------|------|-------|
| `dist/transferencia.apkg` | ~1.2 MB | ~2500 cards, 9 subdecks (bundles A–I) |
| `dist/cards.json` | ~700 KB | flat array, ~2500 entries |
| `audio/lesson_NN.mp3` | varies | cumulative drill |
| `audio/stories/*.mp3` | ~1 MB each | 5 stories per bundle, ~5 min audio each |

The cumulative drill track is large because every L2 + L3 + topical card is expanded into 1-2 segments (en_es and, for sentences/transformations, also es_en). That's expected; later bundles' tracks will be longer still. Piper voices at higher quality may produce different sizes.

A `shadow` direction (Spanish→Spanish repeat) was originally part of the design and shipped briefly. Removed after a first pass through the cards — added bloat without enough learning value. See the deletion in the diff that removed `Direction.SHADOW`.

## Bundle restructure (2026-05)

Original layout had `lesson_NN/cards.yml` per-lesson plus `cards_topical/topic_NN_MM_*.yml` cross-lesson files. Restructured into a single source of truth: `cards/<letter>_<theme>.yml`, one per Spanish-alphabet bundle (A–Z + Ñ, 27 total). Lesson rules + transcripts moved into `lessons/lesson_NN/`. `CROSS_REFERENCES.md` moved to `docs/cross-references.md`.

The combiner (`/tmp/combine_cards.py` was a one-shot) merged duplicates by `(front_en, back_es, type)`, keeping the union of `directions` and the wider `lessons:` array. Existing per-lesson IDs (`l3-001`, `t01_03-002`) preserved unchanged so Anki review history survives.

Bundle file format adds a `bundle:` letter and `lessons:` array. The validation rule loosened from "extended cards must reach the file's max lesson" to "max(card.lessons) must fall inside the bundle's range" — necessary because combined bundles include cards anchored to multiple lessons.

## Remaining open items

These weren't completed in the initial pass and are tracked for follow-up:

- **Bundles J–Z content**: 18 bundles' worth of cards + stories. Rolling effort.
- **Manual Anki import test**: user gates this.
- **TTS A/B with Piper**: requires running `build/scripts/fetch_piper_voices.sh` and a drive-test session. See `docs/tts-plan.md`.
- **Sync to phone documentation**: README has the manual procedure; private podcast feed is a nice-to-have.
- **`int(x)` accepts `bool` quirk in `parse.py`**: Tier and lesson list type-guards accept `True`/`False` as ints. Edge case unlikely to bite; logged as a nit.
