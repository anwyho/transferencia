#!/usr/bin/env python3.11
"""Render the same set of texts across multiple TTS backends for A/B listening.

Usage:
  build/scripts/tts_compare.py --texts "hola" "no es importante" --backends piper mac_say --out audio/eval
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from build.lib.tts.factory import make_tts  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--texts", nargs="+", required=True)
    parser.add_argument("--backends", nargs="+", default=["piper", "mac_say"])
    parser.add_argument("--lang", default="es", choices=["en", "es"])
    parser.add_argument("--out", default="audio/eval")
    args = parser.parse_args(argv)

    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)

    for backend in args.backends:
        backend_dir = out_root / backend
        backend_dir.mkdir(exist_ok=True)
        try:
            tts = make_tts(backend, cache_dir=out_root / ".cache")
        except Exception as e:
            print(f"skip {backend}: {e}", file=sys.stderr)
            continue
        for i, text in enumerate(args.texts, start=1):
            wav = tts.synth(text, args.lang)
            dst = backend_dir / f"{i:03d}.wav"
            dst.write_bytes(wav.read_bytes())
            print(f"{backend}/{dst.name}: {text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
