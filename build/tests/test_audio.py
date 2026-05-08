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
