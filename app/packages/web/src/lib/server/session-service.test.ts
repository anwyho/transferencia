import { describe, expect, it } from 'vitest';
import { answerSession, startSession } from './session-service';

// A.3 — the in-memory session seam (no persistence yet). It orchestrates the
// domain transformation type for one hardcoded item; slice C backs it with the repo.
describe('in-memory session service (A.3)', () => {
	it('starts a session with a transformation prompt for the hardcoded item', () => {
		const s = startSession();
		expect(s.prompt.instruction).toBe('Translate to Spanish');
		expect(s.prompt.given).toBe('nation');
		expect(s.sessionId).toBeTruthy();
	});

	it('grades a correct answer and reveals the answer (rating good)', () => {
		const s = startSession();
		const r = answerSession({ sessionId: s.sessionId, answer: 'nación', hintRevealed: false });
		expect(r.grade.correct).toBe(true);
		expect(r.rating).toBe('good');
		expect(r.correctAnswer).toBe('nación');
	});

	it('accepts accent-off with a note but no rating penalty', () => {
		const s = startSession();
		const r = answerSession({ sessionId: s.sessionId, answer: 'nacion', hintRevealed: false });
		expect(r.grade.correct).toBe(true);
		expect(r.grade.detail).toMatch(/accent/i);
		expect(r.rating).toBe('good');
	});

	it('grades a wrong answer incorrect (rating again)', () => {
		const s = startSession();
		const r = answerSession({ sessionId: s.sessionId, answer: 'gato', hintRevealed: false });
		expect(r.grade.correct).toBe(false);
		expect(r.rating).toBe('again');
	});

	it('caps the rating at hard when the hint was revealed', () => {
		const s = startSession();
		const r = answerSession({ sessionId: s.sessionId, answer: 'nación', hintRevealed: true });
		expect(r.grade.correct).toBe(true);
		expect(r.rating).toBe('hard');
	});
});
