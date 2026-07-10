# Lesson Dependency Graph (Lessons 1–30)

> **Status: draft v1, auto-extracted from lessons 1–30, needs human review.**
> Machine-generated from `lessons/lesson_NN/rules.md` (esp. each file's `## Cross-references`
> section), three pivotal transcripts (L15, L21, L29), and cross-checked against
> `docs/cross-references.md`. Every edge cites a short quoted phrase from the source.
> The 1–30 range is the app's current content ceiling (bundles A–I). Do not treat any
> edge as final until a human has confirmed it against the audio.

---

## (a) Overview of the dependency structure

The course is a **strictly incremental stack**: with very few exceptions, every lesson
1–30 leans only on lessons *below* it, and almost no rule is taught from scratch. The
per-lesson `## Cross-references` sections overwhelmingly open with "Builds on…",
"Reuses…", or "Refers back to…". This makes the graph a near-DAG whose edges point
**backward in lesson number** — which is exactly the invariant the linear `current_lesson`
gating dial relies on (see §d).

Within 1–30 the dependencies cluster into a handful of accumulating threads:

1. **Convertible-word / free-vocabulary spine (L2→L3→L4→L5→L9→L12).** The `-al`,
   `-ant/-ent`, `-ly`, `-ible` rules (L2–3) feed the powerhouse `-ación → -ar`
   verb-maker (L4), which every later verb lesson silently reuses. This is the widest
   fan-out root in the whole range.

2. **Object pronouns / "little words" (L4–5 → L7 → L8 → L11 → L12 → L20 → L21–27).**
   `me/te/lo` (L4–5) → plural `los` (L7) → feminine `la/las` (L8) → placement rule
   "before the changed verb" (L11) → two-word stacking (L12, L24) → placement with
   `haber` (L21). Every past-tense and reflexive lesson presupposes the placement rule.

3. **The "I" form `-o` and the `-go` irregular family (L6 → L10 → L11–13 → L14 → L24 → L29).**
   `intento/voy` (L6) → the general "chop `-r`, add `-o`, stress penultimate" rule (L10)
   → `-go` family `tengo/vengo/salgo/pongo` (L13–14) → `-oy` verbs `doy` (L24), `estoy` (L29).

4. **Stem-vowel split e→ie / o→ue (L10 stress → L15 → L16 → L17 → L18; echoed L19–27).**
   The split rule (L15) is explicitly built *on top of* the penultimate-stress rule (L10)
   and the already-memorised forms `quiero/quiere/tiene/viene` (L4/L8/L14). L17's
   "the *we* form moves stress off the root, so no split" feeds directly into L18's
   `-emos` vs `-imos`.

5. **The have-past with `haber` (L21 → L22 → L23; reused L25–27).** L21 is a major
   pivot that pulls together four earlier threads at once: `sé` (L14) as the model for
   `he`, the `-mos` we-ending (L17) for `hemos`, object-pronoun placement (L11) for
   `lo ha tomado`, and the silent `h` (L6). L22 extends the `-ado` participle to `-ido`;
   L23 adds reflexive `me he perdido`.

6. **Reflexives (L5 `me` → L16 `me duermo` → L23 `me he perdido` → L25 `me quedo` →
   L26 `quedarse` + helpers → L30).** Reflexive pronouns are just the object pronouns
   of thread 2 reused with a "self" meaning; they presuppose that placement machinery.

7. **Gender & adjective agreement (L8 → L12 → L23 → L27 → L28 → L29).** Word-gender
   `la/los/las` (L8) → feminine endings `-a/-ión/-idad` + adjective `-o/-a` (L12) →
   `-ma` exception (L23) → adjectives-after-noun + `roja/rojo` (L27) → full agreement
   (L28) → agreement of `cansado/cansada` under `estar` (L29).

8. **`ser` vs `estar` (L2 `es` → L28 `son` → L29 split → L30 practice).** L29's split is
   built explicitly on `es`/`son` (the two `ser` forms already known from L2 and L28),
   the `-oy` ending (`voy` → `estoy`), and the penultimate-stress rule (`estar` is named
   as its sole exception).

**The one recurring "backward-pointing" oddity is soft foreshadowing, not a hard
prerequisite:** L8 uses `quiere` (which secretly carries the e→ie split) seven lessons
*before* L15 explains the split; L16 uses `me duermo` before reflexives are formalised.
These are safe because the earlier lesson treats the form as a memorised vocabulary item
and does not require the later rule. See §d and the "inferred / needs confirmation" list.

An added annotation on each edge: `strength: strong` (explicit teacher callback or a rule
that literally restates the earlier rule), `medium` (clear reuse, named in cross-refs),
`soft` (pronunciation/vocab recall or pedagogical-only, low gating weight).

---

## (b) Machine-readable dependency graph

`edges`: `X depends_on Y` — lesson `from_lesson` presupposes a concept lesson `to_lesson`
introduces. Edges point backward (`from_lesson > to_lesson`).

