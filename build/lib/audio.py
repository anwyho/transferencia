"""Audio assembly: silence generation, segment concatenation, MP3 encoding."""
from __future__ import annotations

from pathlib import Path

from pydub import AudioSegment


def silence(seconds: float, dst: Path) -> Path:
    seg = AudioSegment.silent(duration=int(seconds * 1000))
    dst.parent.mkdir(parents=True, exist_ok=True)
    seg.export(str(dst), format="wav")
    return dst


def concat_segments(segments: list[Path], dst: Path) -> Path:
    if not segments:
        raise ValueError("concat_segments: empty list")
    combined = AudioSegment.empty()
    for path in segments:
        combined += AudioSegment.from_file(str(path))
    dst.parent.mkdir(parents=True, exist_ok=True)
    combined.export(str(dst), format="wav")
    return dst


def encode_mp3(src_wav: Path, dst_mp3: Path, *, bitrate: str = "96k") -> Path:
    seg = AudioSegment.from_wav(str(src_wav))
    seg = seg.set_channels(1)  # mono
    dst_mp3.parent.mkdir(parents=True, exist_ok=True)
    seg.export(str(dst_mp3), format="mp3", bitrate=bitrate)
    return dst_mp3


from dataclasses import dataclass

from build.lib.types import Card, CardType, Direction


@dataclass(frozen=True)
class Segment:
    card_id: str
    direction: Direction
    prompt_text: str
    prompt_lang: str       # "en" or "es"
    answer_text: str
    answer_lang: str
    pause_seconds: float


def _pause_for(card: Card) -> float:
    return 5.0 if card.type == CardType.SENTENCE else 3.0


def card_segments(card: Card) -> list[Segment]:
    """Expand a card into one Segment per direction it supports."""
    pause = _pause_for(card)
    out: list[Segment] = []
    for direction in card.directions:
        if direction == Direction.EN_ES:
            out.append(Segment(
                card_id=card.id, direction=direction,
                prompt_text=card.front_en, prompt_lang="en",
                answer_text=card.back_es, answer_lang="es",
                pause_seconds=pause,
            ))
        elif direction == Direction.ES_EN:
            out.append(Segment(
                card_id=card.id, direction=direction,
                prompt_text=card.back_es, prompt_lang="es",
                answer_text=card.front_en, answer_lang="en",
                pause_seconds=pause,
            ))
        elif direction == Direction.SHADOW:
            out.append(Segment(
                card_id=card.id, direction=direction,
                prompt_text=card.back_es, prompt_lang="es",
                answer_text=card.back_es, answer_lang="es",
                pause_seconds=max(pause - 1.0, 1.5),
            ))
    return out


import random
from typing import Iterable


def render_card_track(
    segments: Iterable[Segment],
    *,
    tts,
    dst: Path,
    seed: int,
    pace: float = 1.0,
    trailing_gap: float = 0.5,
) -> Path:
    """Render a list of segments into a single MP3 track.

    Order is shuffled deterministically by `seed` so two runs of the same
    track produce the same shuffle but different tracks vary.
    """
    seg_list = list(segments)
    rng = random.Random(seed)
    rng.shuffle(seg_list)

    work = AudioSegment.empty()
    for seg in seg_list:
        prompt_wav = tts.synth(seg.prompt_text, seg.prompt_lang, pace=pace)
        answer_wav = tts.synth(seg.answer_text, seg.answer_lang, pace=pace)
        work += AudioSegment.from_file(str(prompt_wav))
        work += AudioSegment.silent(duration=int(seg.pause_seconds * 1000))
        work += AudioSegment.from_file(str(answer_wav))
        work += AudioSegment.silent(duration=int(trailing_gap * 1000))

    work = work.set_channels(1)
    dst.parent.mkdir(parents=True, exist_ok=True)
    work.export(str(dst), format="mp3", bitrate="96k")
    return dst
