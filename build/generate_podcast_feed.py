#!/usr/bin/env python3.11
"""Emit a podcast RSS feed (podcast.xml) covering audio/flashcards_*.mp3.

Subscribe in Pocket Casts / Overcast / Apple Podcasts via:
  https://raw.githubusercontent.com/<user>/<repo>/<branch>/podcast.xml

Each MP3's enclosure points back at the corresponding raw.githubusercontent.com
URL so the file is downloadable straight from git without extra hosting.
"""
from __future__ import annotations

import argparse
import email.utils
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape

from mutagen.mp3 import MP3

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE = "https://raw.githubusercontent.com/anwyho/transferencia/main"

ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"
ATOM_NS = "http://www.w3.org/2005/Atom"

# Matches "C1 Helpers Saber.mp3" or "NN1 Line Past Full.mp3"
FNAME_RE = re.compile(r"^(?P<letter>[A-Z]+)(?P<part>\d+) (?P<theme>.+)\.mp3$")

# Row pattern in docs/lesson-bundles.md:
#   | 3 | **C. Helpers + saber + first I-form** | 8–10 | `cards/c_helpers_saber.yml` | ...summary... |
BUNDLE_ROW_RE = re.compile(
    r"^\|\s*\d+\s*\|\s*\*\*(?P<name>[^*]+?)\*\*\s*\|\s*(?P<lessons>[^|]+?)\s*\|\s*"
    r"(?P<file>[^|]+?)\s*\|\s*(?P<summary>.+?)\s*\|\s*$"
)
MD_EMPHASIS_RE = re.compile(r"\*+([^*]+?)\*+")
BACKTICK_RE = re.compile(r"`([^`]+?)`")


def _clean_markdown(text: str) -> str:
    """Strip markdown emphasis / inline-code so RSS description reads cleanly."""
    text = MD_EMPHASIS_RE.sub(r"\1", text)
    text = BACKTICK_RE.sub(r"\1", text)
    return text.strip()


def _load_bundle_descriptions(repo_root: Path) -> dict[str, dict]:
    """Parse docs/lesson-bundles.md table into {letter: {name, lessons, summary}}."""
    out: dict[str, dict] = {}
    doc = repo_root / "docs" / "lesson-bundles.md"
    if not doc.exists():
        return out
    for line in doc.read_text(encoding="utf-8").splitlines():
        m = BUNDLE_ROW_RE.match(line)
        if not m:
            continue
        file_cell = m.group("file").strip()
        # Extract bundle letter from the file path, e.g. `cards/c_helpers_saber.yml`
        # — falls back to first char of name when the file column reads
        # "*(not yet built)*".
        letter = None
        if "cards/" in file_cell:
            stem = file_cell.split("cards/", 1)[1].rstrip("`. ").split(".", 1)[0]
            if "_" in stem:
                letter = stem.split("_", 1)[0]
        if not letter:
            name = m.group("name").strip()
            letter = name.split(".", 1)[0].strip().lower()
        out[letter.upper()] = {
            "name": _clean_markdown(m.group("name")),
            "lessons": _clean_markdown(m.group("lessons")).replace("*(4)*", "(4 lessons)"),
            "summary": _clean_markdown(m.group("summary")),
        }
    # nn is the on-disk slug for the Ñ bundle. The table key may be "ñ" or "NN".
    if "NN" not in out:
        for k in list(out.keys()):
            if k.lower() in {"ñ", "n~", "nn"}:
                out["NN"] = out.pop(k)
                break
    return out


def _fmt_duration(seconds: float) -> str:
    s = int(round(seconds))
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:d}:{s:02d}"


def _iter_episodes(audio_dir: Path):
    for path in sorted((audio_dir / "flashcards").glob("*.mp3")):
        m = FNAME_RE.match(path.name)
        if not m:
            continue
        yield path, m.group("letter"), int(m.group("part")), m.group("theme")


def _episode_description(letter: str, part: int, total_parts: int, theme: str,
                         bundles: dict[str, dict]) -> str:
    bundle = bundles.get(letter)
    if not bundle:
        return (
            f"Spanish flashcard drill — bundle {letter}, part {part} of {total_parts}. "
            f"Three exercise shapes interleave: English → Spanish translation, "
            f"Spanish → English translation, and conjugation drills with mixed "
            f"English / Spanish text-to-speech voicing."
        )
    name = bundle["name"]
    lessons = bundle["lessons"]
    summary = bundle["summary"]
    return (
        f"Bundle {name} — Lessons {lessons}. Part {part} of {total_parts}.\n\n"
        f"Concepts covered: {summary}\n\n"
        f"Three exercise shapes interleave throughout this part:\n"
        f"• English → Spanish translation — produce the Spanish for the English prompt.\n"
        f"• Spanish → English translation — sentences are spoken twice (with a long "
        f"pause between) so you can catch them on the second pass.\n"
        f"• Conjugation drills — the prompt splices an English instruction with the "
        f"Spanish infinitive (e.g. 'Conjugate the I form for' + 'dormir'). The answer "
        f"plays the conjugated form, pauses, then restates it with the English meaning "
        f"as a built-in second flashcard for the gloss.\n\n"
        f"Spanish synthesis runs slightly slower than English so words don't mash. "
        f"A two-tone E-major-7 chime separates cards."
    )


