"""Core dataclasses: Card, CardType, Tier, Direction, Story."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List


class CardType(str, Enum):
    TRANSFORMATION = "transformation"
    SENTENCE = "sentence"
    CONJUGATION = "conjugation"


class Tier(str, Enum):
    PRIMARY = "primary"
    EXTENDED = "extended"


class Direction(str, Enum):
    EN_ES = "en_es"
    ES_EN = "es_en"


@dataclass(frozen=True)
class Card:
    id: str
    type: CardType
    tier: Tier
    front_en: str
    back_es: str
    rule_ref: str
    lessons: List[int]
    directions: List[Direction]
    hint: str = ""
    notes: str = ""
    source_file: str = ""  # path to the YAML file the card was loaded from


@dataclass(frozen=True)
class Story:
    """Parsed story file."""
    topic: str
    lessons: List[int]
    title: str
    title_en: str
    order: int
    target_minutes: float
    stretch_used_pct: float
    spanish_paragraphs: List[List[str]]  # paragraphs → list of Spanish lines (gloss stripped)
    free_translation: str
    source_file: str = ""
    skip_budget: bool = False  # opt out of vocab-budget enforcement (for free-form stories)
