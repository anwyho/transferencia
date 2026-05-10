"""Per-bundle review-set selection algorithm.

Selects a sequence of audio Segments for a ~20-minute drill track:
~70% of audio time from the current bundle, ~30% from prior bundles
weighted by recency. Direction is biased 70/30 EN→ES via per-card hash,
so the per-card direction is deterministic across runs.

Spec: docs/superpowers/specs/2026-05-10-audio-review-stories-design.md
"""
from __future__ import annotations

import hashlib
import os
import random
from typing import Iterable

from build.lib.audio import Segment, _pause_for
from build.lib.types import Card, Direction

# Empirical TTS rates at pace=1.0 — used only for duration budgeting.
# Tune if review sets consistently come out outside the 17–22 min band.
CHARS_PER_SEC_EN = 16.0
CHARS_PER_SEC_ES = 14.0
MARKER_SECONDS = 0.8       # "Siguiente." marker clip rough length
GAP_SECONDS = 0.5
TRAILING_GAP_SECONDS = 0.5

CURRENT_RATIO = 0.70
DEFAULT_CAP_SECONDS = 1200.0


def _hash_id(card_id: str, salt: str) -> int:
    h = hashlib.sha256(f"{salt}:{card_id}".encode("utf-8")).digest()
    return int.from_bytes(h[:8], "big")


def _pick_direction(card: Card, salt: str) -> Direction | None:
    """One direction per card per set, biased 70/30 EN→ES."""
    if not card.directions:
        return None
    pick_en_es = (_hash_id(card.id, salt) % 10) < 7
    if pick_en_es and Direction.EN_ES in card.directions:
        return Direction.EN_ES
    if Direction.ES_EN in card.directions:
        return Direction.ES_EN
    return card.directions[0]


def _segment_for(card: Card, direction: Direction) -> Segment:
    pause = _pause_for(card)
    if direction == Direction.EN_ES:
        return Segment(
            card_id=card.id, direction=direction,
            prompt_text=card.front_en, prompt_lang="en",
            answer_text=card.back_es, answer_lang="es",
            pause_seconds=pause,
        )
    return Segment(
        card_id=card.id, direction=direction,
        prompt_text=card.back_es, prompt_lang="es",
        answer_text=card.front_en, answer_lang="en",
        pause_seconds=pause,
    )


def _estimate_segment_seconds(seg: Segment) -> float:
    rate_p = CHARS_PER_SEC_ES if seg.prompt_lang == "es" else CHARS_PER_SEC_EN
    rate_a = CHARS_PER_SEC_ES if seg.answer_lang == "es" else CHARS_PER_SEC_EN
    return (
        len(seg.prompt_text) / rate_p
        + seg.pause_seconds
        + len(seg.answer_text) / rate_a
        + GAP_SECONDS
        + MARKER_SECONDS
        + TRAILING_GAP_SECONDS
    )


def _bundle_letter(card: Card) -> str | None:
    """Recover the bundle letter from the card's source_file path."""
    base = os.path.basename(card.source_file or "")
    if not base or "_" not in base:
        return None
    return base.split("_", 1)[0]


def _bucket_cards(
    all_cards: Iterable[Card], bundle_lessons: list[int],
) -> tuple[list[Card], dict[str, list[Card]]]:
    """Split cards into (current_bundle, prior_bundles_by_letter)."""
    lessons_set = set(bundle_lessons)
    current_letter: str | None = None
    # Identify the current bundle's letter by checking first card whose max lesson
    # is in the bundle's lesson set. Used to exclude same-letter cards from prior.
    current: list[Card] = []
    by_letter: dict[str, list[Card]] = {}
    for c in all_cards:
        if max(c.lessons) in lessons_set:
            current.append(c)
            if current_letter is None:
                current_letter = _bundle_letter(c)
        else:
            letter = _bundle_letter(c)
            if letter:
                by_letter.setdefault(letter, []).append(c)
    # Defensive: drop the current bundle's letter from priors if it accidentally
    # appears (e.g. a card whose max lesson sits outside the bundle's set).
    if current_letter and current_letter in by_letter:
        by_letter.pop(current_letter, None)
    return current, by_letter


