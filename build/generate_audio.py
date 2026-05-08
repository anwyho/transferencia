#!/usr/bin/env python3.11
"""Generate audio drill tracks (cumulative MP3s per lesson) and story tracks."""
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
    parser = argparse.ArgumentParser(description="Render drill MP3s and story MP3s.")
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
    parser.add_argument("--stories", action="store_true",
                        help="Story mode (renders stories instead of drill tracks)")
    parser.add_argument("--bundle", default=None,
                        help="Story mode: limit to one bundle slug")
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    audio_dir = Path(args.audio_dir).resolve()
    cache_dir = Path(args.cache_dir) if args.cache_dir else (audio_dir / ".cache")

    cards = load_all_card_files(repo)
    print(f"Loaded {len(cards)} cards from {repo}")
    if args.validate_only:
        return 0

    if args.stories:
        return _run_stories_mode(repo, audio_dir, cache_dir, args)

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


def _slug(s: str) -> str:
    import re as _re
    from build.lib.normalize import strip_accents
    return _re.sub(r"[^a-z0-9]+", "-", strip_accents(s).lower()).strip("-")


def _run_stories_mode(repo: Path, audio_dir: Path, cache_dir: Path, args) -> int:
    from build.lib.story import load_story_file
    from build.lib.audio import render_story_track

    stories_root = repo / "stories"
    if not stories_root.is_dir():
        print("No stories/ directory; nothing to do.")
        return 0

    if args.bundle:
        bundles = [stories_root / args.bundle]
        if not bundles[0].is_dir():
            print(f"No bundle dir: {bundles[0]}", file=sys.stderr)
            return 1
    else:
        bundles = sorted(p for p in stories_root.iterdir() if p.is_dir() and p.name.startswith("topic_"))

    tts = make_tts(
        args.backend, cache_dir=cache_dir,
        voice_es=args.voice_es, voice_en=args.voice_en,
    )

    out_root = audio_dir / "stories"
    n = 0
    for bundle_dir in bundles:
        topic_slug = bundle_dir.name
        for story_path in sorted(bundle_dir.glob("*.md")):
            story = load_story_file(story_path)
            slug = _slug(story.title_en or story.title)
            out = out_root / f"{topic_slug}__{story.order:02d}_{slug}.mp3"
            render_story_track(
                story.spanish_paragraphs, tts=tts, dst=out,
                pace=max(args.pace, 1.15),  # stories default slower
            )
            print(f"Wrote {out}")
            n += 1
    print(f"Rendered {n} story tracks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
