#!/usr/bin/env python3.11
"""Generate cumulative drill MP3s per lesson."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build.lib.audio import card_segments, render_card_track  # noqa: E402
from build.lib.parse import load_all_card_files  # noqa: E402
from build.lib.tts.factory import make_tts  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render cumulative drill MP3s.")
    parser.add_argument("--repo", default=str(REPO_ROOT))
    parser.add_argument("--audio-dir", default=str(REPO_ROOT / "audio"))
    parser.add_argument("--cache-dir", default=None)
    parser.add_argument("--backend", default=None, help="piper | mac_say")
    parser.add_argument("--voice-es", default=None)
    parser.add_argument("--voice-en", default=None)
    parser.add_argument("--pace", type=float, default=1.0)
    parser.add_argument("--through", type=int, default=None,
                        help="Render cumulative track up through lesson N")
    parser.add_argument("--all-tracks", action="store_true",
                        help="Render every cumulative track (lesson 1..max)")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    audio_dir = Path(args.audio_dir).resolve()
    cache_dir = Path(args.cache_dir) if args.cache_dir else (audio_dir / ".cache")

    cards = load_all_card_files(repo)
    print(f"Loaded {len(cards)} cards from {repo}")
    if args.validate_only:
        return 0

    tts = make_tts(
        args.backend, cache_dir=cache_dir,
        voice_es=args.voice_es, voice_en=args.voice_en,
    )

    targets = _resolve_card_targets(cards, args)
    for lesson_n in targets:
        track_cards = [c for c in cards if max(c.lessons) <= lesson_n]
        if not track_cards:
            print(f"lesson {lesson_n}: no cards, skipping")
            continue
        segments = []
        for card in track_cards:
            segments.extend(card_segments(card))
        out = audio_dir / f"lesson_{lesson_n:02d}.mp3"
        render_card_track(segments, tts=tts, dst=out, seed=lesson_n, pace=args.pace)
        print(f"Wrote {out} ({len(segments)} segments)")
    return 0


def _resolve_card_targets(cards: list, args) -> list[int]:
    if args.through is not None:
        return [args.through]
    max_lesson = max((max(c.lessons) for c in cards), default=0)
    if args.all_tracks:
        return list(range(1, max_lesson + 1))
    return [max_lesson] if max_lesson else []


if __name__ == "__main__":
    raise SystemExit(main())