def _bundle_seed(bundle_lessons: list[int]) -> int:
    s = ",".join(str(x) for x in sorted(bundle_lessons))
    return _hash_id(s, "bundle-seed")


def select_segments_for_bundle(
    all_cards: Iterable[Card],
    *,
    bundle_lessons: list[int],
    cap_seconds: float = DEFAULT_CAP_SECONDS,
) -> list[Segment]:
    """Return the ordered Segment list to render into review_set_<letter>.mp3.

    Algorithm:
      1. Partition cards into current-bundle and prior-bundles-by-letter.
      2. For each card, pick exactly one Segment via direction hash (70/30).
      3. Reserve 0.70 of the cap for current, 0.30 for prior.
      4. Fill current first in deterministic-shuffled order.
      5. Fill prior by weighted bundle sampling (0.50 / 0.30 / 0.20 spread).
      6. Combine and final-shuffle for interleaving.
    """
    all_cards_list = list(all_cards)
    current, prior_by_letter = _bucket_cards(all_cards_list, bundle_lessons)
    seed = _bundle_seed(bundle_lessons)
    salt = f"dir-{seed}"

    current_segments: list[Segment] = []
    for c in current:
        d = _pick_direction(c, salt)
        if d is not None:
            current_segments.append(_segment_for(c, d))
    rng_cur = random.Random(seed ^ 0xCAFE)
    rng_cur.shuffle(current_segments)

    current_budget = cap_seconds * CURRENT_RATIO
    prior_budget = cap_seconds - current_budget

    chosen: list[Segment] = []
    elapsed_current = 0.0
    for seg in current_segments:
        secs = _estimate_segment_seconds(seg)
        if elapsed_current + secs > current_budget:
            continue
        chosen.append(seg)
        elapsed_current += secs

    unused = current_budget - elapsed_current
    if unused > 0:
        prior_budget += unused

    if prior_by_letter and prior_budget > 0:
        sorted_letters = sorted(prior_by_letter.keys())
        weights: dict[str, float] = {}
        n = len(sorted_letters)
        if n == 1:
            weights[sorted_letters[0]] = 1.0
        elif n == 2:
            weights[sorted_letters[-1]] = 0.50
            weights[sorted_letters[-2]] = 0.50
        else:
            weights[sorted_letters[-1]] = 0.50
            weights[sorted_letters[-2]] = 0.30
            rest_share = 0.20 / (n - 2)
            for letter in sorted_letters[:-2]:
                weights[letter] = rest_share

        rng_pri = random.Random(seed ^ 0xBEEF)
        used_ids: set[str] = set()
        elapsed_prior = 0.0
        max_attempts = 10 * sum(len(v) for v in prior_by_letter.values())
        attempts = 0
        while elapsed_prior < prior_budget and attempts < max_attempts:
            attempts += 1
            if all(
                all(c.id in used_ids for c in prior_by_letter[lt])
                for lt in sorted_letters
            ):
                break
            letter = rng_pri.choices(
                sorted_letters,
                weights=[weights[lt] for lt in sorted_letters],
                k=1,
            )[0]
            pool = [c for c in prior_by_letter[letter] if c.id not in used_ids]
            if not pool:
                continue
            card = rng_pri.choice(pool)
            d = _pick_direction(card, salt)
            if d is None:
                used_ids.add(card.id)
                continue
            seg = _segment_for(card, d)
            secs = _estimate_segment_seconds(seg)
            if elapsed_prior + secs > prior_budget:
                used_ids.add(card.id)
                continue
            chosen.append(seg)
            used_ids.add(card.id)
            elapsed_prior += secs

    rng_final = random.Random(seed)
    rng_final.shuffle(chosen)
    return chosen