```yaml
# Legend
#   from_lesson : the later lesson that has the dependency
#   to_lesson   : the earlier lesson it depends on
#   reason      : the concept carried across the edge
#   evidence    : short quoted phrase + its source file/section
#   strength    : strong | medium | soft
#   thread      : which accumulating thread (see overview) this edge belongs to

edges:
  # --- Bundle A: Foundation (L1-3) ---
  - from_lesson: 2
    to_lesson: 1
    reason: "Pedagogical only — L2 applies the 'thinking method'; L1 teaches no Spanish concept."
    evidence: "L1 rules.md: 'No Spanish is taught yet'; L2 rules.md Cross-references: 'None explicit.'"
    strength: soft
    thread: method
  - from_lesson: 3
    to_lesson: 2
    reason: "es / no es pattern, the -al convertible rule, and 'stress is part of the word'."
    evidence: "L3 rules.md Cross-references: 'Builds on the -al rule and the es / no es pattern from Lesson 2. The teacher explicitly asks \"what was is?\" and the student answers es.'"
    strength: strong
    thread: convertible_words

  # --- Bundle B: Verb unlock + voy a (L4-7) ---
  - from_lesson: 4
    to_lesson: 2
    reason: "es / no es plus 'put no before' word order, reused for no quiero."
    evidence: "L4 rules.md Cross-references: 'Reuses the es / no es + word order pattern from Lesson 2 (\"we just put no before\").'"
    strength: strong
    thread: convertible_words
  - from_lesson: 4
    to_lesson: 3
    reason: "convertible-words approach; the English /j/ -> /kh/ sound."
    evidence: "L4 rules.md Cross-references: 'Builds on the convertible-words approach from Lessons 2-3. Reuses the /kh/ vs /h/ pronunciation point from Lesson 3.'"
    strength: medium
    thread: convertible_words
  - from_lesson: 5
    to_lesson: 4
    reason: "quiero / no quiero, the -acion -> -ar verb-maker, and te (informal you)."
    evidence: "L5 rules.md Cross-references: 'Builds directly on quiero / no quiero from Lesson 4. Reuses the -acion -> -ar verb-making rule from Lesson 4. Reuses te.'"
    strength: strong
    thread: convertible_words
  - from_lesson: 5
    to_lesson: 3
    reason: "rolled initial r (introduced via real)."
    evidence: "L5 rules.md Cross-references: 'Reuses the rolled-r hint touched on in Lesson 3 (real).'"
    strength: soft
    thread: pronunciation
  - from_lesson: 6
    to_lesson: 4
    reason: "quiero / no quiero and the -cion -> -r verb rule."
    evidence: "L6 rules.md Cross-references: 'Builds on quiero and no quiero from Lessons 4-5. Reuses the -cion -> -r verb rule from Lesson 4.'"
    strength: strong
    thread: spine_verbs
  - from_lesson: 6
    to_lesson: 5
    reason: "rolled rr, object pronoun lo, and pero."
    evidence: "L6 rules.md Cross-references: 'Reuses the rolled-rr rule from Lesson 5 (horrible, perro). Reuses lo from Lesson 5. Reuses pero from Lesson 5.'"
    strength: medium
    thread: object_pronouns
  - from_lesson: 7
    to_lesson: 6
    reason: "voy is a motion verb; the connecting a (voy a + verb) is the whole point of L7."
    evidence: "L7 rules.md Cross-references: 'Builds on voy from Lesson 6'; L7 rule 3: 'The extra a between voy and the next verb ... verbs of motion want an a.'"
    strength: strong
    thread: present_for_future
  - from_lesson: 7
    to_lesson: 5
    reason: "lo (it/him) pluralised to los (them)."
    evidence: "L7 rules.md Cross-references: 'Builds on lo from Lesson 5; introduces los as its plural.'"
    strength: strong
    thread: object_pronouns
  - from_lesson: 7
    to_lesson: 4
    reason: "quiero / intento base plus te."
    evidence: "L7 rules.md Cross-references: 'Builds on quiero and intento from Lessons 4-6. Reuses te.'"
    strength: medium
    thread: spine_verbs

  # --- Bundle C: Helpers + saber (L8-10) ---
  - from_lesson: 8
    to_lesson: 5
    reason: "lo -> feminine la and plural los/las (gender introduced on the pronoun)."
    evidence: "L8 rules.md Cross-references: 'Builds on lo from Lesson 5 - introduces feminine la and plural los/las.'"
    strength: strong
    thread: gender_agreement
  - from_lesson: 8
    to_lesson: 4
    reason: "quiero -> quiere (he/she/you-formal wants) reuses the conjugation pattern."
    evidence: "L8 rules.md Cross-references: 'Reuses quiero / quiere pattern from Lesson 4.'"
    strength: strong
    thread: spine_verbs
  - from_lesson: 8
    to_lesson: 2
    reason: "quiere covering four subjects 'bands together' exactly as es did in L2."
    evidence: "L8 rules.md rule 4: 'The same four meanings band together - just like es covered is/he is/she is/you (formal) are.'"
    strength: medium
    thread: convertible_words
  - from_lesson: 8
    to_lesson: 7
    reason: "venir a + verb reuses the motion-verb connecting-a rule."
    evidence: "L8 rules.md Cross-references: 'Reuses visitarme and venir a + verb motion-verb rule from Lessons 6-7.'"
    strength: strong
    thread: spine_verbs
  - from_lesson: 9
    to_lesson: 8
    reason: "quiere / no quiere and por que."
    evidence: "L9 rules.md Cross-references: 'Builds heavily on quiero / quiere / no quiero / no quiere from Lessons 4 and 8 ... por que from Lesson 8.'"
    strength: strong
    thread: spine_verbs
  - from_lesson: 9
    to_lesson: 7
    reason: "motion-verb a (venir a la casa a visitarme)."
    evidence: "L9 rules.md Cross-references: 'Reuses motion-verb a rule from Lessons 7-8.'"
    strength: medium
    thread: spine_verbs
  - from_lesson: 9
    to_lesson: 4
    reason: "the -cion -> -r verb rule used throughout."
    evidence: "L9 rules.md Cross-references: 'Reuses the -cion -> -r verb rule from Lesson 4 throughout.'"
    strength: medium
    thread: convertible_words
  - from_lesson: 10
    to_lesson: 4
    reason: "the general I-form (chop -r, add -o) generalises the infinitives minted by -acion -> -ar; voy a + to-form."
    evidence: "L10 rule 3: 'chop off -ar/-er/-ir and add -o'; rule 8: 'Voy a + \"to\"-form.' (L10 Cross-references say 'None explicit'; edge rests on rule content + docs/cross-references.md back-link table 'L10 | 04, 6-7'.)"
    strength: medium
    thread: i_form_and_go

  # --- Bundle D: Regular present + -go start (L11-13) ---
  - from_lesson: 11
    to_lesson: 10
    reason: "restates the I-form rule (chop ending, add -o, shift stress) and the -r infinitive; splits verbs into groups."
    evidence: "L11 rule 2: 'chop -ar/-er/-ir and add -o; shift the stress back one syllable' (verbatim of L10 rule 3-4)."
    strength: strong
    thread: i_form_and_go
  - from_lesson: 12
    to_lesson: 11
    reason: "little words go before the changed verb or on the to-form."
    evidence: "L12 rules.md Cross-references: 'Reuses the rule that little words go before the changed verb, or stick on a \"to\" form (taught in Lesson 11).'"
    strength: strong
    thread: object_pronouns
  - from_lesson: 12
    to_lesson: 10
    reason: "-o for I plus penultimate stress."
    evidence: "L12 rules.md Cross-references: 'Reuses the -o for I and stress on penultimate syllable (taught in Lessons 10-11).'"
    strength: strong
    thread: i_form_and_go
  - from_lesson: 13
    to_lesson: 10
    reason: "the -go family (salgo/tengo/vengo) extends tener/venir's -go I-forms first seen in L10; saber."
    evidence: "L13 rules.md Cross-references: 'Recap of \"I\" form (-o + stress shift) from Lessons 10-12. Saber (savvy, with b) is explicitly recalled from Lesson 10.'"
    strength: strong
    thread: i_form_and_go
  - from_lesson: 13
    to_lesson: 12
    reason: "s = informal-you, n = they/you-guys endings; I-form recap."
    evidence: "L13 rules.md Cross-references: 'Confirms s/n/-o pattern from earlier lessons.'"
    strength: medium
    thread: i_form_and_go

  # --- Bundle E: Spine roll-call + vowel split (L14-17) ---
  - from_lesson: 14
    to_lesson: 13
    reason: "-go family tengo/vengo/salgo extended to pongo/supongo."
    evidence: "L14 rules.md Cross-references: 'Recap of -go family from Lesson 13 (tengo, vengo, salgo) - explicit.'"
    strength: strong
    thread: i_form_and_go
  - from_lesson: 14
    to_lesson: 10
    reason: "tener + the -tain family; voy a + verb."
    evidence: "L14 rules.md Cross-references: 'Tener and the \"-tain\" family from Lesson 10 - explicit. Voy a + verb pattern from Lesson 10.'"
    strength: strong
    thread: spine_verbs
  - from_lesson: 14
    to_lesson: 9
    reason: "saber -> irregular I-form se (I know)."
    evidence: "L14 rule 1: 'Saber is irregular: I know is se'; saber introduced in L9 ('Saber = to know')."
    strength: strong
    thread: spine_verbs
  - from_lesson: 15
    to_lesson: 10
    reason: "the split IS the penultimate-stress rule acting on the root vowel; L15 presupposes that stress mechanism."
    evidence: "L15 transcript: 'when we say querer we have the accent on the ending. Then when we take off that -er we put -o, we would have quero but when we stress down that e it splits'; L15 Cross-references: 'Reuses penultimate-stress rule from Lesson 10.'"
    strength: strong
    thread: vowel_split
  - from_lesson: 15
    to_lesson: 4
    reason: "quiero is the worked example; L15 finally explains WHY it is quiero, not quero."
    evidence: "L15 transcript: 'To want is querer. What is I want? Quiero. So how does querer become quiero?'; L15 Cross-references: 'Reuses quiero from earlier - now we understand WHY it is quiero not quero.'"
    strength: strong
    thread: vowel_split
  - from_lesson: 15
    to_lesson: 13
    reason: "tengo/vengo named as the exceptions that do NOT split (the ng holds them)."
    evidence: "L15 transcript: 'it is not happening with tengo, vengo, because ... the n and the g kind of hold it up.'"
    strength: medium
    thread: vowel_split
  - from_lesson: 16
    to_lesson: 15
    reason: "o->ue split built directly on the e->ie rule."
    evidence: "L16 rules.md Cross-references: 'Builds explicitly on the e -> ie rule from Lesson 15.'"
    strength: strong
    thread: vowel_split
  - from_lesson: 16
    to_lesson: 13
    reason: "poder -> puedo recalled."
    evidence: "L16 rules.md Cross-references: 'Poder / puedo recalled from Lesson 13 - explicit.'"
    strength: medium
    thread: vowel_split
  - from_lesson: 16
    to_lesson: 12
    reason: "noun-vs-verb cue: a form with el/la/un/una in front is a noun."
    evidence: "L16 rules.md Cross-references: 'Reuses the noun-vs-verb cue: nouns take \"the\" (el/la) - extends from Lesson 12.'"
    strength: medium
    thread: gender_agreement
  - from_lesson: 17
    to_lesson: 15
    reason: "recap of the e->ie and o->ue split before showing where it does NOT apply."
    evidence: "L17 rules.md Cross-references: 'Recap of e/o split rule from Lessons 15-16 - explicit.'"
    strength: strong
    thread: vowel_split
  - from_lesson: 17
    to_lesson: 16
    reason: "o->ue splitters (encontrar, mostrar, colgar) carried in from L16."
    evidence: "L17 rules.md Cross-references: 'Refers back to demostrar / mostrar and un encuentro (Lesson 16) - explicit.'"
    strength: medium
    thread: vowel_split

  # --- Bundle F: We-form + ir + future-via-context (L18-20) ---
  - from_lesson: 18
    to_lesson: 17
    reason: "-emos vs -imos IS the we-form; L17 established that the we-form moves stress off the root."
    evidence: "L18 rules.md Cross-references: 'Recaps the \"stress moves off root in we form, so no split\" rule from Lesson 17 - explicit.'"
    strength: strong
    thread: vowel_split
  - from_lesson: 18
    to_lesson: 15
    reason: "e->ie / o->ue split recapped inside the we-form drill."
    evidence: "L18 rules.md Cross-references: 'Recaps the e -> ie and o -> ue split (Lessons 15-17) - explicit.'"
    strength: medium
    thread: vowel_split
  - from_lesson: 19
    to_lesson: 7
    reason: "voy a / vamos a future plugged into ir; 'I'm going to' pattern."
    evidence: "L19 rule 5: 'Building \"I want / can / must / have to go\": just plug ir into the verbs we already know'; docs/cross-references.md back-link 'L19 | 7, 8, 18'."
    strength: strong
    thread: present_for_future
  - from_lesson: 19
    to_lesson: 8
    reason: "feminine gender (esta noche is feminine because esta ends -a) reuses L8/L12 gender."
    evidence: "L19 rule 7: 'We know noche is feminine because esta (the feminine \"this\") has an /a/ ending.'"
    strength: medium
    thread: gender_agreement
  - from_lesson: 20
    to_lesson: 19
    reason: "vamos / vamos a (let's / going-to) and the ir set carried from L19."
    evidence: "L20 rules.md Cross-references: 'Refers back to vamos and vamos a (let's / going to) from track 19.'"
    strength: strong
    thread: present_for_future
  - from_lesson: 20
    to_lesson: 11
    reason: "little words go before the changed verb / on the to-form."
    evidence: "L20 rules.md Cross-references: 'Refers back to \"little words go before the changed verb\" rule.'"
    strength: medium
    thread: object_pronouns

  # --- Bundle G: Haber-past + reflexive intro (L21-23) ---
  - from_lesson: 21
    to_lesson: 14
    reason: "he (I have) is formed exactly like se (I know); L21 names them as the only two verbs doing this."
    evidence: "L21 transcript: 'I have from haber is spelled h-e, just like se from saber ... They are the only two verbs that form the I version in this way'; se introduced in L14."
    strength: strong
    thread: haber_past
  - from_lesson: 21
    to_lesson: 17
    reason: "hemos derived from the -amos/-emos/-imos we-ending taught in L17-18."
    evidence: "L21 transcript: 'What does the verb use for we? -amos ... -emos ... -imos ... The -mos ... how do you think it might be we have? Hemos.'"
    strength: strong
    thread: haber_past
  - from_lesson: 21
    to_lesson: 11
    reason: "object pronoun placement 'before the changed verb' applied to lo ha/hemos + participle."
    evidence: "L21 transcript: 'where does that lo go? ... it is in the beginning ... lo hemos anticipado'; L21 rule 11: 'Little words go BEFORE haber.'"
    strength: strong
    thread: object_pronouns
  - from_lesson: 21
    to_lesson: 6
    reason: "haber carries the silent h (he/ha sound like /e/,/a/) established in L6."
    evidence: "L21 rule 3: 'haber starts with a silent h, so he sounds like /e/, ha like /a/.'"
    strength: medium
    thread: pronunciation
  - from_lesson: 21
    to_lesson: 20
    reason: "sets up 'present can also express the past' by explicit contrast with present-for-future (voy a / mañana / la semana que viene)."
    evidence: "L21 transcript: 'we have seen how we can use the present to talk about the future ... But we can also use the present in Spanish to talk about the past.'"
    strength: medium
    thread: present_for_future
  - from_lesson: 22
    to_lesson: 21
    reason: "-ido participle for -er/-ir extends the -ado participle + haber forms of L21."
    evidence: "L22 rules.md Cross-references: 'Refers back to e-splitting / -ado past from track 21. Refers back to saber/se and haber/he irregular I-forms.'"
    strength: strong
    thread: haber_past
  - from_lesson: 22
    to_lesson: 18
    reason: "the claim 'only ONE difference between -er and -ir: the we-form' restates L18's rule."
    evidence: "L22 rule 2: 'in the WHOLE Spanish language there is only ONE difference between -er and -ir verbs - the \"we\" form (-emos vs -imos).'"
    strength: medium
    thread: vowel_split
  - from_lesson: 23
    to_lesson: 21
    reason: "haber forms (he/has/ha/hemos/han) reused for reflexive past."
    evidence: "L23 rules.md Cross-references: 'Refers back to haber forms (he, has, ha, hemos, han) from track 21.'"
    strength: strong
    thread: haber_past
  - from_lesson: 23
    to_lesson: 22
    reason: "-ido past for -er/-ir; subject-vs-object distinction (tu vs te) that makes me/te reflexive."
    evidence: "L23 rules.md Cross-references: 'Refers back to perdido and -ido past for -er/-ir verbs from track 22. Refers back to subject vs object word distinction (tu vs te) from track 22.'"
    strength: strong
    thread: reflexive
  - from_lesson: 23
    to_lesson: 12
    reason: "the feminine -a rule (now qualified by the -ma masculine exception)."
    evidence: "L23 rules.md Cross-references: 'Refers back to \"feminine endings -a\" rule - now adds the -ma exception.'"
    strength: medium
    thread: gender_agreement
  - from_lesson: 23
    to_lesson: 5
    reason: "reflexive 'do it to myself' logic (me preparo) that underlies me he perdido."
    evidence: "L23 rules.md Cross-references: 'Refers back to me preparo idea (Spanish uses \"myself\" where English wouldn't).'"
    strength: medium
    thread: reflexive

  # --- Bundle H: Indirect pronouns + dar + agreement intro (L24-27) ---
  - from_lesson: 24
    to_lesson: 12
    reason: "two-pronoun stacking, personal word first (te lo), extends L12's me lo venden."
    evidence: "L24 rule 4: 'when stacking, the personal one comes first, then the thing ... te lo doy'; matches L12 rule 19."
    strength: strong
    thread: object_pronouns
  - from_lesson: 24
    to_lesson: 6
    reason: "doy is the -oy I-form pattern first seen in voy."
    evidence: "L24 rules.md Cross-references: 'Refers back to voy (I-form ending in -oy); doy is the same pattern.'"
    strength: medium
    thread: i_form_and_go
  - from_lesson: 24
    to_lesson: 22
    reason: "usted (formal you) introduced in L22, drilled with dar here."
    evidence: "L24 rules.md Cross-references: 'Refers back to usted (formal you) introduced in track 22.'"
    strength: medium
    thread: object_pronouns
  - from_lesson: 24
    to_lesson: 20
    reason: "future-via-context (te lo doy manana)."
    evidence: "L24 rules.md Cross-references: 'Refers back to \"future via context\" rule (using present + time word).'"
    strength: soft
    thread: present_for_future
  - from_lesson: 25
    to_lesson: 23
    reason: "reflexive me/te/nos pattern (me he perdido) reused for me quedo."
    evidence: "L25 rules.md Cross-references: 'Refers back to me preparo / me he perdido - same reflexive pattern from track 23.'"
    strength: strong
    thread: reflexive
  - from_lesson: 25
    to_lesson: 5
    reason: "me/te/nos base meanings, now extended to 'to/for me'."
    evidence: "L25 rules.md Cross-references: 'Refers back to me, te, nos meanings introduced earlier - now extends them to \"to/for me\".'"
    strength: medium
    thread: object_pronouns
  - from_lesson: 26
    to_lesson: 25
    reason: "quedar / me quedo reflexive introduced in L25, now drilled with all helper verbs."
    evidence: "L26 rules.md Cross-references: 'Refers back to quedar and me quedo introduced in track 25.'"
    strength: strong
    thread: reflexive
  - from_lesson: 26
    to_lesson: 14
    reason: "helper 'spine' verbs (quiero/debo/tengo que/puedo) + voy a stacked before quedarme."
    evidence: "L26 rules.md Cross-references: 'Refers back to quiero, debo, tengo que, puedo helper verbs from earlier tracks. Refers back to voy a (going to future).'"
    strength: medium
    thread: spine_verbs
  - from_lesson: 26
    to_lesson: 21
    reason: "have-past with reflexive (me he quedado): me before haber."
    evidence: "L26 rule 11: 'Have-past with reflexive - the me goes BEFORE haber: me he quedado.'"
    strength: medium
    thread: haber_past
  - from_lesson: 27
    to_lesson: 26
    reason: "quedar / me quedo carried in, now combined with adjective+noun."
    evidence: "L27 rules.md Cross-references: 'Refers back to quedar / me quedo from tracks 25-26.'"
    strength: strong
    thread: reflexive
  - from_lesson: 27
    to_lesson: 12
    reason: "gender markers un/una/el/la and adjective -o/-a agreement (roja/rojo) build on L12."
    evidence: "L27 rule 15: 'with a feminine word use the -a version (roja), with a masculine word use -o (rojo)'; L27 Cross-references: 'Refers back to -ion feminine ending.'"
    strength: strong
    thread: gender_agreement
  - from_lesson: 27
    to_lesson: 21
    reason: "haber + -ado (he comprado, me he quedado) reused in the adjective sentences."
    evidence: "L27 rules.md Cross-references: 'Refers back to haber + -ado past (tracks 21-23).'"
    strength: medium
    thread: haber_past

  # --- Bundle I: Full agreement + ser/estar split (L28-30) ---
  - from_lesson: 28
    to_lesson: 27
    reason: "full noun/adjective agreement extends adjectives-after-noun + roja/rojo from L27."
    evidence: "L28 rule 5: 'Adjectives that end in -o change to -a for feminine ... caro -> cara' (extends L27 rule 15). (L28's own Cross-references are thin; edge rests on rule content + docs/cross-references.md 'L28 | 12, 27'.)"
    strength: strong
    thread: gender_agreement
  - from_lesson: 28
    to_lesson: 12
    reason: "gender lives in the word + feminine endings; plural -s/-es on nouns and adjectives."
    evidence: "L28 rule 6: 'The gender of an adjective follows the noun, not the real-world object' (restates L12 rule 9)."
    strength: strong
    thread: gender_agreement
  - from_lesson: 28
    to_lesson: 2
    reason: "es and son taught as a pair; es originates in L2."
    evidence: "L28 rule 4: 'Es = is ... Son = they are ... Always remember them as a pair'; L28 Cross-references: 'Es and son mentioned as previously learned (\"we said es was...\").'"
    strength: medium
    thread: ser_estar
  - from_lesson: 29
    to_lesson: 28
    reason: "ser is the source of both es AND son (both already known), and cansado/cansada uses L28 agreement."
    evidence: "L29 transcript: 'we have ser. This is where es comes from; this is where son comes from'; agreement 'Estamos cansados ... Estamos cansadas.'"
    strength: strong
    thread: ser_estar
  - from_lesson: 29
    to_lesson: 6
    reason: "estoy is the -oy I-form pattern first seen in voy."
    evidence: "L29 transcript: 'Now I am from estar is estoy ... We already saw another verb that ends -oy which is voy.'"
    strength: medium
    thread: i_form_and_go
  - from_lesson: 29
    to_lesson: 10
    reason: "estar is named as the SOLE exception to the penultimate-stress rule, which presupposes that rule."
    evidence: "L29 transcript: 'the only verb in the entire Spanish language that doesn't have the accent on the penultimate syllable in the present tense ... it's estoy; the accent is on the ending.'"
    strength: medium
    thread: i_form_and_go
  - from_lesson: 29
    to_lesson: 12
    reason: "-ity -> -idad used to reach humano (humanidad -> humano)."
    evidence: "L29 transcript: 'The words with -ity end how in Spanish? Humanidad.'"
    strength: soft
    thread: convertible_words
  - from_lesson: 30
    to_lesson: 29
    reason: "estar forms and the state-vs-characteristic split recapped and drilled."
    evidence: "L30 rules.md Cross-references: 'Estar forms - recap of lesson 29.'; L30 rule 1-2 use ?como estas? / ?donde estas?"
    strength: strong
    thread: ser_estar
  - from_lesson: 30
    to_lesson: 22
    reason: "full subject-pronoun set (yo/tu/el/ella/usted/nosotros/ellos/ellas) from L22 listed with estar."
    evidence: "L30 rule 8 lists the pronouns; they were introduced in L22 ('Subject-words (\"big\" pronouns)')."
    strength: medium
    thread: gender_agreement
  - from_lesson: 30
    to_lesson: 14
    reason: "tener que (obligation) requires the extra que, from L14/L19."
    evidence: "L30 rule 11: 'To say \"have TO\" ... Spanish needs an extra word: tener QUE + verb. Just tienen estar is wrong.'"
    strength: medium
    thread: spine_verbs
  - from_lesson: 30
    to_lesson: 25
    reason: "quedarse reflexive (me quedo / nos quedamos) reused."
    evidence: "L30 rule 14: 'Quedar = to remain. To say \"I stay\" you literally say \"I remain MYSELF\" - a reflexive verb.'"
    strength: medium
    thread: reflexive
```

