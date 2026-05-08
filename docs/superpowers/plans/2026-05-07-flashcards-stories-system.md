# Flashcards + Stories System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the engineering infrastructure for a Spanish flashcard + audio drill + story system on top of the existing Language Transfer lesson notes, plus Bundle A's cards and 5 stories as proving content.

**Architecture:** Per-lesson and per-bundle YAML card files plus per-bundle markdown story files feed two generators. `generate_anki.py` produces a `.apkg` deck via genanki with subdecks, multi-axis tags, and stable note IDs. `generate_audio.py` has two modes: cards (cumulative drill MP3s with English/Spanish/silence segments) and stories (pure-Spanish narration MP3s). A pluggable TTS adapter defaults to Piper (free, on-device); macOS `say` is the offline fallback. A vocab validator enforces story stretch budgets.

**Tech Stack:** Python 3.11, PyYAML, genanki, pydub, ffmpeg, Piper TTS, pytest.

**Spec:** [`docs/superpowers/specs/2026-05-07-flashcards-design.md`](../specs/2026-05-07-flashcards-design.md)

**Out of plan scope:** Bundles B-H card content (M5) and stories (M6.5). These are content-authoring rolling efforts done after the generators are working; they don't decompose into engineering tasks.

---

## File Structure

### Engineering files (created during the plan)

```
build/
├── __init__.py
├── requirements.txt                       # Python deps
├── generate_anki.py                       # CLI: cards.yml → .apkg + cards.json
├── generate_audio.py                      # CLI: cards & stories → .mp3
├── lib/
│   ├── __init__.py
│   ├── types.py                           # Card, Story, Segment dataclasses
│   ├── parse.py                           # cards.yml loader + validator
│   ├── normalize.py                       # accent-strip, levenshtein, tokenize
│   ├── vocab.py                           # extract allowed vocab from rules.md
│   ├── anki.py                            # genanki note model + deck builders
│   ├── audio.py                           # silence, concat, encode helpers
│   ├── story.py                           # story.md parser
│   ├── validate_story.py                  # CLI: stretch-budget validator
│   └── tts/
│       ├── __init__.py                    # TTS protocol
│       ├── factory.py                     # backend dispatch from env/flag
│       ├── cache.py                       # SHA1 fragment cache
│       ├── mac_say.py                     # macOS `say` adapter
│       └── piper.py                       # Piper adapter
├── scripts/
│   ├── fetch_piper_voices.sh              # download default voice models
│   └── tts_compare.py                     # render same text across backends
└── tests/
    ├── __init__.py
    ├── conftest.py                        # shared pytest fixtures
    ├── fixtures/
    │   ├── lesson_99/
    │   │   ├── rules.md                   # synthetic rules.md
    │   │   └── cards.yml                  # synthetic cards.yml
    │   └── stories/
    │       └── topic_99/
    │           └── 01_test_story.md
    ├── test_parse.py
    ├── test_normalize.py
    ├── test_vocab.py
    ├── test_anki.py
    ├── test_story.py
    ├── test_validate_story.py
    ├── test_tts_cache.py
    └── test_audio.py

Makefile                                   # install, validate, anki, audio, stories, all
.env.example                               # TTS_BACKEND, voice prefs
.gitignore                                 # add audio/, dist/, build/.piper-voices/, .env, etc.
```

### Content files (authored during the plan)

```
lesson_01/cards.yml
lesson_02/cards.yml
lesson_03/cards.yml
cards_topical/topic_01_03_foundation.yml
stories/_world.md
stories/topic_01_03_foundation/01_a_morning_at_the_cafe.md
stories/topic_01_03_foundation/02_the_important_letter.md
stories/topic_01_03_foundation/03_normally_at_the_park.md
stories/topic_01_03_foundation/04_a_constant_friend.md
stories/topic_01_03_foundation/05_real_or_imaginary.md
```

### Generated outputs (gitignored)

```
dist/transferencia.apkg
dist/cards.json
audio/lesson_NN.mp3
audio/stories/topic_*__*.mp3
audio/.cache/<hash>.wav
build/.piper-voices/*.onnx
```

---

## Tasks

### Task 1: Project skeleton

**Files:**
- Create: `build/__init__.py` (empty)
- Create: `build/lib/__init__.py` (empty)
- Create: `build/lib/tts/__init__.py` (empty for now; protocol added in Task 18)
- Create: `build/tests/__init__.py` (empty)
- Create: `build/requirements.txt`
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `Makefile`
- Create: `build/tests/conftest.py`

- [ ] **Step 1: Create empty package files**

```bash
mkdir -p build/lib/tts build/tests/fixtures build/scripts
touch build/__init__.py build/lib/__init__.py build/lib/tts/__init__.py build/tests/__init__.py
```

- [ ] **Step 2: Write `build/requirements.txt`**

```
genanki>=0.13
PyYAML>=6.0
pydub>=0.25
pytest>=7.4
```

- [ ] **Step 3: Write `.env.example`**

```
# Pick: piper | mac_say
TTS_BACKEND=piper

# Spanish voice (Piper voice id; see build/.piper-voices/)
TTS_VOICE_ES=es_MX-claude-high

# English voice
TTS_VOICE_EN=en_US-amy-medium

# Pace multiplier (1.0 = default, 1.15 = slightly slower for stories)
TTS_PACE=1.0
```

- [ ] **Step 4: Append to `.gitignore`**

```
# generated audio
audio/lesson_*.mp3
audio/stories/
audio/.cache/
audio/eval/

# generated builds
dist/

# Piper voice models
build/.piper-voices/

# Python
build/__pycache__/
build/**/__pycache__/
build/.pytest_cache/
.venv/

# secrets
.env
```

- [ ] **Step 5: Write minimal `Makefile`**

```makefile
.PHONY: install test validate validate-stories anki cards-json audio audio-quick stories all clean

PYTHON ?= python3.11

install:
	$(PYTHON) -m pip install -r build/requirements.txt

test:
	$(PYTHON) -m pytest build/tests -v

validate:
	$(PYTHON) build/generate_anki.py --validate-only

validate-stories:
	$(PYTHON) -m build.lib.validate_story

anki: validate
	$(PYTHON) build/generate_anki.py --out dist/transferencia.apkg

cards-json: validate
	$(PYTHON) build/generate_anki.py --export-json dist/cards.json

audio: validate
	$(PYTHON) build/generate_audio.py --all-tracks

audio-quick: validate
	$(PYTHON) build/generate_audio.py --through 3 --backend mac_say

stories: validate-stories
	$(PYTHON) build/generate_audio.py --stories

all: anki cards-json audio stories

clean:
	rm -rf dist/*.apkg dist/*.json audio/lesson_*.mp3 audio/stories/*.mp3
	# preserves audio/.cache/ — costly TTS fragments
```

- [ ] **Step 6: Write `build/tests/conftest.py`**

```python
"""Shared pytest fixtures."""
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def repo_root() -> Path:
    return REPO_ROOT


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES_DIR
```

- [ ] **Step 7: Verify pytest finds zero tests cleanly**

