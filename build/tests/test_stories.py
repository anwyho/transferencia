"""Tests for build/lib/stories.py — immersion-story parser + validator."""
from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from build.lib.stories import (
    ValidationWarning,
    load_story,
    story_words,
    validate_story,
)


SAMPLE_MD = textwrap.dedent("""\
    ---
    group: 1_foundation
    bundles: [A, B, C]
    bundle_max: C
    lesson_max: 10
    title: "Dos gatos"
    slug: dos_gatos
    kind: animal_fable
    duration_target_sec: 60
    vocab_focus:
      - { es: "importante", en: "important" }
      - { es: "no es",      en: "it's not" }
    preface_en: |
      Listen for "importante" (important) and "no es" (it's not). Aquí vamos.
    ---

    # Dos gatos

    (Setting: un callejón.)
    GATO NEGRO: Es importante. No es importante.
    GATA BLANCA: No es importante.
""").strip()


def _write_story(tmp_path: Path, content: str = SAMPLE_MD) -> Path:
    p = tmp_path / "01_dos_gatos.md"
    p.write_text(content, encoding="utf-8")
    return p


def test_load_story_parses_frontmatter_and_body(tmp_path):
    p = _write_story(tmp_path)
    s = load_story(p)
    assert s.title == "Dos gatos"
    assert s.bundle_max == "C"
    assert s.lesson_max == 10
    assert s.kind == "animal_fable"
    assert s.duration_target_sec == 60
    assert "GATO NEGRO:" in s.body
    assert s.preface_en.startswith("Listen for")
    assert {(vf.es, vf.en) for vf in s.vocab_focus} == {
        ("importante", "important"),
        ("no es", "it's not"),
    }


def test_load_story_rejects_missing_frontmatter(tmp_path):
    p = tmp_path / "bad.md"
    p.write_text("Just a body, no frontmatter.\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_story(p)


def test_story_words_strips_stage_directions_and_speaker_labels(tmp_path):
    p = _write_story(tmp_path)
    s = load_story(p)
    words = story_words(s)
    # Spoken Spanish content present:
    assert "es" in words
    assert "importante" in words
    # Stage direction word "setting" is English-typed inside parens — stripped entirely.
    assert "setting" not in words
    # Speaker labels are stripped: "gato" + "negro" should not leak as Spanish content
    # because the speaker label "GATO NEGRO:" is removed before tokenisation.
    assert "negro" not in words  # would only appear if speaker label leaked


def test_validate_warns_on_unknown_tokens(tmp_path):
    p = _write_story(tmp_path)
    s = load_story(p)
    # Allow only a minimal core; the rest should mostly warn.
    result = validate_story(
        s,
        allowed_words={"es", "no"},
    )
    flagged = {w.word for w in result.warnings}
    # "importante" is in vocab_focus → suppressed.
    assert "importante" not in flagged
    # "callejón" is inside a stage direction → already stripped, not a word.
    assert "callejón" not in flagged
    # Estimated seconds reported.
    assert result.estimated_seconds > 0


def test_validate_accepts_cognate_suffix(tmp_path):
    body = textwrap.dedent("""\
        ---
        group: 1_foundation
        bundles: [A]
        bundle_max: A
        lesson_max: 3
        title: "Cognados"
        slug: cognados
        kind: scenario
        duration_target_sec: 30
        vocab_focus:
          - { es: "es", en: "is" }
        preface_en: |
          Listen. Aquí vamos.
        ---

        Es importante. Es especial. Normalmente es legal.
    """).strip()
    p = tmp_path / "cognados.md"
    p.write_text(body, encoding="utf-8")
    s = load_story(p)
    result = validate_story(s, allowed_words={"es"})
    flagged = {w.word for w in result.warnings}
    # All four content tokens follow taught cognate rules (-ante/-cial/-mente/-al).
    assert "importante" not in flagged
    assert "especial" not in flagged
    assert "normalmente" not in flagged
    assert "legal" not in flagged
