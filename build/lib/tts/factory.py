"""TTS backend dispatch from string id (env / CLI flag)."""
from __future__ import annotations

import os
from pathlib import Path

from build.lib.tts import TTS


def make_tts(
    backend: str | None = None,
    *,
    cache_dir: Path,
    voices_dir: Path | None = None,
    voice_es: str | None = None,
    voice_en: str | None = None,
) -> TTS:
    """Build a TTS adapter from a backend name. Reads sensible defaults from env."""
    backend = backend or os.environ.get("TTS_BACKEND", "piper")
    voice_es = voice_es or os.environ.get("TTS_VOICE_ES")
    voice_en = voice_en or os.environ.get("TTS_VOICE_EN")

    if backend == "mac_say":
        from build.lib.tts.mac_say import MacSayTTS
        return MacSayTTS(cache_dir=cache_dir)

    if backend == "piper":
        from build.lib.tts.piper import PiperTTS
        repo_root = Path(__file__).resolve().parents[3]
        vd = voices_dir or (repo_root / "build" / ".piper-voices")
        return PiperTTS(
            cache_dir=cache_dir,
            voices_dir=vd,
            voice_es=voice_es or "es_MX-claude-high",
            voice_en=voice_en or "en_US-amy-medium",
        )

    raise ValueError(f"unknown TTS backend: {backend}")
