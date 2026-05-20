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
_BUNDLE_FILE_RE = re.compile(r"^(nn|[a-zñ])_.+\.yml$")


def _word_count(text: str) -> int:
    return len(re.findall(r"\b\w+\b", text))


def _sentence_word_cap(max_lesson: int) -> int:
    return 8 if max_lesson <= 10 else 12


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

        # Lessons-context check: the card's *latest* lesson must be inside the file's
        # lesson range. Earlier lessons can reference prior bundles (some cards
        # legitimately combine grammar introduced across multiple bundles).
        if file_lessons is not None:
            if max(lessons) not in file_lessons:
                raise ParseError(
                    f"{path}: cards[{i}] max lesson {max(lessons)} not in file context {sorted(file_lessons)}"
                )

        if ctype == CardType.SENTENCE:
            cap = _sentence_word_cap(max(lessons))
            wc_en = _word_count(c["front_en"])
            wc_es = _word_count(c["back_es"])
            if wc_en > cap or wc_es > cap:
                raise ParseError(
                    f"{path}: cards[{i}] sentence exceeds {cap}-word cap "
                    f"(en={wc_en}, es={wc_es})"
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

    - cards/<letter>_<theme>.yml → set(raw['lessons'])
    - lessons/lesson_NN/cards.yml → {NN} (legacy / test fixtures)
    - cards_topical/topic_AA_BB_*.yml → {AA..BB} (legacy)
    - Other paths → fall back to raw['lessons'] / {raw['lesson']} / None.
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
    # Bundle file or fallback frontmatter
    if "lessons" in raw and isinstance(raw["lessons"], list):
        return set(int(x) for x in raw["lessons"])
    if "lesson" in raw:
        return {int(raw["lesson"])}
    return None


def load_all_card_files(repo_root: Path) -> List[Card]:
    """Load every cards/*.yml bundle file under repo_root.

    Falls back to legacy lessons/lesson_NN/cards.yml and cards_topical/ paths
    if those directories still exist (helpful during migration / for tests).
    """
    out: List[Card] = []
    seen_ids: dict[str, str] = {}

    cards_dir = repo_root / "cards"
    if cards_dir.is_dir():
        for cards_path in sorted(cards_dir.glob("*.yml")):
            for card in load_card_file(cards_path):
                _check_unique_id(card, seen_ids)
                out.append(card)

    # Legacy paths
    for cards_path in sorted(repo_root.glob("lessons/lesson_*/cards.yml")):
        for card in load_card_file(cards_path):
            _check_unique_id(card, seen_ids)
            out.append(card)
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
