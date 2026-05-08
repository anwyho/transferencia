"""Tests for the generate_audio.py CLI (card mode)."""
import platform
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.skipif(platform.system() != "Darwin", reason="card-track smoke test uses mac_say")
def test_card_track_through_99_renders(tmp_path, fixtures_dir):
    repo = tmp_path / "repo"
    (repo / "lesson_99").mkdir(parents=True)
    (repo / "lesson_99" / "cards.yml").write_text(
        (fixtures_dir / "lesson_99" / "cards.yml").read_text()
    )
    (repo / "lesson_99" / "rules.md").write_text(
        (fixtures_dir / "lesson_99" / "rules.md").read_text()
    )

    script = Path(__file__).resolve().parents[2] / "build" / "generate_audio.py"
    result = subprocess.run(
        [sys.executable, str(script),
         "--repo", str(repo), "--through", "99",
         "--backend", "mac_say",
         "--audio-dir", str(tmp_path / "audio")],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    track = tmp_path / "audio" / "lesson_99.mp3"
    assert track.exists() and track.stat().st_size > 0


@pytest.mark.skipif(platform.system() != "Darwin", reason="story-track smoke uses mac_say")
def test_story_mode_renders_a_track(tmp_path, fixtures_dir):
    repo = tmp_path / "repo"
    (repo / "lesson_99").mkdir(parents=True)
    (repo / "lesson_99" / "rules.md").write_text(
        (fixtures_dir / "lesson_99" / "rules.md").read_text()
    )
    stories_src = fixtures_dir / "stories" / "topic_99"
    dst_stories = repo / "stories" / "topic_99"
    dst_stories.mkdir(parents=True)
    (dst_stories / "01_test_story.md").write_text(
        (stories_src / "01_test_story.md").read_text()
    )

    script = Path(__file__).resolve().parents[2] / "build" / "generate_audio.py"
    result = subprocess.run(
        [sys.executable, str(script),
         "--repo", str(repo),
         "--stories", "--bundle", "topic_99",
         "--backend", "mac_say",
         "--audio-dir", str(tmp_path / "audio")],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    track = tmp_path / "audio" / "stories" / "topic_99__01_a-morning.mp3"
    assert track.exists() and track.stat().st_size > 0
