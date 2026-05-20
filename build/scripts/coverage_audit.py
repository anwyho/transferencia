#!/usr/bin/env python3
"""Coverage audit: for each bundle, list

  - VOCAB GAPS: vocab words from rules.md that don't appear as back_es anywhere
    in the bundle.
  - CONCEPT GAPS: rules (L<N>#<X>) that have no card pointing at them via rule_ref.
  - PER-RULE CARD COUNT: how many cards per rule, sentence/transformation/conjugation
    breakdown.
"""
from __future__ import annotations

import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

import yaml

ROOT = Path("/Users/anthony.ho/workspace/transferencia")
CARDS = ROOT / "cards"
LESSONS = ROOT / "lessons"


VOCAB_LINE = re.compile(r"^\-\s+\*([^*]+)\*\s*[—-]\s*")
RULE_LINE = re.compile(r"^(\d+)\.\s+(.+)$")
INLINE_SPANISH = re.compile(r"\*([a-záéíóúñüÑ¿?][^*]*?)\*")


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def normalize(s: str) -> str:
    s = strip_accents(s).lower()
    s = re.sub(r"[^a-z0-9ñ ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def extract_vocab_section(text: str) -> list[str]:
    """Return the Spanish words listed under ## Vocabulary in a rules.md."""
    out: list[str] = []
    in_vocab = False
    for line in text.splitlines():
        if line.startswith("## Vocabulary"):
            in_vocab = True
            continue
        if in_vocab and line.startswith("## "):
            break
        if in_vocab:
            m = VOCAB_LINE.match(line)
            if m:
                out.append(m.group(1).strip())
    return out


def extract_rule_ids(text: str) -> set[str]:
    in_rules = False
    out: set[str] = set()
    for line in text.splitlines():
        if line.startswith("## Rules"):
            in_rules = True
            continue
        if in_rules and line.startswith("## "):
            break
        if in_rules:
            m = RULE_LINE.match(line.lstrip())
            if m:
                out.add(m.group(1))
    return out


def load_bundle_cards() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for yml in sorted(CARDS.glob("*.yml")):
        data = yaml.safe_load(yml.read_text())
        out[yml.name] = data.get("cards", [])
    return out


def card_back_normalized(b: str) -> set[str]:
    """Return the set of normalized Spanish tokens appearing in back_es. Lets us
    match short vocab like *a*, *y*, *no* by token rather than full equality."""
    n = normalize(b)
    return set(n.split())


def main() -> int:
    bundle_cards = load_bundle_cards()

    # Build (lesson → bundle file) map from the YAML metadata.
    file_lessons: dict[str, list[int]] = {}
    for fn, cards in bundle_cards.items():
        data = yaml.safe_load((CARDS / fn).read_text())
        file_lessons[fn] = sorted(set(data.get("lessons", [])))

    # All vocab words across all cards in a bundle (full normalized back_es).
    vocab_in_bundle: dict[str, set[str]] = {fn: set() for fn in bundle_cards}
    tokens_in_bundle: dict[str, set[str]] = {fn: set() for fn in bundle_cards}
    rule_refs_in_bundle: dict[str, set[str]] = {fn: set() for fn in bundle_cards}
    by_type: dict[str, dict[str, int]] = {fn: defaultdict(int) for fn in bundle_cards}

    for fn, cards in bundle_cards.items():
        for c in cards:
            b = c.get("back_es", "")
            vocab_in_bundle[fn].add(normalize(b))
            tokens_in_bundle[fn] |= card_back_normalized(b)
            for part in re.split(r"[,;]\s*", c.get("rule_ref", "")):
                if part:
                    rule_refs_in_bundle[fn].add(part.strip())
            by_type[fn][c.get("type", "?")] += 1

    # For each bundle, walk its lessons and check vocab + rule coverage.
    print(f"{'bundle':42}  cards  txn  cnj  sent  vocab-gaps  rule-gaps")
    print("-" * 95)
    for fn in sorted(bundle_cards):
        cards = bundle_cards[fn]
        lessons = file_lessons[fn]

        missing_vocab: list[tuple[int, str]] = []
        missing_rules: list[str] = []
        for ln in lessons:
            rmd = LESSONS / f"lesson_{ln:02d}" / "rules.md"
            if not rmd.exists():
                continue
            text = rmd.read_text()
            vocab = extract_vocab_section(text)
            rules = extract_rule_ids(text)

            # Vocab gap: word doesn't appear as back_es nor as a token of any back_es.
            for w in vocab:
                wn = normalize(w)
                if not wn:
                    continue
                tokens = set(wn.split())
                if wn in vocab_in_bundle[fn]:
                    continue
                if tokens and tokens.issubset(tokens_in_bundle[fn]):
                    continue
                missing_vocab.append((ln, w))

            # Rule gap: rule has no card pointing at it.
            for r in rules:
                ref = f"L{ln}#{r}"
                if ref not in rule_refs_in_bundle[fn]:
                    missing_rules.append(ref)

        bt = by_type[fn]
        print(
            f"{fn:42}  {len(cards):5}  {bt.get('transformation', 0):3}  "
            f"{bt.get('conjugation', 0):3}  {bt.get('sentence', 0):4}  "
            f"{len(missing_vocab):10}  {len(missing_rules):9}"
        )

    # Detail report for the worst offenders.
    print("\n=== TOP VOCAB GAPS PER BUNDLE ===")
    for fn in sorted(bundle_cards):
        cards = bundle_cards[fn]
        lessons = file_lessons[fn]
        missing_vocab: list[tuple[int, str]] = []
        for ln in lessons:
            rmd = LESSONS / f"lesson_{ln:02d}" / "rules.md"
            if not rmd.exists():
                continue
            text = rmd.read_text()
            for w in extract_vocab_section(text):
                wn = normalize(w)
                if not wn:
                    continue
                tokens = set(wn.split())
                if wn in vocab_in_bundle[fn] or (tokens and tokens.issubset(tokens_in_bundle[fn])):
                    continue
                missing_vocab.append((ln, w))
        if missing_vocab:
            print(f"\n{fn} — {len(missing_vocab)} vocab gaps:")
            for ln, w in missing_vocab[:25]:
                print(f"  L{ln}: {w}")
            if len(missing_vocab) > 25:
                print(f"  … +{len(missing_vocab) - 25} more")
    return 0


if __name__ == "__main__":
    sys.exit(main())
