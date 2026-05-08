"""Tests for build.lib.story."""
from build.lib.story import load_story_file


def test_load_story_basic(fixtures_dir):
    path = fixtures_dir / "stories" / "topic_99" / "01_test_story.md"
    story = load_story_file(path)
    assert story.topic == "test"
    assert story.lessons == [99]
    assert story.title == "Una mañana"
    assert story.title_en == "A Morning"
    assert story.order == 1
    assert story.target_minutes == 5
    # Three Spanish lines, three single-line paragraphs in this fixture
    assert len(story.spanish_paragraphs) == 3
    assert story.spanish_paragraphs[0] == ["Es una mañana normal."]
    assert story.spanish_paragraphs[1] == ["María es importante."]
    assert story.spanish_paragraphs[2] == ["No es diferente."]
    assert "normal morning" in story.free_translation


def test_load_story_strips_gloss_and_footnotes(fixtures_dir, tmp_path):
    path = tmp_path / "stretchy.md"
    path.write_text("""---
topic: test
lessons: [99]
title: "Test"
title_en: "Test"
order: 2
target_minutes: 5
stretch_used_pct: 5
---

## Story

María está perpleja[1].
*María is perplexed.*

[1] *perpleja* — new word, means "perplexed."

Es muy importante.
*Is very important.*

## Free English translation

Maria is perplexed. It is very important.
""")
    story = load_story_file(path)
    spanish_lines = [line for para in story.spanish_paragraphs for line in para]
    # Footnotes and gloss must be excluded from the spanish_paragraphs list
    assert any("perpleja" in line for line in spanish_lines)
    assert all("perplexed" not in line for line in spanish_lines)
    assert all(not line.startswith("[") for line in spanish_lines)
