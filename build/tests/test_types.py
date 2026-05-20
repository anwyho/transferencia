"""Tests for build.lib.types."""
import pytest

from build.lib.types import Card, CardType, Tier, Direction


def test_card_minimal_fields():
    card = Card(
        id="L3-001",
        type=CardType.TRANSFORMATION,
        tier=Tier.PRIMARY,
        front_en="important",
        back_es="importante",
        rule_ref="L3#1",
        lessons=[3],
        directions=[Direction.EN_ES, Direction.ES_EN],
    )
    assert card.id == "L3-001"
    assert card.lessons == [3]
    assert Direction.EN_ES in card.directions


def test_card_default_optional_fields():
    card = Card(
        id="L3-002",
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
