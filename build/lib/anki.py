"""Anki deck builders: note model, note construction, deck assembly."""
from __future__ import annotations

import hashlib
import re

import genanki

from build.lib.types import Card, CardType, Direction, Tier

# Stable id baked once. Never change.
MODEL_ID = 1735000001
DECK_ID_BASE = 1735000100  # subdeck ids derived from base + hash


_CSS = """
.card {
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  font-size: 26px;
  text-align: center;
  color: #222;
  background: #fafafa;
  padding: 32px 24px;
}
.spanish { font-family: 'Charter', 'Georgia', serif; font-size: 32px; color: #1c4ea0; }
.hint { font-size: 16px; opacity: 0.55; margin-top: 18px; }
.rule-ref { font-size: 13px; color: #888; margin-top: 24px; }
.tier-extended::before { content: "extended"; position: absolute; top: 8px; right: 12px;
                        font-size: 11px; color: #b0b0b0; letter-spacing: 0.05em; }
"""


def _tmpl(name: str, dir_field: str, qfmt: str, afmt: str) -> dict:
    """Build a card template that's only generated when dir_field is set."""
    return {
        "name": name,
        "qfmt": "{{#" + dir_field + "}}\n" + qfmt + "\n{{/" + dir_field + "}}",
        "afmt": "{{#" + dir_field + "}}\n" + afmt + "\n{{/" + dir_field + "}}",
    }


_QFMT_EN_ES = (
    '<div class="english">{{FrontEn}}</div>'
    '{{#Hint}}<div class="hint">({{Hint}})</div>{{/Hint}}'
)
_AFMT_EN_ES = (
    '<div class="english">{{FrontEn}}</div>'
    '<hr>'
    '<div class="spanish">{{BackEs}}</div>'
    '<div class="rule-ref">{{RuleRef}}</div>'
)
_QFMT_ES_EN = (
    '<div class="spanish">{{BackEs}}</div>'
)
_AFMT_ES_EN = (
    '<div class="spanish">{{BackEs}}</div>'
    '<hr>'
    '<div class="english">{{FrontEn}}</div>'
    '<div class="rule-ref">{{RuleRef}}</div>'
)
_QFMT_SHADOW = (
    '<div class="spanish">{{BackEs}}</div>'
    '<div class="hint">(say it back)</div>'
)
_AFMT_SHADOW = (
    '<div class="spanish">{{BackEs}}</div>'
    '<div class="rule-ref">{{RuleRef}}</div>'
)


MODEL = genanki.Model(
    model_id=MODEL_ID,
    name="Transferencia Card",
    fields=[
        {"name": "Id"},
        {"name": "FrontEn"},
        {"name": "BackEs"},
        {"name": "Hint"},
        {"name": "RuleRef"},
        {"name": "Type"},
        {"name": "Tier"},
        {"name": "DirEnEs"},
        {"name": "DirEsEn"},
        {"name": "DirShadow"},
    ],
    templates=[
        _tmpl("EN→ES", "DirEnEs", _QFMT_EN_ES, _AFMT_EN_ES),
        _tmpl("ES→EN", "DirEsEn", _QFMT_ES_EN, _AFMT_ES_EN),
        _tmpl("Shadow", "DirShadow", _QFMT_SHADOW, _AFMT_SHADOW),
    ],
    css=_CSS,
)


def _stable_guid(card_id: str) -> str:
    """Derive a stable Anki guid from card.id. Used as the note's `guid` so
    re-imports preserve scheduling history per card."""
    h = hashlib.sha1(card_id.encode("utf-8")).hexdigest()[:15]
    return h


def _rule_tags(rule_ref: str) -> list[str]:
    """Convert 'L3#1, L2#es-noes' → ['rule::L3-1', 'rule::L2-es-noes']."""
    out = []
    for part in re.split(r"[,;]\s*", rule_ref.strip()):
        if not part:
            continue
        normalized = part.replace("#", "-").strip()
        out.append(f"rule::{normalized}")
    return out


def build_note(card: Card) -> genanki.Note:
    """Build a single Anki note from a Card."""
    dirs = set(d.value for d in card.directions)
    fields = [
        card.id,
        card.front_en,
        card.back_es,
        card.hint,
        _format_rule_ref(card.rule_ref),
        card.type.value,
        card.tier.value,
        "1" if "en_es" in dirs else "",
        "1" if "es_en" in dirs else "",
        "1" if "shadow" in dirs else "",
    ]

    tags: list[str] = []
    for L in card.lessons:
        tags.append(f"lesson::{L:02d}")
    tags.append(f"type::{card.type.value}")
    tags.append(f"tier::{card.tier.value}")
    for d in dirs:
        tags.append(f"direction::{d}")
    tags.extend(_rule_tags(card.rule_ref))
    tags = sorted(set(tags))

    note = genanki.Note(
        model=MODEL,
        fields=fields,
        tags=tags,
        guid=_stable_guid(card.id),
    )
    return note


def _format_rule_ref(rule_ref: str) -> str:
    """'L3#1, L2#es-noes' → '→ L2 · L3'."""
    lessons: list[str] = []
    for part in re.split(r"[,;]\s*", rule_ref.strip()):
        m = re.match(r"L(\d+)", part)
        if m:
            lessons.append(f"L{int(m.group(1))}")
    if not lessons:
        return ""
    return "→ " + " · ".join(sorted(set(lessons), key=lambda s: int(s[1:])))


import re as _re

from pathlib import Path

_TOPIC_FILE_RE = _re.compile(r"^topic_(\d+)_(\d+)_(.+)\.yml$")


def deck_name_for_card(card: Card) -> str:
    """Return the subdeck name a card belongs to.

    - lesson_NN/cards.yml → 'Transferencia::Lesson NN'
    - cards_topical/topic_AA_BB_<theme>.yml → 'Transferencia::Topic::AA-BB <Theme Title>'
    """
    src = Path(card.source_file)
    if src.parent.name.startswith("lesson_"):
        m = _re.match(r"lesson_(\d+)", src.parent.name)
        if m:
            return f"Transferencia::Lesson {int(m.group(1)):02d}"
    if src.parent.name == "cards_topical":
        m = _TOPIC_FILE_RE.match(src.name)
        if m:
            lo, hi = int(m.group(1)), int(m.group(2))
            theme = m.group(3).replace("_", " ").title()
            return f"Transferencia::Topic::{lo:02d}-{hi:02d} {theme}"
    # Fallback: synthesize from lessons[]
    return f"Transferencia::Lesson {card.lessons[0]:02d}"


def build_package(cards: list[Card], out_path: Path) -> None:
    """Build the .apkg from a list of Card objects."""
    decks_by_name: dict[str, genanki.Deck] = {}
    for card in cards:
        deck_name = deck_name_for_card(card)
        if deck_name not in decks_by_name:
            deck_id = DECK_ID_BASE + (
                int(hashlib.sha1(deck_name.encode()).hexdigest()[:8], 16) % 10_000_000
            )
            decks_by_name[deck_name] = genanki.Deck(deck_id, deck_name)
        decks_by_name[deck_name].add_note(build_note(card))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    pkg = genanki.Package(list(decks_by_name.values()))
    pkg.write_to_file(str(out_path))
