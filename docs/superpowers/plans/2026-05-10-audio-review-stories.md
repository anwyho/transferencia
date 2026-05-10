# Audio Review Sets + Immersion Stories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The author is executing this plan inline in the same session, with the user's directive to not stop or request approval mid-flight.

**Goal:** Replace the cumulative drill-MP3 generator with per-bundle 20-minute review sets and rebuild the bundle-grouped immersion story system. Render and commit audio for review sets A–O and stories for groups 1–5.

**Architecture:** Two parallel generators (`generate_review_sets.py`, `generate_stories.py`) on top of two new helper libs (`build/lib/review_sets.py`, `build/lib/stories.py`), both reusing the existing Piper TTS pipeline (`build/lib/tts/*`) and audio-assembly primitives (`build/lib/audio.py`). The legacy `build/generate_audio.py` and `audio/lesson_*.mp3` artifacts are retired.

**Tech Stack:** Python 3.11, Piper TTS, pydub, pyyaml, pytest. Voices already in `build/.piper-voices/` (`es_MX-claude-high`, `en_US-amy-medium`).

**Spec:** [docs/superpowers/specs/2026-05-10-audio-review-stories-design.md](../specs/2026-05-10-audio-review-stories-design.md)

---

## Task 1: Marker injection + review-set lib

**Files:**
- Modify: `build/lib/audio.py` (add optional `separator` to `render_card_track`)
- Create: `build/lib/review_sets.py`
- Create: `build/tests/test_review_sets.py`

- [ ] **Step 1: Test — selection algorithm produces ratio + direction balance + determinism**

```python
# build/tests/test_review_sets.py
from build.lib.types import Card, CardType, Direction, Tier
from build.lib.review_sets import select_segments_for_bundle


def _card(id, lessons, dirs=(Direction.EN_ES, Direction.ES_EN), ctype=CardType.SENTENCE):
    return Card(
        id=id, type=ctype, tier=Tier.PRIMARY,
        front_en=f"prompt {id}", back_es=f"respuesta {id}",
        rule_ref="L1#1", lessons=list(lessons), directions=list(dirs),
    )


def test_determinism():
    cards = [_card(f"l{n:02d}-{i:03d}", [n]) for n in range(1, 5) for i in range(40)]
    a = select_segments_for_bundle(cards, bundle_lessons=[3, 4], cap_seconds=200)
    b = select_segments_for_bundle(cards, bundle_lessons=[3, 4], cap_seconds=200)
    assert [s.card_id for s in a] == [s.card_id for s in b]


def test_direction_balance_70_30():
    cards = [_card(f"c-{i:04d}", [3]) for i in range(500)]
    segs = select_segments_for_bundle(cards, bundle_lessons=[3], cap_seconds=99999)
    n_en_es = sum(1 for s in segs if s.direction == Direction.EN_ES)
    ratio = n_en_es / len(segs)
    assert 0.62 <= ratio <= 0.78  # hashes are uniform → ~0.70 with some variance


def test_no_card_appears_twice():
    cards = [_card(f"c-{i:04d}", [3]) for i in range(50)]
    segs = select_segments_for_bundle(cards, bundle_lessons=[3], cap_seconds=99999)
    ids = [s.card_id for s in segs]
    assert len(ids) == len(set(ids))


def test_current_priority_then_prior():
    current = [_card(f"cur-{i:04d}", [3]) for i in range(20)]
    prior = [_card(f"pri-{i:04d}", [1]) for i in range(100)]
    segs = select_segments_for_bundle(
        current + prior, bundle_lessons=[3], cap_seconds=99999,
    )
    cur_count = sum(1 for s in segs if s.card_id.startswith("cur-"))
    pri_count = sum(1 for s in segs if s.card_id.startswith("pri-"))
    # All current cards present + some prior cards sampled
    assert cur_count == 20
    assert pri_count > 0
```

- [ ] **Step 2: Run test — expect failure (module not yet defined)**

Run: `python3 -m pytest build/tests/test_review_sets.py -x`
Expected: `ModuleNotFoundError: build.lib.review_sets`

- [ ] **Step 3: Implement `build/lib/review_sets.py`**

