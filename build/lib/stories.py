"""Immersion story parser, vocab-window validator, and audio assembler.

Story file format: markdown with a YAML frontmatter block (`--- ... ---`).
Required frontmatter keys: group, bundles, bundle_max, lesson_max, title,
slug, kind, duration_target_sec, vocab_focus, preface_en. Optional keys:
repeat_slow, characters, gloss.

See docs/stories.md for the authoring guide.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

import yaml

from build.lib.normalize import strip_accents
from build.lib.vocab import allowed_vocab_through, tokenize_spanish

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n?(.*)$", re.DOTALL)

# Speaker label: ALL-CAPS (incl. accented vowels and Ñ) optionally hyphenated /
# multi-word, followed by a colon. Captured for stripping.
_SPEAKER_LABEL_RE = re.compile(r"^\s*[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ \-]+:\s*", re.MULTILINE)

# Stage direction: text inside parentheses. Non-recursive — fine for one-level
# stage directions which is all the format supports.
_STAGE_DIRECTION_RE = re.compile(r"\([^()]*\)")

# Markdown heading lines.
_HEADING_RE = re.compile(r"^#+ .*$", re.MULTILINE)


# Cognate suffixes a Language Transfer learner can derive once they know
# the foundation rules (L1–L3). The validator silences warnings for tokens
# ending in any of these.
_COGNATE_SUFFIXES: tuple[str, ...] = (
    "ble", "able", "ible",
    "mente",
    "al",
    "ante", "ente",
    "cion", "sion",
    "encia", "ancia",
    "idad",
    "ico", "ica", "icos", "icas",
    "oso", "osa", "osos", "osas",
    "ial", "cial",
)

# Universal LT-implicit particles: words taught indirectly via the audio
# lessons but not present in rules.md Vocabulary sections. Adding them
# once cleans up validator noise without papering over real gaps.
_UNIVERSAL_ALLOW: frozenset[str] = frozenset({
    "y", "o", "u", "mi", "tu", "su", "sí", "no",
    "mucho", "mucha", "muchos", "muchas",
    "muy", "poco", "ya", "bueno", "buena",
    "ay", "oh", "eh",
})


@dataclass(frozen=True)
class VocabFocus:
    es: str
    en: str


@dataclass(frozen=True)
class Story:
    path: Path
    group: str
    bundles: list[str]
    bundle_max: str
    lesson_max: int
    title: str
    slug: str
    kind: str
    duration_target_sec: int
    vocab_focus: list[VocabFocus]
    preface_en: str
    body: str
    repeat_slow: bool = False
    characters: list[dict] = field(default_factory=list)
    gloss: list[dict] = field(default_factory=list)


@dataclass(frozen=True)
class ValidationWarning:
    word: str
    reason: str


@dataclass(frozen=True)
class ValidationResult:
    warnings: list[ValidationWarning]
    estimated_seconds: float


def load_story(path: Path) -> Story:
    """Parse a story `.md` file into a `Story` dataclass."""
    text = path.read_text(encoding="utf-8").lstrip()
    m = _FRONTMATTER_RE.match(text)
    if not m:
        raise ValueError(f"{path}: missing YAML frontmatter")

    fm_raw = yaml.safe_load(m.group(1)) or {}
    if not isinstance(fm_raw, dict):
        raise ValueError(f"{path}: frontmatter must be a YAML mapping")

    body = m.group(2).strip()

    vocab_focus = [
        VocabFocus(es=str(entry["es"]).lower().strip(), en=str(entry["en"]))
        for entry in (fm_raw.get("vocab_focus") or [])
    ]

    required = ("group", "bundle_max", "lesson_max", "title", "slug")
    for key in required:
        if key not in fm_raw:
            raise ValueError(f"{path}: frontmatter missing required key '{key}'")

    return Story(
        path=path,
        group=str(fm_raw["group"]),
        bundles=[str(b) for b in fm_raw.get("bundles", [])],
        bundle_max=str(fm_raw["bundle_max"]),
        lesson_max=int(fm_raw["lesson_max"]),
        title=str(fm_raw["title"]),
        slug=str(fm_raw["slug"]),
        kind=str(fm_raw.get("kind", "scenario")),
        duration_target_sec=int(fm_raw.get("duration_target_sec", 90)),
        vocab_focus=vocab_focus,
        preface_en=str(fm_raw.get("preface_en", "")).strip(),
        body=body,
        repeat_slow=bool(fm_raw.get("repeat_slow", False)),
        characters=list(fm_raw.get("characters") or []),
        gloss=list(fm_raw.get("gloss") or []),
    )


def _spanish_body_text(body: str) -> str:
    """Strip markdown headings, stage directions, and speaker labels."""
    txt = body
    txt = _HEADING_RE.sub("", txt)
    txt = _STAGE_DIRECTION_RE.sub("", txt)
    txt = _SPEAKER_LABEL_RE.sub("", txt)
    return txt


def story_words(story: Story) -> set[str]:
    """Set of lowercased Spanish tokens in the spoken body."""
    return set(tokenize_spanish(_spanish_body_text(story.body)))


def _is_likely_cognate(token: str) -> bool:
    """True if the token's suffix matches a taught convertible-word rule."""
    tok = strip_accents(token)
    return any(tok.endswith(suf) for suf in _COGNATE_SUFFIXES)


