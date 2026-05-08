"""TTS adapter protocol."""
from __future__ import annotations

from pathlib import Path
from typing import Literal, Protocol


class TTS(Protocol):
    """Speech synthesis adapter."""

    backend_id: str  # e.g. "piper:es_MX-claude-high" — used for cache keying

    def synth(
        self,
        text: str,
        lang: Literal["en", "es"],
        *,
        voice: str | None = None,
        pace: float = 1.0,
    ) -> Path:
        """Return path to a cached WAV fragment for `text` in `lang`."""
        ...
