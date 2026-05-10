"""Validate story files against the bundle's stretch-word budget."""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Set

from build.lib.normalize import strip_accents
from build.lib.story import load_story_file
from build.lib.vocab import allowed_vocab_through, tokenize_spanish


# Bundle stretch budget table from docs/stories.md
BUNDLE_BUDGETS = {
    (1, 3): 0.0,
    (4, 5): 3.0,
    (6, 9): 5.0,
    (10, 12): 7.0,
    (13, 14): 10.0,
    (15, 17): 12.0,
    (18, 20): 15.0,
    (21, 22): 20.0,
    (23, 25): 22.0,
    (26, 28): 25.0,
}

# Common Spanish stop-words used across the corpus that are not in any
# Vocabulary section. Conservative list; expand carefully.
DEFAULT_STOPWORDS: Set[str] = {
    "el", "la", "los", "las", "un", "una", "y", "o", "pero",
    "es", "no", "se", "que", "de", "del", "al", "a", "en",
}

# Recurring character names used across the story corpus. These are proper
# nouns, not vocab — keeping them in a separate set makes the extension
# auditable. Cast bible: stories/_world.md.
PROPER_NOUNS: Set[str] = {
    "maría", "daniel", "lina",
}

# Combined default for the validator entry point. Tests can still pass
# their own stopwords explicitly.
DEFAULT_STOPWORDS = DEFAULT_STOPWORDS | PROPER_NOUNS


class StoryValidationError(ValueError):
    pass


@dataclass
class StoryValidationReport:
    story_path: Path
    total_tokens: int
    unknown_tokens: int
    unknown_words: list[str]
    budget_pct: float
    actual_pct: float
    passed: bool


def _budget_for(lessons: list[int]) -> float | None:
    """Find the bundle that contains all `lessons` and return its budget."""
    if not lessons:
        return None
    lo, hi = min(lessons), max(lessons)
    for (b_lo, b_hi), budget in BUNDLE_BUDGETS.items():
        if b_lo <= lo and hi <= b_hi:
            return budget
    return None


def validate_story(
    path: Path,
    *,
    lessons_dir: Path,
    budget_pct: float | None = None,
    stopwords: Set[str] | None = None,
) -> StoryValidationReport:
    story = load_story_file(path)
    if story.skip_budget:
        return StoryValidationReport(
            story_path=path, total_tokens=0, unknown_tokens=0,
            unknown_words=[], budget_pct=0.0, actual_pct=0.0, passed=True,
        )
    max_lesson = max(story.lessons)
    allowed = allowed_vocab_through(max_lesson, lessons_dir=lessons_dir)
    allowed_normalized = {strip_accents(w) for w in allowed}
    sw = (stopwords if stopwords is not None else DEFAULT_STOPWORDS)
    sw_normalized = {strip_accents(w) for w in sw}

    total = 0
    unknown_tokens = 0
    unknown_words: list[str] = []
    for paragraph in story.spanish_paragraphs:
        for line in paragraph:
            tokens = tokenize_spanish(line)
            for tok in tokens:
                total += 1
                tok_norm = strip_accents(tok)
                if tok_norm in allowed_normalized:
                    continue
                if tok_norm in sw_normalized:
                    continue
                unknown_tokens += 1
                unknown_words.append(tok)

    budget = budget_pct if budget_pct is not None else _budget_for(story.lessons)
    if budget is None:
        raise StoryValidationError(f"{path}: no stretch budget for lessons {story.lessons}")

    actual_pct = 100.0 * unknown_tokens / total if total else 0.0
    passed = actual_pct <= budget

    report = StoryValidationReport(
        story_path=path, total_tokens=total, unknown_tokens=unknown_tokens,
        unknown_words=sorted(set(unknown_words)),
        budget_pct=budget, actual_pct=actual_pct, passed=passed,
    )
    if not passed:
        raise StoryValidationError(
            f"{path}: stretch budget exceeded ({actual_pct:.1f}% > {budget:.1f}%); "
            f"stretch words: {report.unknown_words}"
        )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate every story file.")
    parser.add_argument("--repo", default=str(Path(__file__).resolve().parents[2]))
    args = parser.parse_args(argv)
    repo = Path(args.repo).resolve()
    stories_dir = repo / "stories"
    if not stories_dir.is_dir():
        print("No stories/ directory; nothing to validate.")
        return 0

    failed = 0
    for path in sorted(stories_dir.glob("topic_*/*.md")):
        try:
            report = validate_story(path, lessons_dir=repo)
            print(f"OK {path} ({report.actual_pct:.1f}% / {report.budget_pct:.1f}%, "
                  f"{len(report.unknown_words)} stretch words)")
        except StoryValidationError as e:
            failed += 1
            print(f"FAIL {e}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
