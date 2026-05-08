#!/usr/bin/env python3.11
"""Generate the Transferencia Anki deck from card YAML files.

Two modes:
  --validate-only      parse + check, no .apkg
  (default)            produce dist/transferencia.apkg
  --export-json PATH   also dump cards.json
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running as a script: ensure the repo root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build.lib.parse import load_all_card_files, ParseError  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the Transferencia Anki deck.")
    parser.add_argument("--repo", default=str(REPO_ROOT), help="Repo root (default: auto-detect)")
    parser.add_argument("--out", default="dist/transferencia.apkg", help="Output .apkg path")
    parser.add_argument("--export-json", default=None, help="Also dump cards.json")
    parser.add_argument("--validate-only", action="store_true", help="Validate only, no output")
    parser.add_argument("--with-audio", action="store_true",
                        help="Embed Spanish-answer mp3 audio in en_es cards")
    parser.add_argument("--audio-bitrate", default="48k",
                        help="MP3 bitrate for embedded audio (default: 48k)")
    parser.add_argument("--audio-backend", default=None,
                        help="TTS backend for embedded audio (piper | mac_say). Defaults to TTS_BACKEND env.")
    parser.add_argument("--media-dir", default=None,
                        help="Directory for per-card audio (default: <repo>/audio/.media)")
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()

    try:
        cards = load_all_card_files(repo)
    except ParseError as e:
        print(f"Validation error: {e}", file=sys.stderr)
        return 1
    except Exception as e:  # YAML errors etc.
        print(f"Error: {e}", file=sys.stderr)
        return 2

    print(f"Loaded {len(cards)} cards from {repo}")

    # JSON export (independent of validate-only / .apkg generation)
    if args.export_json:
        import json
        export_path = Path(args.export_json)
        export_path.parent.mkdir(parents=True, exist_ok=True)
        export_path.write_text(
            json.dumps([_card_to_dict(c) for c in cards], ensure_ascii=False, indent=2)
        )
        print(f"Wrote {export_path}")

    if args.validate_only:
        return 0

    audio_for: dict[str, str] = {}
    media_paths: list[Path] = []
    if args.with_audio:
        from build.lib.audio import encode_card_audio
        from build.lib.tts.factory import make_tts
        from build.lib.types import Direction

        media_dir = Path(args.media_dir) if args.media_dir else (repo / "audio" / ".media")
        media_dir.mkdir(parents=True, exist_ok=True)
        cache_dir = repo / "audio" / ".cache"
        tts = make_tts(args.audio_backend, cache_dir=cache_dir)
        en_es_cards = [c for c in cards if Direction.EN_ES in c.directions]
        print(f"Generating audio for {len(en_es_cards)} en_es cards "
              f"({args.audio_bitrate} mp3 via {tts.backend_id.split(':',1)[0]})...")
        for i, card in enumerate(en_es_cards, start=1):
            filename = f"card_{card.id}_es.mp3"
            dst = media_dir / filename
            encode_card_audio(card.back_es, "es", tts=tts, dst=dst,
                              bitrate=args.audio_bitrate)
            audio_for[card.id] = filename
            media_paths.append(dst)
            if i % 50 == 0:
                print(f"  {i}/{len(en_es_cards)}")
        print(f"Audio: {len(media_paths)} fragments in {media_dir}")

    from build.lib.anki import build_package
    out = Path(args.out)
    build_package(cards, out, audio_for=audio_for or None,
                  media_paths=media_paths or None)
    print(f"Wrote {out} ({out.stat().st_size // 1024} KB)")
    return 0


def _card_to_dict(c) -> dict:
    return {
        "id": c.id,
        "type": c.type.value,
        "tier": c.tier.value,
        "front_en": c.front_en,
        "back_es": c.back_es,
        "hint": c.hint,
        "rule_ref": c.rule_ref,
        "lessons": c.lessons,
        "directions": [d.value for d in c.directions],
        "notes": c.notes,
    }


if __name__ == "__main__":
    raise SystemExit(main())
