"""Tests for the generate_anki.py CLI."""
import subprocess
import sys
from pathlib import Path


def test_validate_only_succeeds_on_clean_repo(tmp_path, fixtures_dir):
    # Build a synthetic mini-repo: lesson_99 with the fixture cards.yml
    repo = tmp_path / "repo"
    (repo / "lesson_99").mkdir(parents=True)
    (repo / "lesson_99" / "cards.yml").write_text(
        (fixtures_dir / "lesson_99" / "cards.yml").read_text()
    )
    (repo / "lesson_99" / "rules.md").write_text(
        (fixtures_dir / "lesson_99" / "rules.md").read_text()
    )

    script = Path(__file__).resolve().parents[2] / "build" / "generate_anki.py"
    result = subprocess.run(
        [sys.executable, str(script), "--validate-only", "--repo", str(repo)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr


def test_validate_only_fails_on_invalid_yaml(tmp_path):
    repo = tmp_path / "repo"
    (repo / "lesson_99").mkdir(parents=True)
    (repo / "lesson_99" / "cards.yml").write_text("not: valid:\n  cards: [")  # malformed YAML

    script = Path(__file__).resolve().parents[2] / "build" / "generate_anki.py"
    result = subprocess.run(
        [sys.executable, str(script), "--validate-only", "--repo", str(repo)],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
