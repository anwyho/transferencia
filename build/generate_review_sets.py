#!/usr/bin/env python3.11
"""Render per-bundle review-set MP3s (audio/review_set_<letter>.mp3).

Each bundle's set targets ~20 minutes of audio:
  - ~70% audio time from the bundle's own cards,
  - ~30% sampled from prior bundles (recency-weighted),
  - direction biased 70/30 EN→ES per-card,
  - "Siguiente." marker between cards.

See docs/audio-review-sets.md for the algorithm + acceptance band.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydub import AudioSegment  # noqa: E402

from build.lib.audio import render_card_track  # noqa: E402
from build.lib.parse import load_all_card_files  # noqa: E402
from build.lib.review_sets import select_segments_for_bundle  # noqa: E402
from build.lib.tts.factory import make_tts  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]


def _bundle_groups(cards) -> dict[str, list[int]]:
    """Group cards by bundle-letter; collect the lesson set per bundle.

    Returns a {letter: [sorted lessons]} map for every bundle that has cards.
    """
    groups: dict[str, set[int]] = {}
    for c in cards:
        base = os.path.basename(c.source_file or "")
        if "_" not in base:
            continue
        letter = base.split("_", 1)[0]
        groups.setdefault(letter, set()).update(c.lessons)
    return {k: sorted(v) for k, v in groups.items()}


def _ensure_marker(tts, audio_dir: Path) -> AudioSegment:
    """Render the 'Siguiente.' marker once and return it as an AudioSegment."""
    marker_dst = audio_dir / ".cache" / "marker_siguiente.mp3"
    marker_dst.parent.mkdir(parents=True, exist_ok=True)
    if not marker_dst.exists():
        wav = tts.synth("Siguiente.", "es", pace=1.0)
        AudioSegment.from_file(str(wav)).set_channels(1).export(
            str(marker_dst), format="mp3", bitrate="96k",
        )
    return AudioSegment.from_file(str(marker_dst))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render per-bundle review sets.")
    parser.add_argument("--repo", default=str(REPO_ROOT))
    parser.add_argument("--audio-dir", default=str(REPO_ROOT / "audio"))
    parser.add_argument(
        "--bundle",
        default=None,
        help="Bundle letter (a, b, ...). Default: every built bundle.",
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Render every built bundle (same as omitting --bundle).",
    )
    parser.add_argument("--backend", default=None)
    parser.add_argument("--voice-es", default=None)
    parser.add_argument("--voice-en", default=None)
    parser.add_argument("--pace", type=float, default=1.0)
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    audio_dir = Path(args.audio_dir).resolve()
    cache_dir = audio_dir / ".cache"

    cards = load_all_card_files(repo)
    groups = _bundle_groups(cards)
    if not groups:
        print("No bundle cards found.", file=sys.stderr)
        return 1

    tts = make_tts(
        args.backend, cache_dir=cache_dir,
        voice_es=args.voice_es, voice_en=args.voice_en,
    )
    marker = _ensure_marker(tts, audio_dir)

    target_letters = (
        [args.bundle.lower()] if args.bundle else sorted(groups.keys())
    )

    for letter in target_letters:
        if letter not in groups:
            print(f"bundle {letter}: not built, skipping")
            continue
        bundle_lessons = groups[letter]
        segments = select_segments_for_bundle(cards, bundle_lessons=bundle_lessons)
        out = audio_dir / f"review_set_{letter}.mp3"
        render_card_track(
            segments, tts=tts, dst=out,
            seed=hash(letter) & 0xFFFFFFFF,
            pace=args.pace, separator=marker, shuffle=False,
        )
        secs = AudioSegment.from_file(str(out)).duration_seconds
        print(f"Wrote {out} ({len(segments)} segments, {secs/60:.1f} min)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
