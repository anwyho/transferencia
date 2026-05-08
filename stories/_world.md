# Stories — World Bible

Single source of truth for the recurring cast and setting that runs through the
story corpus. Optional but recommended once stories accumulate. The Mary
Poppins / Cat in the Hat model: each story is its own arc, but the world is
familiar across them.

## Setting

A small, sunny town. Unnamed in early bundles (the vocab can't carry a place
name). It has a square, a market, a school, a clinic — but most of these
become nameable only once the relevant nouns enter the vocab from later
lessons. Until then we lean on adjectives, adverbs, and copular sentences.

## Cast

Three recurring characters. Names chosen to be short, easy to pronounce, and
already plausible Spanish names so they don't trip the validator on accent or
vowel rules.

- **María** — the steady, observant one. The narrator's anchor. She tends to
  declare what *is* and what *is not*. Often the one to say *no es*.
- **Daniel** — the enthusiastic one. Likes festivals, novelty, the *real* and
  the *original*. Tends to use intensifiers like *realmente* and
  *constantemente*.
- **Lina** — the practical one. Flexible, posible-minded. The one who keeps
  things *normal* when Daniel pushes for *original*.

In Bundle A (lessons 1-3) the trio can only be described, not put in motion —
no verbs are available beyond *es*. So the stories read like a child's picture
book: declarative, repetitive, comforting. Once Bundle B opens up *quiero* and
the -ar verbs, the cast can act, want, and choose.

## Continuity rules

- Stories within a bundle don't form a strict serial — skipping one doesn't
  break the next. But characters' core traits stay consistent.
- The cast carries forward across bundles. Bundle B picks up María, Daniel,
  Lina without needing the reader to have heard Bundle A's stories.
- New characters can be introduced in later bundles, but each must be added
  to this bible and to `PROPER_NOUNS` in `build/lib/validate_story.py`.

## Validator extensions

To keep the cast valid against the vocab budget without inflating story word
counts with footnoted "stretch" words, the proper nouns above are added to
the validator's stopword set. See `build/lib/validate_story.py:PROPER_NOUNS`.

Currently registered:

- *María* — added Bundle A
- *Daniel* — added Bundle A
- *Lina* — added Bundle A

This is the *only* extension Bundle A makes to the validator's defaults. No
common-word extensions (no *muy*, no *con*, no *para*, etc.) — Bundle A's
constraint is that all content words must come from L1-L3's published
vocabulary, so we keep it that way.
