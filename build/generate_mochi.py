"""Render Mochi-friendly CSV exports grouped by bundle.

Output layout:

  dist/mochi/
    Bundle_A_Foundation/
      reversible.csv      ← cards with directions=[en_es, es_en]
      one_way.csv         ← cards with directions=[en_es] only (skipped if empty)
    Bundle_B_Verb_Unlock/
      reversible.csv
      one_way.csv
    ...

Import each file into a matching Mochi deck/subdeck:

    Transferencia
    ├── Bundle A Foundation
    │   ├── reversible    ← toggle "Review cards in reverse" ON
    │   └── one_way       ← leave reverse OFF
    ├── Bundle B Verb Unlock
    │   ├── reversible
    │   └── one_way
    ...

Why: Mochi has no per-card import flag for reverse review. The toggle is set at
the deck level. Splitting reversible vs one-way into separate subdecks lets each
behave correctly.
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from build.lib.parse import load_all_card_files  # noqa: E402
from build.lib.types import Card  # noqa: E402


# Letter → display name. Mirrors the lesson-bundles.md table.
BUNDLE_NAMES = {
    "A": "Foundation",
    "B": "Verb Unlock",
    "C": "Helpers + Saber",
    "D": "Present + -Go Family",
    "E": "Spine + Vowel Splits",
    "F": "We Form + Future Context",
    "G": "Haber-Past + Reflexive",
    "H": "Indirect Pronouns + Dar",
    "I": "Agreement + Ser/Estar",
    "J": "Full Ser + Flexible Adjectives",
    "K": "Gerund + Future Tense",
    "L": "Pronoun Migration + Reflexive Se",
    "M": "Conditional + Gustar",
    "N": "Gender Exceptions + Line-Past Intro",
    "Ñ": "Line-Past Full",
    "O": "Para vs Por + Pluperfect",
    "P": "Irregular Participles + Relatives",
    "Q": "Point-Past Intro",
    "R": "Past in Context + Dar",
    "S": "Hace + Possessives + Accents",
    "T": "Demonstratives + Mood Intro",
    "U": "Mood Triggers + Commands",
    "V": "Mood Expansion",
    "W": "Seguir + Ojalá + Uses of Se",
    "X": "Past Mood Tense",
    "Y": "Go-Verbs + Future Contractions",
    "Z": "Closeout + Dialects",
}

# Sort order for bundle letters (Spanish-alphabet position: A B C … N Ñ O P …).
BUNDLE_ORDER = list(BUNDLE_NAMES.keys())


def _bundle_letter_for(card: Card) -> str:
    base = os.path.basename(card.source_file or "")
    if "_" not in base:
        return "?"
    prefix = base.split("_", 1)[0]
    return "Ñ" if prefix == "nn" else prefix.upper()


def _bundle_dir_name(letter: str) -> str:
    name = BUNDLE_NAMES.get(letter, "?")
    safe = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_")
    return f"Bundle_{letter}_{safe}"


def _row(card: Card) -> dict[str, str]:
    return {
        "front": card.front_en,
        "back": card.back_es,
        "id": card.id,
        "type": card.type.value,
        "tier": card.tier.value,
        "hint": card.hint,
        "rule_ref": card.rule_ref,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Render Mochi CSV exports.")
    parser.add_argument("--repo", default=str(REPO))
    parser.add_argument("--out-dir", default=None)
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    out_dir = Path(args.out_dir) if args.out_dir else repo / "dist" / "mochi"
    out_dir.mkdir(parents=True, exist_ok=True)

    cards = load_all_card_files(repo)

    # Partition: cards[bundle][rev|oneway]
    grouped: dict[str, dict[str, list[Card]]] = {}
    for c in cards:
        letter = _bundle_letter_for(c)
        ds = {d.value for d in c.directions}
        bucket = "reversible" if ("en_es" in ds and "es_en" in ds) else "one_way"
        grouped.setdefault(letter, {"reversible": [], "one_way": []})[bucket].append(c)

    columns = ("front", "back", "id", "type", "tier", "hint", "rule_ref")
    total_rev = 0
    total_one = 0
    files_written = 0

    def write(path: Path, rows: list[Card]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=columns)
            w.writeheader()
            for c in rows:
                w.writerow(_row(c))

    for letter in BUNDLE_ORDER:
        buckets = grouped.get(letter)
        if not buckets:
            continue
        dir_name = _bundle_dir_name(letter)
        bundle_dir = out_dir / dir_name
        rev = buckets["reversible"]
        one = buckets["one_way"]
        if rev:
            p = bundle_dir / "reversible.csv"
            write(p, rev)
            print(f"  {p.relative_to(out_dir)} ({len(rev)} cards)")
            total_rev += len(rev)
            files_written += 1
        if one:
            p = bundle_dir / "one_way.csv"
            write(p, one)
            print(f"  {p.relative_to(out_dir)} ({len(one)} cards)")
            total_one += len(one)
            files_written += 1

    # Stale-file cleanup: drop legacy flat exports if present.
    for legacy in ("transferencia_reversible.csv", "transferencia_one_way.csv"):
        f = out_dir / legacy
        if f.exists():
            f.unlink()

    print(
        f"Wrote {files_written} CSV(s) in {out_dir.relative_to(repo)}/ "
        f"({total_rev} reversible + {total_one} one-way = {total_rev + total_one} cards)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