def build_feed(audio_dir: Path, base_url: str, feed_url: str) -> str:
    items: list[str] = []
    episodes = list(_iter_episodes(audio_dir))
    bundles = _load_bundle_descriptions(REPO_ROOT)
    parts_per_letter: dict[str, int] = {}
    for _, letter, _, _ in episodes:
        parts_per_letter[letter] = parts_per_letter.get(letter, 0) + 1

    # Sort: bundle letter ('NN' = Ñ lands after N lexicographically), then part.
    episodes.sort(key=lambda t: (t[1], t[2]))

    now = datetime.now(timezone.utc)
    base_time = now - timedelta(minutes=len(episodes))

    for idx, (path, letter, part, theme) in enumerate(episodes):
        size_bytes = path.stat().st_size
        audio = MP3(str(path))
        duration_s = audio.info.length
        title = f"{letter}{part} {theme}"
        guid = f"flashcards-{letter}-pt{part}"
        url = f"{base_url}/audio/flashcards/{quote(path.name)}"
        pub = base_time + timedelta(minutes=idx)
        pub_struct = pub.timetuple()
        pub_rfc822 = email.utils.format_datetime(pub)
        desc = _episode_description(
            letter, part, parts_per_letter[letter], theme, bundles,
        )
        items.append(
            f"""    <item>
      <title>{escape(title)}</title>
      <description>{escape(desc)}</description>
      <enclosure url="{escape(url)}" length="{size_bytes}" type="audio/mpeg" />
      <guid isPermaLink="false">{escape(guid)}</guid>
      <pubDate>{escape(pub_rfc822)}</pubDate>
      <itunes:duration>{_fmt_duration(duration_s)}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
      <itunes:episode>{idx + 1}</itunes:episode>
    </item>"""
        )

    channel_pub = email.utils.format_datetime(now)
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="{ITUNES_NS}" xmlns:atom="{ATOM_NS}">
  <channel>
    <title>Transferencia — Spanish Flashcards</title>
    <link>{escape(base_url)}</link>
    <atom:link href="{escape(feed_url)}" rel="self" type="application/rss+xml" />
    <language>en-us</language>
    <description>Per-bundle Spanish flashcard audio drills, voiced by Piper TTS. \
The 27 bundles (A–Z + Ñ) chunk Mihalis Eleftheriou's 90-lesson Language Transfer \
Complete Spanish course into thematic groups; each bundle plays as one or more \
≤30-minute parts. Three exercise shapes interleave throughout: English → Spanish \
translation, Spanish → English translation, and conjugation drills that splice \
English and Spanish voices then defer the meaning gloss as a built-in second \
flashcard. Shuffled per bundle, Spanish synthesized slightly slower than English, \
with a two-tone E-major-7 chime separating cards.</description>
    <itunes:author>Transferencia</itunes:author>
    <itunes:summary>Per-bundle Spanish flashcard audio drills.</itunes:summary>
    <itunes:owner>
      <itunes:name>Transferencia</itunes:name>
      <itunes:email>noreply@example.com</itunes:email>
    </itunes:owner>
    <itunes:category text="Education">
      <itunes:category text="Language Learning" />
    </itunes:category>
    <itunes:explicit>false</itunes:explicit>
    <pubDate>{escape(channel_pub)}</pubDate>
{chr(10).join(items)}
  </channel>
</rss>
"""
    _ = time.mktime(pub_struct)  # keep timestruct usage so reorder safe
    return xml


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Emit podcast.xml for flashcard MP3s.")
    parser.add_argument("--audio-dir", default=str(REPO_ROOT / "audio"))
    parser.add_argument("--out", default=str(REPO_ROOT / "podcast.xml"))
    parser.add_argument(
        "--base-url", default=DEFAULT_BASE,
        help="URL prefix for enclosures (no trailing slash)",
    )
    parser.add_argument(
        "--feed-url", default=f"{DEFAULT_BASE}/podcast.xml",
        help="Self URL for the feed",
    )
    args = parser.parse_args(argv)

    audio_dir = Path(args.audio_dir).resolve()
    xml = build_feed(audio_dir, args.base_url.rstrip("/"), args.feed_url)
    out = Path(args.out).resolve()
    out.write_text(xml, encoding="utf-8")
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
