"""Parse story markdown files (frontmatter + Spanish/gloss/footnotes/translation)."""
from __future__ import annotations

import re
from pathlib import Path

import yaml

from build.lib.types import Story


_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)


def load_story_file(path: Path) -> Story:
    text = path.read_text(encoding="utf-8")
    m = _FRONTMATTER_RE.match(text)
    if not m:
        raise ValueError(f"{path}: missing YAML frontmatter")
    fm = yaml.safe_load(m.group(1)) or {}
    body = m.group(2)

    # Split body into ## sections
    sections = _split_sections(body)
    story_section = sections.get("Story", "")
    free_section = sections.get("Free English translation", "").strip()

    spanish_paragraphs = _extract_spanish_paragraphs(story_section)

    return Story(
        topic=str(fm.get("topic", "")),
        lessons=[int(x) for x in (fm.get("lessons") or [])],
        title=str(fm.get("title", "")),
        title_en=str(fm.get("title_en", "")),
        order=int(fm.get("order", 0)),
        target_minutes=float(fm.get("target_minutes", 0)),
        stretch_used_pct=float(fm.get("stretch_used_pct", 0)),
        spanish_paragraphs=spanish_paragraphs,
        free_translation=free_section,
        source_file=str(path),
    )


def _split_sections(body: str) -> dict[str, str]:
    """Split body by '## Heading' lines into a dict of section name → content."""
    out: dict[str, str] = {}
    current_name: str | None = None
    current_lines: list[str] = []
    for line in body.splitlines():
        if line.startswith("## "):
            if current_name is not None:
                out[current_name] = "\n".join(current_lines).strip()
            current_name = line[3:].strip()
            current_lines = []
        elif current_name is not None:
            current_lines.append(line)
    if current_name is not None:
        out[current_name] = "\n".join(current_lines).strip()
    return out


def _extract_spanish_paragraphs(story_text: str) -> list[list[str]]:
    """Extract pure Spanish lines, stripped of gloss and footnotes.

    A line is Spanish iff it's a non-empty line that:
      - is not a footnote (starts with '[N]' or contains the footnote pattern)
      - is not a literal-gloss line (italic-wrapped: starts and ends with '*')

    Paragraphs are separated by blank lines.
    """
    paragraphs: list[list[str]] = []
    current: list[str] = []
    for raw in story_text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            if current:
                paragraphs.append(current)
                current = []
            continue
        # Skip footnote definitions
        if re.match(r"^\s*\[\d+\]", line):
            continue
        # Skip literal-gloss italic lines
        stripped = line.strip()
        if stripped.startswith("*") and stripped.endswith("*"):
            continue
        # Treat any line with leading '*' or trailing '*' as gloss too
        if stripped.startswith("*") or stripped.endswith("*"):
            continue
        # Strip inline footnote markers like 'palabra[1]' → 'palabra'
        cleaned = re.sub(r"\[\d+\]", "", stripped)
        current.append(cleaned)
    if current:
        paragraphs.append(current)
    return paragraphs
