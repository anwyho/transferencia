# Transferencia

A personal study repository for Mihalis Eleftheriou's free [Language Transfer — Complete Spanish](https://www.languagetransfer.org/complete-spanish) course (90 lessons), structured for spaced-repetition flashcards and hands-free audio drills.

## What's here

```
.
├── lesson_NN/                  # one directory per lesson, NN = 01..90
│   ├── rules.md                # the rules and patterns the teacher introduces
│   └── transcript.md           # verbatim transcript of the audio lesson
├── cards_topical/              # cards spanning multiple lessons (planned)
├── build/                      # generators (planned): cards.yml → Anki, → MP3
├── stories/                    # short Spanish stories per topical bundle (planned)
├── docs/                       # design + content guidelines
│   ├── learning-system.md      # overview of the flashcard + audio drill + story system
│   ├── lesson-bundles.md       # how lessons are grouped into topical bundles
│   ├── card-design.md          # card schema, tiers, directions, quality bar
│   ├── stories.md              # story system: gloss format, stretch budget, file layout
│   ├── study-routine.md        # daily flow: flashcards + audio time
│   └── tts-plan.md             # TTS backend choice and progression plan
├── CROSS_REFERENCES.md         # bird's-eye map of theme threads across all 90 lessons
└── Complete+Spanish+transcript+-+2019+final.pdf
```

## What it's for

Three outputs feeding the same source-of-truth markdown:

1. **An Anki deck** for desk review, with subdecks per lesson and per topical bundle, tagged so you can drill `lesson:03` or `topic:04_05_verb_unlock` or the whole thing.
2. **Cumulative MP3 drill tracks** for hands-free practice in the car. Each track plays English prompt → silent pause for you to answer aloud → Spanish answer, mixing all three directions (production, recognition, shadowing).
3. **Short Spanish stories** (5 per topical bundle, 40 total for L1-22) for immersion-style listening. Pure Spanish narration MP3s plus markdown files with a word-aligned literal English gloss that reveals Spanish syntax. See [docs/stories.md](docs/stories.md).

The cards live in `lesson_NN/cards.yml` (anchored to one lesson) or `cards_topical/topic_NN_MM_*.yml` (spanning multiple). Stories live in `stories/topic_NN_MM_<theme>/`. Everything feeds the same generators.

## Pedagogy

Following Language Transfer's method:

- **Mental transfer** — apply rules to derive Spanish from English (*-tion → -ción → -ar*), not rote vocab memorization.
- **Mental translation** — production direction (EN → ES) dominates. Hardest, most useful.
- **Reinforcement, not first exposure** — cards assume you've heard the lesson audio. Minimal rule-context on the card; lesson links for back-reference.
- **Two tiers per lesson** — *primary* (drawn directly from the lesson) and *extended* (real-world examples that apply the same rule, not in the lesson).

See [docs/learning-system.md](docs/learning-system.md) for full design.

## Status

- ✅ Lesson rules + transcripts: 90/90
- ✅ Cross-references map: complete
- 🚧 Card system: in design (initial scope: lessons 1-22)
- 🚧 Story system: in design (40 stories: 5 per bundle for L1-22)
- ⏳ Anki + MP3 generators: not yet built

## Daily routine

Target: 5-20 min flashcards + 20-40 min audio (drill or story) per day. See [docs/study-routine.md](docs/study-routine.md).

## Source

Audio + 2019 final transcript come from Language Transfer (free, donation-supported). The course itself is the work of Mihalis Eleftheriou.