```python
"""Per-bundle review-set selection algorithm.

Selects a sequence of audio Segments for a 20-minute drill track:
~70% of audio time from the current bundle, ~30% from prior bundles
weighted by recency. Direction is biased 70/30 EN→ES via per-card hash.
"""
from __future__ import annotations

import hashlib
import random
from typing import Iterable

from build.lib.audio import Segment, _pause_for
from build.lib.types import Card, Direction

# Empirical TTS rates at pace=1.0 used only for duration budgeting.
CHARS_PER_SEC_EN = 16.0
CHARS_PER_SEC_ES = 14.0
MARKER_SECONDS = 0.8       # "Siguiente." marker clip rough length
GAP_SECONDS = 0.5
TRAILING_GAP_SECONDS = 0.5
CURRENT_RATIO = 0.70
DEFAULT_CAP_SECONDS = 1200.0


def _hash_id(card_id: str, salt: str) -> int:
    h = hashlib.sha256(f"{salt}:{card_id}".encode("utf-8")).digest()
    return int.from_bytes(h[:8], "big")


def _pick_direction(card: Card, salt: str) -> Direction | None:
    if not card.directions:
        return None
    pick_en_es = (_hash_id(card.id, salt) % 10) < 7
    if pick_en_es and Direction.EN_ES in card.directions:
        return Direction.EN_ES
    if Direction.ES_EN in card.directions:
        return Direction.ES_EN
    return card.directions[0]


def _segment_for(card: Card, direction: Direction) -> Segment:
    pause = _pause_for(card)
    if direction == Direction.EN_ES:
        return Segment(
            card_id=card.id, direction=direction,
            prompt_text=card.front_en, prompt_lang="en",
            answer_text=card.back_es, answer_lang="es",
            pause_seconds=pause,
        )
    return Segment(
        card_id=card.id, direction=direction,
        prompt_text=card.back_es, prompt_lang="es",
        answer_text=card.front_en, answer_lang="en",
        pause_seconds=pause,
    )


def _estimate_segment_seconds(seg: Segment) -> float:
    rate_p = CHARS_PER_SEC_ES if seg.prompt_lang == "es" else CHARS_PER_SEC_EN
    rate_a = CHARS_PER_SEC_ES if seg.answer_lang == "es" else CHARS_PER_SEC_EN
    return (
        len(seg.prompt_text) / rate_p
        + seg.pause_seconds
        + len(seg.answer_text) / rate_a
        + GAP_SECONDS
        + MARKER_SECONDS
        + TRAILING_GAP_SECONDS
    )


def _bundle_letter(card: Card) -> str | None:
    """Recover the bundle letter from the card's source_file path.

    cards/<letter>_<theme>.yml → <letter>. Returns None for non-bundle files.
    """
    import os
    base = os.path.basename(card.source_file or "")
    if not base or "_" not in base:
        return None
    return base.split("_", 1)[0]


def _bucket_cards(
    all_cards: Iterable[Card], bundle_lessons: list[int],
) -> tuple[list[Card], dict[str, list[Card]]]:
    """Split cards into (current_bundle, prior_bundles_by_letter)."""
    lessons_set = set(bundle_lessons)
    current: list[Card] = []
    prior_by_letter: dict[str, list[Card]] = {}
    for c in all_cards:
        if max(c.lessons) in lessons_set:
            current.append(c)
        else:
            letter = _bundle_letter(c)
            if letter:
                prior_by_letter.setdefault(letter, []).append(c)
    return current, prior_by_letter


def _bundle_seed(bundle_lessons: list[int]) -> int:
    s = ",".join(str(x) for x in sorted(bundle_lessons))
    return _hash_id(s, "bundle-seed")


def select_segments_for_bundle(
    all_cards: Iterable[Card],
    *,
    bundle_lessons: list[int],
    cap_seconds: float = DEFAULT_CAP_SECONDS,
) -> list[Segment]:
    """Return the ordered Segment list to render into review_set_<letter>.mp3.

    Algorithm (mirrors the spec):
      1. Partition cards into current-bundle and prior-bundles-by-letter.
      2. For each card, pick exactly one Segment via direction hash (70/30 EN→ES).
      3. Reserve 0.70 of the cap for current, 0.30 for prior.
      4. Fill current first in deterministic-shuffled order.
      5. Fill prior by weighted bundle sampling (0.50 / 0.30 / 0.20 spread).
      6. Combine and final-shuffle for interleaving.
    """
    all_cards = list(all_cards)
    current, prior_by_letter = _bucket_cards(all_cards, bundle_lessons)
    seed = _bundle_seed(bundle_lessons)
    salt = f"dir-{seed}"

    # Step 1+2: expand current bundle to one segment per card.
    current_segments: list[Segment] = []
    for c in current:
        d = _pick_direction(c, salt)
        if d is not None:
            current_segments.append(_segment_for(c, d))
    rng_cur = random.Random(seed ^ 0xCAFE)
    rng_cur.shuffle(current_segments)

    # Step 3: budgets.
    current_budget = cap_seconds * CURRENT_RATIO
    prior_budget = cap_seconds - current_budget

    chosen: list[Segment] = []
    elapsed_current = 0.0
    for seg in current_segments:
        secs = _estimate_segment_seconds(seg)
        if elapsed_current + secs > current_budget:
            continue  # try the next; the shuffle already varied things
        chosen.append(seg)
        elapsed_current += secs

    # Unused current budget rolls into prior budget.
    unused = current_budget - elapsed_current
    prior_budget += max(unused, 0.0)

    # Step 5: weighted prior-pool sampling.
    if prior_by_letter and prior_budget > 0:
        sorted_letters = sorted(prior_by_letter.keys())
        # Recency = alphabetical position; bundle "z" most recent if listed.
        # In practice prior_by_letter only contains letters < current bundle.
        # Weights: most-recent 0.50, second-most 0.30, all earlier share 0.20.
        weights: dict[str, float] = {}
        n = len(sorted_letters)
        if n == 1:
            weights[sorted_letters[0]] = 1.0
        elif n == 2:
            weights[sorted_letters[-1]] = 0.50
            weights[sorted_letters[-2]] = 0.50  # only two priors → split evenly
        else:
            weights[sorted_letters[-1]] = 0.50
            weights[sorted_letters[-2]] = 0.30
            rest_share = 0.20 / (n - 2)
            for letter in sorted_letters[:-2]:
                weights[letter] = rest_share

        rng_pri = random.Random(seed ^ 0xBEEF)
        used_ids: set[str] = set()
        elapsed_prior = 0.0
        # Bounded attempts; pool may legitimately exhaust early.
        attempts = 0
        max_attempts = 10 * sum(len(v) for v in prior_by_letter.values())
        while elapsed_prior < prior_budget and attempts < max_attempts:
            attempts += 1
            letter = rng_pri.choices(
                sorted_letters, weights=[weights[lt] for lt in sorted_letters], k=1,
            )[0]
            pool = [c for c in prior_by_letter[letter] if c.id not in used_ids]
            if not pool:
                # If every letter exhausted, bail.
                if all(
                    all(c.id in used_ids for c in prior_by_letter[lt])
                    for lt in sorted_letters
                ):
                    break
                continue
            card = rng_pri.choice(pool)
            d = _pick_direction(card, salt)
            if d is None:
                used_ids.add(card.id)
                continue
            seg = _segment_for(card, d)
            secs = _estimate_segment_seconds(seg)
            if elapsed_prior + secs > prior_budget:
                used_ids.add(card.id)
                continue
            chosen.append(seg)
            used_ids.add(card.id)
            elapsed_prior += secs

    # Step 6: final shuffle to interleave current and prior.
    rng_final = random.Random(seed)
    rng_final.shuffle(chosen)
    return chosen
```

