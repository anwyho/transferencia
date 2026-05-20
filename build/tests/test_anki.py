"""Tests for build.lib.anki note model + builders."""
import pytest

from build.lib.anki import build_note, MODEL_ID, MODEL
from build.lib.types import Card, CardType, Direction, Tier


def _sample_card(directions=None, tier=Tier.PRIMARY, type_=CardType.TRANSFORMATION):
    return Card(
        id="L3-001",
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
    assert MODEL_ID == 1735000002


def test_build_note_field_count_matches_model():
    note = build_note(_sample_card())
    assert len(note.fields) == len(MODEL.fields)


def test_build_note_dir_flags_set():
    note = build_note(_sample_card(directions=[Direction.EN_ES]))
    field_names = [f["name"] for f in MODEL.fields]
    field_values = dict(zip(field_names, note.fields))
    assert field_values["DirEnEs"] == "1"
    assert field_values["DirEsEn"] == ""


def test_build_note_no_audio_field_empty_by_default():
    note = build_note(_sample_card())
    field_names = [f["name"] for f in MODEL.fields]
    field_values = dict(zip(field_names, note.fields))
    assert field_values["AudioEs"] == ""


def test_build_note_with_audio_filename_wraps_in_sound_tag():
    note = build_note(_sample_card(), audio_filename="card_l3-001_es.mp3")
    field_names = [f["name"] for f in MODEL.fields]
    field_values = dict(zip(field_names, note.fields))
    assert field_values["AudioEs"] == "[sound:card_l3-001_es.mp3]"


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


def test_subdeck_for_lesson_card():
    from build.lib.anki import deck_name_for_card
    card = _sample_card()  # lesson 3, no topical
    # The _sample_card factory currently doesn't set source_file, so simulate:
    card = Card(
        id=card.id, type=card.type, tier=card.tier,
        front_en=card.front_en, back_es=card.back_es,
        rule_ref=card.rule_ref, lessons=card.lessons,
        directions=card.directions, hint=card.hint,
        source_file="lesson_03/cards.yml",
    )
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
    # Use _sample_card and override source_file so subdeck assignment works
    base = _sample_card()
    card = Card(
        id=base.id, type=base.type, tier=base.tier,
        front_en=base.front_en, back_es=base.back_es,
        rule_ref=base.rule_ref, lessons=base.lessons,
        directions=base.directions, hint=base.hint,
        source_file="lesson_03/cards.yml",
    )
    cards = [card]
    out = tmp_path / "x.apkg"
    build_package(cards, out)
    assert out.exists() and out.stat().st_size > 0


def test_build_package_with_media_files_embeds_audio(tmp_path):
    from build.lib.anki import build_package
    base = _sample_card()
    card = Card(
        id=base.id, type=base.type, tier=base.tier,
        front_en=base.front_en, back_es=base.back_es,
        rule_ref=base.rule_ref, lessons=base.lessons,
        directions=base.directions, hint=base.hint,
        source_file="lesson_03/cards.yml",
    )
    fake_audio = tmp_path / "card_l3-001_es.mp3"
    fake_audio.write_bytes(b"\xff\xfb\x90\x00fake mp3 bytes")
    out = tmp_path / "with_audio.apkg"
    build_package(
        [card], out,
        audio_for={"L3-001": "card_l3-001_es.mp3"},
        media_paths=[fake_audio],
    )
    assert out.exists() and out.stat().st_size > 0