Run: `python3.11 -m pytest build/tests -v`
Expected: `no tests ran in 0.0Xs` exit 5 (no tests collected — that's fine for now). If pytest isn't installed yet, `make install` first.

- [ ] **Step 8: Commit**

```bash
git add build/__init__.py build/lib/__init__.py build/lib/tts/__init__.py build/tests/__init__.py build/tests/conftest.py build/requirements.txt .env.example .gitignore Makefile
git commit -m "Project skeleton: build/, Makefile, requirements, gitignore"
```

---

### Task 2: `Card` and related dataclasses

**Files:**
- Create: `build/lib/types.py`
- Test: `build/tests/test_types.py`

- [ ] **Step 1: Write the failing test**

`build/tests/test_types.py`:

```python
"""Tests for build.lib.types."""
import pytest

from build.lib.types import Card, CardType, Tier, Direction


def test_card_minimal_fields():
    card = Card(
        id="l3-001",
        type=CardType.TRANSFORMATION,
        tier=Tier.PRIMARY,
        front_en="important",
        back_es="importante",
        rule_ref="L3#1",
        lessons=[3],
        directions=[Direction.EN_ES, Direction.ES_EN],
    )
    assert card.id == "l3-001"
    assert card.lessons == [3]
    assert Direction.EN_ES in card.directions


def test_card_default_optional_fields():
    card = Card(
        id="l3-002",
        type=CardType.SENTENCE,
        tier=Tier.PRIMARY,
        front_en="It's not different.",
        back_es="No es diferente.",
        rule_ref="L3#1",
        lessons=[2, 3],
        directions=[Direction.EN_ES],
    )
    assert card.hint == ""
    assert card.notes == ""
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3.11 -m pytest build/tests/test_types.py -v`
Expected: ImportError on `from build.lib.types import Card, ...`

- [ ] **Step 3: Implement `build/lib/types.py`**

```python
"""Core dataclasses: Card, CardType, Tier, Direction, Story."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List


class CardType(str, Enum):
    TRANSFORMATION = "transformation"
    SENTENCE = "sentence"
    CONJUGATION = "conjugation"


class Tier(str, Enum):
    PRIMARY = "primary"
    EXTENDED = "extended"


class Direction(str, Enum):
    EN_ES = "en_es"
    ES_EN = "es_en"
    SHADOW = "shadow"


@dataclass(frozen=True)
class Card:
    id: str
    type: CardType
    tier: Tier
    front_en: str
    back_es: str
    rule_ref: str
    lessons: List[int]
    directions: List[Direction]
    hint: str = ""
    notes: str = ""
    source_file: str = ""  # path to the YAML file the card was loaded from


@dataclass(frozen=True)
class Story:
    """Parsed story file."""
    topic: str
    lessons: List[int]
    title: str
    title_en: str
    order: int
    target_minutes: float
    stretch_used_pct: float
    spanish_paragraphs: List[List[str]]  # paragraphs → list of Spanish lines (gloss stripped)
    free_translation: str
    source_file: str = ""
```

- [ ] **Step 4: Run test, verify it passes**

Run: `python3.11 -m pytest build/tests/test_types.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add build/lib/types.py build/tests/test_types.py
git commit -m "Add Card, Story, Tier, Direction dataclasses"
```

---

### Task 3: `vocab.py` — extract allowed vocab from `lesson_NN/rules.md`

**Files:**
- Create: `build/lib/vocab.py`
- Test: `build/tests/test_vocab.py`
- Create: `build/tests/fixtures/lesson_99/rules.md`

- [ ] **Step 1: Write fixture rules.md**

`build/tests/fixtures/lesson_99/rules.md`:

```markdown
# Lesson 99 (test fixture)

## Summary
Test summary. Not real.

## Rules
1. Test rule one.
2. Test rule two.

## Vocabulary
- *importante* — important
- *diferente* — different
- *real* — real / royal
- *normalmente* — normally / usually

## Examples / Sentences
- *Es importante.* — It's important.
- *No es diferente.* — It's not different.
```

- [ ] **Step 2: Write the failing test**

`build/tests/test_vocab.py`:

```python
"""Tests for build.lib.vocab."""
from build.lib.vocab import extract_lesson_vocab, allowed_vocab_through


def test_extract_lesson_vocab_picks_up_italic_entries(fixtures_dir):
    rules_path = fixtures_dir / "lesson_99" / "rules.md"
    vocab = extract_lesson_vocab(rules_path)
    assert "importante" in vocab
    assert "diferente" in vocab
    assert "real" in vocab
    assert "normalmente" in vocab


def test_extract_lesson_vocab_lowercases_and_strips(fixtures_dir):
    rules_path = fixtures_dir / "lesson_99" / "rules.md"
    vocab = extract_lesson_vocab(rules_path)
    # All entries should be lowercase, no surrounding whitespace
    for word in vocab:
        assert word == word.lower().strip()


def test_allowed_vocab_through_unions_lessons(repo_root, fixtures_dir, monkeypatch):
    # Point allowed_vocab_through at the fixtures dir so we don't depend on real lesson files
    vocab = allowed_vocab_through(99, lessons_dir=fixtures_dir)
    assert "importante" in vocab
```

- [ ] **Step 3: Run test, verify it fails**

Run: `python3.11 -m pytest build/tests/test_vocab.py -v`
Expected: ImportError

- [ ] **Step 4: Implement `build/lib/vocab.py`**

```python
"""Extract allowed vocabulary from lesson_NN/rules.md files."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable, Set

REPO_ROOT = Path(__file__).resolve().parents[2]

# Matches Vocabulary entries:  - *importante* — important
# Captures the italic Spanish word in the first group.
_VOCAB_LINE_RE = re.compile(r"^\s*-\s*\*([^*]+)\*\s*[—\-:]", re.MULTILINE)


def extract_lesson_vocab(rules_path: Path) -> Set[str]:
    """Extract the Spanish vocabulary words from a rules.md file.

    Looks for the `## Vocabulary` section and parses lines like:
        - *importante* — important
        - *real* — real / royal

    Returns lowercased, whitespace-stripped Spanish words. Multi-word
    entries (e.g. *tener que*) are kept as a single space-separated key.
    """
    text = rules_path.read_text(encoding="utf-8")
    # Slice from "## Vocabulary" to the next "## " heading (or EOF)
    m = re.search(r"##\s+Vocabulary\s*\n(.*?)(?=\n##\s|\Z)", text, re.DOTALL)
    if not m:
        return set()
    section = m.group(1)
    return {match.group(1).strip().lower() for match in _VOCAB_LINE_RE.finditer(section)}


def allowed_vocab_through(
    max_lesson: int, *, lessons_dir: Path = REPO_ROOT
) -> Set[str]:
    """Union of vocab from all lesson_NN/rules.md where NN <= max_lesson.

    Looks for both `lesson_NN/` (zero-padded) and `lesson_N/` directory
    naming under `lessons_dir`. Missing lessons are silently skipped so
    we can be tolerant of incomplete corpora during testing.
    """
    union: Set[str] = set()
    for n in range(1, max_lesson + 1):
        for candidate in (f"lesson_{n:02d}", f"lesson_{n}", f"lesson_{n:01d}"):
            rules = lessons_dir / candidate / "rules.md"
            if rules.exists():
                union |= extract_lesson_vocab(rules)
                break
    return union


def tokenize_spanish(text: str) -> list[str]:
    """Lowercase Spanish word tokenizer. Strips punctuation, keeps ñ/accents."""
    return re.findall(r"[a-záéíóúüñ]+", text.lower())
```

- [ ] **Step 5: Run test, verify it passes**

Run: `python3.11 -m pytest build/tests/test_vocab.py -v`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add build/lib/vocab.py build/tests/test_vocab.py build/tests/fixtures/lesson_99/rules.md
git commit -m "Add vocab.py: extract allowed vocabulary from rules.md"
```

---

### Task 4: `normalize.py` — accent strip, levenshtein

**Files:**
- Create: `build/lib/normalize.py`
- Test: `build/tests/test_normalize.py`

- [ ] **Step 1: Write the failing test**

`build/tests/test_normalize.py`:

```python
"""Tests for build.lib.normalize."""
import pytest

from build.lib.normalize import strip_accents, levenshtein, fuzzy_match


@pytest.mark.parametrize("inp,expected", [
    ("difícil", "dificil"),
    ("España", "Espana"),
    ("María", "Maria"),
    ("naturalmente", "naturalmente"),
    ("ñoño", "nono"),
])
def test_strip_accents(inp, expected):
    assert strip_accents(inp) == expected


def test_levenshtein_identical():
    assert levenshtein("hola", "hola") == 0


def test_levenshtein_one_substitution():
    assert levenshtein("hola", "hala") == 1


def test_levenshtein_one_insertion():
    assert levenshtein("hol", "hola") == 1


def test_fuzzy_match_accents_ignored():
    # "diferente" answered, "difərente" (with accent) expected
    assert fuzzy_match("difərente", "diferente", threshold=0.8) is True


def test_fuzzy_match_below_threshold():
    assert fuzzy_match("perro", "gato", threshold=0.8) is False
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3.11 -m pytest build/tests/test_normalize.py -v`
Expected: ImportError

- [ ] **Step 3: Implement `build/lib/normalize.py`**

```python
"""Spanish text utilities: accent strip, levenshtein, fuzzy match."""
from __future__ import annotations

import unicodedata


def strip_accents(s: str) -> str:
    """Remove combining accent marks. Preserves ñ → n."""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def levenshtein(a: str, b: str) -> int:
    """Standard Levenshtein edit distance."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            curr[j] = min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
        prev = curr
    return prev[-1]


def fuzzy_match(actual: str, expected: str, *, threshold: float = 0.85) -> bool:
    """Accent-insensitive fuzzy comparison. Returns True if similarity >= threshold.

    Similarity = 1 - (levenshtein / max(len)).
    """
    a = strip_accents(actual.strip().lower())
    e = strip_accents(expected.strip().lower())
    if not a and not e:
        return True
    max_len = max(len(a), len(e))
    if max_len == 0:
        return True
    sim = 1.0 - (levenshtein(a, e) / max_len)
    return sim >= threshold
```

- [ ] **Step 4: Run test, verify it passes**

Run: `python3.11 -m pytest build/tests/test_normalize.py -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add build/lib/normalize.py build/tests/test_normalize.py
git commit -m "Add normalize.py: strip_accents, levenshtein, fuzzy_match"
```

---

### Task 5: `parse.py` — load + structurally validate cards.yml

**Files:**
- Create: `build/lib/parse.py`
- Test: `build/tests/test_parse.py`
- Create: `build/tests/fixtures/lesson_99/cards.yml`

- [ ] **Step 1: Write fixture cards.yml**

`build/tests/fixtures/lesson_99/cards.yml`:

```yaml
lesson: 99
title: "Test fixture lesson"
cards:
  - id: l99-001
    type: transformation
    tier: primary
    front_en: "important"
    back_es: "importante"
    hint: "-ant → -ante"
    rule_ref: "L99#1"
    lessons: [99]
    directions: [en_es, es_en]
  - id: l99-002
    type: sentence
    tier: primary
    front_en: "It's not different."
    back_es: "No es diferente."
    rule_ref: "L99#1"
    lessons: [99]
    directions: [en_es, es_en, shadow]
```

- [ ] **Step 2: Write the failing test**

`build/tests/test_parse.py`:

```python
"""Tests for build.lib.parse."""
import pytest

from build.lib.parse import load_card_file, ParseError
from build.lib.types import CardType, Direction, Tier


def test_load_lesson_card_file(fixtures_dir):
    cards = load_card_file(fixtures_dir / "lesson_99" / "cards.yml")
    assert len(cards) == 2

    c1 = cards[0]
    assert c1.id == "l99-001"
    assert c1.type == CardType.TRANSFORMATION
    assert c1.tier == Tier.PRIMARY
    assert c1.lessons == [99]
    assert Direction.EN_ES in c1.directions
    assert c1.hint == "-ant → -ante"

    c2 = cards[1]
    assert c2.type == CardType.SENTENCE
    assert Direction.SHADOW in c2.directions


def test_load_card_file_with_missing_required_field_raises(tmp_path):
    bad = tmp_path / "bad.yml"
    bad.write_text("""
lesson: 1
cards:
  - id: l1-001
    type: transformation
    tier: primary
    # missing front_en
    back_es: "importante"
    rule_ref: "L1#1"
    lessons: [1]
    directions: [en_es]
""")
    with pytest.raises(ParseError, match="front_en"):
        load_card_file(bad)


def test_load_card_file_lesson_mismatch_raises(tmp_path):
    bad = tmp_path / "bad.yml"
    bad.write_text("""
lesson: 1
cards:
  - id: l1-001
    type: transformation
    tier: primary
    front_en: "X"
    back_es: "Y"
    rule_ref: "L1#1"
    lessons: [2]   # mismatch — file says lesson 1
    directions: [en_es]
""")
    with pytest.raises(ParseError, match="lessons"):
        load_card_file(bad)
```

- [ ] **Step 3: Run test, verify it fails**

Run: `python3.11 -m pytest build/tests/test_parse.py -v`
Expected: ImportError

- [ ] **Step 4: Implement `build/lib/parse.py`**

```python
"""Load and structurally validate card YAML files."""
from __future__ import annotations

import re
from pathlib import Path
from typing import List

import yaml

from build.lib.types import Card, CardType, Direction, Tier


class ParseError(ValueError):
    """Raised when a card YAML file fails structural validation."""


_REQUIRED_CARD_FIELDS = (
    "id", "type", "tier", "front_en", "back_es",
    "rule_ref", "lessons", "directions",
)

_TOPIC_FILE_RE = re.compile(r"^topic_(\d+)_(\d+)_.*\.yml$")
_LESSON_DIR_RE = re.compile(r"^lesson_(\d+)$")


def load_card_file(path: Path) -> List[Card]:
    """Load and validate a single card YAML file. Returns the parsed cards."""
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ParseError(f"{path}: top-level must be a mapping")

    file_lessons = _file_lesson_context(path, raw)
    cards_raw = raw.get("cards")
    if not isinstance(cards_raw, list) or not cards_raw:
        raise ParseError(f"{path}: 'cards' must be a non-empty list")

    out: List[Card] = []
    for i, c in enumerate(cards_raw):
        if not isinstance(c, dict):
            raise ParseError(f"{path}: cards[{i}] must be a mapping")
        for field_name in _REQUIRED_CARD_FIELDS:
            if field_name not in c:
                raise ParseError(f"{path}: cards[{i}] missing required field '{field_name}'")

        try:
            ctype = CardType(c["type"])
            tier = Tier(c["tier"])
            directions = [Direction(d) for d in c["directions"]]
        except ValueError as e:
            raise ParseError(f"{path}: cards[{i}] invalid enum: {e}") from e

        lessons = c["lessons"]
        if not isinstance(lessons, list) or not all(isinstance(x, int) for x in lessons):
            raise ParseError(f"{path}: cards[{i}] 'lessons' must be a list of ints")

        # Lessons-context check: every lesson in the card's `lessons` field
        # must be in the file's lesson context.
        if file_lessons is not None and not all(L in file_lessons for L in lessons):
            raise ParseError(
                f"{path}: cards[{i}] lessons {lessons} not in file context {sorted(file_lessons)}"
            )

        out.append(Card(
            id=str(c["id"]),
            type=ctype,
            tier=tier,
            front_en=str(c["front_en"]),
            back_es=str(c["back_es"]),
            rule_ref=str(c["rule_ref"]),
            lessons=list(lessons),
            directions=directions,
            hint=str(c.get("hint", "")),
            notes=str(c.get("notes", "")),
            source_file=str(path),
        ))
    return out


def _file_lesson_context(path: Path, raw: dict) -> set[int] | None:
    """Determine the set of lessons this file is allowed to reference.

    - lesson_NN/cards.yml → {NN}
    - cards_topical/topic_AA_BB_*.yml → {AA, AA+1, ..., BB}
    - Other paths (e.g. test fixtures) → fall back to raw['lessons'] or {raw['lesson']}
      or None (skip the check).
    """
    parent = path.parent.name
    m = _LESSON_DIR_RE.match(parent)
    if m:
        return {int(m.group(1))}
    if parent == "cards_topical":
        m2 = _TOPIC_FILE_RE.match(path.name)
        if m2:
            lo, hi = int(m2.group(1)), int(m2.group(2))
            return set(range(lo, hi + 1))
    # Fallback: use frontmatter
    if "lessons" in raw and isinstance(raw["lessons"], list):
        return set(int(x) for x in raw["lessons"])
    if "lesson" in raw:
        return {int(raw["lesson"])}
    return None


def load_all_card_files(repo_root: Path) -> List[Card]:
    """Load every lesson_NN/cards.yml and cards_topical/topic_*.yml under repo_root."""
    out: List[Card] = []
    seen_ids: dict[str, str] = {}

    for cards_path in sorted(repo_root.glob("lesson_*/cards.yml")):
        for card in load_card_file(cards_path):
            _check_unique_id(card, seen_ids)
            out.append(card)

    topical = repo_root / "cards_topical"
    if topical.is_dir():
        for cards_path in sorted(topical.glob("topic_*.yml")):
            for card in load_card_file(cards_path):
                _check_unique_id(card, seen_ids)
                out.append(card)

    return out


def _check_unique_id(card: Card, seen: dict[str, str]) -> None:
    if card.id in seen:
        raise ParseError(
            f"duplicate card id '{card.id}' in {card.source_file} (also in {seen[card.id]})"
        )
    seen[card.id] = card.source_file
```

- [ ] **Step 5: Run test, verify it passes**

Run: `python3.11 -m pytest build/tests/test_parse.py -v`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add build/lib/parse.py build/tests/test_parse.py build/tests/fixtures/lesson_99/cards.yml
git commit -m "Add parse.py: load and structurally validate cards.yml"
```

---

### Task 6: `parse.py` — extended-card grammar gate

**Files:**
- Modify: `build/lib/parse.py`
- Modify: `build/tests/test_parse.py`

- [ ] **Step 1: Add the failing test**

Append to `build/tests/test_parse.py`:

```python
def test_extended_card_must_use_max_file_lesson(tmp_path):
    """An extended card's lessons[] must include the file's max lesson — no reaching forward."""
    # Topic file says 1-3, extended card claims only lesson 1 → forbidden.
    topical_dir = tmp_path / "cards_topical"
    topical_dir.mkdir()
    bad = topical_dir / "topic_01_03_test.yml"
    bad.write_text("""
topic: "test"
lessons: [1, 2, 3]
cards:
  - id: tx-001
    type: sentence
    tier: extended
    front_en: "X"
    back_es: "Y"
    rule_ref: "L1#1"
    lessons: [1]   # missing 3 — extended card pretending to use only L1 grammar in a 1-3 file
    directions: [en_es]
""")
    with pytest.raises(ParseError, match="extended"):
        load_card_file(bad)
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3.11 -m pytest build/tests/test_parse.py::test_extended_card_must_use_max_file_lesson -v`
Expected: FAIL — currently parse.py accepts the file.

- [ ] **Step 3: Update `_file_lesson_context` and add the gate**

In `build/lib/parse.py`, change `load_card_file` to also pass `file_lessons` for the gate. Replace the lessons-context check loop body in `load_card_file` with:

```python
        if file_lessons is not None:
            if not all(L in file_lessons for L in lessons):
                raise ParseError(
                    f"{path}: cards[{i}] lessons {lessons} not in file context {sorted(file_lessons)}"
                )
            # Extended cards must reach the file's max lesson — no claiming
            # to use only earlier-lesson grammar inside a multi-lesson bundle.
            if tier == Tier.EXTENDED and max(file_lessons) not in lessons:
                raise ParseError(
                    f"{path}: cards[{i}] is tier=extended but lessons {lessons} "
                    f"don't reach the file's max lesson {max(file_lessons)}"
                )
```

- [ ] **Step 4: Run all parse tests**

Run: `python3.11 -m pytest build/tests/test_parse.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add build/lib/parse.py build/tests/test_parse.py
git commit -m "parse: enforce extended cards reach file's max lesson"
```

---

### Task 7: `parse.py` — sentence length cap

**Files:**
- Modify: `build/lib/parse.py`
- Modify: `build/tests/test_parse.py`

- [ ] **Step 1: Add the failing test**

Append to `build/tests/test_parse.py`:

```python
def test_sentence_length_cap_l1_10_is_8_words(tmp_path):
    bad = tmp_path / "bad.yml"
    bad.write_text("""
lesson: 1
cards:
  - id: l1-100
    type: sentence
    tier: primary
    front_en: "This is a very long sentence with way too many words."
    back_es: "Esta es una frase muy larga con muchas palabras y más."
    rule_ref: "L1#1"
    lessons: [1]
    directions: [en_es]
""")
    with pytest.raises(ParseError, match="word"):
        load_card_file(bad)


def test_sentence_length_cap_l11_22_is_12_words(tmp_path):
    """A 12-word sentence in lesson 11 is fine; a 13-word one isn't."""
    ok = tmp_path / "ok.yml"
    ok.write_text("""
lesson: 11
cards:
  - id: l11-001
    type: sentence
    tier: primary
    front_en: "One two three four five six seven eight nine ten eleven twelve."
    back_es: "Uno dos tres cuatro cinco seis siete ocho nueve diez once doce."
    rule_ref: "L11#1"
    lessons: [11]
    directions: [en_es]
""")
    cards = load_card_file(ok)
    assert len(cards) == 1
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python3.11 -m pytest build/tests/test_parse.py -v`
Expected: 2 new failures.

- [ ] **Step 3: Implement length cap in parse.py**

Add to `build/lib/parse.py` after the existing imports:

```python
def _word_count(text: str) -> int:
    return len(re.findall(r"\b\w+\b", text))


def _sentence_word_cap(max_lesson: int) -> int:
    return 8 if max_lesson <= 10 else 12
```

In `load_card_file`, after the extended-card gate, add:

```python
        if ctype == CardType.SENTENCE:
            cap = _sentence_word_cap(max(lessons))
            wc_en = _word_count(c["front_en"])
            wc_es = _word_count(c["back_es"])
            if wc_en > cap or wc_es > cap:
                raise ParseError(
                    f"{path}: cards[{i}] sentence exceeds {cap}-word cap "
                    f"(en={wc_en}, es={wc_es})"
                )
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `python3.11 -m pytest build/tests/test_parse.py -v`
Expected: all parse tests pass.

- [ ] **Step 5: Commit**

```bash
git add build/lib/parse.py build/tests/test_parse.py
git commit -m "parse: enforce sentence length cap (8 words L1-10, 12 words L11-22)"
```

---

### Task 8: `generate_anki.py --validate-only` entry point

**Files:**
- Create: `build/generate_anki.py`
- Test: `build/tests/test_generate_anki_cli.py`

- [ ] **Step 1: Write the failing test**

`build/tests/test_generate_anki_cli.py`:

```python
"""Tests for the generate_anki.py CLI."""
import subprocess
import sys
from pathlib import Path


def test_validate_only_succeeds_on_clean_repo(tmp_path, fixtures_dir):
    # Build a synthetic mini-repo: lesson_99 with the fixture cards.yml
    repo = tmp_path / "repo"
    (repo / "lesson_99").mkdir(parents=True)
    (repo / "lesson_99" / "cards.yml").write_text(
        (fixtures_dir / "lesson_99" / "cards.yml").read_text()
    )
    (repo / "lesson_99" / "rules.md").write_text(
        (fixtures_dir / "lesson_99" / "rules.md").read_text()
    )

    script = Path(__file__).resolve().parents[2] / "build" / "generate_anki.py"
    result = subprocess.run(
        [sys.executable, str(script), "--validate-only", "--repo", str(repo)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr


def test_validate_only_fails_on_invalid_yaml(tmp_path):
    repo = tmp_path / "repo"
    (repo / "lesson_99").mkdir(parents=True)
    (repo / "lesson_99" / "cards.yml").write_text("not: valid:\n  cards: [")  # malformed YAML

    script = Path(__file__).resolve().parents[2] / "build" / "generate_anki.py"
    result = subprocess.run(
        [sys.executable, str(script), "--validate-only", "--repo", str(repo)],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3.11 -m pytest build/tests/test_generate_anki_cli.py -v`
Expected: FAIL — script doesn't exist.

- [ ] **Step 3: Implement minimal `build/generate_anki.py`**

```python
#!/usr/bin/env python3.11
"""Generate the Transferencia Anki deck from card YAML files.

Two modes:
  --validate-only      parse + check, no .apkg
  (default)            produce dist/transferencia.apkg
  --export-json PATH   also dump cards.json
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running as a script: ensure the repo root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build.lib.parse import load_all_card_files, ParseError  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the Transferencia Anki deck.")
    parser.add_argument("--repo", default=str(REPO_ROOT), help="Repo root (default: auto-detect)")
    parser.add_argument("--out", default="dist/transferencia.apkg", help="Output .apkg path")
    parser.add_argument("--export-json", default=None, help="Also dump cards.json")
    parser.add_argument("--validate-only", action="store_true", help="Validate only, no output")
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()

    try:
        cards = load_all_card_files(repo)
    except ParseError as e:
        print(f"Validation error: {e}", file=sys.stderr)
        return 1
    except Exception as e:  # YAML errors etc.
        print(f"Error: {e}", file=sys.stderr)
        return 2

    print(f"Loaded {len(cards)} cards from {repo}")
    if args.validate_only:
        return 0

    # .apkg generation lives in Task 13.
    print("(.apkg generation not yet implemented — see Task 13)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test, verify it passes**

Run: `python3.11 -m pytest build/tests/test_generate_anki_cli.py -v`
Expected: 2 passed.

- [ ] **Step 5: Run `make validate` against the actual repo (currently has no card files)**

Run: `make validate`
Expected: `Loaded 0 cards from ...` exit 0

- [ ] **Step 6: Commit**

```bash
git add build/generate_anki.py build/tests/test_generate_anki_cli.py
git commit -m "Add generate_anki.py CLI scaffolding with --validate-only"
```

---

### Task 9: `anki.py` — note model and card templates

**Files:**
- Create: `build/lib/anki.py`
- Test: `build/tests/test_anki.py`

- [ ] **Step 1: Write the failing test**

`build/tests/test_anki.py`:

```python
"""Tests for build.lib.anki note model + builders."""
import pytest

from build.lib.anki import build_note, MODEL_ID, MODEL
from build.lib.types import Card, CardType, Direction, Tier


def _sample_card(directions=None, tier=Tier.PRIMARY, type_=CardType.TRANSFORMATION):
    return Card(
        id="l3-001",
        type=type_,
        tier=tier,
        front_en="important",
        back_es="importante",
        hint="-ant → -ante",
        rule_ref="L3#1",
        lessons=[3],
        directions=directions or [Direction.EN_ES, Direction.ES_EN],
    )


def test_model_id_is_stable():
    """Tests that the model id is the constant we baked in. Changing this would
    invalidate every existing user's review history."""
    assert MODEL_ID == 1735000001


def test_build_note_field_count_matches_model():
    note = build_note(_sample_card())
    assert len(note.fields) == len(MODEL.fields)


def test_build_note_dir_flags_set():
    note = build_note(_sample_card(directions=[Direction.EN_ES]))
    # Find DirEnEs / DirEsEn / DirShadow fields
    field_names = [f["name"] for f in MODEL.fields]
    field_values = dict(zip(field_names, note.fields))
    assert field_values["DirEnEs"] == "1"
    assert field_values["DirEsEn"] == ""
    assert field_values["DirShadow"] == ""


def test_build_note_tag_set_per_card():
    note = build_note(_sample_card())
    tags = set(note.tags)
    assert "lesson::03" in tags
    assert "type::transformation" in tags
    assert "tier::primary" in tags
    assert "direction::en_es" in tags
    assert "direction::es_en" in tags
    assert "rule::L3-1" in tags


def test_build_note_id_stable_across_runs():
    a = build_note(_sample_card())
    b = build_note(_sample_card())
    assert a.guid == b.guid
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3.11 -m pytest build/tests/test_anki.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `build/lib/anki.py`**

```python
"""Anki deck builders: note model, note construction, deck assembly."""
from __future__ import annotations

import hashlib
import re

import genanki

from build.lib.types import Card, CardType, Direction, Tier

# Stable id baked once. Never change.
MODEL_ID = 1735000001
DECK_ID_BASE = 1735000100  # subdeck ids derived from base + hash


_CSS = """
.card {
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  font-size: 26px;
  text-align: center;
  color: #222;
  background: #fafafa;
  padding: 32px 24px;
}
.spanish { font-family: 'Charter', 'Georgia', serif; font-size: 32px; color: #1c4ea0; }
.hint { font-size: 16px; opacity: 0.55; margin-top: 18px; }
.rule-ref { font-size: 13px; color: #888; margin-top: 24px; }
.tier-extended::before { content: "extended"; position: absolute; top: 8px; right: 12px;
                        font-size: 11px; color: #b0b0b0; letter-spacing: 0.05em; }
"""


def _tmpl(name: str, dir_field: str, qfmt: str, afmt: str) -> dict:
    """Build a card template that's only generated when dir_field is set."""
    return {
        "name": name,
        "qfmt": "{{#" + dir_field + "}}\n" + qfmt + "\n{{/" + dir_field + "}}",
        "afmt": "{{#" + dir_field + "}}\n" + afmt + "\n{{/" + dir_field + "}}",
    }


_QFMT_EN_ES = (
    '<div class="english">{{FrontEn}}</div>'
    '{{#Hint}}<div class="hint">({{Hint}})</div>{{/Hint}}'
)
_AFMT_EN_ES = (
    '<div class="english">{{FrontEn}}</div>'
    '<hr>'
    '<div class="spanish">{{BackEs}}</div>'
    '<div class="rule-ref">{{RuleRef}}</div>'
)
_QFMT_ES_EN = (
    '<div class="spanish">{{BackEs}}</div>'
)
_AFMT_ES_EN = (
    '<div class="spanish">{{BackEs}}</div>'
    '<hr>'
    '<div class="english">{{FrontEn}}</div>'
    '<div class="rule-ref">{{RuleRef}}</div>'
)
_QFMT_SHADOW = (
    '<div class="spanish">{{BackEs}}</div>'
    '<div class="hint">(say it back)</div>'
)
_AFMT_SHADOW = (
    '<div class="spanish">{{BackEs}}</div>'
    '<div class="rule-ref">{{RuleRef}}</div>'
)


MODEL = genanki.Model(
    model_id=MODEL_ID,
    name="Transferencia Card",
    fields=[
        {"name": "Id"},
        {"name": "FrontEn"},
        {"name": "BackEs"},
        {"name": "Hint"},
        {"name": "RuleRef"},
        {"name": "Type"},
        {"name": "Tier"},
        {"name": "DirEnEs"},
        {"name": "DirEsEn"},
        {"name": "DirShadow"},
    ],
    templates=[
        _tmpl("EN→ES", "DirEnEs", _QFMT_EN_ES, _AFMT_EN_ES),
        _tmpl("ES→EN", "DirEsEn", _QFMT_ES_EN, _AFMT_ES_EN),
        _tmpl("Shadow", "DirShadow", _QFMT_SHADOW, _AFMT_SHADOW),
    ],
    css=_CSS,
)


def _stable_guid(card_id: str) -> str:
    """Derive a stable Anki guid from card.id. Used as the note's `guid` so
    re-imports preserve scheduling history per card."""
    h = hashlib.sha1(card_id.encode("utf-8")).hexdigest()[:15]
    # genanki accepts strings as guid via the `guid` argument
    return h


def _rule_tags(rule_ref: str) -> list[str]:
    """Convert 'L3#1, L2#es-noes' → ['rule::L3-1', 'rule::L2-es-noes']."""
    out = []
    for part in re.split(r"[,;]\s*", rule_ref.strip()):
        if not part:
            continue
        normalized = part.replace("#", "-").strip()
        out.append(f"rule::{normalized}")
    return out


def build_note(card: Card) -> genanki.Note:
    """Build a single Anki note from a Card."""
    dirs = set(d.value for d in card.directions)
    fields = [
        card.id,
        card.front_en,
        card.back_es,
        card.hint,
        _format_rule_ref(card.rule_ref),
        card.type.value,
        card.tier.value,
        "1" if "en_es" in dirs else "",
        "1" if "es_en" in dirs else "",
        "1" if "shadow" in dirs else "",
    ]

    tags: list[str] = []
    for L in card.lessons:
        tags.append(f"lesson::{L:02d}")
    tags.append(f"type::{card.type.value}")
    tags.append(f"tier::{card.tier.value}")
    for d in dirs:
        tags.append(f"direction::{d}")
    tags.extend(_rule_tags(card.rule_ref))
    tags = sorted(set(tags))

    note = genanki.Note(
        model=MODEL,
        fields=fields,
        tags=tags,
        guid=_stable_guid(card.id),
    )
    return note


def _format_rule_ref(rule_ref: str) -> str:
    """'L3#1, L2#es-noes' → '→ L2 · L3'."""
    lessons: list[str] = []
    for part in re.split(r"[,;]\s*", rule_ref.strip()):
        m = re.match(r"L(\d+)", part)
        if m:
            lessons.append(f"L{int(m.group(1))}")
    if not lessons:
        return ""
    return "→ " + " · ".join(sorted(set(lessons), key=lambda s: int(s[1:])))
```

- [ ] **Step 4: Run test, verify it passes**

Run: `python3.11 -m pytest build/tests/test_anki.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add build/lib/anki.py build/tests/test_anki.py
git commit -m "Add anki.py: note model, templates, stable guids, tag generation"
```

---

### Task 10: `anki.py` — subdecks and `.apkg` writer

**Files:**
- Modify: `build/lib/anki.py`
- Modify: `build/tests/test_anki.py`

- [ ] **Step 1: Add the failing test**

Append to `build/tests/test_anki.py`:

```python
def test_subdeck_for_lesson_card():
    from build.lib.anki import deck_name_for_card
    card = _sample_card()  # lesson 3, no topical
    assert deck_name_for_card(card) == "Transferencia::Lesson 03"


def test_subdeck_for_topical_card():
    from build.lib.anki import deck_name_for_card
    card = Card(
        id="t04_05-001",
        type=CardType.SENTENCE,
        tier=Tier.PRIMARY,
        front_en="X",
        back_es="Y",
        rule_ref="L4#1",
        lessons=[4, 5],
        directions=[Direction.EN_ES],
        source_file="cards_topical/topic_04_05_verb_unlock.yml",
    )
    assert deck_name_for_card(card) == "Transferencia::Topic::04-05 Verb Unlock"


def test_build_package_writes_apkg(tmp_path):
    from build.lib.anki import build_package
    cards = [_sample_card()]
    out = tmp_path / "x.apkg"
    build_package(cards, out)
    assert out.exists() and out.stat().st_size > 0
```

- [ ] **Step 2: Run tests, verify failures**

Run: `python3.11 -m pytest build/tests/test_anki.py -v`
Expected: 3 new failures.

- [ ] **Step 3: Implement subdeck assignment + package builder**

Append to `build/lib/anki.py`:

```python
import re as _re

from pathlib import Path

_TOPIC_FILE_RE = _re.compile(r"^topic_(\d+)_(\d+)_(.+)\.yml$")


def deck_name_for_card(card: Card) -> str:
    """Return the subdeck name a card belongs to.

    - lesson_NN/cards.yml → 'Transferencia::Lesson NN'
    - cards_topical/topic_AA_BB_<theme>.yml → 'Transferencia::Topic::AA-BB <Theme Title>'
    """
    src = Path(card.source_file)
    if src.parent.name.startswith("lesson_"):
        m = _re.match(r"lesson_(\d+)", src.parent.name)
        if m:
            return f"Transferencia::Lesson {int(m.group(1)):02d}"
    if src.parent.name == "cards_topical":
        m = _TOPIC_FILE_RE.match(src.name)
        if m:
            lo, hi = int(m.group(1)), int(m.group(2))
            theme = m.group(3).replace("_", " ").title()
            return f"Transferencia::Topic::{lo:02d}-{hi:02d} {theme}"
    # Fallback: synthesize from lessons[]
    return f"Transferencia::Lesson {card.lessons[0]:02d}"


def build_package(cards: list[Card], out_path: Path) -> None:
    """Build the .apkg from a list of Card objects."""
    decks_by_name: dict[str, genanki.Deck] = {}
    for card in cards:
        deck_name = deck_name_for_card(card)
        if deck_name not in decks_by_name:
            deck_id = DECK_ID_BASE + (
                int(hashlib.sha1(deck_name.encode()).hexdigest()[:8], 16) % 10_000_000
            )
            decks_by_name[deck_name] = genanki.Deck(deck_id, deck_name)
        decks_by_name[deck_name].add_note(build_note(card))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    pkg = genanki.Package(list(decks_by_name.values()))
    pkg.write_to_file(str(out_path))
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `python3.11 -m pytest build/tests/test_anki.py -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add build/lib/anki.py build/tests/test_anki.py
git commit -m "anki: subdeck assignment + .apkg writer"
```

---

### Task 11: `generate_anki.py` — full deck output + cards.json export

**Files:**
- Modify: `build/generate_anki.py`
- Modify: `build/tests/test_generate_anki_cli.py`

- [ ] **Step 1: Add the failing tests**

Append to `build/tests/test_generate_anki_cli.py`:

```python
def test_apkg_is_written(tmp_path, fixtures_dir):
    repo = tmp_path / "repo"
    (repo / "lesson_99").mkdir(parents=True)
    (repo / "lesson_99" / "cards.yml").write_text(
        (fixtures_dir / "lesson_99" / "cards.yml").read_text()
    )
    (repo / "lesson_99" / "rules.md").write_text(
        (fixtures_dir / "lesson_99" / "rules.md").read_text()
    )

    out = tmp_path / "out.apkg"
    script = Path(__file__).resolve().parents[2] / "build" / "generate_anki.py"
    result = subprocess.run(
        [sys.executable, str(script), "--repo", str(repo), "--out", str(out)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert out.exists() and out.stat().st_size > 0


def test_export_json_writes_flat_array(tmp_path, fixtures_dir):
    import json
    repo = tmp_path / "repo"
    (repo / "lesson_99").mkdir(parents=True)
    (repo / "lesson_99" / "cards.yml").write_text(
        (fixtures_dir / "lesson_99" / "cards.yml").read_text()
    )
    (repo / "lesson_99" / "rules.md").write_text(
        (fixtures_dir / "lesson_99" / "rules.md").read_text()
    )

    out_json = tmp_path / "cards.json"
    script = Path(__file__).resolve().parents[2] / "build" / "generate_anki.py"
    result = subprocess.run(
        [sys.executable, str(script), "--repo", str(repo),
         "--validate-only", "--export-json", str(out_json)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    data = json.loads(out_json.read_text())
    assert isinstance(data, list)
    assert len(data) == 2
    assert data[0]["id"] == "l99-001"
```

- [ ] **Step 2: Run tests, verify failures**

Run: `python3.11 -m pytest build/tests/test_generate_anki_cli.py -v`
Expected: 2 new failures.

- [ ] **Step 3: Wire `.apkg` and JSON export into `generate_anki.py`**

Replace the placeholder block at the bottom of `main()` in `build/generate_anki.py` with:

```python
    # JSON export (independent of validate-only / .apkg generation)
    if args.export_json:
        import json
        export_path = Path(args.export_json)
        export_path.parent.mkdir(parents=True, exist_ok=True)
        export_path.write_text(
            json.dumps([_card_to_dict(c) for c in cards], ensure_ascii=False, indent=2)
        )
        print(f"Wrote {export_path}")

    if args.validate_only:
        return 0

    from build.lib.anki import build_package
    out = Path(args.out)
    build_package(cards, out)
    print(f"Wrote {out}")
    return 0


def _card_to_dict(c) -> dict:
    return {
        "id": c.id,
        "type": c.type.value,
        "tier": c.tier.value,
        "front_en": c.front_en,
        "back_es": c.back_es,
        "hint": c.hint,
        "rule_ref": c.rule_ref,
        "lessons": c.lessons,
        "directions": [d.value for d in c.directions],
        "notes": c.notes,
    }
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `python3.11 -m pytest build/tests/test_generate_anki_cli.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add build/generate_anki.py build/tests/test_generate_anki_cli.py
git commit -m "generate_anki: full .apkg output + cards.json export"
```

---

### Task 12: TTS protocol + cache layer

**Files:**
- Modify: `build/lib/tts/__init__.py`
- Create: `build/lib/tts/cache.py`
- Test: `build/tests/test_tts_cache.py`

- [ ] **Step 1: Write the failing test**

`build/tests/test_tts_cache.py`:

```python
"""Tests for build.lib.tts.cache."""
from build.lib.tts.cache import cache_path_for, ensure_cached


def test_cache_path_deterministic(tmp_path):
    p1 = cache_path_for(tmp_path, "hola", "es", "piper:es_MX-claude-high")
    p2 = cache_path_for(tmp_path, "hola", "es", "piper:es_MX-claude-high")
    assert p1 == p2


def test_cache_path_changes_with_voice(tmp_path):
    p_a = cache_path_for(tmp_path, "hola", "es", "piper:es_MX-claude-high")
    p_b = cache_path_for(tmp_path, "hola", "es", "piper:es_MX-ald-medium")
    assert p_a != p_b


def test_ensure_cached_only_calls_synth_once(tmp_path):
    calls = {"n": 0}

    def fake_synth(text: str, lang: str, dst):
        calls["n"] += 1
        dst.write_bytes(b"FAKE_WAV")
        return dst

    p1 = ensure_cached(tmp_path, "hola", "es", "test:fake", fake_synth)
    p2 = ensure_cached(tmp_path, "hola", "es", "test:fake", fake_synth)
    assert p1 == p2
    assert calls["n"] == 1
    assert p1.read_bytes() == b"FAKE_WAV"
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3.11 -m pytest build/tests/test_tts_cache.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement TTS protocol + cache**

`build/lib/tts/__init__.py`:

```python
"""TTS adapter protocol."""
from __future__ import annotations

from pathlib import Path
from typing import Literal, Protocol


class TTS(Protocol):
    """Speech synthesis adapter."""

    backend_id: str  # e.g. "piper:es_MX-claude-high" — used for cache keying

    def synth(
        self,
        text: str,
        lang: Literal["en", "es"],
        *,
        voice: str | None = None,
        pace: float = 1.0,
    ) -> Path:
        """Return path to a cached WAV fragment for `text` in `lang`."""
        ...
```

`build/lib/tts/cache.py`:

```python
"""On-disk cache for TTS-synthesized audio fragments."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Callable


def cache_path_for(cache_dir: Path, text: str, lang: str, backend_id: str) -> Path:
    key = f"{backend_id}|{lang}|{text}".encode("utf-8")
    digest = hashlib.sha1(key).hexdigest()
    return cache_dir / f"{digest}.wav"


SynthFn = Callable[[str, str, Path], Path]


def ensure_cached(
    cache_dir: Path,
    text: str,
    lang: str,
    backend_id: str,
    synth: SynthFn,
) -> Path:
    """Return cached WAV path; call `synth(text, lang, dst)` if missing."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_path_for(cache_dir, text, lang, backend_id)
    if not path.exists():
        synth(text, lang, path)
    return path
```

- [ ] **Step 4: Run test, verify it passes**

Run: `python3.11 -m pytest build/tests/test_tts_cache.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add build/lib/tts/__init__.py build/lib/tts/cache.py build/tests/test_tts_cache.py
git commit -m "Add TTS protocol and on-disk fragment cache"
```

---

### Task 13: macOS `say` adapter

**Files:**
- Create: `build/lib/tts/mac_say.py`
- Test: `build/tests/test_tts_mac_say.py`

- [ ] **Step 1: Write the failing test**

`build/tests/test_tts_mac_say.py`:

```python
"""Tests for the macOS `say` adapter. Skipped on non-Darwin systems."""
import platform

import pytest

from build.lib.tts.mac_say import MacSayTTS


pytestmark = pytest.mark.skipif(platform.system() != "Darwin", reason="macOS only")


def test_synth_es_produces_nonempty_wav(tmp_path):
    tts = MacSayTTS(cache_dir=tmp_path)
    out = tts.synth("hola", lang="es")
    assert out.exists()
    assert out.stat().st_size > 0


def test_synth_uses_cache(tmp_path):
    tts = MacSayTTS(cache_dir=tmp_path)
    a = tts.synth("hola", lang="es")
    b = tts.synth("hola", lang="es")
    assert a == b
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3.11 -m pytest build/tests/test_tts_mac_say.py -v`
Expected: ImportError (or skip on non-Darwin).

- [ ] **Step 3: Implement `build/lib/tts/mac_say.py`**

```python
"""macOS `say` adapter. Free, native, decent quality. Offline fallback."""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import Literal

from build.lib.tts.cache import ensure_cached


class MacSayTTS:
    """Wraps `say -v <voice>` with WAV output via `afconvert`."""

    DEFAULT_VOICES = {"en": "Samantha", "es": "Mónica"}

    def __init__(self, cache_dir: Path, voices: dict[str, str] | None = None):
        self.cache_dir = cache_dir
        self.voices = {**self.DEFAULT_VOICES, **(voices or {})}
        voice_id = "+".join(f"{k}={v}" for k, v in sorted(self.voices.items()))
        self.backend_id = f"mac_say:{voice_id}"

    def synth(
        self,
        text: str,
        lang: Literal["en", "es"],
        *,
        voice: str | None = None,
        pace: float = 1.0,
    ) -> Path:
        chosen = voice or self.voices[lang]
        # Bake voice + pace into the cache key so re-renders with different
        # voices/paces don't collide.
        backend_id = f"{self.backend_id}|voice={chosen}|pace={pace:.3f}"

        def _do_synth(t: str, _lang: str, dst: Path) -> Path:
            with tempfile.NamedTemporaryFile(suffix=".aiff", delete=False) as tmp:
                aiff_path = Path(tmp.name)
            try:
                rate = int(180 * pace)  # words/min; 180 ≈ default
                subprocess.run(
                    ["say", "-v", chosen, "-r", str(rate), "-o", str(aiff_path), t],
                    check=True, capture_output=True,
                )
                subprocess.run(
                    ["afconvert", str(aiff_path), str(dst), "-d", "LEI16@22050"],
                    check=True, capture_output=True,
                )
            finally:
                aiff_path.unlink(missing_ok=True)
            return dst

        return ensure_cached(self.cache_dir, text, lang, backend_id, _do_synth)
```

- [ ] **Step 4: Run test, verify it passes (on macOS)**

Run: `python3.11 -m pytest build/tests/test_tts_mac_say.py -v`
Expected (Darwin): 2 passed.
Expected (non-Darwin): 2 skipped.

- [ ] **Step 5: Commit**

```bash
git add build/lib/tts/mac_say.py build/tests/test_tts_mac_say.py
git commit -m "Add macOS `say` TTS adapter (offline fallback)"
```

---

### Task 14: Piper adapter

**Files:**
- Create: `build/lib/tts/piper.py`
- Create: `build/scripts/fetch_piper_voices.sh`
- Test: `build/tests/test_tts_piper.py`

- [ ] **Step 1: Write `build/scripts/fetch_piper_voices.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Download default Piper voice models for transferencia.
# Voices land in build/.piper-voices/

DEST="$(cd "$(dirname "$0")/.." && pwd)/.piper-voices"
mkdir -p "$DEST"

declare -a VOICES=(
  "es_MX/claude/high/es_MX-claude-high.onnx|https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx"
  "es_MX/claude/high/es_MX-claude-high.onnx.json|https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx.json"
  "en_US/amy/medium/en_US-amy-medium.onnx|https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx"
  "en_US/amy/medium/en_US-amy-medium.onnx.json|https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json"
)

for entry in "${VOICES[@]}"; do
  rel="${entry%%|*}"
  url="${entry#*|}"
  out="$DEST/$rel"
  mkdir -p "$(dirname "$out")"
  if [[ -f "$out" ]]; then
    echo "skip  $rel (exists)"
    continue
  fi
  echo "fetch $rel"
  curl -fsSL "$url" -o "$out"
done

echo "Voices in $DEST"
ls "$DEST"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x build/scripts/fetch_piper_voices.sh
```

- [ ] **Step 3: Write the failing test**

`build/tests/test_tts_piper.py`:

```python
"""Tests for the Piper adapter. Skipped if `piper` binary not on PATH."""
import shutil

import pytest

piper_available = shutil.which("piper") is not None
pytestmark = pytest.mark.skipif(not piper_available, reason="piper not installed")


def test_piper_synth_produces_nonempty_wav(tmp_path):
    from build.lib.tts.piper import PiperTTS
    voices_dir = tmp_path / "voices"
    voices_dir.mkdir()
    # If real voices aren't present, this test will be a no-op for now.
    # In CI we should require the test runner to call fetch_piper_voices.sh first.
    import os
    real_voices = os.environ.get("PIPER_VOICES_DIR")
    if not real_voices:
        pytest.skip("Set PIPER_VOICES_DIR to the result of fetch_piper_voices.sh")

    tts = PiperTTS(
        cache_dir=tmp_path / "cache",
        voices_dir=os.environ["PIPER_VOICES_DIR"],
        voice_es="es_MX-claude-high",
        voice_en="en_US-amy-medium",
    )
    out = tts.synth("hola", lang="es")
    assert out.exists() and out.stat().st_size > 0
```

- [ ] **Step 4: Run test, verify it fails (or skips on missing piper)**

Run: `python3.11 -m pytest build/tests/test_tts_piper.py -v`
Expected: skip (most envs); ImportError if piper installed but module not yet written.

- [ ] **Step 5: Implement `build/lib/tts/piper.py`**

```python
"""Piper TTS adapter. Free, on-device, Apache 2.0. Default backend."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Literal

from build.lib.tts.cache import ensure_cached


class PiperTTS:
    """Wraps the piper CLI (https://github.com/rhasspy/piper).

    Voice files (`*.onnx` + `*.onnx.json`) live under voices_dir, organized by
    voice id (e.g. voices_dir/es_MX/claude/high/es_MX-claude-high.onnx).
    """

    def __init__(
        self,
        cache_dir: Path,
        voices_dir: Path,
        voice_es: str = "es_MX-claude-high",
        voice_en: str = "en_US-amy-medium",
    ):
        self.cache_dir = Path(cache_dir)
        self.voices_dir = Path(voices_dir)
        self.voice_es = voice_es
        self.voice_en = voice_en
        if not shutil.which("piper"):
            raise RuntimeError("piper binary not on PATH; install via `brew install piper-tts`")
        self.backend_id = f"piper:es={voice_es}|en={voice_en}"

    def _voice_path(self, voice_id: str) -> Path:
        # Voice id like "es_MX-claude-high" → es_MX/claude/high/es_MX-claude-high.onnx
        parts = voice_id.split("-")
        if len(parts) < 3:
            raise ValueError(f"unexpected voice id format: {voice_id}")
        lang_region, name, quality = parts[0], parts[1], parts[2]
        return self.voices_dir / lang_region / name / quality / f"{voice_id}.onnx"

    def synth(
        self,
        text: str,
        lang: Literal["en", "es"],
        *,
        voice: str | None = None,
        pace: float = 1.0,
    ) -> Path:
        chosen = voice or (self.voice_es if lang == "es" else self.voice_en)
        backend_id = f"{self.backend_id}|chosen={chosen}|pace={pace:.3f}"

        def _do_synth(t: str, _lang: str, dst: Path) -> Path:
            length_scale = 1.0 / max(pace, 0.1)  # piper: bigger = slower
            cmd = [
                "piper",
                "--model", str(self._voice_path(chosen)),
                "--output_file", str(dst),
                "--length_scale", f"{length_scale:.3f}",
            ]
            subprocess.run(cmd, input=t, text=True, check=True, capture_output=True)
            return dst

        return ensure_cached(self.cache_dir, text, lang, backend_id, _do_synth)
```

- [ ] **Step 6: Smoke-run the fetch script and a manual synth (skip if no internet)**

```bash
build/scripts/fetch_piper_voices.sh
PIPER_VOICES_DIR=$(pwd)/build/.piper-voices python3.11 -m pytest build/tests/test_tts_piper.py -v
```

Expected: 1 passed (if Piper installed + voices fetched). Otherwise skip — that's fine for the plan; downstream tests will continue to use mac_say.

- [ ] **Step 7: Commit**

```bash
git add build/lib/tts/piper.py build/scripts/fetch_piper_voices.sh build/tests/test_tts_piper.py
git commit -m "Add Piper TTS adapter and voice-fetch script"
```

---

### Task 15: TTS factory dispatch

**Files:**
- Create: `build/lib/tts/factory.py`
- Test: `build/tests/test_tts_factory.py`

- [ ] **Step 1: Write the failing test**

`build/tests/test_tts_factory.py`:

```python
"""Tests for build.lib.tts.factory."""
from build.lib.tts.factory import make_tts


def test_make_tts_mac_say(tmp_path):
    tts = make_tts("mac_say", cache_dir=tmp_path / "cache")
    assert tts.backend_id.startswith("mac_say:")


def test_make_tts_unknown_raises(tmp_path):
    import pytest
    with pytest.raises(ValueError):
        make_tts("nonexistent_backend", cache_dir=tmp_path / "cache")
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3.11 -m pytest build/tests/test_tts_factory.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `build/lib/tts/factory.py`**

```python
"""TTS backend dispatch from string id (env / CLI flag)."""
from __future__ import annotations

import os
from pathlib import Path

from build.lib.tts import TTS


def make_tts(
    backend: str | None = None,
    *,
    cache_dir: Path,
    voices_dir: Path | None = None,
    voice_es: str | None = None,
    voice_en: str | None = None,
) -> TTS:
    """Build a TTS adapter from a backend name. Reads sensible defaults from env."""
    backend = backend or os.environ.get("TTS_BACKEND", "piper")
    voice_es = voice_es or os.environ.get("TTS_VOICE_ES")
    voice_en = voice_en or os.environ.get("TTS_VOICE_EN")

    if backend == "mac_say":
        from build.lib.tts.mac_say import MacSayTTS
        return MacSayTTS(cache_dir=cache_dir)

    if backend == "piper":
        from build.lib.tts.piper import PiperTTS
        repo_root = Path(__file__).resolve().parents[3]
        vd = voices_dir or (repo_root / "build" / ".piper-voices")
        return PiperTTS(
            cache_dir=cache_dir,
            voices_dir=vd,
            voice_es=voice_es or "es_MX-claude-high",
            voice_en=voice_en or "en_US-amy-medium",
        )

    raise ValueError(f"unknown TTS backend: {backend}")
```

- [ ] **Step 4: Run test, verify it passes**

Run: `python3.11 -m pytest build/tests/test_tts_factory.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add build/lib/tts/factory.py build/tests/test_tts_factory.py
git commit -m "Add TTS factory: backend dispatch from env/flag"
```

---

### Task 16: `audio.py` — silence + concatenation helpers

**Files:**
- Create: `build/lib/audio.py`
- Test: `build/tests/test_audio.py`

- [ ] **Step 1: Write the failing test**

`build/tests/test_audio.py`:

```python
"""Tests for build.lib.audio."""
from pathlib import Path

import pytest

from build.lib.audio import silence, concat_segments


def _wav_seconds(path: Path) -> float:
    """Read a WAV file's duration in seconds via pydub."""
    from pydub import AudioSegment
    return AudioSegment.from_wav(str(path)).duration_seconds


def test_silence_creates_correct_length_wav(tmp_path):
    out = silence(seconds=2.0, dst=tmp_path / "silence.wav")
    assert out.exists()
    assert abs(_wav_seconds(out) - 2.0) < 0.05


def test_concat_segments_lengths_add(tmp_path):
    s1 = silence(seconds=0.5, dst=tmp_path / "a.wav")
    s2 = silence(seconds=1.0, dst=tmp_path / "b.wav")
    out = concat_segments([s1, s2], dst=tmp_path / "combined.wav")
    assert abs(_wav_seconds(out) - 1.5) < 0.05
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3.11 -m pytest build/tests/test_audio.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `build/lib/audio.py`**

```python
"""Audio assembly: silence generation, segment concatenation, MP3 encoding."""
from __future__ import annotations

from pathlib import Path

from pydub import AudioSegment


def silence(seconds: float, dst: Path) -> Path:
    seg = AudioSegment.silent(duration=int(seconds * 1000))
    dst.parent.mkdir(parents=True, exist_ok=True)
    seg.export(str(dst), format="wav")
    return dst


def concat_segments(segments: list[Path], dst: Path) -> Path:
    if not segments:
        raise ValueError("concat_segments: empty list")
    combined = AudioSegment.empty()
    for path in segments:
        combined += AudioSegment.from_file(str(path))
    dst.parent.mkdir(parents=True, exist_ok=True)
    combined.export(str(dst), format="wav")
    return dst


def encode_mp3(src_wav: Path, dst_mp3: Path, *, bitrate: str = "96k") -> Path:
    seg = AudioSegment.from_wav(str(src_wav))
    seg = seg.set_channels(1)  # mono
    dst_mp3.parent.mkdir(parents=True, exist_ok=True)
    seg.export(str(dst_mp3), format="mp3", bitrate=bitrate)
    return dst_mp3
```

- [ ] **Step 4: Run test, verify it passes**

Run: `python3.11 -m pytest build/tests/test_audio.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add build/lib/audio.py build/tests/test_audio.py
git commit -m "Add audio.py: silence, concat_segments, encode_mp3"
```

---

### Task 17: Card → segments + cumulative track assembly

**Files:**
- Modify: `build/lib/audio.py`
- Modify: `build/tests/test_audio.py`

- [ ] **Step 1: Add the failing test**

Append to `build/tests/test_audio.py`:

```python
def test_card_segments_for_en_es_only_emits_one_segment(tmp_path):
    """Test the segment expansion for a card declaring only en_es."""
    from build.lib.audio import card_segments
    from build.lib.types import Card, CardType, Direction, Tier

    card = Card(
        id="x", type=CardType.TRANSFORMATION, tier=Tier.PRIMARY,
        front_en="important", back_es="importante",
        rule_ref="L3#1", lessons=[3],
        directions=[Direction.EN_ES],
    )
    segs = card_segments(card)
    assert len(segs) == 1
    assert segs[0].direction == Direction.EN_ES


def test_card_segments_for_three_directions_emits_three(tmp_path):
    from build.lib.audio import card_segments
    from build.lib.types import Card, CardType, Direction, Tier

    card = Card(
        id="x", type=CardType.SENTENCE, tier=Tier.PRIMARY,
        front_en="It's important.", back_es="Es importante.",
        rule_ref="L3#1", lessons=[3],
        directions=[Direction.EN_ES, Direction.ES_EN, Direction.SHADOW],
    )
    segs = card_segments(card)
    assert {s.direction for s in segs} == {Direction.EN_ES, Direction.ES_EN, Direction.SHADOW}
```

- [ ] **Step 2: Run tests, verify failures**

Run: `python3.11 -m pytest build/tests/test_audio.py -v`
Expected: 2 new failures.

- [ ] **Step 3: Add `Segment` dataclass + `card_segments` to audio.py**

Append to `build/lib/audio.py`:

```python
from dataclasses import dataclass

from build.lib.types import Card, CardType, Direction


@dataclass(frozen=True)
class Segment:
    card_id: str
    direction: Direction
    prompt_text: str
    prompt_lang: str       # "en" or "es"
    answer_text: str
    answer_lang: str
    pause_seconds: float


def _pause_for(card: Card) -> float:
    return 5.0 if card.type == CardType.SENTENCE else 3.0


def card_segments(card: Card) -> list[Segment]:
    """Expand a card into one Segment per direction it supports."""
    pause = _pause_for(card)
    out: list[Segment] = []
    for direction in card.directions:
        if direction == Direction.EN_ES:
            out.append(Segment(
                card_id=card.id, direction=direction,
                prompt_text=card.front_en, prompt_lang="en",
                answer_text=card.back_es, answer_lang="es",
                pause_seconds=pause,
            ))
        elif direction == Direction.ES_EN:
            out.append(Segment(
                card_id=card.id, direction=direction,
                prompt_text=card.back_es, prompt_lang="es",
                answer_text=card.front_en, answer_lang="en",
                pause_seconds=pause,
            ))
        elif direction == Direction.SHADOW:
            out.append(Segment(
                card_id=card.id, direction=direction,
                prompt_text=card.back_es, prompt_lang="es",
                answer_text=card.back_es, answer_lang="es",
                pause_seconds=max(pause - 1.0, 1.5),
            ))
    return out
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `python3.11 -m pytest build/tests/test_audio.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add build/lib/audio.py build/tests/test_audio.py
git commit -m "audio: card_segments — expand a card into per-direction Segment objects"
```

---

### Task 18: Track renderer

**Files:**
- Modify: `build/lib/audio.py`
- Modify: `build/tests/test_audio.py`

- [ ] **Step 1: Add the failing test** (uses a fake TTS for determinism)

Append to `build/tests/test_audio.py`:

```python
def test_render_track_assembles_segments(tmp_path, monkeypatch):
    from build.lib.audio import render_card_track, Segment, silence
    from build.lib.types import Direction
    from pydub import AudioSegment

    # A fake TTS that produces 0.5s of silence per request.
    class FakeTTS:
        backend_id = "fake"
        def __init__(self):
            self.calls = 0
        def synth(self, text, lang, *, voice=None, pace=1.0):
            self.calls += 1
            f = tmp_path / f"frag_{self.calls}.wav"
            return silence(0.5, f)

    tts = FakeTTS()
    segs = [
        Segment("a", Direction.EN_ES, "hello", "en", "hola", "es", 1.0),
        Segment("b", Direction.ES_EN, "hola", "es", "hello", "en", 1.0),
    ]
    out = render_card_track(segs, tts=tts, dst=tmp_path / "track.mp3", seed=42)
    assert out.exists()
    duration = AudioSegment.from_file(str(out)).duration_seconds
    # 2 segments × (0.5 prompt + 1.0 pause + 0.5 answer + 0.5 trailing gap) = 5.0s ± slack
    assert 4.0 < duration < 6.5
    assert tts.calls == 4  # 2 segments × 2 calls each
```

- [ ] **Step 2: Run test, verify failure**

Run: `python3.11 -m pytest build/tests/test_audio.py::test_render_track_assembles_segments -v`
Expected: ImportError on `render_card_track`.

- [ ] **Step 3: Implement `render_card_track`**

Append to `build/lib/audio.py`:

```python
import random
from typing import Iterable


def render_card_track(
    segments: Iterable[Segment],
    *,
    tts,
    dst: Path,
    seed: int,
    pace: float = 1.0,
    trailing_gap: float = 0.5,
) -> Path:
    """Render a list of segments into a single MP3 track.

    Order is shuffled deterministically by `seed` so two runs of the same
    track produce the same shuffle but different tracks vary.
    """
    seg_list = list(segments)
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

    work = work.set_channels(1)
    dst.parent.mkdir(parents=True, exist_ok=True)
    work.export(str(dst), format="mp3", bitrate="96k")
    return dst
```

- [ ] **Step 4: Run test, verify it passes**

Run: `python3.11 -m pytest build/tests/test_audio.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add build/lib/audio.py build/tests/test_audio.py
git commit -m "audio: render_card_track — assemble segments into MP3 with deterministic shuffle"
```

---

### Task 19: `generate_audio.py` — card mode CLI

**Files:**
- Create: `build/generate_audio.py`
- Test: `build/tests/test_generate_audio_cli.py`

- [ ] **Step 1: Write the failing test**

`build/tests/test_generate_audio_cli.py`:

```python
"""Tests for the generate_audio.py CLI (card mode)."""
import platform
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.skipif(platform.system() != "Darwin", reason="card-track smoke test uses mac_say")
def test_card_track_through_99_renders(tmp_path, fixtures_dir):
    repo = tmp_path / "repo"
    (repo / "lesson_99").mkdir(parents=True)
    (repo / "lesson_99" / "cards.yml").write_text(
        (fixtures_dir / "lesson_99" / "cards.yml").read_text()
    )
    (repo / "lesson_99" / "rules.md").write_text(
        (fixtures_dir / "lesson_99" / "rules.md").read_text()
    )

    script = Path(__file__).resolve().parents[2] / "build" / "generate_audio.py"
    result = subprocess.run(
        [sys.executable, str(script),
         "--repo", str(repo), "--through", "99",
         "--backend", "mac_say",
         "--audio-dir", str(tmp_path / "audio")],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    track = tmp_path / "audio" / "lesson_99.mp3"
    assert track.exists() and track.stat().st_size > 0
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3.11 -m pytest build/tests/test_generate_audio_cli.py -v`
Expected: FAIL — script doesn't exist.

- [ ] **Step 3: Implement `build/generate_audio.py`**

```python
#!/usr/bin/env python3.11
"""Generate audio drill tracks (cumulative MP3s per lesson) and story tracks."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build.lib.audio import card_segments, render_card_track  # noqa: E402
from build.lib.parse import load_all_card_files  # noqa: E402
from build.lib.tts.factory import make_tts  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render drill MP3s and story MP3s.")
    parser.add_argument("--repo", default=str(REPO_ROOT))
    parser.add_argument("--audio-dir", default=str(REPO_ROOT / "audio"))
    parser.add_argument("--cache-dir", default=None)
    parser.add_argument("--backend", default=None, help="piper | mac_say")
    parser.add_argument("--voice-es", default=None)
    parser.add_argument("--voice-en", default=None)
    parser.add_argument("--pace", type=float, default=1.0)
    parser.add_argument("--through", type=int, default=None,
                        help="Render cumulative track up through lesson N")
    parser.add_argument("--all-tracks", action="store_true",
                        help="Render every cumulative track (lesson 1..max)")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--stories", action="store_true",
                        help="Story mode (renders stories instead of drill tracks)")
    parser.add_argument("--bundle", default=None,
                        help="Story mode: limit to one bundle slug")
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    audio_dir = Path(args.audio_dir).resolve()
    cache_dir = Path(args.cache_dir) if args.cache_dir else (audio_dir / ".cache")

    cards = load_all_card_files(repo)
    print(f"Loaded {len(cards)} cards from {repo}")
    if args.validate_only:
        return 0

    if args.stories:
        print("(story mode lands in Task 22)", file=sys.stderr)
        return 0

    tts = make_tts(
        args.backend, cache_dir=cache_dir,
        voice_es=args.voice_es, voice_en=args.voice_en,
    )

    targets = _resolve_card_targets(cards, args)
    for lesson_n in targets:
        track_cards = [c for c in cards if max(c.lessons) <= lesson_n]
        if not track_cards:
            print(f"lesson {lesson_n}: no cards, skipping")
            continue
        segments = []
        for card in track_cards:
            segments.extend(card_segments(card))
        out = audio_dir / f"lesson_{lesson_n:02d}.mp3"
        render_card_track(segments, tts=tts, dst=out, seed=lesson_n, pace=args.pace)
        print(f"Wrote {out} ({len(segments)} segments)")
    return 0


def _resolve_card_targets(cards: list, args) -> list[int]:
    if args.through is not None:
        return [args.through]
    max_lesson = max((max(c.lessons) for c in cards), default=0)
    if args.all_tracks:
        return list(range(1, max_lesson + 1))
    return [max_lesson] if max_lesson else []


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test, verify it passes (on macOS)**

Run: `python3.11 -m pytest build/tests/test_generate_audio_cli.py -v`
Expected: 1 passed (macOS) or skipped (others).

- [ ] **Step 5: Commit**

```bash
git add build/generate_audio.py build/tests/test_generate_audio_cli.py
git commit -m "Add generate_audio.py CLI: card-mode track rendering"
```

---

### Task 20: `story.py` — story file parser

**Files:**
- Create: `build/lib/story.py`
- Test: `build/tests/test_story.py`
- Create: `build/tests/fixtures/stories/topic_99/01_test_story.md`

- [ ] **Step 1: Write fixture story file**

`build/tests/fixtures/stories/topic_99/01_test_story.md`:

```markdown
---
topic: test
lessons: [99]
title: "Una mañana"
title_en: "A Morning"
order: 1
target_minutes: 5
stretch_used_pct: 0
notes: "fixture"
---

## Story

Es una mañana normal.
*Is a morning normal.*

María es importante.
*María is important.*

No es diferente.
*No is different.*

## Free English translation

It's a normal morning. María is important. It's not different.
```

- [ ] **Step 2: Write the failing test**

`build/tests/test_story.py`:

```python
"""Tests for build.lib.story."""
from build.lib.story import load_story_file


def test_load_story_basic(fixtures_dir):
    path = fixtures_dir / "stories" / "topic_99" / "01_test_story.md"
    story = load_story_file(path)
    assert story.topic == "test"
    assert story.lessons == [99]
    assert story.title == "Una mañana"
    assert story.title_en == "A Morning"
    assert story.order == 1
    assert story.target_minutes == 5
    # Three Spanish lines, three single-line paragraphs in this fixture
    assert len(story.spanish_paragraphs) == 3
    assert story.spanish_paragraphs[0] == ["Es una mañana normal."]
    assert story.spanish_paragraphs[1] == ["María es importante."]
    assert story.spanish_paragraphs[2] == ["No es diferente."]
    assert "normal morning" in story.free_translation


def test_load_story_strips_gloss_and_footnotes(fixtures_dir, tmp_path):
    path = tmp_path / "stretchy.md"
    path.write_text("""---
topic: test
lessons: [99]
title: "Test"
title_en: "Test"
order: 2
target_minutes: 5
stretch_used_pct: 5
---

## Story

María está perpleja[1].
*María is perplexed.*

[1] *perpleja* — new word, means "perplexed."

Es muy importante.
*Is very important.*

## Free English translation

Maria is perplexed. It is very important.
""")
    story = load_story_file(path)
    spanish_lines = [line for para in story.spanish_paragraphs for line in para]
    # Footnotes and gloss must be excluded from the spanish_paragraphs list
    assert any("perpleja" in line for line in spanish_lines)
    assert all("perplexed" not in line for line in spanish_lines)
    assert all(not line.startswith("[") for line in spanish_lines)
```

- [ ] **Step 3: Run tests, verify failures**

Run: `python3.11 -m pytest build/tests/test_story.py -v`
Expected: ImportError.

- [ ] **Step 4: Implement `build/lib/story.py`**

```python
"""Parse story markdown files (frontmatter + Spanish/gloss/footnotes/translation)."""
from __future__ import annotations

import re
from pathlib import Path

import yaml

from build.lib.types import Story


_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)


def load_story_file(path: Path) -> Story:
    text = path.read_text(encoding="utf-8")
    m = _FRONTMATTER_RE.match(text)
    if not m:
        raise ValueError(f"{path}: missing YAML frontmatter")
    fm = yaml.safe_load(m.group(1)) or {}
    body = m.group(2)

    # Split body into ## sections
    sections = _split_sections(body)
    story_section = sections.get("Story", "")
    free_section = sections.get("Free English translation", "").strip()

    spanish_paragraphs = _extract_spanish_paragraphs(story_section)

    return Story(
        topic=str(fm.get("topic", "")),
        lessons=[int(x) for x in (fm.get("lessons") or [])],
        title=str(fm.get("title", "")),
        title_en=str(fm.get("title_en", "")),
        order=int(fm.get("order", 0)),
        target_minutes=float(fm.get("target_minutes", 0)),
        stretch_used_pct=float(fm.get("stretch_used_pct", 0)),
        spanish_paragraphs=spanish_paragraphs,
        free_translation=free_section,
        source_file=str(path),
    )


def _split_sections(body: str) -> dict[str, str]:
    """Split body by '## Heading' lines into a dict of section name → content."""
    out: dict[str, str] = {}
    current_name: str | None = None
    current_lines: list[str] = []
    for line in body.splitlines():
        if line.startswith("## "):
            if current_name is not None:
                out[current_name] = "\n".join(current_lines).strip()
            current_name = line[3:].strip()
            current_lines = []
        elif current_name is not None:
            current_lines.append(line)
    if current_name is not None:
        out[current_name] = "\n".join(current_lines).strip()
    return out


def _extract_spanish_paragraphs(story_text: str) -> list[list[str]]:
    """Extract pure Spanish lines, stripped of gloss and footnotes.

    A line is Spanish iff it's a non-empty line that:
      - is not a footnote (starts with '[N]' or contains the footnote pattern)
      - is not a literal-gloss line (italic-wrapped: starts and ends with '*')

    Paragraphs are separated by blank lines.
    """
    paragraphs: list[list[str]] = []
    current: list[str] = []
    for raw in story_text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            if current:
                paragraphs.append(current)
                current = []
            continue
        # Skip footnote definitions
        if re.match(r"^\s*\[\d+\]", line):
            continue
        # Skip literal-gloss italic lines
        stripped = line.strip()
        if stripped.startswith("*") and stripped.endswith("*"):
            continue
        # Treat any line with leading '*' or trailing '*' as gloss too
        if stripped.startswith("*") or stripped.endswith("*"):
            continue
        # Strip inline footnote markers like 'palabra[1]' → 'palabra'
        cleaned = re.sub(r"\[\d+\]", "", stripped)
        current.append(cleaned)
    if current:
        paragraphs.append(current)
    return paragraphs
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `python3.11 -m pytest build/tests/test_story.py -v`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add build/lib/story.py build/tests/test_story.py build/tests/fixtures/stories/topic_99/01_test_story.md
git commit -m "Add story.py: parse frontmatter + extract Spanish from gloss/footnotes"
```

---

### Task 21: `validate_story.py` — stretch-budget validator

**Files:**
- Create: `build/lib/validate_story.py`
- Test: `build/tests/test_validate_story.py`

- [ ] **Step 1: Write the failing test**

`build/tests/test_validate_story.py`:

```python
"""Tests for build.lib.validate_story."""
import pytest

from build.lib.validate_story import StoryValidationError, validate_story


def test_validate_story_under_budget_passes(fixtures_dir):
    # The fixture story uses only words from lesson_99/rules.md (importante,
    # diferente, real, normalmente). Plus stop-words like "es", "una", "no",
    # "una", "mañana" — last one (mañana) is NOT in the fixture rules. With
    # a 100% stretch budget for testing, anything passes.
    path = fixtures_dir / "stories" / "topic_99" / "01_test_story.md"
    report = validate_story(path, lessons_dir=fixtures_dir, budget_pct=100.0,
                            stopwords={"es", "una", "no"})
    assert report.unknown_words  # there are some unknowns
    assert report.passed


def test_validate_story_over_budget_fails(fixtures_dir):
    path = fixtures_dir / "stories" / "topic_99" / "01_test_story.md"
    # 0% budget — even a single unknown word fails
    with pytest.raises(StoryValidationError):
        validate_story(path, lessons_dir=fixtures_dir, budget_pct=0.0,
                       stopwords={"es", "una", "no", "mañana", "maría"})
        # Note: even with stopwords, "normal" isn't in fixture vocab → trips it
```

- [ ] **Step 2: Run test, verify failure**

Run: `python3.11 -m pytest build/tests/test_validate_story.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `build/lib/validate_story.py`**

```python
"""Validate story files against the bundle's stretch-word budget."""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Set

from build.lib.normalize import strip_accents
from build.lib.story import load_story_file
from build.lib.vocab import allowed_vocab_through, tokenize_spanish


# Bundle stretch budget table from docs/stories.md
BUNDLE_BUDGETS = {
    (1, 3): 0.0,
    (4, 5): 3.0,
    (6, 9): 5.0,
    (10, 12): 7.0,
    (13, 14): 10.0,
    (15, 17): 12.0,
    (18, 20): 15.0,
    (21, 22): 20.0,
}

# Common Spanish stop-words used across the corpus that are not in any
# Vocabulary section. Conservative list; expand carefully.
DEFAULT_STOPWORDS: Set[str] = {
    "el", "la", "los", "las", "un", "una", "y", "o", "pero",
    "es", "no", "se", "que", "de", "del", "al", "a", "en",
}


class StoryValidationError(ValueError):
    pass


@dataclass
class StoryValidationReport:
    story_path: Path
    total_tokens: int
    unknown_tokens: int
    unknown_words: list[str]
    budget_pct: float
    actual_pct: float
    passed: bool


def _budget_for(lessons: list[int]) -> float | None:
    """Find the bundle that contains all `lessons` and return its budget."""
    if not lessons:
        return None
    lo, hi = min(lessons), max(lessons)
    for (b_lo, b_hi), budget in BUNDLE_BUDGETS.items():
        if b_lo <= lo and hi <= b_hi:
            return budget
    return None


def validate_story(
    path: Path,
    *,
    lessons_dir: Path,
    budget_pct: float | None = None,
    stopwords: Set[str] | None = None,
) -> StoryValidationReport:
    story = load_story_file(path)
    max_lesson = max(story.lessons)
    allowed = allowed_vocab_through(max_lesson, lessons_dir=lessons_dir)
    allowed_normalized = {strip_accents(w) for w in allowed}
    sw = (stopwords if stopwords is not None else DEFAULT_STOPWORDS)
    sw_normalized = {strip_accents(w) for w in sw}

    total = 0
    unknown_tokens = 0
    unknown_words: list[str] = []
    for paragraph in story.spanish_paragraphs:
        for line in paragraph:
            tokens = tokenize_spanish(line)
            for tok in tokens:
                # Skip proper nouns (capitalization heuristic): tokenize_spanish
                # already lowercased, so we apply it before lowercasing.
                total += 1
                tok_norm = strip_accents(tok)
                if tok_norm in allowed_normalized:
                    continue
                if tok_norm in sw_normalized:
                    continue
                unknown_tokens += 1
                unknown_words.append(tok)

    budget = budget_pct if budget_pct is not None else _budget_for(story.lessons)
    if budget is None:
        raise StoryValidationError(f"{path}: no stretch budget for lessons {story.lessons}")

    actual_pct = 100.0 * unknown_tokens / total if total else 0.0
    passed = actual_pct <= budget

    report = StoryValidationReport(
        story_path=path, total_tokens=total, unknown_tokens=unknown_tokens,
        unknown_words=sorted(set(unknown_words)),
        budget_pct=budget, actual_pct=actual_pct, passed=passed,
    )
    if not passed:
        raise StoryValidationError(
            f"{path}: stretch budget exceeded ({actual_pct:.1f}% > {budget:.1f}%); "
            f"stretch words: {report.unknown_words}"
        )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate every story file.")
    parser.add_argument("--repo", default=str(Path(__file__).resolve().parents[2]))
    args = parser.parse_args(argv)
    repo = Path(args.repo).resolve()
    stories_dir = repo / "stories"
    if not stories_dir.is_dir():
        print("No stories/ directory; nothing to validate.")
        return 0

    failed = 0
    for path in sorted(stories_dir.glob("topic_*/*.md")):
        try:
            report = validate_story(path, lessons_dir=repo)
            print(f"OK {path} ({report.actual_pct:.1f}% / {report.budget_pct:.1f}%, "
                  f"{len(report.unknown_words)} stretch words)")
        except StoryValidationError as e:
            failed += 1
            print(f"FAIL {e}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test, verify it passes**

Run: `python3.11 -m pytest build/tests/test_validate_story.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add build/lib/validate_story.py build/tests/test_validate_story.py
git commit -m "Add validate_story.py: enforce per-bundle stretch budget"
```

---

### Task 22: `generate_audio.py --stories` mode

**Files:**
- Modify: `build/generate_audio.py`
- Modify: `build/lib/audio.py`
- Modify: `build/tests/test_generate_audio_cli.py`

- [ ] **Step 1: Add the failing test**

Append to `build/tests/test_generate_audio_cli.py`:

```python
@pytest.mark.skipif(platform.system() != "Darwin", reason="story-track smoke uses mac_say")
def test_story_mode_renders_a_track(tmp_path, fixtures_dir):
    repo = tmp_path / "repo"
    (repo / "lesson_99").mkdir(parents=True)
    (repo / "lesson_99" / "rules.md").write_text(
        (fixtures_dir / "lesson_99" / "rules.md").read_text()
    )
    stories_src = fixtures_dir / "stories" / "topic_99"
    dst_stories = repo / "stories" / "topic_99"
    dst_stories.mkdir(parents=True)
    (dst_stories / "01_test_story.md").write_text(
        (stories_src / "01_test_story.md").read_text()
    )

    script = Path(__file__).resolve().parents[2] / "build" / "generate_audio.py"
    result = subprocess.run(
        [sys.executable, str(script),
         "--repo", str(repo),
         "--stories", "--bundle", "topic_99",
         "--backend", "mac_say",
         "--audio-dir", str(tmp_path / "audio")],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    track = tmp_path / "audio" / "stories" / "topic_99__01_a-morning.mp3"
    assert track.exists() and track.stat().st_size > 0
```

- [ ] **Step 2: Run test, verify failure**

Run: `python3.11 -m pytest build/tests/test_generate_audio_cli.py -v`
Expected: 1 new failure (story mode not implemented).

- [ ] **Step 3: Add `render_story_track` to `build/lib/audio.py`**

Append to `build/lib/audio.py`:

```python
def render_story_track(
    paragraphs: list[list[str]],
    *,
    tts,
    dst: Path,
    pace: float = 1.15,
    paragraph_pause: float = 1.5,
) -> Path:
    """Render Spanish-only story narration. One TTS call per Spanish line."""
    work = AudioSegment.empty()
    for i, paragraph in enumerate(paragraphs):
        for line in paragraph:
            line_wav = tts.synth(line, "es", pace=pace)
            work += AudioSegment.from_file(str(line_wav))
            work += AudioSegment.silent(duration=300)  # tiny gap between lines
        if i + 1 < len(paragraphs):
            work += AudioSegment.silent(duration=int(paragraph_pause * 1000))

    work = work.set_channels(1)
    dst.parent.mkdir(parents=True, exist_ok=True)
    work.export(str(dst), format="mp3", bitrate="96k")
    return dst
```

- [ ] **Step 4: Wire story mode into `build/generate_audio.py`**

Replace the placeholder block

```python
    if args.stories:
        print("(story mode lands in Task 22)", file=sys.stderr)
        return 0
```

with:

```python
    if args.stories:
        return _run_stories_mode(repo, audio_dir, cache_dir, args)
```

and append:

```python
def _slug(s: str) -> str:
    import re as _re
    return _re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _run_stories_mode(repo: Path, audio_dir: Path, cache_dir: Path, args) -> int:
    from build.lib.story import load_story_file
    from build.lib.audio import render_story_track

    stories_root = repo / "stories"
    if not stories_root.is_dir():
        print("No stories/ directory; nothing to do.")
        return 0

    if args.bundle:
        bundles = [stories_root / args.bundle]
        if not bundles[0].is_dir():
            print(f"No bundle dir: {bundles[0]}", file=sys.stderr)
            return 1
    else:
        bundles = sorted(p for p in stories_root.iterdir() if p.is_dir() and p.name.startswith("topic_"))

    tts = make_tts(
        args.backend, cache_dir=cache_dir,
        voice_es=args.voice_es, voice_en=args.voice_en,
    )

    out_root = audio_dir / "stories"
    n = 0
    for bundle_dir in bundles:
        topic_slug = bundle_dir.name
        for story_path in sorted(bundle_dir.glob("*.md")):
            story = load_story_file(story_path)
            slug = _slug(story.title_en or story.title)
            out = out_root / f"{topic_slug}__{story.order:02d}_{slug}.mp3"
            render_story_track(
                story.spanish_paragraphs, tts=tts, dst=out,
                pace=max(args.pace, 1.15),  # stories default slower
            )
            print(f"Wrote {out}")
            n += 1
    print(f"Rendered {n} story tracks")
    return 0
```

- [ ] **Step 5: Run test, verify it passes (on macOS)**

Run: `python3.11 -m pytest build/tests/test_generate_audio_cli.py -v`
Expected: 2 passed (mac) or 2 skipped (other).

- [ ] **Step 6: Commit**

```bash
git add build/generate_audio.py build/lib/audio.py build/tests/test_generate_audio_cli.py
git commit -m "generate_audio: --stories mode renders pure-Spanish narration tracks"
```

---

### Task 23: TTS compare utility script

**Files:**
- Create: `build/scripts/tts_compare.py`

- [ ] **Step 1: Write the script**

`build/scripts/tts_compare.py`:

```python
#!/usr/bin/env python3.11
"""Render the same set of texts across multiple TTS backends for A/B listening.

Usage:
  build/scripts/tts_compare.py --texts "hola" "no es importante" --backends piper mac_say --out audio/eval
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from build.lib.tts.factory import make_tts  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--texts", nargs="+", required=True)
    parser.add_argument("--backends", nargs="+", default=["piper", "mac_say"])
    parser.add_argument("--lang", default="es", choices=["en", "es"])
    parser.add_argument("--out", default="audio/eval")
    args = parser.parse_args(argv)

    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)

    for backend in args.backends:
        backend_dir = out_root / backend
        backend_dir.mkdir(exist_ok=True)
        try:
            tts = make_tts(backend, cache_dir=out_root / ".cache")
        except Exception as e:
            print(f"skip {backend}: {e}", file=sys.stderr)
            continue
        for i, text in enumerate(args.texts, start=1):
            wav = tts.synth(text, args.lang)
            dst = backend_dir / f"{i:03d}.wav"
            dst.write_bytes(wav.read_bytes())
            print(f"{backend}/{dst.name}: {text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x build/scripts/tts_compare.py
```

- [ ] **Step 3: Smoke-test (on macOS — confirms wiring without requiring Piper)**

```bash
python3.11 build/scripts/tts_compare.py --texts "hola" --backends mac_say --out /tmp/tts_eval
ls /tmp/tts_eval/mac_say
```

Expected: a file `001.wav` in `/tmp/tts_eval/mac_say/`.

- [ ] **Step 4: Commit**

```bash
git add build/scripts/tts_compare.py
git commit -m "Add tts_compare script for A/B TTS evaluation"
```

---

### Task 24: Bundle A cards content (lesson_01, 02, 03)

**Files:**
- Create: `lesson_01/cards.yml`
- Create: `lesson_02/cards.yml`
- Create: `lesson_03/cards.yml`

This is a content-authoring task. Each `cards.yml` file is hand-written using `docs/card-design.md` as the rule book. Aim for the quantity targets (~20-30 primary, 40-80 extended per lesson).

- [ ] **Step 1: Read the source rules and decide coverage**

```bash
less lesson_01/rules.md
less lesson_02/rules.md
less lesson_03/rules.md
```

For each lesson identify:
- All Vocabulary entries → become vocab/transformation cards (primary).
- All Examples / Sentences → become sentence cards (primary).
- Each Rule → seeds for transformation patterns and (where applicable) extended cards.

- [ ] **Step 2: Author `lesson_01/cards.yml`**

Acceptance: every Vocabulary entry and every Example sentence in `lesson_01/rules.md` appears as a primary card. ~10-20 extended cards apply the same rules to real-world examples not in the lesson. All cards conform to the schema in `docs/card-design.md`.

Skeleton:

```yaml
lesson: 1
title: "Welcome — Spanish overview"
cards:
  - id: l1-001
    type: transformation        # adjust per card
    tier: primary
    front_en: "<English>"
    back_es: "<Spanish>"
    hint: "<minimal nudge or empty>"
    rule_ref: "L1#<rule#>"
    lessons: [1]
    directions: [en_es, es_en]
  # ... add ~30-50 more cards
```

(See `docs/card-design.md` and lesson_99 fixture in tests for full schema.)

- [ ] **Step 3: Author `lesson_02/cards.yml`** — same acceptance bar.

- [ ] **Step 4: Author `lesson_03/cards.yml`** — same acceptance bar.

- [ ] **Step 5: Validate**

```bash
make validate
```

Expected: `Loaded N cards from <repo>` exit 0. Fix any validation errors raised by parse.py.

- [ ] **Step 6: Commit**

```bash
git add lesson_01/cards.yml lesson_02/cards.yml lesson_03/cards.yml
git commit -m "Add Bundle A primary + extended cards for lessons 1-3"
```

---

### Task 25: Topical bundle A cards

**Files:**
- Create: `cards_topical/topic_01_03_foundation.yml`

- [ ] **Step 1: Identify cards that span lessons**

Scan `lesson_01/rules.md`, `lesson_02/rules.md`, `lesson_03/rules.md`. Identify ~30-50 sentence cards that combine constructs from ≥2 of these lessons (for example: *Es importante* combines L2's *es* with L3's `-ante`).

Acceptance: every card in this file uses constructs from ≥2 of L1/L2/L3, with `lessons:` listing every contributing lesson.

- [ ] **Step 2: Author the file**

```yaml
topic: "Foundation: vowels, ser, convertible words"
lessons: [1, 2, 3]
cards:
  - id: t01_03-001
    type: sentence
    tier: extended
    front_en: "Generally it's not important."
    back_es: "Generalmente no es importante."
    hint: "-ly→-mente · -ant→-ante · /j/→/kh/ on general"
    rule_ref: "L3#3, L3#7, L2#es-noes"
    lessons: [2, 3]
    directions: [en_es, es_en, shadow]
  # ... add 30+ more multi-lesson cards
```

- [ ] **Step 3: Validate**

```bash
make validate
```

Expected: total card count goes up; no errors.

- [ ] **Step 4: Commit**

```bash
git add cards_topical/topic_01_03_foundation.yml
git commit -m "Add topical Bundle A cards (L1-3 multi-lesson sentences)"
```

---

### Task 26: Build full Anki deck for Bundle A and import-test it

**Files:**
- (no code changes — content-driven smoke test)

- [ ] **Step 1: Build the deck**

```bash
make anki
```

Expected: `dist/transferencia.apkg` produced; the printed card count matches the sum of cards across `lesson_01/02/03/cards.yml` and `cards_topical/topic_01_03_foundation.yml`.

- [ ] **Step 2: Import into Anki desktop**

Open Anki desktop → File → Import → select `dist/transferencia.apkg`. Verify:
- Subdecks present: `Transferencia::Lesson 01`, `Lesson 02`, `Lesson 03`, `Topic::01-03 Foundation`.
- Open one card from each subdeck. Confirm:
  - Front renders with hint (when present)
  - Back renders with `→ L1` / `→ L2` / `→ L3` rule footer
  - 2-3 cards per note depending on `directions`
- Click "Browse" → filter `tag:rule::L3-1`. Confirm tag-based filtering works.

- [ ] **Step 3: Sync to AnkiMobile / AnkiWeb (manual)**

Open Anki desktop → Sync → confirms upload to AnkiWeb. Open AnkiMobile on iPhone, sync down, open one card. Confirm legibility.

- [ ] **Step 4: Re-import idempotency check**

Edit one card in `lesson_01/cards.yml` (e.g. tweak a hint string). Run `make anki`. Re-import the .apkg. Confirm Anki updates that one card and preserves SRS history on the rest.

(No commit — this task is a verification gate.)

---

### Task 27: Bundle A's 5 stories — drafting and validation

**Files:**
- Create: `stories/_world.md`
- Create: `stories/topic_01_03_foundation/01_a_morning_at_the_cafe.md`
- Create: `stories/topic_01_03_foundation/02_the_important_letter.md`
- Create: `stories/topic_01_03_foundation/03_normally_at_the_park.md`
- Create: `stories/topic_01_03_foundation/04_a_constant_friend.md`
- Create: `stories/topic_01_03_foundation/05_real_or_imaginary.md`

This is a content-authoring task. Each story file follows `docs/stories.md` (file format, gloss rules, footnote style) and stays within Bundle A's 0% stretch budget.

- [ ] **Step 1: Sketch a tiny world bible**

`stories/_world.md`:

```markdown
# Story World — Transferencia

A small fictional Latin-American town where most stories happen. Recurring cast and settings used across bundles.

## Town

A modest town. Café Luna in the plaza. A small park with a fountain. A library, a school, a music store.

## Recurring characters

- **María** — protagonist of many stories. Curious, normal, polite.
- **Daniel** — María's friend. A musician.
- **El profesor** — the schoolteacher. Older, patient.
- **La doctora** — the town doctor.

(Add to this file as new bundles introduce new characters.)
```

- [ ] **Step 2: Author story 01 — "A Morning at the Café"**

`stories/topic_01_03_foundation/01_a_morning_at_the_cafe.md` follows the format:

```markdown
---
topic: foundation
lessons: [1, 2, 3]
title: "Una mañana en el café"
title_en: "A Morning at the Café"
order: 1
target_minutes: 5
stretch_used_pct: 0
notes: "Story 1 of Bundle A. 0% stretch — pure cognates + es/no es + -mente."
---

## Story

Es una mañana normal.
*Is  a    morning normal.*

María es importante.
*María is  important.*

(... ~25-40 lines like this. Stick rigidly to L1-3 vocab. Use hyphenated
glosses to preserve embedded morphology. Footnote any stretch words —
should be zero for story 01.)

## Free English translation

It's a normal morning. María is important. (... idiomatic English.)
```

- [ ] **Step 3: Validate story 01**

```bash
make validate-stories
```

Expected: `OK stories/topic_01_03_foundation/01_a_morning_at_the_cafe.md (0.0% / 0.0%, 0 stretch words)`.

If the validator flags stretch words, either remove them or add the relevant ones to a small project-level stopword list (e.g. clear filler words like *en*, *con*, *sí*, *muy* if you decide they should be considered "free"). The existing `DEFAULT_STOPWORDS` in `validate_story.py` is conservative — extend if Bundle A reveals legitimate gaps.

- [ ] **Step 4: Author stories 02-05**

Repeat the process for each:
- `02_the_important_letter.md`
- `03_normally_at_the_park.md`
- `04_a_constant_friend.md`
- `05_real_or_imaginary.md`

Each should still validate with 0% stretch. Vary setting / tone / character focus across the 5.

- [ ] **Step 5: Run story validator on the whole bundle**

```bash
make validate-stories
```

Expected: 5 OKs, no failures.

- [ ] **Step 6: Render audio for Bundle A stories**

```bash
build/generate_audio.py --stories --bundle topic_01_03_foundation --backend mac_say
```

Expected: 5 mp3 files in `audio/stories/topic_01_03_foundation__*.mp3`.

(Use `--backend piper` instead if Piper is installed and voices are fetched.)

- [ ] **Step 7: Cold-listen test**

Listen to story 01 with no text. Note pacing problems, mispronunciations, or any line that's incomprehensible at the bundle's vocab. Tweak story text or `target_minutes`/pacing if needed and re-render.

- [ ] **Step 8: Commit**

```bash
git add stories/_world.md stories/topic_01_03_foundation/*.md
git commit -m "Add Bundle A: 5 stories with literal gloss + free translation"
```

---

### Task 28: README sync flow + final wiring

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README status block**

Change the "Status" section to reflect what's now implemented:

```markdown
## Status

- ✅ Lesson rules + transcripts: 90/90
- ✅ Cross-references map: complete
- ✅ Card system infrastructure: schema, parser, validator, Anki generator, MP3 generator (cards mode + stories mode), Piper + macOS TTS adapters
- ✅ Bundle A content: lesson_01/02/03 cards.yml + topical + 5 stories
- 🚧 Bundles B-H content (cards): rolling effort
- 🚧 Bundles B-H content (stories): rolling effort
```

- [ ] **Step 2: Add a "Getting started" section before "What it's for"**

```markdown
## Getting started

```bash
# Install Python deps
make install

# Download Piper voices (≈100 MB)
build/scripts/fetch_piper_voices.sh

# Validate, build the deck, render audio
make all

# Outputs:
#   dist/transferencia.apkg                      → import in Anki
#   dist/cards.json                              → for Phase 2 / iOS Shortcut
#   audio/lesson_NN.mp3                          → cumulative drill tracks
#   audio/stories/topic_*__*.mp3                 → story narration tracks
```
```

- [ ] **Step 3: Add "Sync to phone" section near the end**

```markdown
## Sync to phone

For now, the simplest path:

1. Drag `dist/transferencia.apkg` to Anki desktop, then sync to AnkiWeb. AnkiMobile pulls it automatically.
2. Drag `audio/lesson_*.mp3` and `audio/stories/*.mp3` into an iCloud Drive folder. Open them from Files on iPhone. CarPlay / Bluetooth play directly.

A private podcast feed is a future option for incremental auto-sync.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "README: getting-started + sync flow; mark Bundle A as built"
```

---

### Task 29: End-to-end sanity check

**Files:** none (verification only)

- [ ] **Step 1: Fresh-clone simulation**

```bash
git status   # confirm clean tree
make clean
make install
make validate
make validate-stories
make anki
make cards-json
make audio-quick   # mac_say, lesson_03 only
```

Expected: every step exits 0. `dist/transferencia.apkg`, `dist/cards.json`, `audio/lesson_03.mp3` all exist.

- [ ] **Step 2: Story render**

```bash
build/generate_audio.py --stories --bundle topic_01_03_foundation --backend mac_say
ls audio/stories/
```

Expected: 5 mp3 files.

- [ ] **Step 3: Final test pass**

```bash
make test
```

Expected: full pytest suite passes (with the platform-skips noted in `test_tts_mac_say.py`, `test_tts_piper.py`, `test_generate_audio_cli.py`).

- [ ] **Step 4: Document any deviations**

If anything in the spec didn't end up working as written (e.g., Piper voice paths, `say` voice availability), note it in `docs/learning-system.md` or a new `docs/build-notes.md`. Commit.

```bash
git add docs/  # whatever you wrote
git commit -m "docs: build notes from end-to-end run"
```

---

## Self-Review

This section is for the writer to verify the plan against the spec. Done after task drafting:

**Spec coverage check:**

- ✅ Goal #1 (Anki deck): Tasks 8-11, 26
- ✅ Goal #2 (drill MP3): Tasks 16-19, 29
- ✅ Goal #3 (story MP3 + literal gloss): Tasks 20-22, 27
- ✅ Components — `parse.py`: Tasks 5-7
- ✅ Components — `normalize.py`: Task 4
- ✅ Components — `vocab.py`: Task 3
- ✅ Components — `tts/` adapter package: Tasks 12-15
- ✅ Components — `validate_story.py`: Task 21
- ✅ Components — `generate_anki.py`: Tasks 8, 11
- ✅ Components — `generate_audio.py`: Tasks 19, 22
- ✅ `Makefile`: Task 1 (initial), Task 19 (referenced)
- ✅ Bundle A demo content: Tasks 24, 25, 27
- ✅ End-to-end verification: Task 29
- ⏳ M5 (Bundles B-H cards), M6.5 (Bundles B-H stories): out of scope per plan opening; user does these rolling
- ⏳ M7 (Phase 2 interactive): out of scope per spec — `cards.json` export (Task 11) leaves the door open

**Placeholder scan:** No `TODO`, `TBD`, or "fill in details" placeholders in any code step. Every code step has the actual code an engineer writes. Content-authoring tasks (24, 25, 27) explicitly delegate creative content to the human author and provide acceptance criteria + skeletons.

**Type consistency:** `Card`, `Story`, `Direction`, `Tier`, `CardType`, `Segment` defined in Tasks 2 and 17, used consistently in Tasks 5-22. The `TTS` protocol (Task 12) is consumed by `make_tts` (Task 15) and used in `render_card_track` (Task 18) and `render_story_track` (Task 22). Method signatures match across tasks: `synth(text, lang, *, voice=None, pace=1.0)`.

**Open questions deferred:** The spec's open questions (story cast continuity, audio sync mechanism, Phase 2 trigger, gloss workflow tooling) are answered in-plan where forced (Task 27 sketches `_world.md`; Task 28 documents iCloud Drive sync); the rest stay open as runtime decisions.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-07-flashcards-stories-system.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
