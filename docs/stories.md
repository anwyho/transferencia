# Immersion Stories

Short Spanish stories scoped to a thematic bundle-group's grammar window. Each story has a quick English orientation preface ("listen for these words"), then the Spanish body. The whole point is exposure — characters with edge, mini drama, and natural dialogue rather than textbook-clean narration.

## Bundle-group map

Stories are organised into nine thematic groups, hand-picked along Language-Transfer grammar arcs rather than rigid bundle triples. Each group's `lesson_max` constrains the vocab/grammar window the stories live inside.

| # | Group slug | Bundles | Lesson_max | Theme |
|---|------------|---------|------------|-------|
| 1 | `1_foundation` | A, B, C | 10 | vowels, *es / no es*, big verb unlock (*-ación → -ar*), helpers (*quiero, debo, voy a*), first object pronouns |
| 2 | `2_present_pivot` | D, E, F | 20 | full regular present, -go family, spine roll-call, vowel splits (e→ie, o→ue), we-form, *ir/vamos*, future-via-context |
| 3 | `3_first_past_objects` | G, H, I | 30 | *haber*-past + reflexive past, *dar* with two-word stacks (*te lo doy*), numbers 6–10, first agreement, *ser* vs *estar* |
| 4 | `4_ser_gerund_pronouns` | J, K, L | 39 | full *ser*, flexible adjectives, gerund (*-ando/-iendo*), real future, pronoun migration (*lo → le*), full reflexive *se* |
| 5 | `5_gustar_line_past` | M, N, Ñ | 49 | preposition pairs, *conmigo/contigo*, conditional, *gustar* family, gender exceptions, full line-past, *era/iba/veía* |
| 6 | `6_para_por_participles` | O, P | 57 | *para vs por*, pluperfect, irregular participles, relatives, *-emos vs -imos* survivor split, *lo + adj* |
| 7 | `7_point_past_in_motion` | Q, R, S | 67 | point-past, was-X-when-Y, *dar* point-past, *le lo → se lo*, *hace + time*, possessives, accent rules |
| 8 | `8_demonstratives_mood_intro` | T, U, V | 77 | demonstratives, mood-tense intro, commands (all flavours), mood expansion |
| 9 | `9_closeout_mood_past` | W, X, Y, Z | 90 | *ojalá*, all uses of *se*, past mood, go-verb family with commands and future contractions, irregular point-past, regional accents |

Groups 1–5 are built. Groups 6–9 await the corresponding bundle cards.

## Why these groupings (LT-teacher rationale)

- **Group 1** is the foundation arc end-to-end. With only `es/no es`, cognates, *quiero / voy a / debo*, and a handful of object pronouns, stories have to live on dialogue snippets and cognate-heavy declarations. Short by design (45–60 sec).
- **Group 2** is "now you have a present tense." Routines, day-in-the-life scenes, intentions. Spine roll-call drives dialogue.
- **Group 3** is "you can talk about what happened today." Gift-giving + asking-for-things + lost-tourist scenes.
- **Group 4** is *ser* personality types and gerund "what I'm doing right now". Character description meets immediate scene.
- **Group 5** is memory / feeling / hypothetical — line-past + *gustar* family + conditional all flow naturally into childhood stories, preferences arguments, and what-if monologues.

## File format

`stories/<group_slug>/<NN>_<slug>.md`:

```markdown
---
group: 1_foundation
bundles: [A, B, C]
bundle_max: C
lesson_max: 10
title: "Dos gatos importantes"
slug: dos_gatos_importantes
kind: animal_fable          # animal_fable | scenario | dialogue | history | memory
duration_target_sec: 45
vocab_focus:
  - { es: "importante", en: "important" }
  - { es: "no es",      en: "it's not" }
characters:
  - name: GATO NEGRO
    note: pompous, certain
  - name: GATA BLANCA
    note: dry, unimpressed
preface_en: |
  Two cats argue. Listen for "es" (is), "no es" (it's not), and
  "pero" (but). Aquí vamos.
gloss:
  - { es: "ridículo", en: "ridiculous" }
repeat_slow: false           # optional; if true, body is also rendered at pace 0.85
---

# Dos gatos importantes

GATO NEGRO: Es importante.
GATA BLANCA: No es importante.
...
```

Rules:

- `bundle_max` and `lesson_max` are the **hard window**. The validator checks every Spanish content word against an allow-list built from `lessons/lesson_*/rules.md` for lessons 1..`lesson_max`.
- `preface_en` is the only English in the story. Length: 2–5 short sentences. Always closes with **"Aquí vamos."** — the cue that the Spanish is starting. Embedding 1–3 Spanish target phrases ("Listen for *importante* (important)…") is encouraged.
- Body is plain prose-with-dialogue. **Stage directions** go in parentheses, in Spanish: `(Setting: un callejón.)`. **Speaker labels** are ALL-CAPS plus colon: `GATO NEGRO:`. Both are stripped before TTS and rendered as a 350 ms pause before the line so a listener hears voice change implied, not the literal label.

## Validator

`build/lib/stories.py` exposes `validate_story(story)`. Reads the body, strips stage directions and speaker labels, tokenises, then walks every unique Spanish token:

- In the lesson-derived allow-list (rules.md Vocabulary sections for lessons 1..lesson_max)? OK.
- In the universal LT-implicit set (`y`, `o`, `mi`, `tu`, `mucho`, `muy`, `ya`, `bueno`, etc.)? OK.
- A component word of a multi-word vocab entry (e.g. `voy` from `voy a`)? OK.
- In `vocab_focus` or `gloss`? OK.
- Matches a known cognate suffix (`-mente`, `-al`, `-ante/-ente`, `-cion/-sion`, `-ible/-able`, `-encia/-ancia`, `-idad`, `-ico/-ica`, `-oso/-osa`, `-ial`)? OK.
- Otherwise → **warning**.

Warnings are **advisory**, not blocking. Stories ship with warnings because the validator over-flags pragmatically-available particles and conjugated forms LT teaches in passing. The author resolves warnings either by rewriting the line, adding a `gloss` entry, or accepting the warning.

Word-count check: body must fit `duration_target_sec ± 25%` at 2.5 Spanish words/sec.

```bash
make validate-stories
# or
.venv/bin/python build/generate_stories.py --validate-only
.venv/bin/python build/generate_stories.py --group 1_foundation --validate-only
```

## Per-kind voice + pace

`build/generate_stories.py` picks the body pace from the story's `kind`:

| `kind` | ES pace | Why |
|--------|---------|-----|
| `animal_fable` | 1.0 | Crisp, classic story timing |
| `scenario` | 0.95 | Slightly slower — most listeners are driving |
| `dialogue` | 0.95 | Same |
| `history` | 0.95 | Narrative pace |
| `memory` | 0.9 | More reflective; gives the line-past time to breathe |

All stories use `es_MX-claude-high` (Spanish) and `en_US-amy-medium` (English) by default — the same voices the cards use. Multi-voice dialogue (one voice per speaker) is a future option; today every line plays in the same Spanish voice with 350 ms pauses between lines marking voice change.

## Per-story audio structure

```
[preface_en at pace=1.0 in en_US-amy-medium]
[1.0 sec silence]
[body line 1 at pace=kind_pace in es_MX-claude-high]
[350 ms silence]
[body line 2 ...]
...
```

If `repeat_slow: true` is set in the frontmatter, the body is appended again at `pace=0.85` after a 0.8 sec gap.

## Authoring workflow

1. Draft `stories/<group_slug>/<NN>_<slug>.md`. LLM-assisted drafting is fine — Claude can write a first cut from a prompt that quotes the group's theme + character notes.
2. `make validate-stories` flags out-of-window vocab.
3. Edit: either rewrite the line, add the token to `vocab_focus` (with English gloss), or add a `gloss:` entry. Re-validate.
4. `make stories` (or `python build/generate_stories.py --group <slug>`) renders the MP3.
5. Listen. Edit. Re-render.
6. Final `.md` + `.mp3` are committed together (`audio/stories/<group>/<NN>_<slug>.mp3`).

## CLI

```bash
# render every group
make stories

# render one group
.venv/bin/python build/generate_stories.py --group 5_gustar_line_past

# render a single story
.venv/bin/python build/generate_stories.py --story stories/1_foundation/01_dos_gatos_importantes.md

# validate only — no render
make validate-stories
```

## Current inventory (2026-05-10)

| Group | Stories | Total audio |
|-------|---------|-------------|
| `1_foundation` | 3 | ~3.5 min |
| `2_present_pivot` | 3 | ~5 min |
| `3_first_past_objects` | 3 | ~5 min |
| `4_ser_gerund_pronouns` | 3 | ~5.5 min |
| `5_gustar_line_past` | 3 | ~6.5 min |

15 stories across groups 1–5, covering Language-Transfer lessons 1–49. Groups 6–9 deferred until the corresponding bundle cards (P–Z) are authored.
