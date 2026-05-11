# Audio Review Sets

Per-bundle drill MP3s for hands-free practice in the car. One file per Spanish-alphabet bundle: `audio/review_set_a.mp3`, `audio/review_set_b.mp3`, ..., `audio/review_set_ñ.mp3`, ..., `audio/review_set_z.mp3`.

Target duration: ~20 minutes (acceptance band 17–22 min). Each set contains:

- ~70% of audio time from the **current** bundle's own cards,
- ~30% sampled from **prior** bundles (recency-weighted),
- direction biased **70/30 EN→ES** for production focus.

Between every card a Piper-rendered "Siguiente." marker plays as a mental reset.

## Why per-bundle and not cumulative

The previous design rendered a cumulative track (`audio/lesson_NN.mp3`) that grew unbounded as you progressed. Useful for a brand-new listener but useless past lesson 30 — the file became too long to listen to in one drive. The per-bundle format aligns audio with the bundle-per-week rhythm in [`study-routine.md`](study-routine.md): "today is bundle E week, play `review_set_e.mp3`."

## Selection algorithm

Implemented in [`build/lib/review_sets.py`](../build/lib/review_sets.py). For a target bundle B (e.g. `e_spine_vowel_split`):

1. **Partition** every card into either the current bundle (`max(card.lessons) ∈ B.lessons`) or a prior bundle (by source-file letter).
2. **Direction selection** — one segment per card per set. Hash the card id with the bundle seed; if `hash % 10 < 7` and the card declares `en_es`, the card contributes its `en_es` segment; otherwise it contributes whatever direction it does declare. This gives a globally 70/30 EN→ES mix and no card appears twice in the same set.
3. **Budget split** — 70% × 1200 sec = 840 sec for current-bundle segments, 360 sec for prior-bundle segments. Per-segment elapsed is estimated via `chars / chars_per_sec + pause + gap + marker + gap`.
4. **Fill current first** in deterministic-shuffled order until the current-budget is exhausted. Any unused budget transfers to the prior pool.
5. **Fill prior** by weighted sampling. Most-recent prior bundle 0.50, second-most-recent 0.30, all earlier share 0.20 uniformly. For each draw, pick a bundle by weight, then a uniform-random not-yet-used card from that bundle.
6. **Final shuffle** — combine the two lists and shuffle by `seed = hash(bundle_letter)`. The shuffle interleaves current and prior naturally, giving the listener spaced re-exposure without bulk-grouping.

Deterministic across runs (same input cards + same bundle ⇒ same MP3, byte-similar modulo MP3 encoder).

## Per-card audio structure

```
[prompt audio]
[pause: 5 sec for sentences, 3 sec for transformations/conjugations]
[answer audio]
[0.5 sec gap]
["Siguiente." marker — rendered once into audio/.cache/marker_siguiente.mp3]
[0.5 sec gap]
```

Pause durations follow the existing `_pause_for(card)` in `build/lib/audio.py` — unchanged from the previous drill format.

## CLI

```bash
# render every built bundle
.venv/bin/python build/generate_review_sets.py --all

# render one bundle
.venv/bin/python build/generate_review_sets.py --bundle e

# slower pace for tougher drilling
.venv/bin/python build/generate_review_sets.py --bundle e --pace 1.1

# alternate via make
make review-sets
```

## Acceptance

- For each built bundle, `audio/review_set_<letter>.mp3` exists.
- Duration between 17 and 22 minutes (cap is 1200 sec; estimator rates are tuned in `review_sets.py`).
- Mono ~96 kbps mp3.
- Two consecutive runs produce the same ordering (the audio bytes vary slightly because of LAME non-determinism but the segments and their order are identical).

## Calibration

The duration estimator uses these constants in `build/lib/review_sets.py`:

| Constant | Value | What |
|----------|-------|------|
| `CHARS_PER_SEC_EN` | 16.0 | English TTS pace at `pace=1.0` |
| `CHARS_PER_SEC_ES` | 14.0 | Spanish TTS pace at `pace=1.0` |
| `MARKER_SECONDS` | 0.8 | "Siguiente." marker rough length |
| `GAP_SECONDS` | 0.5 | gap between answer and marker |
| `TRAILING_GAP_SECONDS` | 0.5 | gap after marker |
| `CURRENT_RATIO` | 0.70 | fraction of cap reserved for current bundle |
| `DEFAULT_CAP_SECONDS` | 1200.0 | 20 minutes |

If a rendered track lands outside 17–22 min consistently, tune the chars/sec constants first.

## Sync to phone

`audio/review_set_*.mp3` files are committed (per user instruction). To sync:

1. **Easiest**: drop them into an iCloud Drive folder. Files app on iPhone plays directly. Bluetooth/CarPlay: yes.
2. **Cleaner**: generate a private podcast `feed.xml` from `audio/` and subscribe in Apple Podcasts.
3. **Manual**: AirDrop one at a time.

Same sync story as the earlier cumulative drill, but with predictable filenames (`review_set_a.mp3` ... `review_set_z.mp3`) instead of `lesson_NN.mp3`.
