"""On-disk cache for TTS-synthesized audio fragments."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Callable


def cache_path_for(cache_dir: Path, text: str, lang: str, backend_id: str) -> Path:
    key = f"{backend_id}|{lang}|{text}".encode("utf-8")
    digest = hashlib.sha1(key).hexdigest()
    return cache_dir / f"{digest}.wav"


SynthFn = Callable[[str, str, Path], Path]


def ensure_cached(
    cache_dir: Path,
    text: str,
    lang: str,
    backend_id: str,
    synth: SynthFn,
) -> Path:
    """Return cached WAV path; call `synth(text, lang, dst)` if missing."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_path_for(cache_dir, text, lang, backend_id)
    if not path.exists():
        synth(text, lang, path)
    return path
