# Study Routine

Daily practice plan. Designed to fit between work and life — not a full course, but enough volume to make steady progress.

## Daily target

- **5–20 minutes of flashcards** (Anki, any subdeck or whole deck)
- **20–40 minutes of audio**:
  - `audio/review_set_<letter>.mp3` for the current bundle (the 20-min drive companion), or
  - `audio/stories/<group>/*.mp3` for immersion + exposure on lighter days

Total daily commitment: ~30–60 minutes. Audio time is mostly during the drive — it doesn't compete with desk hours.

## Suggested weekly rhythm

| Day | Audio | Why |
|-----|-------|-----|
| Mon | `review_set_<current>.mp3` | Active production, set the week's tone |
| Tue | `review_set_<current>.mp3` | Reinforce; the set is 70/30 EN→ES so you're still producing |
| Wed | `review_set_<prior>.mp3` | Mix in old material — last week's bundle |
| Thu | Stories: current group | Immersion / passive ear; gives the production drills a rest |
| Fri | `review_set_<current>.mp3` | Production push before the weekend |
| Sat | Catch-up Anki (longer session if backlog) | Bring SRS queue current |
| Sun | Stories: an earlier group | Consolidation, low-effort listening |

Anki happens every day. Audio rotates.

## Pace across bundles

Rough target: **one bundle per week**.

- Day 1–2: hear `review_set_<current>.mp3` cold; flag cards that hit you wrong
- Day 3–5: drill cards in Anki; re-listen the review set to validate
- Day 6–7: re-listen + sweep failing cards; pick up the group's stories for the next-bundle theme
- Following week: roll forward to next bundle

Don't move forward until the *current* bundle's review set feels comfortable. If you're missing more than half the answers, you're not ready — re-loop.

## When to skip ahead vs slow down

Slow down if:
- The review set has cards that surprise you more than half the time
- You're fatiguing in Anki (review queue > 30 min/day)

Speed up (consider 2 bundles/week) if:
- Review set feels easy on cold listen
- Anki ease is high (Anki is rating most cards "Easy")
- You're hungry for new grammar

There's no race. Bundles aren't gates — they're checkpoints.

## Flashcards: what to study

If unsure what to drill in Anki:

- **In a focused mood?** Filter to current bundle's tag (`tag:bundle::b_verb_unlock`). Push hard on what's new.
- **In a maintenance mood?** Whole deck, let SRS pick. Reviews a mix of new and old.
- **Anxious about a specific rule?** Filter by `tag:rule::L4-big-rule`. Drill that pattern across all cards that touch it.
- **Stuck on a card type?** Filter `tag:type::transformation` or `tag:type::sentence`.

## Audio: which file when

- **Just got out of a lesson?** `audio/review_set_<letter>.mp3` for the bundle that contains it.
- **20-min commute?** Same — review sets are sized to fit. The "Siguiente." marker between cards gives you a moment to reset between drills.
- **Short errand?** Same — drop in for 5 min, drop out. The set tolerates interruption.
- **Tired, just want to absorb Spanish?** Pick a story from `audio/stories/<group>/`. Listen to the English preface for the listen-fors, then let the Spanish wash over you. No production required.
- **Long drive?** Pair a review set with one or two stories. Drill, then absorb.

The stories grow with the course — group 1 stories (L1–10) live entirely on cognates + `es/no es` + a handful of helpers, and that's exactly enough drama to make two cats argue. Later groups get more characters, more conditional fantasies, more memory pieces.

## Sync to phone

Pre-rendered MP3s land in `audio/`. To get them on your iPhone:

1. **Easiest:** drag `audio/review_set_*.mp3` and the `audio/stories/` tree into an iCloud Drive folder. Files app on iPhone plays them directly. Bluetooth/CarPlay: yes.
2. **Cleaner:** generate a private podcast `feed.xml` from the audio folder, host on a static server, subscribe in Apple Podcasts. Auto-syncs new tracks.
3. **Manual:** AirDrop one mp3 at a time.

(Sync details documented separately as the project gets running.)
