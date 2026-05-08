"""Tests for the macOS `say` adapter. Skipped on non-Darwin systems."""
import platform

import pytest

from build.lib.tts.mac_say import MacSayTTS


pytestmark = pytest.mark.skipif(platform.system() != "Darwin", reason="macOS only")


def test_synth_es_produces_nonempty_wav(tmp_path):
    tts = MacSayTTS(cache_dir=tmp_path)
    out = tts.synth("hola", lang="es")
    assert out.exists()
    assert out.stat().st_size > 0


def test_synth_uses_cache(tmp_path):
    tts = MacSayTTS(cache_dir=tmp_path)
    a = tts.synth("hola", lang="es")
    b = tts.synth("hola", lang="es")
    assert a == b
