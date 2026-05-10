# Spec — Audio Review Sets + Immersion Stories (Rework)

**Date:** 2026-05-10
**Owner:** Anthony Ho
**Status:** drafted; awaiting user review before plan handoff
**Supersedes (audio + stories portions only):** [2026-05-07-flashcards-design.md](2026-05-07-flashcards-design.md)

## Why this rework

The 2026-05-07 spec assumed lessons 1–22 organised into 8 topical bundles. The card system has since been completely re-authored into **27 Spanish-alphabet bundles** (A–Z + Ñ, lessons 1–90) and the prior story system was wiped (commit `e83ef07`). The cumulative drill-MP3 format (`audio/lesson_NN.mp3`) no longer matches how the user studies: car rides are reliably ~20 minutes, and per-bundle review beats per-lesson cumulative because bundles are the unit of weekly progression (`docs/study-routine.md`).

This spec replaces both audio surfaces with two new artifact families and rebuilds the immersion story system around the 27-bundle structure.

## Goals

Produce two new artifact families from source-of-truth files already in the repo plus a new `stories/` tree:

1. **Per-bundle review sets** (`audio/review_set_<letter>.mp3`) — ~20-minute car-drive drill MP3s. One per bundle (A–Z + Ñ). Bidirectional EN↔ES at 70/30, "siguiente" between cards, 5-sec answer pauses for sentences and 3-sec for transformations (current behaviour preserved). Each set draws ~70% from the current bundle's cards and ~30% from prior-bundle review samples, deterministically shuffled.

2. **Bundle-grouped immersion stories** (`audio/stories/<group_slug>/<NN>_<slug>.mp3`) — Spanish stories scoped to the grammar/vocab a learner has by the end of a thematic bundle-group. Each story has a short English orientation preface ("listen for these words"), then the Spanish body. 3–5 stories per group, 1–5 minutes each. Tone: dialogue-driven, characters with edge/sass/drama where it fits, simple childlike for animal fables. Story scripts live in `stories/<group_slug>/*.md` (markdown + YAML frontmatter), drafted-then-reviewed and committed alongside their rendered MP3s.

Initial implementation scope: **first 5 groups** (lessons 1–49, ~55% of the course). Groups 6–9 deferred until cards are authored for the corresponding bundles (cards P–Z are still pending per `docs/lesson-bundles.md`).

## Non-goals

- Not changing the Anki deck pipeline, the card YAML schema, or any code under the card-author agent's surface (see "Co-agent coordination" below).
- Not adding a new TTS backend — Piper stays the default per `docs/tts-plan.md`.
- Not building a CMS, web UI, or interactive playback. Outputs are plain MP3 files synced to the phone.
- Not retaining the cumulative `audio/lesson_NN.mp3` format. It and its generator path get retired.

## Co-agent coordination

A second Claude Code agent is concurrently re-authoring card YAML files (`cards/*.yml`) and `docs/card-design.md` in this same git working tree. To avoid stomping:

