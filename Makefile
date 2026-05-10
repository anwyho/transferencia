.PHONY: install test validate anki anki-with-audio cards-json audio audio-quick all clean

PYTHON ?= python3.11

install:
	$(PYTHON) -m pip install -r build/requirements.txt

test:
	$(PYTHON) -m pytest build/tests -v

validate:
	$(PYTHON) build/generate_anki.py --validate-only

anki: validate
	$(PYTHON) build/generate_anki.py --out dist/transferencia.apkg

anki-with-audio: validate
	$(PYTHON) build/generate_anki.py --out dist/transferencia.apkg --with-audio --audio-bitrate 48k

cards-json: validate
	$(PYTHON) build/generate_anki.py --export-json dist/cards.json

audio: validate
	$(PYTHON) build/generate_audio.py --all-tracks

audio-quick: validate
	$(PYTHON) build/generate_audio.py --through 3 --backend mac_say

all: anki cards-json audio

clean:
	@# Use `trash` instead of rm -rf — sends files to macOS Trash so deletes are recoverable.
	@# Preserves audio/.cache/ (costly TTS fragments).
	@for f in dist/*.apkg dist/*.json audio/lesson_*.mp3; do \
		[ -e "$$f" ] && trash "$$f" || true; \
	done
