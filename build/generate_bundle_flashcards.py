#!/usr/bin/env python3.11
"""Render per-bundle flashcard MP3s into audio/flashcards/.

Three exercise shapes:
  1. EN→ES sentence/transformation: English prompt → Spanish answer.
  2. ES→EN sentence/transformation: Spanish prompt → English answer.
  3. Conjugation: spliced "Conjugate the <pronoun> form for <english>." (EN) +
     "<spanish verb>." (ES) → answer "<conj>. <conj> means <english gloss>."

Speech rules:
  - Spanish synthesized at slower pace.
  - Spanish sentence prompts are spoken twice with a long pause between.
  - All other prompts and all answers are spoken once.

Output: each bundle's deck is shuffled then split into ≤30-min parts at
audio/flashcards/bundle_<letter>_pt<NN>.mp3. Files get ID3 tags so podcast
clients display them nicely.
"""
from __future__ import annotations

import argparse
import os
import random
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydub import AudioSegment  # noqa: E402

from build.lib.parse import load_all_card_files  # noqa: E402
from build.lib.tts.factory import make_tts  # noqa: E402
from build.lib.types import Card, CardType, Direction  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]

# Pacing
PACE_EN = 1.0
PACE_ES = 0.85  # slower so Spanish is clearer

# Gaps (ms)
SPLICE_GAP_MS = 200
SENTENCE_REPEAT_GAP_MS = 2200
CONJ_ANSWER_RESTATE_GAP_MS = 600
PROMPT_TO_ANSWER_SECS = {
    CardType.SENTENCE: 5.0,
    CardType.CONJUGATION: 4.0,
    CardType.TRANSFORMATION: 3.0,
}
ANSWER_TO_DING_MS = 1300
DING_TO_NEXT_MS = 600

MAX_PART_MS = 30 * 60 * 1000


@dataclass
class Chunk:
    text: str
    lang: str  # "en" or "es"
    pre_gap_ms: int = SPLICE_GAP_MS


@dataclass
class Exercise:
    card: Card
    prompt_chunks: list[Chunk]
    answer_chunks: list[Chunk]
    pause_ms: int
    repeat_prompt: bool = False
    repeat_gap_ms: int = SENTENCE_REPEAT_GAP_MS


def _bundle_letter(card: Card) -> str | None:
    base = os.path.basename(card.source_file or "")
    if "_" not in base:
        return None
    return base.split("_", 1)[0]


def _bundle_theme(card: Card) -> str:
    """Title-case theme from cards/<letter>_<theme>.yml (drops .yml)."""
    base = os.path.basename(card.source_file or "")
    stem = base.rsplit(".", 1)[0]  # drop .yml
    if "_" not in stem:
        return stem.upper()
    _, theme = stem.split("_", 1)
    return theme.replace("_", " ").title()


def _english_meaning_from_hint(hint: str) -> str | None:
    """Pull the base English verb phrase from a conjugation card's hint.
    Hints conventionally lead with 'to <verb>'; anything else returns None."""
    if not hint:
        return None
    first = hint.split("·")[0].strip().strip("'\"`")
    if first.lower().startswith("to "):
        return first[3:].strip(" .")
    return None


def _split_conjugation_prompt(text: str) -> tuple[str, str] | None:
    """Return (descriptor, spanish_verb) for '<descriptor> form of <verb>'."""
    if " form of " not in text:
        return None
    descriptor, verb = text.split(" form of ", 1)
    descriptor = descriptor.replace("-", " ").strip()
    return descriptor, verb.strip(" .")


_IRREG_3RD = {"have": "has", "do": "does", "go": "goes", "be": "is"}


def _third_singular(verb: str) -> str:
    v = verb.strip().lower()
    if v in _IRREG_3RD:
        return _IRREG_3RD[v]
    if v.endswith(("s", "sh", "ch", "x", "z")):
        return v + "es"
    if len(v) > 1 and v.endswith("y") and v[-2] not in "aeiou":
        return v[:-1] + "ies"
    return v + "s"


