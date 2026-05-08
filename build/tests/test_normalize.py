"""Tests for build.lib.normalize."""
import pytest

from build.lib.normalize import strip_accents, levenshtein, fuzzy_match


@pytest.mark.parametrize("inp,expected", [
    ("difícil", "dificil"),
    ("España", "Espana"),
    ("María", "Maria"),
    ("naturalmente", "naturalmente"),
    ("ñoño", "nono"),
])
def test_strip_accents(inp, expected):
    assert strip_accents(inp) == expected


def test_levenshtein_identical():
    assert levenshtein("hola", "hola") == 0


def test_levenshtein_one_substitution():
    assert levenshtein("hola", "hala") == 1


def test_levenshtein_one_insertion():
    assert levenshtein("hol", "hola") == 1


def test_fuzzy_match_accents_ignored():
    # "diferente" answered, "difərente" (with accent) expected
    assert fuzzy_match("difərente", "diferente", threshold=0.8) is True


def test_fuzzy_match_below_threshold():
    assert fuzzy_match("perro", "gato", threshold=0.8) is False