### Related-lesson cross-references (concept threads for "related lessons" context)

Each thread lists, in order, the lessons within 1–30 that introduce or reinforce it, so an
item tagged with a rule can surface sibling lessons. `continues_past_30` flags threads that
extend beyond the current content ceiling (full chains live in `docs/cross-references.md`).

```yaml
related_threads:
  - concept: convertible_words
    origin: 2
    reinforced_in: [3, 4, 5, 9, 12, 29]
    note: "-al (L2) -> -ant/-ent/-ly/-ible (L3) -> -acion->-ar (L4) -> -encia (L5) -> -cion/-idad (L12)."
    continues_past_30: true
  - concept: object_pronouns
    origin: 4
    reinforced_in: [5, 7, 8, 11, 12, 20, 21, 22, 24, 25]
    note: "me/te (L4-5) -> los (L7) -> la/las (L8) -> placement (L11) -> stacking (L12,24) -> with haber (L21)."
    continues_past_30: true
  - concept: i_form_and_go
    origin: 6
    reinforced_in: [10, 11, 12, 13, 14, 24, 29]
    note: "intento/voy (L6) -> chop-r-add-o (L10) -> -go family (L13-14) -> -oy verbs doy/estoy (L24,29)."
    continues_past_30: true
  - concept: spine_verbs
    origin: 4
    reinforced_in: [6, 7, 8, 9, 10, 11, 13, 14, 21, 26]
    note: "quiero (L4) -> intento (L6) -> voy a (L7) -> quiere/debo (L8) -> saber (L9) -> tener (L10) -> hacer/poder/esperar (L13) -> spine roll-call (L14)."
    continues_past_30: true
  - concept: vowel_split
    origin: 15
    reinforced_in: [16, 17, 18, 19, 20, 21, 25, 26, 27]
    note: "e->ie / o->ue (L15-16) -> no-split in we-form (L17) -> -emos/-imos (L18); echoed in viene, tiempo, nueve, pienso, encuentro."
    continues_past_30: true
  - concept: haber_past
    origin: 21
    reinforced_in: [22, 23, 25, 26, 27]
    note: "he+-ado (L21) -> -ido (L22) -> reflexive me he perdido (L23) -> cocinado/quedado (L25-27)."
    continues_past_30: true
  - concept: reflexive
    origin: 5
    reinforced_in: [16, 23, 25, 26, 27, 30]
    note: "me/myself (L5) -> me duermo (L16) -> me he perdido (L23) -> me quedo (L25) -> quedarse + helpers (L26,30)."
    continues_past_30: true
  - concept: gender_agreement
    origin: 8
    reinforced_in: [12, 16, 19, 23, 27, 28, 29, 30]
    note: "la/los/las (L8) -> feminine endings + adj -o/-a (L12) -> -ma exception (L23) -> adj-after-noun/roja (L27) -> full agreement (L28) -> cansada (L29)."
    continues_past_30: true
  - concept: ser_estar
    origin: 29
    reinforced_in: [30]
    note: "es/son as ser forms (L2,L28) -> the state-vs-characteristic split + full estar (L29-30)."
    continues_past_30: true
  - concept: present_for_future
    origin: 7
    reinforced_in: [10, 19, 20, 24]
    note: "voy a (L7) -> manana/present (L10) -> ir + future context (L19-20); L21 pivots the same 'present does other tenses' idea to the past."
    continues_past_30: false
  - concept: pronunciation_and_spelling
    origin: 2
    reinforced_in: [3, 5, 6, 9, 10, 13, 17, 21, 25]
    note: "vowels/es/s (L2) -> /kh/ + rolled r (L3) -> rr (L5) -> silent h + v~b (L6) -> z (L10) -> single-s (L17) -> q-u=/k/ (L25)."
    continues_past_30: true
```

