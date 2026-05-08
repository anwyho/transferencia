# TTS Plan

The MP3 audio drill tracks need a Spanish + English text-to-speech backend. We commit to [Piper](https://github.com/rhasspy/piper) as the default and document a quality-progression path if Piper proves insufficient.

## Why Piper

- **Free, on-device, Apache 2.0.** No API keys, no quotas, no per-character cost, no internet dependency. Re-running `make audio` is always free.
- **Spanish quality is solid.** Multiple LatAm and Castilian neural voices in the official model catalog. Real-time on Apple Silicon CPU.
- **Tiny footprint.** ~50MB per voice model. Single binary or Python wheel.
- **Fits the project's ethos.** This repo is built around free Language Transfer audio. The card system shouldn't introduce a paid dependency for a side feature.

Alternatives we evaluated and rejected for the default slot:

| Option | Why not the default |
|--------|---------------------|
| OpenAI `tts-1` | High quality, low cost (~$0.015/1K chars), but not free. Saved as an "if you want to pay for premium" option. |
| ElevenLabs | Premium quality, free tier (10K chars/mo) too small for the corpus. Skip. |
| Microsoft Azure Speech | Excellent quality, 500K chars/mo free forever — keeps as a viable upgrade path (see Stage 2 below) but adds a cloud dependency. Piper preferred for default. |
| Google Cloud TTS | Free tier exists but limits and tier rules have shifted. Too much policy churn. |
| MeloTTS | Promising, newer (2024), heavier install. Re-evaluate later if Piper voices feel stale. |
| Coqui XTTS-v2 | Best on-device quality but license is non-commercial and CPU inference is slow. |
| macOS premium voices (`say -v "Mónica (Premium)"`) | Decent, free, native — kept as the offline emergency fallback. Quality below Piper. |
| espeak-ng | Robotic formant synth. Truly last-resort. |

## Piper voice selection

Picked at compare time, not theoretically. Candidates to evaluate side-by-side on a 10-card sample track:

**Spanish:**
- `es_MX-ald-medium` — Mexican male, clear, neutral pace
- `es_MX-claude-high` — Mexican female, clear, slightly slower (good for drills)
- `es_ES-davefx-medium` — Castilian male
- `es_ES-mls_10246-low` — Castilian neutral

The course teaches a neutral Latin Spanish, so a LatAm voice is the natural baseline. Castilian voices reserved for variety in Stage 3.

**English:**
- `en_US-amy-medium` — clear, neutral
- `en_US-libritts_r-medium` — alternative

Pick one English voice and don't change it. Voice variety belongs on the answer side, not the prompt side.

## Stage 1 — Piper-only

**Goal:** working `audio/lesson_03.mp3` rendered with Piper, listenable end-to-end in the car.

Steps:

1. Install Piper. macOS: `brew install piper-tts` (or `pip install piper-tts`).
2. Download voice models into `build/.piper-voices/` via `build/scripts/fetch_piper_voices.sh`. Models gitignored.
3. Implement `build/lib/tts/piper.py` adapter conforming to the `TTS` protocol.
4. Wire `--backend piper` flag into `generate_audio.py`. Make it the default.
5. Render `audio/lesson_03.mp3` for Bundle A cards.
6. Drive with it. Make notes:
   - Mispronunciations of lesson vocabulary
   - Pace too fast / too slow
   - Accent dissonance with Mihalis's teaching style
   - Any words that sound robotic enough to be confusing

**Acceptance bar:** intelligible end-to-end; fewer than 1-in-50 words mispronounced for typical lesson vocab; pace can be tuned via Piper's `length_scale` parameter to acceptable.

If Piper passes: ship. Stop here. Don't over-engineer.

## Stage 2 — Azure free tier A/B (only if Piper isn't good enough)

If Piper falls short, A/B test Azure neural voices side-by-side before committing to a paid path.

**Setup:**

- Azure account + free Speech resource (500K chars/month forever)
- Implement `build/lib/tts/azure.py`
- Render the same 10-card sample track through Azure voices

**Voices:**

- `es-MX-DaliaNeural`, `es-MX-JorgeNeural`, `es-ES-ElviraNeural`
- `en-US-JennyNeural`, `en-US-AriaNeural`

**Decision rule:** switch only if Azure is *meaningfully* better in real driving conditions, not just on a quiet listen. Cloud dependency is a cost — only worth it for a clear win.

**Free-tier budget check** for L1-22:
- ~2200 cards × ~30 chars avg × 3 directions × 2 languages ≈ 400K chars one-time
- Re-runs hit the on-disk cache: zero additional spend
- Adding 100 new cards: ~18K chars
- Sits comfortably under Azure's 500K/month, even in the first month

## Stage 3 — Per-card voice variety (only after Stage 1 or 2 is shipped)

Once one backend is dialed in, optionally mix voices so your ear doesn't memorize one speaker:

- **Sentence cards** rotate among 2-3 Spanish voices.
- **Transformation cards** stick with one Spanish voice — consistency helps rule-recall.
- **English prompts** always one voice. No variety on the prompt side.

The adapter passes `voice_seed=card.id` to deterministically pick a voice per card. Stable across re-renders so cached fragments still hit.

## Deliverables

| File | Purpose |
|------|---------|
| `build/lib/tts/__init__.py` | Common `TTS` protocol + factory |
| `build/lib/tts/piper.py` | Piper adapter (Stage 1, default) |
| `build/lib/tts/mac_say.py` | macOS `say` adapter (offline emergency fallback) |
| `build/lib/tts/azure.py` | Azure adapter (Stage 2, written only if needed) |
| `build/lib/tts/openai.py` | OpenAI adapter (premium-paid option, optional) |
| `build/scripts/fetch_piper_voices.sh` | Download default Piper voices into `build/.piper-voices/` |
| `build/scripts/tts_compare.py` | Render the same card list across all installed backends into `audio/eval/<backend>/<card_id>.mp3` for A/B |

`.gitignore` adds:

```
build/.piper-voices/
audio/.cache/
audio/eval/
```

## Tuning knobs (Piper)

Piper exposes per-call parameters worth surfacing in the audio generator:

- `length_scale` — speed control. 1.0 default; 1.1 for slightly slower drill-friendly pace; 1.2 for very deliberate.
- `noise_scale` — variation in voicing. Defaults are fine.
- `noise_w` — variation in phoneme duration. Defaults are fine.

Generator CLI exposes `--pace 1.0` (default) → `--pace 1.15` for slower drills if needed.

## Sample command (forward-looking)

```bash
# Stage 1, default
build/generate_audio.py --through 3

# explicit
build/generate_audio.py --through 3 --backend piper --voice-es es_MX-claude-high --voice-en en_US-amy-medium --pace 1.1

# A/B compare
build/scripts/tts_compare.py --cards l3-001,l3-014,l3-031 --backends piper,mac_say
```
