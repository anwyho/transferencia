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
    lessons: [2]
    directions: [en_es]
""")
    with pytest.raises(ParseError, match="lessons"):
        load_card_file(bad)