---

## (c) Inferred / needs confirmation

Dependencies that are plausible or partly-supported but NOT cleanly nailed by an explicit
teacher callback, plus discrepancies a human should resolve:

1. **`docs/cross-references.md` back-link table lists L21 as building on "6 (haber)".**
   `haber` is introduced *fresh* in L21 — it does not appear in L6 (which teaches `voy`
   and the silent `h`). L6's real contribution to L21 is the **silent-h** rule (`he`/`ha`
   sound like `/e/`,`/a/`), which the graph above records instead. Recommend correcting
   the table label from "6 (haber)" to "6 (silent h)".

2. **Soft forward-references (foreshadowing) — safe but worth confirming they never gate a card early:**
   - **L8 `quiere` before the L15 split rule.** L8 uses `quiere` (an e→ie form) as
     vocabulary; the split is only *explained* in L15. `docs/cross-references.md` §23 calls
     this out: "L8 introduces quiere (e-split) before the rule is taught — explained in L15."
     A card that drills the *split mechanic* should carry `max(lessons)=15`, but a card that
     merely uses `quiere` as a word can sit at L8. Confirm card `lessons` arrays honor this.
   - **L16 `me duermo` before reflexives are formalised (L23).** Reflexive `me` is used
     as a set phrase in L16; the "self" system is not taught until L23/L25. Likely fine, but
     confirm no L16-home card *teaches* reflexivity.
   - **L17 "we-form doesn't split" explicitly pre-builds for the (out-of-range) L60
     point-past anomaly** (`docs/cross-references.md` §23). Not relevant to the 1–30 ceiling.

