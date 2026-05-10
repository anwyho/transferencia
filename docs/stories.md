# Stories

Each topical bundle gets **5 short Spanish stories** for immersion-style listening practice. Cards drill production; stories drill comprehension at a more natural pace, with a literal-gloss layer that reveals Spanish structure rather than smoothing it over.

Full course target: 27 bundles × 5 stories = **135 stories**, ~30-40 hours of audio.

## Why 5 per bundle

A single story per bundle exercises the new grammar once. Five exercise it from different angles — different settings, characters, tones — so the patterns get absorbed across contexts, not memorized as a one-off. Five also gives a difficulty climb within the bundle: story 1 sticks rigorously to allowed vocab; story 5 spends the full stretch budget.

## File layout

```
stories/
├── topic_01_03_foundation/
│   ├── 01_a_morning_at_the_cafe.md
│   ├── 02_the_important_letter.md
│   ├── 03_normally_at_the_park.md
│   ├── 04_a_constant_friend.md
│   └── 05_real_or_imaginary.md
├── topic_04_05_verb_unlock/
│   └── ...
└── topic_21_22_haber_past/
    └── ...
```

```
audio/stories/
├── topic_01_03_foundation__01_a-morning-at-the-cafe.mp3
├── topic_01_03_foundation__02_the-important-letter.mp3
└── ...
```

The English title appears in both story filenames (snake_case) and audio filenames (kebab-case). On a phone, you can read "the-important-letter" off the lock screen and immediately know which one you've heard.

## Soft cast continuity

The 5 stories within a bundle aren't a strict serial — skipping one shouldn't break the next. But they share a fictional small-town setting and a small recurring cast. Mary Poppins / Cat in the Hat model: each story is its own arc, the world is familiar across them. The same cast can carry forward across bundles too (so Bundle B picks up characters from Bundle A), as long as new bundles don't depend on you having heard old ones.

Cast and setting bible can live in `stories/_world.md` as a single source-of-truth reference for whoever drafts new stories. Optional but recommended once stories start accumulating.

## Stretch-word budget

Stories are not strictly capped to the bundle's allowed vocab. Each bundle has a "stretch budget" — a percentage of total tokens that may come from outside the allowed vocab. The cap loosens as bundles progress, mirroring the user's growing comfort.

| Bundle | Lessons | Stretch budget | Target length | Feel |
|--------|---------|----------------|---------------|------|
| A. Foundation | 1–3 | 0% | 5 min | Cat in the Hat. Just *es*, cognates, *-mente*. |
| B. Verb unlock + voy a | 4–7 | ~3% | 6 min | Still very controlled. |
| C. Helpers + saber | 8–10 | ~5% | 7 min | First narrative shape. |
| D. Present + -go start | 11–13 | ~7% | 8 min | Loosening. |
| E. Spine + vowel splits | 14–17 | ~10% | 10 min | More flow. |
| F. We-form + future-context | 18–20 | ~12% | 11 min | Comfortable. |
| G. Haber-past + reflexive | 21–23 | ~15% | 13 min | Naturalistic. |
| H. Indirect pronouns + dar | 24–27 | ~17% | 15 min | Mostly natural. |
| I. Agreement + ser/estar | 28–30 | ~20% | 16 min | Close to native cadence. |
| J–Z | 31–90 | climbs to ~30% by Z | 18–22 min | Native-level by closeout. |

Within a bundle, the 5 stories climb: story 1 uses ~0% of budget, story 5 uses the full budget. So Bundle C's story 1 is tighter than Bundle C's story 5.

Validator (`build/lib/validate_story.py`):
- Tokenize Spanish, normalize accents/case
- Compute `unknown_count / total_count` against the bundle's allowed vocab union
- If above the bundle's budget → error
- Otherwise warn with a list of stretch words used (for confirmation)

The validator is intentionally lenient on grammar (verb tenses, moods) — vocab is the easy hard-edge to enforce. Grammar drift is judged by hand during review.

## File format