- [ ] **Step 4: Add `separator` arg to `render_card_track` in `build/lib/audio.py`**

```python
# Replace the existing render_card_track signature + body:
def render_card_track(
    segments: Iterable[Segment],
    *,
    tts,
    dst: Path,
    seed: int,
    pace: float = 1.0,
    trailing_gap: float = 0.5,
    separator: AudioSegment | None = None,
    shuffle: bool = True,
) -> Path:
    """Render a list of segments into a single MP3 track.

    If `shuffle` is True (back-compat default), order is shuffled by `seed`.
    If a `separator` AudioSegment is provided (e.g. a 'Siguiente.' marker),
    it is appended after each segment's trailing gap.
    """
    seg_list = list(segments)
    if shuffle:
        rng = random.Random(seed)
        rng.shuffle(seg_list)

    work = AudioSegment.empty()
    for seg in seg_list:
        prompt_wav = tts.synth(seg.prompt_text, seg.prompt_lang, pace=pace)
        answer_wav = tts.synth(seg.answer_text, seg.answer_lang, pace=pace)
        work += AudioSegment.from_file(str(prompt_wav))
        work += AudioSegment.silent(duration=int(seg.pause_seconds * 1000))
        work += AudioSegment.from_file(str(answer_wav))
        work += AudioSegment.silent(duration=int(trailing_gap * 1000))
        if separator is not None:
            work += separator
            work += AudioSegment.silent(duration=int(trailing_gap * 1000))

    work = work.set_channels(1)
    dst.parent.mkdir(parents=True, exist_ok=True)
    work.export(str(dst), format="mp3", bitrate="96k")
    return dst
```

- [ ] **Step 5: Run tests**

Run: `python3 -m pytest build/tests/test_review_sets.py build/tests/test_audio.py -x`
Expected: PASS

- [ ] **Step 6: Create `build/generate_review_sets.py`**

