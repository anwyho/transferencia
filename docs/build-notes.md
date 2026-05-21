# Build Notes

Implementation gotchas worth keeping. Anything below earned its line because something else broke when the convention was violated.

## Deletes: use `trash`, not `rm -rf`

Never delete with `rm -rf` in this repo.

1. **`trash <path>`** — system CLI at `/usr/bin/trash` on macOS, recoverable from the Trash. Preferred.
2. **`.trash/`** — project-local staging folder (gitignored). `mv path .trash/$(date +%s)-name`.

The `Makefile` `clean` target uses `trash` for this reason.

## Python version

`Makefile` defaults `PYTHON` to `.venv/bin/python`. Local dev uses Python 3.14 in a `.venv/` virtualenv. Override with `make PYTHON=python3 …` if needed.

## Audio embed (--with-audio) — MODEL_ID is locked

Adding the `AudioEs` field to the Anki note model bumped `MODEL_ID` (`1735000001 → 1735000002`). Anki keys per-card review history on `(model_id, note_guid)`, so changing it invalidates existing review state. We did this once early enough that no real review history existed; from now on, treat `MODEL_ID` as locked.

`--with-audio` synthesizes one Spanish-answer MP3 per card (Strategy A from the embed tradeoff). 48 kbps mono → ~12–30 KB per card. Files land in `audio/.media/` (gitignored, idempotent) and ship as `Package.media_files` inside the `.apkg`.

## Piper install

Piper is **not** on Homebrew. Install via pip:

```bash
.venv/bin/pip install piper-tts
```

Binary lands at `.venv/bin/piper`. The adapter uses `shutil.which("piper")`, so either activate the venv or prepend `.venv/bin` to `PATH`. Run `build/scripts/fetch_piper_voices.sh` once to pull `es_MX-claude-high` + `en_US-amy-medium` (~120 MB) into `build/.piper-voices/`.

CLI flag note: Piper 1.4.x only recognizes the hyphenated forms `--output-file` and `--length-scale`. The underscored forms silently fail.

## audioop-lts shim

Python 3.14 removed `audioop` from stdlib. `pydub` still imports it, so `build/requirements.txt` includes:

```
audioop-lts>=0.2 ; python_version >= "3.13"
```

## TTS cache: treat zero-byte WAVs as misses

`ensure_cached` in `build/lib/tts/cache.py` deletes zero-byte cache entries before serving. A killed mid-synth Piper run can leave an empty `<hash>.wav` on disk; without this guard, every downstream pydub decode fails on that fragment until the cache is hand-cleared.

## Lesson 1 has no Spanish content

Bundle A spans L1–3 in the design, but `lessons/lesson_01/rules.md` is purely meta. No L1 cards exist; `cards/a_foundation.yml` still claims `lessons: [1, 2, 3]` because L1's framing belongs to the bundle even though no surface vocab comes from it.
