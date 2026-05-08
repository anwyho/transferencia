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
    lessons: [1]
    directions: [en_es]
""")
    with pytest.raises(ParseError, match="extended"):
        load_card_file(bad)


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