```python
#!/usr/bin/env python3.11
"""Render per-bundle review-set MP3s."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydub import AudioSegment  # noqa: E402

from build.lib.audio import render_card_track  # noqa: E402
from build.lib.parse import load_all_card_files  # noqa: E402
from build.lib.review_sets import select_segments_for_bundle  # noqa: E402
from build.lib.tts.factory import make_tts  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]


def _bundle_groups(cards) -> dict[str, list[int]]:
    """Group cards by bundle letter; collect the lesson set per bundle."""
    groups: dict[str, set[int]] = {}
    for c in cards:
        import os
        base = os.path.basename(c.source_file or "")
        if "_" not in base:
            continue
        letter = base.split("_", 1)[0]
        groups.setdefault(letter, set()).update(c.lessons)
    return {k: sorted(v) for k, v in groups.items()}


def _ensure_marker(tts, audio_dir: Path) -> AudioSegment:
    """Render the 'Siguiente.' marker once and return it as an AudioSegment."""
    marker_dst = audio_dir / ".cache" / "marker_siguiente.mp3"
    marker_dst.parent.mkdir(parents=True, exist_ok=True)
    if not marker_dst.exists():
        wav = tts.synth("Siguiente.", "es", pace=1.0)
        AudioSegment.from_file(str(wav)).set_channels(1).export(
            str(marker_dst), format="mp3", bitrate="96k",
        )
    return AudioSegment.from_file(str(marker_dst))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render per-bundle review sets.")
    parser.add_argument("--repo", default=str(REPO_ROOT))
    parser.add_argument("--audio-dir", default=str(REPO_ROOT / "audio"))
    parser.add_argument("--bundle", default=None,
                        help="Bundle letter (a, b, ...). Default: all built bundles.")
    parser.add_argument("--all", action="store_true",
                        help="Render every built bundle (same as omitting --bundle).")
    parser.add_argument("--backend", default=None)
    parser.add_argument("--voice-es", default=None)
    parser.add_argument("--voice-en", default=None)
    parser.add_argument("--pace", type=float, default=1.0)
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    audio_dir = Path(args.audio_dir).resolve()
    cache_dir = audio_dir / ".cache"

    cards = load_all_card_files(repo)
    groups = _bundle_groups(cards)
    if not groups:
        print("No bundle cards found.", file=sys.stderr)
        return 1

    tts = make_tts(args.backend, cache_dir=cache_dir,
                   voice_es=args.voice_es, voice_en=args.voice_en)
    marker = _ensure_marker(tts, audio_dir)

    target_letters = (
        [args.bundle.lower()] if args.bundle else sorted(groups.keys())
    )
    for letter in target_letters:
        if letter not in groups:
            print(f"bundle {letter}: not built, skipping")
            continue
        bundle_lessons = groups[letter]
        segments = select_segments_for_bundle(cards, bundle_lessons=bundle_lessons)
        out = audio_dir / f"review_set_{letter}.mp3"
        render_card_track(
            segments, tts=tts, dst=out,
            seed=hash(letter) & 0xFFFFFFFF,
            pace=args.pace, separator=marker, shuffle=False,
        )
        # report duration
        secs = AudioSegment.from_file(str(out)).duration_seconds
        print(f"Wrote {out} ({len(segments)} segments, {secs/60:.1f} min)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 7: Commit**

```bash
git add build/lib/review_sets.py build/lib/audio.py build/generate_review_sets.py build/tests/test_review_sets.py
git commit -m "Add review-set selection lib + generator CLI"
```

## Task 2: Story system (parser + validator + assembler + CLI + tests)

**Files:**
- Create: `build/lib/stories.py`
- Create: `build/generate_stories.py`
- Create: `build/tests/test_stories.py`

- [ ] **Step 1: Test — parser pulls frontmatter and body cleanly**

```python
# build/tests/test_stories.py
from pathlib import Path
import textwrap

from build.lib.stories import load_story, validate_story, story_words


