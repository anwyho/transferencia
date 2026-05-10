"""Tests for build/lib/review_sets.py — per-bundle 20-min review-set selection."""
from __future__ import annotations

from build.lib.review_sets import (
    DEFAULT_CAP_SECONDS,
    _estimate_segment_seconds,
    select_segments_for_bundle,
)
from build.lib.types import Card, CardType, Direction, Tier


def _card(
    id: str,
    lessons: list[int],
    *,
    source_file: str = "cards/c_helpers.yml",
    dirs: tuple[Direction, ...] = (Direction.EN_ES, Direction.ES_EN),
    ctype: CardType = CardType.SENTENCE,
) -> Card:
    return Card(
        id=id,
        type=ctype,
        tier=Tier.PRIMARY,
        front_en=f"prompt for {id}",
        back_es=f"respuesta {id}",
        rule_ref="L1#1",
        lessons=list(lessons),
        directions=list(dirs),
        source_file=source_file,
    )


def test_determinism():
    cards = [_card(f"l{n:02d}-{i:03d}", [n]) for n in range(1, 5) for i in range(40)]
    a = select_segments_for_bundle(cards, bundle_lessons=[3, 4], cap_seconds=200.0)
    b = select_segments_for_bundle(cards, bundle_lessons=[3, 4], cap_seconds=200.0)
    assert [s.card_id for s in a] == [s.card_id for s in b]
    assert [s.direction for s in a] == [s.direction for s in b]


def test_direction_balance_70_30():
    cards = [
        _card(f"c-{i:04d}", [3], source_file="cards/c_helpers.yml")
        for i in range(500)
    ]
    segs = select_segments_for_bundle(
        cards, bundle_lessons=[3], cap_seconds=99999.0
    )
    n_en_es = sum(1 for s in segs if s.direction == Direction.EN_ES)
    ratio = n_en_es / len(segs)
    # Per-card hash mod 10 < 7 → uniform Bernoulli. 500 samples gives tight ±0.05.
    assert 0.62 <= ratio <= 0.78


def test_no_card_appears_twice():
    cards = [_card(f"c-{i:04d}", [3]) for i in range(50)]
    segs = select_segments_for_bundle(
        cards, bundle_lessons=[3], cap_seconds=99999.0
    )
    ids = [s.card_id for s in segs]
    assert len(ids) == len(set(ids))


def test_respects_cap_seconds():
    cards = [_card(f"c-{i:04d}", [3]) for i in range(200)]
    cap = 60.0
    segs = select_segments_for_bundle(cards, bundle_lessons=[3], cap_seconds=cap)
    total = sum(_estimate_segment_seconds(s) for s in segs)
    # Should not exceed the cap.
    assert total <= cap + 1.0  # tiny slack for float arith


def test_current_priority_plus_prior_pool():
    current = [_card(f"cur-{i:04d}", [3], source_file="cards/c_helpers.yml")
               for i in range(20)]
    prior = [_card(f"pri-{i:04d}", [1], source_file="cards/a_foundation.yml")
             for i in range(100)]
    segs = select_segments_for_bundle(
        current + prior,
        bundle_lessons=[3],
        cap_seconds=DEFAULT_CAP_SECONDS,
    )
    cur_count = sum(1 for s in segs if s.card_id.startswith("cur-"))
    pri_count = sum(1 for s in segs if s.card_id.startswith("pri-"))
    # All 20 current cards present (well under the 70% budget).
    assert cur_count == 20
    # And the prior budget pulled in some samples.
    assert pri_count > 0


def test_single_direction_card_uses_its_only_direction():
    cards = [
        _card(f"only-en-{i:03d}", [3], dirs=(Direction.EN_ES,))
        for i in range(20)
    ] + [
        _card(f"only-es-{i:03d}", [3], dirs=(Direction.ES_EN,))
        for i in range(20)
    ]
    segs = select_segments_for_bundle(
        cards, bundle_lessons=[3], cap_seconds=99999.0
    )
    for s in segs:
        if s.card_id.startswith("only-en-"):
            assert s.direction == Direction.EN_ES
        elif s.card_id.startswith("only-es-"):
            assert s.direction == Direction.ES_EN


def test_empty_pool_returns_empty():
    segs = select_segments_for_bundle([], bundle_lessons=[3], cap_seconds=100.0)
    assert segs == []


def test_no_prior_cards_when_bundle_a():
    cards = [_card(f"a-{i:03d}", [1], source_file="cards/a_foundation.yml")
             for i in range(30)]
    segs = select_segments_for_bundle(
        cards, bundle_lessons=[1, 2, 3], cap_seconds=DEFAULT_CAP_SECONDS,
    )
    # Every segment must come from the current bundle (no prior exists).
    assert {s.card_id for s in segs} <= {f"a-{i:03d}" for i in range(30)}
