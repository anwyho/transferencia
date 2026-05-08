# Card Design

The schema, types, directions, and quality bar for cards in `lesson_NN/cards.yml` and `cards_topical/topic_NN_MM_*.yml`.

## File schema

Every card file is a YAML document with this shape:

```yaml
# Per-lesson file: lesson_03/cards.yml
lesson: 3
title: "Convertible words: -ante/-ente, -mente, /j/→/kh/"
cards:
  - id: l3-001
    type: transformation
    tier: primary
    front_en: "important"
    back_es: "importante"
    hint: "-ant → -ante"
    rule_ref: "L3#1"
    lessons: [3]
    directions: [en_es, es_en]
    notes: ""
```

```yaml
# Topical bundle file: cards_topical/topic_04_05_verb_unlock.yml
topic: "Verb unlock + first object pronouns"
lessons: [4, 5]
cards:
  - id: t04_05-012
    type: sentence
    tier: extended
    front_en: "I want to cancel the reservation."
    back_es: "Quiero cancelar la reservación."
    hint: "-ación → -ar; quiero + infinitive"
    rule_ref: "L4#big-rule, L4#quiero"
    lessons: [4]
    directions: [en_es, es_en]
```

### Field reference

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Globally unique. Format: `l<N>-<NNN>` for lesson cards, `t<NN>_<MM>-<NNN>` for topical. Stable across edits — Anki SRS history keys on this. |
| `type` | enum | yes | `transformation`, `sentence`, or `conjugation`. |
| `tier` | enum | yes | `primary` or `extended`. |
| `front_en` | string | yes | English prompt. |
| `back_es` | string | yes | Spanish answer. Use accents correctly. |
| `hint` | string | no | Minimal nudge pointing at the rule, not giving the answer. Faded on the front. |
| `rule_ref` | string | yes | Comma-separated `L<N>#<rule>` references into `rules.md`. Powers Anki footers and audio attribution. |
| `lessons` | int[] | yes | Lessons whose grammar this card uses. Generator validates: cannot exceed the bundle's stated lessons; for extended cards, cannot reach into a later lesson. |
| `directions` | enum[] | yes | Subset of `[en_es, es_en]`. Each direction generates one Anki card from the note and one slot in the audio track. |
| `notes` | string | no | Author commentary. Not rendered. |

## Card types

### `transformation`

Apply a rule to derive a Spanish word from an English one. The Language Transfer signature drill.

```yaml
- id: l3-002
  type: transformation
  tier: primary
  front_en: "different"
  back_es: "diferente"
  hint: "-ent → -ente"
  rule_ref: "L3#1"
  lessons: [3]
  directions: [en_es, es_en]
```

Front rendering (Anki, en_es direction):

```
different
( -ent → -ente )            ← faded hint, smaller
                            → L3
```

Hints reference the rule, never spell out the answer. Once the pattern is internalized, extended cards can omit hints.

### `sentence`

Mental translation. The bread and butter.

```yaml
- id: l3-014
  type: sentence
  tier: primary
  front_en: "It's not different."
  back_es: "No es diferente."
  rule_ref: "L3#1, L2#es-noes"
  lessons: [2, 3]
  directions: [en_es, es_en, shadow]
```

Sentence rules:
- Build only on prior-lesson constructs (no surprise grammar).
- Plain everyday phrasing. No literary, no slang in primary; light real-world idioms allowed in extended.
- Negation, pronoun-swap, and word-order variants count as separate cards (different recall pattern, distinct `id`).
- Length cap: ≤8 words for first 10 lessons, ≤12 for L11-22.

### `conjugation`

Verb form drill.

```yaml
- id: l13-008
  type: conjugation
  tier: primary
  front_en: "I form of hacer"
  back_es: "hago"
  hint: "-go family"
  rule_ref: "L13#3"
  lessons: [13]
  directions: [en_es]
```

Production direction only. Reverse direction (*hago* → "I do") would be trivial and not worth drilling.

Front phrasing standard:
- `I form of <infinitive>` → first person singular present
- `we form of <infinitive>` → first person plural present
- `she form of <infinitive>` → third person singular present (covers he/she/it/usted)
- `they form of <infinitive>` → third person plural present (covers they/ustedes)
- For tenses past present, prepend tense: `past haber form of vender` → `vendido`

## Directions

| Direction | Anki front | Anki back | Audio behavior |
|-----------|------------|-----------|----------------|
| `en_es` | English | Spanish | TTS English prompt → pause → TTS Spanish |
| `es_en` | Spanish | English | TTS Spanish prompt → pause → TTS English |

Defaults:
- All cards: `en_es`.
- Sentences + transformations: also `es_en`.
- Conjugations: `en_es` only.

(An earlier design also included `shadow` — Spanish prompt repeated as Spanish answer, for pronunciation muscle memory. Removed: in practice it added bloat to the deck without enough learning value over `es_en`. The Spanish utterance already gets heard during `es_en` recognition.)

## Quality bar

Hard rules the generator validates:

1. Every card has `id`, `type`, `tier`, `front_en`, `back_es`, `rule_ref`, `lessons`, `directions`.
2. `id` is globally unique across all card files.
3. `lessons` matches the file context — for `lesson_NN/cards.yml`, every entry must equal `NN`. For `cards_topical/topic_AA_BB_*.yml`, every entry must be in `[AA..BB]`.
4. For extended cards, `max(lessons)` must equal the file's lesson context (no reaching into a future lesson).
5. Sentence cards under the word-count cap for their lesson range.
6. `rule_ref` references exist (rule numbers actually present in the referenced `rules.md`).

Soft conventions:
- Primary cards aim for 100% coverage of vocab + examples in the lesson.
- Extended cards aim for 2-3× the volume of primary.
- Hints kept under 30 characters where possible.
- No regional slang in primary tier.

## Quantity targets (rough)

| Tier | Per lesson | Per topical bundle | Through L22 |
|------|-----------|---------------------|-------------|
| Primary | 20-30 | — | ~500 |
| Extended | 40-80 | — | ~1300 |
| Topical | — | 30-50 | ~300 |

Total ~2000-2500 cards through lesson 22.