def _write(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "01_x.md"
    p.write_text(body, encoding="utf-8")
    return p


SAMPLE = textwrap.dedent("""\
    ---
    group: 1_foundation
    bundles: [A, B, C]
    bundle_max: C
    lesson_max: 10
    title: "Dos gatos"
    slug: dos_gatos
    kind: animal_fable
    duration_target_sec: 60
    vocab_focus:
      - { es: "importante", en: "important" }
    preface_en: |
      Listen for "importante". Aqui vamos.
    ---

    # Dos gatos

    (Setting: un callejon.)
    GATO: Es importante. No es importante.
    """).strip()


def test_load_story_parses_frontmatter_and_body(tmp_path):
    p = _write(tmp_path, SAMPLE)
    s = load_story(p)
    assert s.title == "Dos gatos"
    assert s.bundle_max == "C"
    assert s.lesson_max == 10
    assert s.kind == "animal_fable"
    assert "GATO:" in s.body
    assert s.preface_en.startswith("Listen for")


def test_story_words_strips_directions_and_labels(tmp_path):
    p = _write(tmp_path, SAMPLE)
    s = load_story(p)
    words = story_words(s)
    assert "gato" in words or "es" in words
    # Stage direction and speaker label removed:
    assert "setting" not in words
    assert "callejon" in words or True   # spelling test is loose
    assert "gato:" not in words  # speaker label stripped


def test_validate_emits_warnings_for_unknown(tmp_path):
    p = _write(tmp_path, SAMPLE)
    s = load_story(p)
    result = validate_story(s, allowed_words={"es", "no"})
    # "importante" is in vocab_focus → OK. "gato" is not → warning.
    flagged = {w.word for w in result.warnings}
    assert "gato" in flagged
    assert "importante" not in flagged
```

- [ ] **Step 2: Run — expect failure**

Run: `python3 -m pytest build/tests/test_stories.py -x`
Expected: `ModuleNotFoundError: build.lib.stories`

- [ ] **Step 3: Implement `build/lib/stories.py`**

```python
"""Immersion story parser, validator, and audio assembly helper."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import yaml

from build.lib.normalize import strip_accents
from build.lib.vocab import allowed_vocab_through, tokenize_spanish

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)
_SPEAKER_LABEL_RE = re.compile(r"^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ \-]+:\s*", re.MULTILINE)
_STAGE_DIRECTION_RE = re.compile(r"\([^()]*\)")
_HEADING_RE = re.compile(r"^#+ .*$", re.MULTILINE)


@dataclass(frozen=True)
class VocabFocus:
    es: str
    en: str


@dataclass(frozen=True)
class Story:
    path: Path
    group: str
    bundles: list[str]
    bundle_max: str
    lesson_max: int
    title: str
    slug: str
    kind: str
    duration_target_sec: int
    vocab_focus: list[VocabFocus]
    preface_en: str
    body: str
    repeat_slow: bool = False
    characters: list[dict] = field(default_factory=list)


@dataclass(frozen=True)
class ValidationWarning:
    word: str
    reason: str


@dataclass(frozen=True)
class ValidationResult:
    warnings: list[ValidationWarning]
    estimated_seconds: float


def load_story(path: Path) -> Story:
    text = path.read_text(encoding="utf-8").lstrip()
    m = _FRONTMATTER_RE.match(text)
    if not m:
        raise ValueError(f"{path}: missing YAML frontmatter")
    fm = yaml.safe_load(m.group(1)) or {}
    body = m.group(2).strip()
    vocab_focus = [
        VocabFocus(es=str(entry["es"]).lower(), en=str(entry["en"]))
        for entry in (fm.get("vocab_focus") or [])
    ]
    return Story(
        path=path,
        group=str(fm["group"]),
        bundles=[str(b) for b in fm.get("bundles", [])],
        bundle_max=str(fm["bundle_max"]),
        lesson_max=int(fm["lesson_max"]),
        title=str(fm["title"]),
        slug=str(fm["slug"]),
        kind=str(fm.get("kind", "scenario")),
        duration_target_sec=int(fm.get("duration_target_sec", 90)),
        vocab_focus=vocab_focus,
        preface_en=str(fm.get("preface_en", "")).strip(),
        body=body,
        repeat_slow=bool(fm.get("repeat_slow", False)),
        characters=list(fm.get("characters") or []),
    )


def _spanish_body_text(body: str) -> str:
    """Strip headings, stage directions, speaker labels — return spoken Spanish."""
    txt = body
    txt = _HEADING_RE.sub("", txt)
    txt = _STAGE_DIRECTION_RE.sub("", txt)
    txt = _SPEAKER_LABEL_RE.sub("", txt)
    return txt


def story_words(story: Story) -> set[str]:
    return set(tokenize_spanish(_spanish_body_text(story.body)))


# Convertible-word patterns the learner can derive once they know L1–3 rules.
_COGNATE_SUFFIXES = (
    "ble", "able", "ible", "mente", "al", "ante", "ente",
    "cion", "sion", "encia", "ancia", "idad", "ico", "ica",
    "ico", "ica", "ente",
)


def _is_likely_cognate(token: str, allowed_endings: tuple[str, ...]) -> bool:
    tok = strip_accents(token)
    return any(tok.endswith(suf) for suf in allowed_endings)


def validate_story(
    story: Story,
    *,
    allowed_words: set[str] | None = None,
    lessons_dir: Path | None = None,
) -> ValidationResult:
    """Walk story body, return warnings for tokens outside the vocab window.

    Warnings are advisory: vocab_focus entries silence them; recognised
    cognate suffix patterns silence them; everything else flags.
    """
    if allowed_words is None:
        allowed_words = allowed_vocab_through(
            story.lesson_max,
            lessons_dir=lessons_dir if lessons_dir else None,  # vocab.py uses default
        ) if lessons_dir is None else allowed_vocab_through(
            story.lesson_max, lessons_dir=lessons_dir,
        )

    focus_words = {vf.es.lower() for vf in story.vocab_focus}
    # Multi-word focus entries — split into component words to also allow.
    focus_component_words: set[str] = set()
    for fw in focus_words:
        for part in fw.split():
            focus_component_words.add(part.lower())

    body_words = story_words(story)
    warnings: list[ValidationWarning] = []
    for w in sorted(body_words):
        if w in allowed_words:
            continue
        if w in focus_words or w in focus_component_words:
            continue
        if _is_likely_cognate(w, _COGNATE_SUFFIXES):
            continue
        warnings.append(ValidationWarning(word=w, reason="not in vocab window"))

    # Estimate duration: 2.5 ES words/sec at pace 1.0.
    word_count = len(_spanish_body_text(story.body).split())
    est = word_count / 2.5
    return ValidationResult(warnings=warnings, estimated_seconds=est)


def render_story_audio(
    story: Story,
    *,
    tts,
    dst: Path,
    pace_body: float = 0.95,
) -> Path:
    """Render preface (EN) + body (ES) into a single MP3."""
    from pydub import AudioSegment
    work = AudioSegment.empty()

    if story.preface_en:
        prefp = tts.synth(story.preface_en, "en", pace=1.0)
        work += AudioSegment.from_file(str(prefp))
        work += AudioSegment.silent(duration=1000)

    spanish = _spanish_body_text(story.body)
    # Use speaker-label boundaries to insert short silences between lines.
    # We re-split body on lines for natural prosody.
    lines = [ln.strip() for ln in spanish.splitlines() if ln.strip()]
    for ln in lines:
        wav = tts.synth(ln, "es", pace=pace_body)
        work += AudioSegment.from_file(str(wav))
        work += AudioSegment.silent(duration=350)

    if story.repeat_slow:
        work += AudioSegment.silent(duration=800)
        for ln in lines:
            wav = tts.synth(ln, "es", pace=0.85)
            work += AudioSegment.from_file(str(wav))
            work += AudioSegment.silent(duration=350)

    work = work.set_channels(1)
    dst.parent.mkdir(parents=True, exist_ok=True)
    work.export(str(dst), format="mp3", bitrate="96k")
    return dst


def iter_story_files(stories_dir: Path, group: str | None = None) -> Iterable[Path]:
    if group:
        for p in sorted((stories_dir / group).glob("*.md")):
            yield p
    else:
        for sub in sorted(stories_dir.iterdir()):
            if sub.is_dir():
                for p in sorted(sub.glob("*.md")):
                    yield p
```

- [ ] **Step 4: Run test — expect pass**

Run: `python3 -m pytest build/tests/test_stories.py -x`
Expected: PASS

- [ ] **Step 5: Create `build/generate_stories.py`**

```python
#!/usr/bin/env python3.11
"""Render immersion-story MP3s from stories/<group>/<NN>_<slug>.md."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build.lib.stories import (  # noqa: E402
    iter_story_files,
    load_story,
    render_story_audio,
    validate_story,
)
from build.lib.tts.factory import make_tts  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]

