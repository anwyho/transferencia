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


def test_card_segments_for_two_directions_emits_two(tmp_path):
    from build.lib.audio import card_segments
    from build.lib.types import Card, CardType, Direction, Tier

    card = Card(
        id="x", type=CardType.SENTENCE, tier=Tier.PRIMARY,
        front_en="It's important.", back_es="Es importante.",
        rule_ref="L3#1", lessons=[3],
        directions=[Direction.EN_ES, Direction.ES_EN],
    )
    segs = card_segments(card)
    assert {s.direction for s in segs} == {Direction.EN_ES, Direction.ES_EN}


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