def validate_story(
    story: Story,
    *,
    allowed_words: set[str] | None = None,
    lessons_dir: Path | None = None,
) -> ValidationResult:
    """Walk story body, return warnings for tokens outside the vocab window.

    Warnings are advisory: vocab_focus entries silence them; recognised
    cognate suffix patterns silence them; everything else flags.

    `allowed_words` overrides the lesson-derived allow-list. If omitted,
    the validator pulls vocab from rules.md files for lessons 1..lesson_max.
    """
    if allowed_words is None:
        if lessons_dir is not None:
            allowed_words = allowed_vocab_through(
                story.lesson_max, lessons_dir=lessons_dir,
            )
        else:
            allowed_words = allowed_vocab_through(story.lesson_max)

    # Multi-word vocab entries (e.g. "te amo", "voy a", "la casa") also
    # license their component words individually — otherwise "amo" alone
    # flags despite "te amo" being in the lesson.
    component_words: set[str] = set()
    for entry in allowed_words:
        if " " in entry:
            for part in entry.split():
                component_words.add(part)
    allowed_words = allowed_words | component_words

    focus_phrases = {vf.es.lower() for vf in story.vocab_focus}
    focus_component_words: set[str] = set()
    for fw in focus_phrases:
        for part in fw.split():
            focus_component_words.add(part.lower())

    gloss_words = {str(entry.get("es", "")).lower() for entry in story.gloss}

    body_words = story_words(story)
    warnings: list[ValidationWarning] = []
    for w in sorted(body_words):
        if w in allowed_words:
            continue
        if w in _UNIVERSAL_ALLOW:
            continue
        if w in focus_phrases or w in focus_component_words:
            continue
        if w in gloss_words:
            continue
        if _is_likely_cognate(w):
            continue
        warnings.append(ValidationWarning(word=w, reason="not in vocab window"))

    word_count = len(_spanish_body_text(story.body).split())
    estimated_seconds = word_count / 2.5  # 2.5 ES words/sec at pace 1.0

    return ValidationResult(warnings=warnings, estimated_seconds=estimated_seconds)


def iter_story_files(
    stories_dir: Path, group: str | None = None,
) -> Iterator[Path]:
    """Yield story `.md` files under `stories/<group>/` or every group."""
    if group:
        for p in sorted((stories_dir / group).glob("*.md")):
            yield p
    else:
        if not stories_dir.is_dir():
            return
        for sub in sorted(stories_dir.iterdir()):
            if sub.is_dir():
                for p in sorted(sub.glob("*.md")):
                    yield p


def render_story_audio(
    story: Story,
    *,
    tts,
    dst: Path,
    pace_body: float = 0.95,
) -> Path:
    """Render preface (EN) + body (ES) into a single MP3.

    Speaker labels become 350 ms silences between lines. Stage directions
    are stripped. If `story.repeat_slow` is True, the body is appended
    again at pace 0.85.
    """
    from pydub import AudioSegment

    work = AudioSegment.empty()

    if story.preface_en:
        prefp = tts.synth(story.preface_en, "en", pace=1.0)
        work += AudioSegment.from_file(str(prefp))
        work += AudioSegment.silent(duration=1000)

    spanish = _spanish_body_text(story.body)
    lines = [ln.strip() for ln in spanish.splitlines() if ln.strip()]
    for ln in lines:
        wav = tts.synth(ln, "es", pace=pace_body)
        work += AudioSegment.from_file(str(wav))
        work += AudioSegment.silent(duration=350)

    if story.repeat_slow:
        work += AudioSegment.silent(duration=800)
        for ln in lines:
            wav = tts.synth(ln, "es", pace=0.85)
            work += AudioSegment.from_file(str(wav))
            work += AudioSegment.silent(duration=350)

    work = work.set_channels(1)
    dst.parent.mkdir(parents=True, exist_ok=True)
    work.export(str(dst), format="mp3", bitrate="96k")
    return dst
