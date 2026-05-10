"""Core dataclasses: Card, CardType, Tier, Direction."""
from __future__ import annotations

from dataclasses import dataclass
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


