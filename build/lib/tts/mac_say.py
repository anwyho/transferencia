"""macOS `say` adapter. Free, native, decent quality. Offline fallback."""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import Literal

from build.lib.tts.cache import ensure_cached


class MacSayTTS:
    """Wraps `say -v <voice>` with WAV output via `afconvert`."""

    DEFAULT_VOICES = {"en": "Samantha", "es": "Mónica"}

    def __init__(self, cache_dir: Path, voices: dict[str, str] | None = None):
        self.cache_dir = cache_dir
        self.voices = {**self.DEFAULT_VOICES, **(voices or {})}
        voice_id = "+".join(f"{k}={v}" for k, v in sorted(self.voices.items()))
        self.backend_id = f"mac_say:{voice_id}"

    def synth(
        self,
        text: str,
        lang: Literal["en", "es"],
        *,
        voice: str | None = None,
        pace: float = 1.0,
    ) -> Path:
        chosen = voice or self.voices[lang]
        # Bake voice + pace into the cache key so re-renders with different
        # voices/paces don't collide.
        backend_id = f"{self.backend_id}|voice={chosen}|pace={pace:.3f}"

        def _do_synth(t: str, _lang: str, dst: Path) -> Path:
            with tempfile.NamedTemporaryFile(suffix=".aiff", delete=False) as tmp:
                aiff_path = Path(tmp.name)
            try:
                rate = int(180 * pace)  # words/min; 180 ≈ default
                subprocess.run(
                    ["say", "-v", chosen, "-r", str(rate), "-o", str(aiff_path), t],
                    check=True, capture_output=True,
                )
                subprocess.run(
                    ["afconvert", str(aiff_path), str(dst), "-d", "LEI16@22050"],
                    check=True, capture_output=True,
                )
            finally:
                aiff_path.unlink(missing_ok=True)
            return dst

        return ensure_cached(self.cache_dir, text, lang, backend_id, _do_synth)
