#!/usr/bin/env python3.11
"""Render immersion-story MP3s from stories/<group>/<NN>_<slug>.md."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build.lib.stories import (  # noqa: E402
    iter_story_files,
    load_story,
    render_story_audio,
    validate_story,
)
from build.lib.tts.factory import make_tts  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]

# Per-kind default body pace. Slightly slower than 1.0 across the board:
# the goal is comprehension during a drive, not native-speed delivery.
_KIND_PACE: dict[str, float] = {
    "animal_fable": 1.0,
    "scenario": 0.95,
    "dialogue": 0.95,
    "history": 0.95,
    "memory": 0.9,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render immersion stories.")
    parser.add_argument("--repo", default=str(REPO_ROOT))
    parser.add_argument("--audio-dir", default=str(REPO_ROOT / "audio"))
    parser.add_argument("--stories-dir", default=str(REPO_ROOT / "stories"))
    parser.add_argument(
        "--group",
        default=None,
        help="Group slug (e.g. 1_foundation). Omit to render every group.",
    )
    parser.add_argument(
        "--story",
        default=None,
        help="Path to a single story .md. Overrides --group.",
    )
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--backend", default=None)
    parser.add_argument("--voice-es", default=None)
    parser.add_argument("--voice-en", default=None)
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    audio_dir = Path(args.audio_dir).resolve()
    stories_dir = Path(args.stories_dir).resolve()
    cache_dir = audio_dir / ".cache"

    if args.story:
        story_paths = [Path(args.story)]
    else:
        story_paths = list(iter_story_files(stories_dir, group=args.group))

    if not story_paths:
        print("No stories found.", file=sys.stderr)
        return 1

    stories = [load_story(p) for p in story_paths]
    for s in stories:
        result = validate_story(s, lessons_dir=repo)
        if result.warnings:
            print(f"{s.path.name}: {len(result.warnings)} unknown tokens flagged:")
            for w in result.warnings:
                print(f"  ! {w.word}")
        target = s.duration_target_sec
        est = result.estimated_seconds
        if not (target * 0.75 <= est <= target * 1.25):
            print(
                f"{s.path.name}: estimated {est:.0f}s vs target {target}s "
                f"(outside ±25%)"
            )
    if args.validate_only:
        return 0

    tts = make_tts(
        args.backend, cache_dir=cache_dir,
        voice_es=args.voice_es, voice_en=args.voice_en,
    )

    from pydub import AudioSegment
    for s in stories:
        out = audio_dir / "stories" / s.group / f"{s.path.stem}.mp3"
        pace = _KIND_PACE.get(s.kind, 0.95)
        render_story_audio(s, tts=tts, dst=out, pace_body=pace)
        secs = AudioSegment.from_file(str(out)).duration_seconds
        print(f"Wrote {out} ({secs:.1f}s, target {s.duration_target_sec}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
