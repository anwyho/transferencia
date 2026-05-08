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
