"""Tests for build.lib.audio."""
from pathlib import Path

from build.lib.audio import concat_segments, silence


def _wav_seconds(path: Path) -> float:
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
