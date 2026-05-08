"""Tests for build.lib.tts.factory."""
from build.lib.tts.factory import make_tts


def test_make_tts_mac_say(tmp_path):
    tts = make_tts("mac_say", cache_dir=tmp_path / "cache")
    assert tts.backend_id.startswith("mac_say:")


def test_make_tts_unknown_raises(tmp_path):
    import pytest
    with pytest.raises(ValueError):
        make_tts("nonexistent_backend", cache_dir=tmp_path / "cache")
