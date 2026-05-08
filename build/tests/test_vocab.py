"""Tests for build.lib.vocab."""
from build.lib.vocab import extract_lesson_vocab, allowed_vocab_through


def test_extract_lesson_vocab_picks_up_italic_entries(fixtures_dir):
    rules_path = fixtures_dir / "lesson_99" / "rules.md"
    vocab = extract_lesson_vocab(rules_path)
    assert "importante" in vocab
    assert "diferente" in vocab
    assert "real" in vocab
    assert "normalmente" in vocab


def test_extract_lesson_vocab_lowercases_and_strips(fixtures_dir):
    rules_path = fixtures_dir / "lesson_99" / "rules.md"
    vocab = extract_lesson_vocab(rules_path)
    # All entries should be lowercase, no surrounding whitespace
    for word in vocab:
        assert word == word.lower().strip()


def test_allowed_vocab_through_unions_lessons(repo_root, fixtures_dir, monkeypatch):
    # Point allowed_vocab_through at the fixtures dir so we don't depend on real lesson files
    vocab = allowed_vocab_through(99, lessons_dir=fixtures_dir)
    assert "importante" in vocab
