"""Tests for the Piper adapter. Skipped if `piper` binary not on PATH."""
import shutil
import os

import pytest

piper_available = shutil.which("piper") is not None
pytestmark = pytest.mark.skipif(not piper_available, reason="piper not installed")


def test_piper_synth_produces_nonempty_wav(tmp_path):
    from build.lib.tts.piper import PiperTTS
    voices_dir = tmp_path / "voices"
    voices_dir.mkdir()
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