3. **L10 → L4/L6/L7 rests on rule content, not an explicit callback.** L10's own
   `## Cross-references` says "None explicit." The edge (the I-form generalises the
   infinitives minted by `-ación → -ar`, and reuses `voy a`) is inferred from rule text +
   the secondary back-link table. Low risk, but not teacher-stated.

4. **L28 → L27/L12 rests on rule content, not an explicit callback.** L28's own
   cross-references only name `pero`/`perro` and `es`/`son`. The strong conceptual
   dependency on L27 (adjectives after the noun, `roja/rojo`) and L12 (gender in the word)
   is inferred from the rules restating those ideas. Consider adding an explicit callback
   to L28's `rules.md`.

5. **`ser` proper (`soy/eres/somos`) is NOT taught in range.** L29–30 introduce the
   *split* and full `estar`, but `es`/`son` are the only `ser` forms available through L30
   (full `ser` is L31, bundle J). Any L29/L30-home card must not require `soy`/`eres`.

6. **Method/pedagogical edges (e.g. L2→L1) are not grammatical dependencies.** L1 teaches
   only the "thinking method." Included with `strength: soft`; a reviewer may prefer to drop
   L1 from the concept graph entirely.

7. **Numbers, question words, and time expressions** (`seis`–`diez` in L25, `cuándo`/`dónde`
   scattered across L13–18, `esta noche`/`mañana`) form minor vocab threads not modeled as
   hard edges here. They rarely gate grammar, but if the app wants "related lessons" for a
   numbers card, thread them separately.