```markdown
---
topic: foundation
lessons: [1, 2, 3]
title: "Una mañana en el café"
title_en: "A Morning at the Café"
order: 1
target_minutes: 5
stretch_used_pct: 0
notes: "Pure Bundle A. Sticks to es/no es + cognates."
---

## Story

Es una mañana normal.
*Is  a    morning normal.*

María es importante.
*María is  important.*

Es una mujer real[1].
*Is  a    woman royal/real.*

[1] *real* — already in Bundle A vocab. Note that *real* in Spanish doubles as "royal." *Real Madrid* = "Royal Madrid."

No es diferente.
*No is  different.*

Naturalmente, es posible.
*Naturally,    is  possible.*

...

## Free English translation

It's a normal morning. María is important. She's a royal woman. It's not different. Naturally, it's possible...
```

### Format rules for the literal gloss line

- Italic, on its own line, directly under each Spanish line.
- **Word order matches Spanish.** Reader sees Spanish syntax intact.
- **Hyphenated combinations preserve embedded morphology:** `eres` → `you-are`, `te espero` → `you(obj) I-wait`, `puede` → `can-he/she`, `vamos` → `we-go`.
- **Object pronouns annotated when ambiguous:** `te` → `you(obj)`, `la` → `her/it(fem)`.
- **Articles literal first time per paragraph:** `el` → `the(masc)`, `la` → `the(fem)`; just `the` after.
- **One word per Spanish word.** No English smoothing. If the gloss reads broken, that's correct — it's revealing the underlying grammar.
- **Footnote stretch words inline.** Use `[N]` markers. Each footnote gives the meaning + a cognate or memory hook (LT-style transferable rule when possible).

### Free translation

A smooth idiomatic English version at the bottom of every story file. Reader uses it after the literal gloss to confirm comprehension.

## Audio generation

Same Piper backend as the card MP3s, separate output path. Pure Spanish narration only — no English in audio.

- `length_scale=1.15` (slower than card answers, more deliberate)
- 1.5s pause between paragraphs
- Optional gentle music intro/outro (≤5s, royalty-free, configurable; off by default)
- Generated by extending `generate_audio.py` with `--stories` mode

```bash
build/generate_audio.py --stories                           # all 40 story tracks
build/generate_audio.py --stories --bundle topic_01_03_foundation
build/generate_audio.py --stories --pace 1.2                # slower
```

## Generation workflow per story

1. Read `lessons/lesson_NN/rules.md` for every lesson up to `max(bundle.lessons)`.
2. LLM-draft a Spanish story from the allowed-vocab union, optionally using up to the bundle's stretch budget. Specify recurring cast / setting from `stories/_world.md` if it exists.
3. Hand-write the literal-gloss layer. **This is the craftsmanship part — LLM can draft glosses but they need careful review.** A clumsy gloss defeats the point of the layer.
4. Hand-write or LLM-draft the free English translation.
5. Run `make validate-stories` → confirms vocab budget + warns about stretch words used.
6. Render audio: `build/generate_audio.py --stories --bundle <topic_slug>`.
7. Cold-listen test: hear the MP3 once without reading. Validates pacing and intelligibility.
8. Commit.

## Listening flow (recommended)

1. **Cold listen.** Play the MP3 with no text in front of you. Note what you understood.
2. **Read with gloss.** Open the story `.md` and read the Spanish + literal gloss together. Spot the structure.
3. **Re-listen.** Same MP3, now you should catch much more.
4. **Free translation check.** Read the free English translation at the bottom. Confirm comprehension.
5. **Move on, or queue for re-listen.** Stories are good for re-listening — they encode bundle grammar in a memorable narrative form.

## Story directory naming

Existing story directories under `stories/` use the legacy `topic_NN_MM_<theme>/` slug. These continue to work (the validator and audio generator glob `topic_*`). New stories under the 27-bundle scheme can use the bundle-letter slug `<letter>_<theme>/` (e.g. `stories/a_foundation/`); both naming styles coexist.

## Status

- ✅ Story system: in production
- ✅ Bundle A: 5 stories drafted + audio rendered
- 🚧 Bundle B: 1/5 drafted
- ⏳ Bundles C–Z: not yet drafted
