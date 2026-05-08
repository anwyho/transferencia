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
    if args.validate_only:
        return 0

    # .apkg generation lives in Task 11.
    print("(.apkg generation not yet implemented - see Task 11)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
