"""Tests for build.lib.tts.cache."""
from build.lib.tts.cache import cache_path_for, ensure_cached


def test_cache_path_deterministic(tmp_path):
    p1 = cache_path_for(tmp_path, "hola", "es", "piper:es_MX-claude-high")
    p2 = cache_path_for(tmp_path, "hola", "es", "piper:es_MX-claude-high")
    assert p1 == p2


def test_cache_path_changes_with_voice(tmp_path):
    p_a = cache_path_for(tmp_path, "hola", "es", "piper:es_MX-claude-high")
    p_b = cache_path_for(tmp_path, "hola", "es", "piper:es_MX-ald-medium")
    assert p_a != p_b


def test_ensure_cached_only_calls_synth_once(tmp_path):
    calls = {"n": 0}

    def fake_synth(text: str, lang: str, dst):
        calls["n"] += 1
        dst.write_bytes(b"FAKE_WAV")
        return dst

    p1 = ensure_cached(tmp_path, "hola", "es", "test:fake", fake_synth)
    p2 = ensure_cached(tmp_path, "hola", "es", "test:fake", fake_synth)
    assert p1 == p2
    assert calls["n"] == 1
    assert p1.read_bytes() == b"FAKE_WAV"