- This work owns: `audio/`, `stories/`, `build/lib/audio.py`, `build/lib/review_sets.py` (new), `build/lib/stories.py` (new), `build/generate_review_sets.py` (new), `build/generate_stories.py` (new), `build/lib/tts/` (light edits), `docs/tts-plan.md`, `docs/study-routine.md`, `docs/audio-review-sets.md` (new), `docs/stories.md` (new), and additive updates to `docs/lesson-bundles.md` (status table) and `README.md`.
- Cards YAML and `docs/card-design.md` are off-limits to this work unless the user explicitly asks for changes there.
- `build/generate_audio.py` is the contested file. Plan: retire `generate_audio.py` and move embedded-audio rendering used by `generate_anki.py` into `build/lib/audio.py` proper, so the Anki generator (card-author agent's territory) stops depending on the drill-MP3 path. The card-author agent will be told via commit messages and the lesson-bundles status table.
- Staging discipline: never `git add -A` or `git add .`; always stage by path. Before committing, `git status` is used to confirm the diff matches expected paths.

## Architecture

```
                         ┌────────────────────────────┐
                         │ cards/<letter>_<theme>.yml │
                         │  (owned by card agent)     │
                         └─────────────┬──────────────┘
                                       │
                                       ▼
                         ┌────────────────────────────┐
                         │ build/lib/parse.py         │
                         │  (existing, reused)        │
                         └─────────────┬──────────────┘
                                       │
                       ┌───────────────┴───────────────┐
                       ▼                               ▼
        ┌──────────────────────────┐    ┌──────────────────────────┐
        │ build/lib/review_sets.py │    │ build/lib/stories.py     │
        │  - pool selection        │    │  - load story files      │
        │  - 70/30 prior mix       │    │  - validate vocab window │
        │  - direction balancing   │    │  - assemble preface+body │
        │  - 20-min truncation     │    │  - per-story MP3 plan    │
        └─────────────┬────────────┘    └────────────┬─────────────┘
                      │                              │
                      └──────────────┬───────────────┘
                                     ▼
                         ┌────────────────────────────┐
                         │ build/lib/audio.py         │
                         │  - Segment, render track   │
                         │  - "siguiente" injector    │
                         │  - story body renderer     │
                         └─────────────┬──────────────┘
                                       ▼
                         ┌────────────────────────────┐
                         │ build/lib/tts/ (Piper)     │
                         └─────────────┬──────────────┘
                                       ▼
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
   audio/review_set_<letter>.mp3        audio/stories/<group_slug>/<NN>_<slug>.mp3
   (e.g. review_set_b.mp3)              (e.g. stories/1_foundation/01_dos_gatos.mp3)
```

## Component 1 — Review sets

### Selection algorithm

For target bundle `B` (e.g. `e_spine_vowel_split`):

1. **Current-bundle pool:** every card with `max(card.lessons) ∈ B.lessons`.
2. **Prior-bundle pool:** every card from bundles strictly before `B` in alphabetical order, with per-card sampling weight by recency of its home bundle. Bundle-weight: most-recent prior bundle 0.50, second-most-recent 0.30, all earlier 0.20 (uniform among them).
3. **Direction selection (one segment per card per set):** for each card, hash `card.id` together with the bundle seed; if `hash % 10 < 7` and the card declares `en_es`, the card contributes only its `en_es` segment; else if the card declares `es_en`, it contributes only its `es_en` segment; else it contributes whatever single direction it does declare. Result: a per-card `Segment` list that's globally 70/30 EN→ES across the bundle's cards (since the hash is uniform), and no card appears twice in the same set.
4. **Budgeted fill (70/30 by audio time, not by card count):**
   - Total duration cap: 1200 sec (20 min).
   - Reserve 840 sec for the current-bundle pool, 360 sec for the prior-bundle pool.
   - Estimate per-segment elapsed as `chars(prompt)/rate_lang + pause + chars(answer)/rate_lang + 0.5s gap + marker_seconds + 0.5s gap`.
   - Fill the current-bundle reservation by adding segments in deterministic-shuffled order until the next segment would push past 840 sec. If the current-bundle pool is exhausted before 840 sec is reached, transfer the unused budget to the prior-bundle reservation.
   - Fill the prior-bundle reservation by weighted sampling: pick a prior bundle by bundle-weight, pick a uniform-random not-yet-used card from that bundle, expand to one segment per the direction rule above, add if it fits remaining prior-pool budget.
   - Stop when total elapsed crosses 1200 sec or both pools/budgets are exhausted.
5. **Final shuffle:** concatenate the current-bundle segments and prior-bundle segments, then `random.Random(seed=hash(bundle_letter)).shuffle(combined)`. The deterministic shuffle interleaves current and prior cards naturally, giving the listener spaced re-exposure without bulk-grouping.
6. **Output:** `audio/review_set_<letter>.mp3`.

Estimated TTS rate (for duration budgeting, not rendering): 14 chars/sec for ES, 16 chars/sec for EN at `pace=1.0`. Tuned once empirically; constants live in `build/lib/review_sets.py`.

### Per-card audio structure

```
[prompt audio]
[pause: 5s for sentence, 3s for transformation/conjugation]
[answer audio]
[gap: 0.5s]
["siguiente" marker]
[gap: 0.5s]
```

Pause durations follow the existing `_pause_for(card)` in `build/lib/audio.py`. No change.

### "Siguiente" marker

A single Piper-rendered Spanish utterance `"Siguiente."` rendered once into `audio/.cache/marker_siguiente.mp3` (gitignored, deterministic so regen is identical). Injected by a new optional `separator: AudioSegment | None` argument to `render_card_track` in `build/lib/audio.py`. No new public type.

### CLI

```
build/generate_review_sets.py --bundle e
build/generate_review_sets.py --all
build/generate_review_sets.py --bundle e --pace 1.1
```

Make targets:

- `make review-sets` — render all bundles that have cards
- `make review-set-<letter>` (computed) — render one bundle

### Acceptance

- For each bundle that has cards, `audio/review_set_<letter>.mp3` exists, is between 17 and 22 minutes long, mono, ~96 kbps mp3.
- `Card-author-agent`-only paths are untouched in the diff.
- Two consecutive runs produce byte-identical output (modulo mp3 encoder non-determinism — assert via `pydub` duration equality and shuffled-order equality).

## Component 2 — Immersion stories

### Bundle-group map (final)

Hand-picked thematic groups. First 5 implemented in this rework; 6–9 deferred until their bundles' cards exist.

| # | Slug | Bundles | Lessons | Theme |
|---|------|---------|---------|-------|
| 1 | `1_foundation` | A, B, C | 1–10 | Vowels, *es / no es*, convertible words (-al, -mente, -ible, -ant/-ent), big verb unlock (*-ación → -ar*), helpers (*quiere, debo, la/los/las*), *saber*, *tener*, *voy a + verb*, first object pronouns (*me/te/lo*). |
| 2 | `2_present_pivot` | D, E, F | 11–20 | Full regular present, *-go* family start, spine roll-call (*quiero / voy a / tengo que / puedo / debo*), e→ie & o→ue vowel splits, reflexive *me duermo*, *-amos*, we-form, *ir* irregular, future-via-context. |
| 3 | `3_first_past_objects` | G, H, I | 21–30 | *Haber*-past (*he/has/ha + -ado/-ido*), *dar* with two-word pronoun stacks (*te lo doy*), *me/te/nos* as "to/for me", numbers 6–10, *quedar*, *llamar/me llamo*, adjectives after nouns, full *-o/-a/-os/-as/-es* agreement, *ser* vs *estar*, *muy*. |
| 4 | `4_ser_gerund_pronouns` | J, K, L | 31–39 | Full *ser* (*soy/eres/es/somos/son*), flexible adjectives (*aburrido, listo, bueno, feliz*), *-ando/-iendo* gerund, real future tense (*-é/-ás/-á/-emos/-án*), *salir/salgo*, pronoun migration *lo→le*, full reflexive *se*, prepositions with *mí/ti*, *darse cuenta*, *quedarse*. |
| 5 | `5_gustar_line_past` | M, N, Ñ | 40–49 | Preposition pairs (*enamorarse de, pensar en, soñar con*), *conmigo/contigo*, conditional (-ía/-ías/-íamos/-ían), *gustar* + family (*interesar, parecer*), *habría + part*, *debería*, gender exceptions (*la mano/foto/moto*), line-past full (-aba and -ía), *era/iba/veía*, *tenía*. |
| 6 | `6_para_por_participles` | O, P | 50–57 | *Para vs por*, *estar para/por*, pluperfect *había + part*, irregular participles (*roto, dicho, hecho, visto, abierto, cerrado*), *que/cual/quien*, *-emos vs -imos* split, *lo + adj*. |
| 7 | `7_point_past_in_motion` | Q, R, S | 58–67 | Point-past *-ar* and *-er/-ir* with accents, passive *se envió*, line + point together (was-cooking-when-rang), *dar* point-past, *le lo → se lo*, *acordarse*, *hace + time = ago*, possessives, *propio*, written-accent rules. |
| 8 | `8_demonstratives_mood_intro` | T, U, V | 68–70, 71–73, 74–77 | *este/ese/esto*, *día* masc, *tan*, *creer*, mood-tense intro (*quiero que*, *necesito que*, *espero que*), *contar/contar con*, personal *a*, *a+el=al*, commands (all flavours), *cuando + future*, *donde/como/que/cuando + mood*, *hay/había + mood*, *qué fuerte que…*. |
| 9 | `9_closeout_mood_past` | W, X, Y, Z | 78–90 | *Seguir + -ando*, *empezar/comenzar a + INF*, *ojalá + mood*, all uses of *se*, *se me/se te*, past mood (*hablara/hablaran*), *si pudiera… lo cancelaría*, alt *-ase/-iese*, full go-verb family with commands and future contractions, irregular point-past (*tuve, estuve, hice, vine, fui*), regional accents, leísmo, vosotros. |

### Why these groupings (LT-teacher rationale)

- **Group 1 has the foundation arc end-to-end.** L1–10 is when a learner first gets verbs, helpers, *saber*, and the basic pronoun moves. Stories here have to live on cognates + *-ar* verbs + *es / no es* + *quiero / voy a + INF* and a tiny handful of nouns. Animal fables and very short dialogues fit the constraint naturally.
- **Group 2 is "now you have a present tense."** Once D–F lands, the learner can describe routines, day-in-the-life scenes, intentions, locations. Spine roll-call gives the dialogue spine.
- **Group 3 is "you can talk about what happened today."** Haber-past + *dar* + first agreement → stories with simple narrative arcs and gift-giving / asking-for-things scenes.
- **Group 4 separates *ser* personality types from gerund "what I'm doing right now."** Full *ser* + flexible adjectives is where characters get personalities, and the gerund makes scenes immediate. Pronoun migration enables natural indirect-object phrasing.
- **Group 5 is the memory/feeling group.** Line-past + *gustar* family + conditional = backstory, preferences, and what-if. These map onto the most natural childhood-memory and "imagine if" story templates.
- Groups 6–9 follow the same logic but are deferred (cards don't exist yet).

### Story file format

`stories/<group_slug>/<NN>_<slug>.md`:

```markdown
---
group: 1_foundation
bundles: [A, B, C]
bundle_max: C
lesson_max: 10
title: "Dos gatos importantes"
slug: dos_gatos_importantes
kind: animal_fable      # one of: animal_fable | scenario | dialogue | history | memory
duration_target_sec: 90
vocab_focus:
  - { es: "importante", en: "important" }
  - { es: "no es",      en: "it's not" }
  - { es: "es muy",     en: "it's very" }
characters:
  - name: Gato Negro
    note: pompous, thinks he runs the alley
  - name: Gata Blanca
    note: deadpan, unimpressed
preface_en: |
  Today: two cats argue about who's more important.
  Listen for "importante" (important), "no es" (it's not),
  and "es muy" (it's very). Aquí vamos.
---

# Dos gatos importantes

(Setting: un callejón. Dos gatos.)

GATO NEGRO: Yo soy muy importante. Es importante. Es muy importante.
GATA BLANCA: ¿Sí? No es importante. No es muy importante. No es nada.
...
```

Rules:

- `bundle_max` and `lesson_max` are the hard window. The vocab/grammar validator checks every Spanish content word against an allow-list derived from bundles A through `bundle_max`. Words outside the window must be either (a) declared in `vocab_focus` with a gloss, (b) a proper noun, or (c) a transparent cognate that follows a rule already taught by `bundle_max` (e.g. *-al, -mente, -ible/-able, -ente, -ación → -ar* derivations).
- `preface_en` is the only English in the story. Length: 2–5 short sentences. Always closes with **"Aquí vamos."** as the cue that the Spanish is starting. Up to one Spanish phrase per "listen for" line is allowed (encouraged) — the goal is to plant the word's sound before it appears.
- `kind` informs voice/pace choice (see below).
- Story body is plain prose-with-dialogue. Stage directions go in parentheses in Spanish. Speaker labels (`GATO NEGRO:`) are stripped before TTS and rendered as a 250 ms pause before the line (so a listener hears voice change implied, not a literal "gato negro colon").

### Vocab window validator

`build/lib/stories.py` exposes `validate_story(story_path)`:

1. Parse frontmatter + body.
2. Strip stage directions and speaker labels.
3. Tokenise the Spanish body (already have `build/lib/normalize.py` and `build/lib/vocab.py` for similar work on cards — reuse rather than reinvent).
4. For each unique token, check:
   - Is it in the allow-list built from cards in bundles A through `bundle_max`? OK.
   - Is it declared in `vocab_focus`? OK.
   - Is it a recognised proper noun (Capitalised, not at sentence-start)? OK.
   - Is it derivable from a known rule per `bundle_max`? OK.
   - Otherwise: validator emits a warning (not an error) listing the offending tokens.
5. Word count check: body must fit `duration_target_sec` ± 25% at 2.5 ES words/sec at `pace=1.0`.

Validation is advisory for stories — the author can still ship a story that flags warnings, because LT-style cognate derivation is fuzzy. But every flagged word must appear in either `vocab_focus` or a new top-level `gloss:` field appended for that pass.

Run via `make validate-stories`.

### Per-story audio assembly

```
[preface_en rendered via en voice, pace=1.0]
[1.0 sec silence]
[story body rendered via es voice, pace=0.95]   ← slightly slower for clarity
[0.5 sec silence]
[optional: story body repeated at pace=0.85]    ← only if `repeat_slow: true` in frontmatter
```

`kind` informs default pace and voice:

| `kind` | ES voice | Pace |
|--------|----------|------|
| `animal_fable` | `es_MX-claude-high` (clear, slightly slower default) | 1.0 |
| `scenario` | `es_MX-claude-high` | 0.95 |
| `dialogue` | `es_MX-ald-medium` for one speaker, `es_MX-claude-high` for the other (if Piper has both); else single voice with pause-based speaker change | 0.95 |
| `history` | `es_MX-ald-medium` (more "narrator") | 0.95 |
| `memory` | `es_MX-claude-high` | 0.9 |

Dialogue multi-voice is best-effort: only used if both voices are present in `build/.piper-voices/`. Single-voice fallback is acceptable for v1.

### CLI

```
build/generate_stories.py --group 1
build/generate_stories.py --all
build/generate_stories.py --story stories/1_foundation/01_dos_gatos_importantes.md
build/generate_stories.py --validate-only
```

Make targets:

- `make stories` — render all
- `make stories-group GROUP=1`
- `make validate-stories`

### Authoring workflow

> Reconciling the user's "generated on the fly" + "commit audio" answer: scripts are LLM-drafted during implementation (Claude drafts, user reviews, edits, then commits both `.md` and `.mp3`). Once committed, regeneration of the MP3 from the committed `.md` is deterministic (Piper + seed). No build-time LLM call.

1. Author drafts story `.md` (LLM-assisted; either the user prompts Claude in a future session, or Claude drafts the initial 5-group batch as part of this rework's implementation phase).
2. `make validate-stories` flags out-of-window vocab.
3. Author updates `vocab_focus` and/or rewrites lines to stay in-window.
4. `make stories-group GROUP=N` renders MP3s.
5. Author listens, edits as needed (typo fixes, pacing tweaks).
6. Final `.md` + `.mp3` committed together. MP3s are tracked in git per the precedent set by commit `beda638` "commit audio".

### Initial batch (this rework)

Draft and commit **3 stories per group for groups 1–5** (= 15 stories total). Mix: at least 1 dialogue with character, 1 simple scenario or fable, 1 narrative/memory piece, distributed across the 5 groups according to what fits each group's grammar window.

Group 5's stories will lean on line-past (childhood memory) and *gustar* (preferences) and conditional (what-if) — the natural homes for those tools.

### Acceptance

- `stories/1_foundation/` through `stories/5_gustar_line_past/` each contain 3 `.md` files passing `make validate-stories` (warnings allowed; errors not).
- `audio/stories/<group>/*.mp3` for those 15 stories exists, mono ~96 kbps mp3, duration within ±25% of `duration_target_sec`.
- Each story's preface ends with "Aquí vamos." and is ≤ 30 seconds of English audio.
- Both `.md` scripts and `.mp3` files are committed.

## Component 3 — Docs updates

These ride in the same PR series so the docs never lag the artifacts.

| File | Change |
|------|--------|
| `docs/tts-plan.md` | Note the marker-clip reuse and per-`kind` voice/pace table. No backend change. |
| `docs/study-routine.md` | Replace cumulative-drill references with per-bundle review sets. Update weekly rhythm table to "review set current bundle / review set prior bundle / story group N". |
| `docs/lesson-bundles.md` | Add a "Story group" column to the bundle table (`1_foundation`, etc.). Status section gains a "Stories built: groups 1–5" line. |
| `README.md` | Replace the `audio/lesson_NN.mp3` description with `audio/review_set_<letter>.mp3` and `audio/stories/...`. Adjust "Outputs" block. |
| `docs/audio-review-sets.md` *(new)* | Standalone doc: selection algorithm, direction mix, marker placement, CLI, examples. |
| `docs/stories.md` *(new)* | Standalone doc: file format, vocab window, validator semantics, voice/pace map, authoring workflow, bundle-group map. |
| `docs/build-notes.md` | Append a "2026-05-10 audio rework" entry noting the cumulative-drill retirement and co-agent contention notes. |

`docs/learning-system.md` and `docs/card-design.md` belong to the card-author agent — not edited here. If those drift relative to the new audio surface, the user/PR review surfaces the drift and the appropriate agent fixes it.

## Components/files inventory

New:

- `build/generate_review_sets.py`
- `build/generate_stories.py`
- `build/lib/review_sets.py`
- `build/lib/stories.py`
- `stories/1_foundation/*.md` … `stories/5_gustar_line_past/*.md` (15 files)
- `audio/stories/<group_slug>/*.mp3` (15 files)
- `audio/review_set_<letter>.mp3` (one per existing built bundle — A through O = 15 files at current state)
- `docs/audio-review-sets.md`
- `docs/stories.md`

Modified:

- `build/lib/audio.py` — add `separator` arg to `render_card_track`; add story-body assembly helper.
- `build/lib/tts/__init__.py` and/or `factory.py` — if the multi-voice dialogue path needs explicit per-call voice selection, surface that as a kwarg.
- `Makefile` — new targets, retire `audio` target if it points at the old generator.
- `docs/tts-plan.md`, `docs/study-routine.md`, `docs/lesson-bundles.md`, `docs/build-notes.md`, `README.md`

Deleted:

- `build/generate_audio.py` (after its embedded-audio dependency from `generate_anki.py` is moved into `build/lib/audio.py`; if it's already separable, just delete).
- Existing `audio/lesson_*.mp3` (the file format goes away). Audio is gitignored anyway — local cleanup only.

## Risks + mitigations

| Risk | Mitigation |
|------|------------|
| Drill-MP3 retirement breaks the card-author agent's Anki embed path. | Move embedded-audio renderer out of `generate_audio.py` and into `build/lib/audio.py` before retiring the script. Verify `make anki-with-audio` still works. |
| Co-agent edits collide on `docs/lesson-bundles.md` or `README.md`. | Touch only the additive sections. Commit doc edits as their own commits with clear paths so a rebase is trivial. |
| Vocab window validator generates noisy warnings on legitimate cognate derivations. | Validator emits **warnings**, not errors. Author can suppress per-token by adding to `vocab_focus`. The bar is "warnings are reviewable", not "warnings break the build". |
| 20-min duration cap miscalculated → tracks too long/short. | Calibrate `chars/sec` constants on one rendered track. Adjust once. Acceptance band is 17–22 min. |
| LLM-drafted stories drift toward generic / textbook tone. | Drafting prompt explicitly calls for character sass / mini-drama, gives the named-character pattern in the frontmatter, and instructs short snappy lines per the `kind` field. First batch is human-reviewed before committing. |
| Piper "siguiente" marker sounds wrong (clipped or low energy). | Render once, inspect, accept or re-render with `pace=0.9`. One-time effort. |

## Open questions

None blocking. The user explicitly delegated remaining design decisions ("make sensible design decisions from a LT teacher perspective"). All decisions above are recorded for review at the spec-approval gate.

Soft questions worth surfacing during implementation, in case the user wants to weigh in:

1. **Group naming.** Slugs use `1_foundation` etc. The number prefix keeps directories sorted; the word makes the directory self-describing. Alternative: drop the number (just `foundation`) and rely on the bundle-group table. Going with numbered slugs for now.
2. **Story tracking in git.** MP3 files in `audio/stories/` are committed (per user instruction). `audio/review_set_*.mp3` are *not* committed — they're regenerable from cards and the algorithm is deterministic; that matches the prior gitignore on `audio/`. Confirm at review.
3. **Bundle Ñ filename for stories.** No story group's slug uses Ñ — groups are indexed by number not letter, so this is a non-issue.

## Acceptance for the spec

- Each component has a clear file footprint, CLI, and acceptance band.
- Co-agent contention is named and mitigated.
- Initial story batch is concrete (15 stories across 5 groups).
- Doc updates are itemised.
- All design decisions trace back to either (a) explicit user answer, or (b) a stated LT-teacher rationale.

Next step after user approves this spec: invoke `superpowers:writing-plans` to convert it into an executable implementation plan.