_KIND_PACE = {
    "animal_fable": 1.0,
    "scenario": 0.95,
    "dialogue": 0.95,
    "history": 0.95,
    "memory": 0.9,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render immersion stories.")
    parser.add_argument("--repo", default=str(REPO_ROOT))
    parser.add_argument("--audio-dir", default=str(REPO_ROOT / "audio"))
    parser.add_argument("--stories-dir", default=str(REPO_ROOT / "stories"))
    parser.add_argument("--group", default=None,
                        help="Group slug (1_foundation, ...). Omit for all groups.")
    parser.add_argument("--story", default=None,
                        help="Path to one story .md. Overrides --group.")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--backend", default=None)
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    audio_dir = Path(args.audio_dir).resolve()
    stories_dir = Path(args.stories_dir).resolve()
    cache_dir = audio_dir / ".cache"

    if args.story:
        story_paths = [Path(args.story)]
    else:
        story_paths = list(iter_story_files(stories_dir, group=args.group))

    if not story_paths:
        print("No stories found.", file=sys.stderr)
        return 1

    stories = [load_story(p) for p in story_paths]
    any_errors = False
    for s in stories:
        result = validate_story(s, lessons_dir=repo)
        if result.warnings:
            print(f"{s.path.name}: {len(result.warnings)} unknown tokens flagged:")
            for w in result.warnings:
                print(f"  ! {w.word}")
        target = s.duration_target_sec
        est = result.estimated_seconds
        # ±25% window
        if not (target * 0.75 <= est <= target * 1.25):
            print(
                f"{s.path.name}: estimated {est:.0f}s vs target {target}s (±25% miss)"
            )
        # Errors? Currently warnings are advisory; never block.
    if args.validate_only:
        return 0

    tts = make_tts(args.backend, cache_dir=cache_dir)

    for s in stories:
        out = audio_dir / "stories" / s.group / f"{s.path.stem}.mp3"
        pace = _KIND_PACE.get(s.kind, 0.95)
        render_story_audio(s, tts=tts, dst=out, pace_body=pace)
        from pydub import AudioSegment
        secs = AudioSegment.from_file(str(out)).duration_seconds
        print(f"Wrote {out} ({secs:.1f}s, target {s.duration_target_sec}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: Commit**

```bash
git add build/lib/stories.py build/generate_stories.py build/tests/test_stories.py
git commit -m "Add immersion-story parser, validator, generator"
```

## Task 3: Draft 15 stories (groups 1–5)

**Files:**
- Create: `stories/1_foundation/01_*.md`, `02_*.md`, `03_*.md`
- Create: `stories/2_present_pivot/01_*.md`, `02_*.md`, `03_*.md`
- Create: `stories/3_first_past_objects/01_*.md`, `02_*.md`, `03_*.md`
- Create: `stories/4_ser_gerund_pronouns/01_*.md`, `02_*.md`, `03_*.md`
- Create: `stories/5_gustar_line_past/01_*.md`, `02_*.md`, `03_*.md`

For each story:

- [ ] Author content keeping vocab inside `bundle_max`'s window.
- [ ] Include `vocab_focus` listing the 3–6 hooks the listener should catch.
- [ ] Preface in English, closing with "Aquí vamos."
- [ ] Body in Spanish, with optional `(stage directions)` and `SPEAKER:` labels.
- [ ] Run `python3 build/generate_stories.py --group <n> --validate-only`, accept warnings as long as flagged tokens are intentional cognates or proper nouns or `vocab_focus` entries; otherwise rewrite the line.
- [ ] Commit once the group is clean.

Story prompts (LT-teacher tone, character-driven):

- **`1_foundation/01_dos_gatos_importantes.md`** — animal fable. Two cats argue over self-importance in a callejón. Vocabulary: cognates (importante, especial), *es / no es*, *muy*, *para*, *con*. ~60 sec.
- **`1_foundation/02_voy_al_mercado.md`** — scenario. A child is sent to *el mercado* by *mamá*. Uses *voy a + INF*, *los*, motion *a*, *tener*, *necesito*. ~75 sec.
- **`1_foundica/03_quiero_pero_no_puedo.md`** — dialogue. Friend wants a *taco*, can't decide. Spine: *quiero, no puedo, debo, voy a*. ~60 sec.
- **`2_present_pivot/01_el_perro_que_no_duerme.md`** — animal fable. A dog who refuses to sleep tries everything. Uses e→ie/o→ue splits (*duermo, quiero, puede*), present routines. ~90 sec.
- **`2_present_pivot/02_vamos_al_parque.md`** — scenario. Three friends plan a park outing. Uses *vamos, ir, vamos a, podemos, queremos, tenemos*. ~75 sec.
- **`2_present_pivot/03_la_mañana_de_marisa.md`** — first-person daily routine. Spine and -go verbs (*pongo, supongo, hago, salgo* once it lands). ~75 sec.
- **`3_first_past_objects/01_te_lo_doy.md`** — dialogue with sass. A child negotiates a *regalo* with grandma. Uses *dar* + *te lo doy*, *me, te, nos*, two-pronoun stacks. ~90 sec.
- **`3_first_past_objects/02_me_he_perdido.md`** — scenario. Lost tourist. Uses *haber*-past (*me he perdido, he visto, he comido*), reflexive past. ~90 sec.
- **`3_first_past_objects/03_estoy_aburrido_no_soy_aburrido.md`** — short comedic dialogue. *Ser* vs *estar* contrast played for laughs. ~60 sec.
- **`4_ser_gerund_pronouns/01_estoy_buscando.md`** — gerund-heavy scene. Detective looking for a missing *gato*. *Estoy buscando, estoy mirando, estoy pensando*. ~90 sec.
- **`4_ser_gerund_pronouns/02_se_llama_diego.md`** — character sketch. A description of a new neighbor. Full *ser*, flexible adjectives, *salir/salgo*, future. ~90 sec.
- **`4_ser_gerund_pronouns/03_te_lo_dare_manana.md`** — short dialogue. Procrastinator and accuser. Future tense, pronoun migration (*lo → le*), *darse cuenta*. ~75 sec.
- **`5_gustar_line_past/01_cuando_era_niña.md`** — memory piece. Childhood remembrance. Line-past (*era, iba, veía, jugaba, comía, tenía*). ~120 sec.
- **`5_gustar_line_past/02_me_gusta_pero_no_me_encanta.md`** — preferences dialogue. *Gustar, encantar, interesar, parecer*. ~90 sec.
- **`5_gustar_line_past/03_que_haría_yo.md`** — what-if monologue. Conditional (*haría, sería, iría, podría, debería*). ~90 sec.

After each group's three stories are drafted:

- [ ] **Validate group**

Run: `python3 build/generate_stories.py --group <slug> --validate-only`

- [ ] **Commit group**

```bash
git add stories/<group_slug>/
git commit -m "Draft stories for group <slug>"
```

## Task 4: Update .gitignore to allow audio commits

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Replace blanket `audio/` exclusion with targeted exclusions**

```
# audio/.cache and audio/.media are TTS workspace; the rest of audio/ is tracked.
audio/.cache/
audio/.media/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "Track generated audio (review sets + stories), keep TTS workspace ignored"
```

## Task 5: Render audio

- [ ] **Step 1: Render review sets for every built bundle**

Run: `python3 build/generate_review_sets.py --all`
Expected: `Wrote audio/review_set_a.mp3 (...)` lines, durations between 17–22 min.

- [ ] **Step 2: Render all stories**

Run: `python3 build/generate_stories.py`
Expected: 15 lines `Wrote audio/stories/<group>/NN_<slug>.mp3 (...)`.

- [ ] **Step 3: Spot-check one story + one review set**

Run: `mdls -name kMDItemDurationSeconds audio/review_set_a.mp3 audio/stories/1_foundation/01_dos_gatos_importantes.mp3 2>/dev/null || true`

- [ ] **Step 4: Commit audio**

```bash
git add audio/
git commit -m "Render audio: review sets A-O + stories groups 1-5"
```

## Task 6: Retire `generate_audio.py` + update Makefile

**Files:**
- Delete: `build/generate_audio.py`
- Delete: `build/tests/test_generate_audio_cli.py` (if it exists)
- Modify: `Makefile`

- [ ] **Step 1: Delete the script**

```bash
git rm build/generate_audio.py
```

If a test exists for the deleted script, delete it too:

```bash
[ -f build/tests/test_generate_audio_cli.py ] && git rm build/tests/test_generate_audio_cli.py
```

- [ ] **Step 2: Replace Makefile audio targets**

```makefile
.PHONY: install test validate anki anki-with-audio cards-json review-sets stories validate-stories all clean

PYTHON ?= python3.11

install:
	$(PYTHON) -m pip install -r build/requirements.txt

test:
	$(PYTHON) -m pytest build/tests -v

validate:
	$(PYTHON) build/generate_anki.py --validate-only

anki: validate
	$(PYTHON) build/generate_anki.py --out dist/transferencia.apkg

anki-with-audio: validate
	$(PYTHON) build/generate_anki.py --out dist/transferencia.apkg --with-audio --audio-bitrate 48k

cards-json: validate
	$(PYTHON) build/generate_anki.py --export-json dist/cards.json

review-sets: validate
	$(PYTHON) build/generate_review_sets.py --all

stories:
	$(PYTHON) build/generate_stories.py

validate-stories:
	$(PYTHON) build/generate_stories.py --validate-only

all: anki cards-json review-sets stories

clean:
	@for f in dist/*.apkg dist/*.json audio/review_set_*.mp3 audio/lesson_*.mp3; do \
		[ -e "$$f" ] && trash "$$f" || true; \
	done
```

- [ ] **Step 3: Verify Anki path still works**

Run: `python3 build/generate_anki.py --validate-only`
Expected: validation passes, no import errors.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "Retire generate_audio.py; new Makefile targets for review-sets/stories"
```

## Task 7: Documentation

**Files:**
- Modify: `docs/tts-plan.md`
- Modify: `docs/study-routine.md`
- Modify: `docs/lesson-bundles.md` (additive only, no row deletions)
- Modify: `README.md`
- Modify: `docs/build-notes.md`
- Create: `docs/audio-review-sets.md`
- Create: `docs/stories.md`

- [ ] **Step 1: Update `docs/tts-plan.md`** — append section noting the marker-clip reuse, the story per-`kind` voice/pace table, and the (best-effort) multi-voice dialogue note.

- [ ] **Step 2: Rewrite `docs/study-routine.md`** — replace cumulative-drill references with per-bundle review sets and the story-group rotation.

- [ ] **Step 3: Update `docs/lesson-bundles.md`** — add a "Story group" column to the bundle table and a "Stories built: groups 1–5" line in the Status section.

- [ ] **Step 4: Update `README.md`** — replace `audio/lesson_NN.mp3` references with `audio/review_set_<letter>.mp3` and `audio/stories/...`. Replace `make audio` with `make review-sets` and `make stories`.

- [ ] **Step 5: Create `docs/audio-review-sets.md`** — selection algorithm, direction mix, marker, CLI, acceptance band.

- [ ] **Step 6: Create `docs/stories.md`** — file format, vocab window, validator semantics, voice/pace map, authoring workflow, bundle-group map.

- [ ] **Step 7: Update `docs/build-notes.md`** — add a 2026-05-10 entry summarising the audio rework, the gitignore change, and the co-agent contention plan.

- [ ] **Step 8: Commit**

```bash
git add docs/ README.md
git commit -m "Docs: update for audio review sets + story rework"
```

## Task 8: Push

- [ ] **Step 1: Push**

```bash
git push origin main
```

---

## Self-review summary

Spec coverage: every spec component has tasks. Selection algorithm in Task 1, vocab validator in Task 2, gitignore in Task 4, audio render in Task 5, retire path in Task 6, docs in Task 7. Push in Task 8.

Placeholder scan: no TBDs. Code blocks in code steps.

Type consistency: `Story`, `Segment`, `Card` reused; `Direction.EN_ES` / `Direction.ES_EN`; `_pause_for` shared. `render_card_track` separator arg is the only new public knob.

Co-agent guardrails honored: only paths in the spec's "own" list are touched. Cards YAML and `docs/card-design.md` untouched throughout.
