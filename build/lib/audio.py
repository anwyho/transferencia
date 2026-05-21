"""Audio helpers used by the Anki per-card audio pipeline."""
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
    seg = seg.set_channels(1)
    dst_mp3.parent.mkdir(parents=True, exist_ok=True)
    seg.export(str(dst_mp3), format="mp3", bitrate=bitrate)
    return dst_mp3


def encode_card_audio(text: str, lang: str, *, tts, dst: Path, bitrate: str = "48k") -> Path:
    """Synthesize text, transcode to mono MP3, write to dst. Idempotent."""
    if dst.exists():
        return dst
    wav_path = tts.synth(text, lang)
    seg = AudioSegment.from_file(str(wav_path)).set_channels(1)
    dst.parent.mkdir(parents=True, exist_ok=True)
    seg.export(str(dst), format="mp3", bitrate=bitrate)
    return dst
