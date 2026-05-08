"""Piper TTS adapter. Free, on-device, Apache 2.0. Default backend."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Literal

from build.lib.tts.cache import ensure_cached


class PiperTTS:
    """Wraps the piper CLI (https://github.com/rhasspy/piper).

    Voice files (`*.onnx` + `*.onnx.json`) live under voices_dir, organized by
    voice id (e.g. voices_dir/es_MX/claude/high/es_MX-claude-high.onnx).
    """

    def __init__(
        self,
        cache_dir: Path,
        voices_dir: Path,
        voice_es: str = "es_MX-claude-high",
        voice_en: str = "en_US-amy-medium",
    ):
        self.cache_dir = Path(cache_dir)
        self.voices_dir = Path(voices_dir)
        self.voice_es = voice_es
        self.voice_en = voice_en
        if not shutil.which("piper"):
            raise RuntimeError("piper binary not on PATH; install via `pip install piper-tts`")
        self.backend_id = f"piper:es={voice_es}|en={voice_en}"

    def _voice_path(self, voice_id: str) -> Path:
        # Voice id like "es_MX-claude-high" → es_MX/claude/high/es_MX-claude-high.onnx
        parts = voice_id.split("-")
        if len(parts) < 3:
            raise ValueError(f"unexpected voice id format: {voice_id}")
        lang_region, name, quality = parts[0], parts[1], parts[2]
        return self.voices_dir / lang_region / name / quality / f"{voice_id}.onnx"

    def synth(
        self,
        text: str,
        lang: Literal["en", "es"],
        *,
        voice: str | None = None,
        pace: float = 1.0,
    ) -> Path:
        chosen = voice or (self.voice_es if lang == "es" else self.voice_en)
        backend_id = f"{self.backend_id}|chosen={chosen}|pace={pace:.3f}"

        def _do_synth(t: str, _lang: str, dst: Path) -> Path:
            length_scale = 1.0 / max(pace, 0.1)  # piper: bigger = slower
            cmd = [
                "piper",
                "--model", str(self._voice_path(chosen)),
                "--output-file", str(dst),
                "--length-scale", f"{length_scale:.3f}",
            ]
            subprocess.run(cmd, input=t, text=True, check=True, capture_output=True)
            return dst

        return ensure_cached(self.cache_dir, text, lang, backend_id, _do_synth)