def _english_gloss(descriptor: str, base_verb: str) -> str | None:
    """Best-effort English meaning for a conjugated form.

    Returns None on tenses we can't render cleanly (preterite, subjunctive,
    irregular contracted forms); the caller should omit the 'means …' segment
    in that case so we don't speak nonsense.
    """
    d = descriptor.lower().strip()

    # Tenses we don't try to render in English.
    bail = (
        "point-past", "past-point", "point past",
        "past mood", "past-mood",
        "mood",
        "(would", "(vos", "(vosotros",
        "should", "could", "would", "will",
        "have", "give",
    )
    if any(token in d for token in bail):
        return None

    modal: str | None = None
    if "conditional" in d:
        modal = "would"
        d = d.replace("conditional", "").strip()
    elif "future" in d:
        modal = "will"
        d = d.replace("future", "").strip()
    elif "line-past" in d or "line past" in d:
        modal = "used to"
        d = d.replace("line-past", "").replace("line past", "").strip()

    # Pronoun phrase → English subject + person.
    if "vosotros" in d or "you-all" in d:
        subject, third = "you all", False
    elif d.startswith("they") or "they/you" in d or "they / you" in d:
        subject, third = "they", False
    elif d.startswith("we"):
        subject, third = "we", False
    elif d in ("he", "she") or d.startswith("he/") or d.startswith("she/"):
        subject, third = "he", True
    elif d.startswith("you guys"):
        subject, third = "you all", False
    elif d.startswith("you"):
        subject, third = "you", False
    elif d == "i" or d.startswith("i "):
        subject, third = "I", False
    else:
        return None

    if modal:
        return f"{subject} {modal} {base_verb}"
    if third:
        return f"{subject} {_third_singular(base_verb)}"
    return f"{subject} {base_verb}"


def _exercises_for_card(card: Card) -> list[Exercise]:
    pause_ms = int(PROMPT_TO_ANSWER_SECS.get(card.type, 3.0) * 1000)
    out: list[Exercise] = []

    if card.type == CardType.CONJUGATION:
        parsed = _split_conjugation_prompt(card.front_en)
        if parsed is None:
            return []
        descriptor, verb_es = parsed
        en_meaning = _english_meaning_from_hint(card.hint)

        # Prompt deliberately keeps the verb in Spanish only — exercise is
        # "conjugate this Spanish verb"; the English meaning is revealed in
        # the answer block, after a pause, as a self-test on the meaning.
        prompt_chunks = [
            Chunk(f"Conjugate the {descriptor} form for", "en"),
            Chunk(f"{verb_es}.", "es"),
        ]

        conj = card.back_es.strip().strip(".")
        gloss = _english_gloss(descriptor, en_meaning) if en_meaning else None
        answer_chunks = [Chunk(f"{conj}.", "es")]
        if gloss:
            answer_chunks.append(
                Chunk(conj, "es", pre_gap_ms=CONJ_ANSWER_RESTATE_GAP_MS),
            )
            answer_chunks.append(Chunk(f"means {gloss}.", "en"))

        out.append(Exercise(card, prompt_chunks, answer_chunks, pause_ms))
        return out

    # Sentence / transformation: keep both directions when the card has them.
    for direction in card.directions:
        if direction == Direction.EN_ES:
            prompt = [Chunk(card.front_en, "en")]
            answer = [Chunk(card.back_es, "es")]
            repeat = False
        elif direction == Direction.ES_EN:
            prompt = [Chunk(card.back_es, "es")]
            answer = [Chunk(card.front_en, "en")]
            repeat = card.type == CardType.SENTENCE
        else:
            continue
        out.append(Exercise(card, prompt, answer, pause_ms, repeat_prompt=repeat))
    return out


def _synth_chunks(tts, chunks: list[Chunk]) -> AudioSegment:
    work = AudioSegment.empty()
    for i, c in enumerate(chunks):
        if i > 0 and c.pre_gap_ms > 0:
            work += AudioSegment.silent(duration=c.pre_gap_ms)
        pace = PACE_ES if c.lang == "es" else PACE_EN
        wav = tts.synth(c.text, c.lang, pace=pace)
        work += AudioSegment.from_file(str(wav))
    return work


def _render_one_exercise(tts, ex: Exercise, marker: AudioSegment) -> AudioSegment:
    prompt_audio = _synth_chunks(tts, ex.prompt_chunks)
    answer_audio = _synth_chunks(tts, ex.answer_chunks)

    work = AudioSegment.empty()
    work += prompt_audio
    if ex.repeat_prompt:
        work += AudioSegment.silent(duration=ex.repeat_gap_ms)
        work += prompt_audio
    work += AudioSegment.silent(duration=ex.pause_ms)
    work += answer_audio
    work += AudioSegment.silent(duration=ANSWER_TO_DING_MS)
    work += marker
    work += AudioSegment.silent(duration=DING_TO_NEXT_MS)
    return work


