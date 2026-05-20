.PHONY: install test validate coverage anki anki-with-audio review-sets stories validate-stories all clean

PYTHON ?= python3.11

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

review-sets: validate
	$(PYTHON) build/generate_review_sets.py --all

stories:
	$(PYTHON) build/generate_stories.py

validate-stories:
	$(PYTHON) build/generate_stories.py --validate-only

all: anki review-sets stories

clean:
	@# Use `trash` instead of rm -rf — sends files to macOS Trash so deletes are recoverable.
	@# Preserves audio/.cache/ (costly TTS fragments).
	@for f in dist/*.apkg audio/review_set_*.mp3 audio/lesson_*.mp3; do \
		[ -e "$$f" ] && trash "$$f" || true; \
	done
