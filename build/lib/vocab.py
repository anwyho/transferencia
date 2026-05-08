"""Extract allowed vocabulary from lesson_NN/rules.md files."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable, Set

REPO_ROOT = Path(__file__).resolve().parents[2]

# Matches Vocabulary entries:  - *importante* — important
# Captures the italic Spanish word in the first group.
_VOCAB_LINE_RE = re.compile(r"^\s*-\s*\*([^*]+)\*\s*[—\-:]", re.MULTILINE)


def extract_lesson_vocab(rules_path: Path) -> Set[str]:
    """Extract the Spanish vocabulary words from a rules.md file.

    Looks for the `## Vocabulary` section and parses lines like:
        - *importante* — important
        - *real* — real / royal

    Returns lowercased, whitespace-stripped Spanish words. Multi-word
    entries (e.g. *tener que*) are kept as a single space-separated key.
    """
    text = rules_path.read_text(encoding="utf-8")
    # Slice from "## Vocabulary" to the next "## " heading (or EOF)
    m = re.search(r"##\s+Vocabulary\s*\n(.*?)(?=\n##\s|\Z)", text, re.DOTALL)
    if not m:
        return set()
    section = m.group(1)
    return {match.group(1).strip().lower() for match in _VOCAB_LINE_RE.finditer(section)}


def allowed_vocab_through(
    max_lesson: int, *, lessons_dir: Path = REPO_ROOT
) -> Set[str]:
    """Union of vocab from all lesson_NN/rules.md where NN <= max_lesson.

    Looks for both `lesson_NN/` (zero-padded) and `lesson_N/` directory
    naming under `lessons_dir`. Missing lessons are silently skipped so
    we can be tolerant of incomplete corpora during testing.
    """
    union: Set[str] = set()
    for n in range(1, max_lesson + 1):
        for candidate in (f"lesson_{n:02d}", f"lesson_{n}", f"lesson_{n:01d}"):
            rules = lessons_dir / candidate / "rules.md"
            if rules.exists():
                union |= extract_lesson_vocab(rules)
                break
    return union


def tokenize_spanish(text: str) -> list[str]:
    """Lowercase Spanish word tokenizer. Strips punctuation, keeps ñ/accents."""
    return re.findall(r"[a-záéíóúüñ]+", text.lower())
