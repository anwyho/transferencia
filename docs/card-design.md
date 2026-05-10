# Card Design

The schema, types, directions, and quality bar for cards in `cards/<letter>_<theme>.yml`.

## File schema

Every bundle file is a YAML document with this shape:

```yaml
# cards/a_foundation.yml
bundle: A
title: "Foundation: vowels, es / no es, convertible-word rules"
lessons: [1, 2, 3]
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

  - id: t01_03-001
    type: sentence
    tier: extended
    front_en: "Normally it's legal."
    back_es: "Normalmente es legal."
    hint: "-ly→-mente · -al · es"
    rule_ref: "L3#3, L3#6, L2#2, L2#7"
    lessons: [2, 3]
    directions: [en_es, es_en]
```

### Field reference

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Globally unique. Format: `l<N>-<NNN>` for cards drawn from one lesson, `t<NN>_<MM>-<NNN>` for cross-lesson cards (legacy). Stable across edits — Anki SRS history keys on this. |
| `type` | enum | yes | `transformation`, `sentence`, or `conjugation`. |
| `tier` | enum | yes | `primary` or `extended`. |
| `front_en` | string | yes | English prompt. |
| `back_es` | string | yes | Spanish answer. Use accents correctly. |
| `hint` | string | no | Derivation, mnemonic, or rule pointer. Rendered on the **back** of the card alongside the answer — the front shows only the prompt, so hints can be as explicit as needed without leaking the answer. |
| `rule_ref` | string | yes | Comma-separated `L<N>#<rule>` references into `rules.md`. Powers Anki footers and audio attribution. |
| `lessons` | int[] | yes | Lessons whose grammar this card uses. Generator validates: `max(lessons)` must fall inside the bundle's `lessons:` range. Earlier entries can reference prior bundles. |
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
```

Back rendering after flip:

```
different
─────────
diferente
( -ent → -ente )            ← faded hint, smaller
                            → L3
```

Hints live on the **back** so the recall test on the front is honest. They can spell out derivations, etymologies, or contrasts (`-ent → -ente`, `Arabic 'al-ruz'`, `disambiguate from si='if'`) without leaking the answer to the prompt side. Once the pattern is internalized, extended cards can omit hints.

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

## Embedded audio (optional)

Build the deck with `make anki-with-audio` (or `--with-audio` on the generator) to embed Spanish answer audio in every card with the `en_es` direction. The audio plays automatically when the card flips. Encoded once at 48 kbps mono mp3 via the configured TTS backend (Piper by default), then bundled into the `.apkg`.

Per-card cost ~12–30 KB. ~3 MB extra for Bundle A (226 cards), ~75 MB at full 90-lesson scale. Files cached at `audio/.media/card_<id>_es.mp3` so re-runs are free.

Skipped for:
- `es_en` cards: the Spanish is already on the prompt side, no need to play it on flip.
- Conjugation cards: front is `"I form of hacer"` → audible answer adds nothing over reading `hago`.

## Quality bar

Hard rules the generator validates:

1. Every card has `id`, `type`, `tier`, `front_en`, `back_es`, `rule_ref`, `lessons`, `directions`.
2. `id` is globally unique across all card files.
3. `max(card.lessons)` must fall inside the bundle's `lessons:` range — that anchors the card to one home bundle. Earlier entries in `card.lessons` can reference prior bundles.
4. Sentence cards under the word-count cap for their lesson range (≤8 words for L1–10, ≤12 for L11+).
5. `rule_ref` references exist (rule numbers actually present in the referenced `rules.md`).

Soft conventions:
- Primary cards aim for 100% coverage of vocab + examples in the lesson.
- Extended cards aim for 2-3× the volume of primary.
- Hints kept under 30 characters where possible.
- No regional slang in primary tier.

## Quantity targets (rough)

| Tier | Per 3-lesson bundle | Per 4-lesson bundle |
|------|---------------------|---------------------|
| Primary | 60-90 | 80-120 |
| Extended | 120-240 | 160-320 |

Through bundle I (L1–28): ~2500 cards. Full 90-lesson scale: ~7000–9000 cards.
