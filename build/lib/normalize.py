"""Spanish text utilities: accent strip, levenshtein, fuzzy match."""
from __future__ import annotations

import unicodedata


def strip_accents(s: str) -> str:
    """Remove combining accent marks. Preserves ñ → n."""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def levenshtein(a: str, b: str) -> int:
    """Standard Levenshtein edit distance."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            curr[j] = min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
        prev = curr
    return prev[-1]


def fuzzy_match(actual: str, expected: str, *, threshold: float = 0.85) -> bool:
    """Accent-insensitive fuzzy comparison. Returns True if similarity >= threshold.

    Similarity = 1 - (levenshtein / max(len)).
    """
    a = strip_accents(actual.strip().lower())
    e = strip_accents(expected.strip().lower())
    if not a and not e:
        return True
    max_len = max(len(a), len(e))
    if max_len == 0:
        return True
    sim = 1.0 - (levenshtein(a, e) / max_len)
    return sim >= threshold
