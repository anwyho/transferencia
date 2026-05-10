"""Extract allowed vocabulary from lesson_NN/rules.md files."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable, Set

REPO_ROOT = Path(__file__).resolve().parents[2]

# Matches Vocabulary entries (bullet lines):  - *importante* — important
# Matches every italic Spanish phrase on the line — supports both:
#   - *importante* — important
#   - *tener* / *tengo* — to have / I have
_VOCAB_LINE_RE = re.compile(r"^\s*-\s+(.*)", re.MULTILINE)
_ITALIC_PHRASE_RE = re.compile(r"\*([^*]+)\*")


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
    out: Set[str] = set()
    for line_match in _VOCAB_LINE_RE.finditer(section):
        line = line_match.group(1)
        # Pull every italic phrase on the line. The line format is normally:
        #   - *infinitive* / *form1* / *form2* — gloss (and *form3* — more gloss)
        # Vocab lines often have additional Spanish forms after the em-dash —
        # so we match every italic block, not just the first one before "—".
        # A few English words appear in italics inside glosses (e.g. *intention*),
        # but they don't collide with Spanish tokens in card prompts so it's safe.
        for phrase_match in _ITALIC_PHRASE_RE.finditer(line):
            phrase = phrase_match.group(1).strip().lower()
            # Slash-separated conjugation lists inside one italic block count
            # as multiple entries: *vengo / viene / vienen* → {vengo, viene, vienen}.
            if " / " in phrase:
                for part in phrase.split(" / "):
                    p = part.strip()
                    if p:
                        out.add(p)
            elif phrase:
                out.add(phrase)
    return out


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
        for candidate in (
            f"lessons/lesson_{n:02d}",
            f"lessons/lesson_{n}",
            f"lesson_{n:02d}",  # legacy
            f"lesson_{n}",
        ):
            rules = lessons_dir / candidate / "rules.md"
            if rules.exists():
                union |= extract_lesson_vocab(rules)
                break
    return union


def tokenize_spanish(text: str) -> list[str]:
    """Lowercase Spanish word tokenizer. Strips punctuation, keeps ñ/accents."""
    return re.findall(r"[a-záéíóúüñ]+", text.lower())
