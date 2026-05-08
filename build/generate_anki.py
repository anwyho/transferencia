#!/usr/bin/env python3.11
"""Generate the Transferencia Anki deck from card YAML files.

Two modes:
  --validate-only      parse + check, no .apkg
  (default)            produce dist/transferencia.apkg
  --export-json PATH   also dump cards.json
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running as a script: ensure the repo root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build.lib.parse import load_all_card_files, ParseError  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the Transferencia Anki deck.")
    parser.add_argument("--repo", default=str(REPO_ROOT), help="Repo root (default: auto-detect)")
    parser.add_argument("--out", default="dist/transferencia.apkg", help="Output .apkg path")
    parser.add_argument("--export-json", default=None, help="Also dump cards.json")
    parser.add_argument("--validate-only", action="store_true", help="Validate only, no output")
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()

    try:
        cards = load_all_card_files(repo)
    except ParseError as e:
        print(f"Validation error: {e}", file=sys.stderr)
        return 1
    except Exception as e:  # YAML errors etc.
        print(f"Error: {e}", file=sys.stderr)
        return 2

    print(f"Loaded {len(cards)} cards from {repo}")

    # JSON export (independent of validate-only / .apkg generation)
    if args.export_json:
        import json
        export_path = Path(args.export_json)
        export_path.parent.mkdir(parents=True, exist_ok=True)
        export_path.write_text(
            json.dumps([_card_to_dict(c) for c in cards], ensure_ascii=False, indent=2)
        )
        print(f"Wrote {export_path}")

    if args.validate_only:
        return 0

    from build.lib.anki import build_package
    out = Path(args.out)
    build_package(cards, out)
    print(f"Wrote {out}")
    return 0


def _card_to_dict(c) -> dict:
    return {
        "id": c.id,
        "type": c.type.value,
        "tier": c.tier.value,
        "front_en": c.front_en,
        "back_es": c.back_es,
        "hint": c.hint,
        "rule_ref": c.rule_ref,
        "lessons": c.lessons,
        "directions": [d.value for d in c.directions],
        "notes": c.notes,
    }


if __name__ == "__main__":
    raise SystemExit(main())
