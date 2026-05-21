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
from xml.sax.saxutils import escape

from mutagen.mp3 import MP3

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE = "https://raw.githubusercontent.com/anwyho/transferencia/main"

ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"
ATOM_NS = "http://www.w3.org/2005/Atom"

FNAME_RE = re.compile(r"^bundle_(?P<letter>[a-z]+)_pt(?P<part>\d+)\.mp3$")


def _fmt_duration(seconds: float) -> str:
    s = int(round(seconds))
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:d}:{s:02d}"


def _iter_episodes(audio_dir: Path):
    for path in sorted((audio_dir / "flashcards").glob("bundle_*_pt*.mp3")):
        m = FNAME_RE.match(path.name)
        if not m:
            continue
        yield path, m.group("letter"), int(m.group("part"))


def build_feed(audio_dir: Path, base_url: str, feed_url: str) -> str:
    items: list[str] = []
    episodes = list(_iter_episodes(audio_dir))

    # Sort: bundle letter ('nn' lexicographically after 'n', ordering matches
    # learning sequence well enough), then part number.
    episodes.sort(key=lambda t: (t[1], t[2]))

    # Use an evenly-spaced fake pubDate sequence so clients order episodes
    # consistently. Earliest bundle = oldest date.
    now = datetime.now(timezone.utc)
    base_time = now - timedelta(minutes=len(episodes))

    for idx, (path, letter, part) in enumerate(episodes):
        size_bytes = path.stat().st_size
        audio = MP3(str(path))
        duration_s = audio.info.length
        title = f"Bundle {letter.upper()} — Part {part}"
        guid = f"flashcards-{letter}-pt{part}"
        url = f"{base_url}/audio/flashcards/{path.name}"
        pub = base_time + timedelta(minutes=idx)
        pub_struct = pub.timetuple()
        pub_rfc822 = email.utils.format_datetime(pub)
        desc = (
            f"Spanish flashcard drill — Bundle {letter.upper()}, part {part}. "
            f"Three exercise shapes: ES→EN, EN→ES, conjugation. Shuffled."
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
    <description>Per-bundle Spanish flashcard audio drills (Piper TTS). \
ES→EN, EN→ES, and conjugation exercises. Shuffled. ~30 min per part.</description>
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
