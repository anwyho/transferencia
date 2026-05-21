.PHONY: install test validate coverage anki anki-with-audio flashcards podcast all clean

PYTHON ?= .venv/bin/python

install:
	$(PYTHON) -m pip install -r build/requirements.txt

test:
	$(PYTHON) -m pytest build/tests -v

validate:
	$(PYTHON) build/generate_anki.py --validate-only

coverage:
	$(PYTHON) build/scripts/coverage_audit.py

anki: validate
	$(PYTHON) build/generate_anki.py --out dist/transferencia.apkg

anki-with-audio: validate
	$(PYTHON) build/generate_anki.py --out dist/transferencia.apkg --with-audio --audio-bitrate 48k

flashcards: validate
	$(PYTHON) build/generate_bundle_flashcards.py

podcast:
	$(PYTHON) build/generate_podcast_feed.py

all: anki flashcards podcast

clean:
	@# Uses `trash` (macOS Trash, recoverable) — preserves audio/.cache/ TTS fragments.
	@for f in dist/*.apkg audio/flashcards/*.mp3 podcast.xml; do \
		[ -e "$$f" ] && trash "$$f" || true; \
	done