---

## (d) Topological read & gating implications

**The gating model is linear, not graph-based.** Per `docs/webapp-spec-prompt.md` and the
Phase-0 spec, an item is visible iff `min_lesson(item) <= current_lesson`, and
`min_lesson` derives from `max(card.lessons)` (a card's "home" lesson). There is no
per-edge prerequisite check at runtime.

**The dependency graph's job is therefore to *validate* that the linear order is safe.**
That safety holds iff **every dependency edge points backward in lesson number** — i.e., no
lesson presupposes a concept from a higher-numbered lesson. Across lessons 1–30 that
invariant **holds for every hard edge** in §b: all `from_lesson > to_lesson`. So the natural
`current_lesson` ordering (1, 2, 3, … 30) is a valid topological sort, and raising the dial
one lesson at a time never surfaces a card whose grammar hasn't been introduced.

Consequences for the `current_lesson` dial and card authoring:

- **No re-ordering is required.** The teacher's own lesson numbering is already a topological
  order of the concept DAG. The dial can stay a simple integer.

- **The real risk is mis-tagged `card.lessons`, not lesson order.** Because gating keys on
  `max(card.lessons)`, a card that *exercises* a later rule but is tagged only with an early
  lesson would appear before its prerequisite. The high-value check: for every card, confirm
  `max(card.lessons)` is ≥ the lesson that introduces the *hardest* rule the card uses. The
  foreshadowing cases in §c(2) (`quiere`, `me duermo`) are where this is most likely to slip.

- **Cross-bundle back-references are expected and fine.** `card-design.md` already allows a
  card's `lessons` array to reference earlier bundles as long as `max(lessons)` stays in the
  home bundle. The graph confirms those back-references are exactly the dependency edges —
  e.g. an L21 have-past card legitimately lists `lessons: [14, 17, 21]` (needs `sé`, the
  we-ending, and `haber`).

- **Only "backward-pointing" phenomena are the soft forward-references** (§c(2)). They do
  not violate the topological order because the earlier lesson does not *depend* on the later
  rule — it merely previews a form. No dial change is needed; just tag those cards' `lessons`
  by the rule they actually test.