def _ensure_marker(audio_dir: Path) -> AudioSegment:
    """E-major-7 chord chime (E5 + G#5 + B5 + D#6), 600ms with soft fade.
    Slightly dreamier sound than a plain triad — works as a card boundary."""
    marker_dst = audio_dir / ".cache" / "marker_ding.mp3"
    marker_dst.parent.mkdir(parents=True, exist_ok=True)
    if not marker_dst.exists():
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "lavfi", "-i", "sine=frequency=659.25:duration=0.6",
                "-f", "lavfi", "-i", "sine=frequency=830.61:duration=0.6",
                "-f", "lavfi", "-i", "sine=frequency=987.77:duration=0.6",
                "-f", "lavfi", "-i", "sine=frequency=1244.51:duration=0.6",
                "-filter_complex",
                "[0]afade=t=out:st=0.1:d=0.5[a];"
                "[1]afade=t=out:st=0.1:d=0.5[b];"
                "[2]afade=t=out:st=0.1:d=0.5[c];"
                "[3]afade=t=out:st=0.1:d=0.5[d];"
                "[a][b][c][d]amix=inputs=4:normalize=0,volume=0.6",
                "-ar", "22050", "-ac", "1", str(marker_dst),
            ],
            check=True, capture_output=True,
        )
    return AudioSegment.from_file(str(marker_dst))


def _tag_mp3(path: Path, title: str, album: str, track: int, total: int) -> None:
    from mutagen.easyid3 import EasyID3
    from mutagen.id3 import ID3NoHeaderError
    try:
        tags = EasyID3(str(path))
    except ID3NoHeaderError:
        tags = EasyID3()
        tags.save(str(path))
        tags = EasyID3(str(path))
    tags["title"] = title
    tags["album"] = album
    tags["artist"] = "Transferencia"
    tags["albumartist"] = "Transferencia"
    tags["genre"] = "Education"
    tags["tracknumber"] = f"{track}/{total}"
    tags.save(str(path))


def _export_part(work: AudioSegment, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    work.set_channels(1).export(str(dst), format="mp3", bitrate="96k")


def _render_bundle(*, cards: list[Card], tts, marker: AudioSegment,
                   audio_dir: Path, letter: str, seed: int) -> list[Path]:
    exercises: list[Exercise] = []
    for c in cards:
        exercises.extend(_exercises_for_card(c))

    rng = random.Random(seed)
    rng.shuffle(exercises)

    rendered = [_render_one_exercise(tts, ex, marker) for ex in exercises]

    parts: list[AudioSegment] = []
    cur = AudioSegment.empty()
    for piece in rendered:
        if len(cur) > 0 and len(cur) + len(piece) > MAX_PART_MS:
            parts.append(cur)
            cur = AudioSegment.empty()
        cur += piece
    if len(cur) > 0:
        parts.append(cur)

    # Avoid stub trailing parts (< 5 min) by folding them back into the prior
    # part. Result may run a few minutes over MAX_PART_MS; acceptable.
    min_tail_ms = 5 * 60 * 1000
    if len(parts) > 1 and len(parts[-1]) < min_tail_ms:
        parts[-2] = parts[-2] + parts[-1]
        parts.pop()

    total = len(parts)
    paths: list[Path] = []
    theme = _bundle_theme(cards[0])
    prefix = letter.upper()
    album = f"Transferencia — {prefix} {theme}"
    out_dir = audio_dir / "flashcards"
    for idx, part in enumerate(parts, start=1):
        dst = out_dir / f"{prefix}{idx} {theme}.mp3"
        _export_part(part, dst)
        title = f"{prefix}{idx} {theme}"
        _tag_mp3(dst, title=title, album=album, track=idx, total=total)
        paths.append(dst)
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render per-bundle flashcard MP3s.")
    parser.add_argument("--repo", default=str(REPO_ROOT))
    parser.add_argument("--audio-dir", default=str(REPO_ROOT / "audio"))
    parser.add_argument(
        "--bundle", action="append", default=None,
        help="Bundle letter (a, b, ...). Repeatable. Default: all built bundles.",
    )
    parser.add_argument("--backend", default=None)
    parser.add_argument("--voice-es", default=None)
    parser.add_argument("--voice-en", default=None)
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    audio_dir = Path(args.audio_dir).resolve()
    cache_dir = audio_dir / ".cache"

    cards = load_all_card_files(repo)
    groups: dict[str, list[Card]] = {}
    for c in cards:
        letter = _bundle_letter(c)
        if letter:
            groups.setdefault(letter, []).append(c)
    if not groups:
        print("No bundle cards found.", file=sys.stderr)
        return 1

    tts = make_tts(
        args.backend, cache_dir=cache_dir,
        voice_es=args.voice_es, voice_en=args.voice_en,
    )
    marker = _ensure_marker(audio_dir)

    target = [b.lower() for b in (args.bundle or sorted(groups.keys()))]
    for letter in target:
        if letter not in groups:
            print(f"bundle {letter}: not built, skipping")
            continue
        paths = _render_bundle(
            cards=groups[letter], tts=tts, marker=marker,
            audio_dir=audio_dir, letter=letter,
            seed=hash(letter) & 0xFFFFFFFF,
        )
        for p in paths:
            secs = AudioSegment.from_file(str(p)).duration_seconds
            print(f"Wrote {p} ({secs/60:.1f} min)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
