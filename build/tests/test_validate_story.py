"""Tests for build.lib.validate_story."""
import pytest

from build.lib.validate_story import StoryValidationError, validate_story


def test_validate_story_under_budget_passes(fixtures_dir):
    # The fixture story uses only words from lesson_99/rules.md (importante,
    # diferente, real, normalmente). Plus stop-words like "es", "una", "no",
    # "una", "mañana" — last one (mañana) is NOT in the fixture rules. With
    # a 100% stretch budget for testing, anything passes.
    path = fixtures_dir / "stories" / "topic_99" / "01_test_story.md"
    report = validate_story(path, lessons_dir=fixtures_dir, budget_pct=100.0,
                            stopwords={"es", "una", "no"})
    assert report.unknown_words  # there are some unknowns
    assert report.passed


def test_validate_story_over_budget_fails(fixtures_dir):
    path = fixtures_dir / "stories" / "topic_99" / "01_test_story.md"
    # 0% budget — even a single unknown word fails
    with pytest.raises(StoryValidationError):
        validate_story(path, lessons_dir=fixtures_dir, budget_pct=0.0,
                       stopwords={"es", "una", "no", "mañana", "maría"})
        # Note: even with stopwords, "normal" isn't in fixture vocab → trips it
