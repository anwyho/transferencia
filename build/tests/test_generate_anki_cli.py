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


def test_apkg_is_written(tmp_path, fixtures_dir):
    repo = tmp_path / "repo"
    (repo / "lesson_99").mkdir(parents=True)
    (repo / "lesson_99" / "cards.yml").write_text(
        (fixtures_dir / "lesson_99" / "cards.yml").read_text()
    )
    (repo / "lesson_99" / "rules.md").write_text(
        (fixtures_dir / "lesson_99" / "rules.md").read_text()
    )

    out = tmp_path / "out.apkg"
    script = Path(__file__).resolve().parents[2] / "build" / "generate_anki.py"
    result = subprocess.run(
        [sys.executable, str(script), "--repo", str(repo), "--out", str(out)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert out.exists() and out.stat().st_size > 0


def test_export_json_writes_flat_array(tmp_path, fixtures_dir):
    import json
    repo = tmp_path / "repo"
    (repo / "lesson_99").mkdir(parents=True)
    (repo / "lesson_99" / "cards.yml").write_text(
        (fixtures_dir / "lesson_99" / "cards.yml").read_text()
    )
    (repo / "lesson_99" / "rules.md").write_text(
        (fixtures_dir / "lesson_99" / "rules.md").read_text()
    )

    out_json = tmp_path / "cards.json"
    script = Path(__file__).resolve().parents[2] / "build" / "generate_anki.py"
    result = subprocess.run(
        [sys.executable, str(script), "--repo", str(repo),
         "--validate-only", "--export-json", str(out_json)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    data = json.loads(out_json.read_text())
    assert isinstance(data, list)
    assert len(data) == 2
    assert data[0]["id"] == "L99-001"
