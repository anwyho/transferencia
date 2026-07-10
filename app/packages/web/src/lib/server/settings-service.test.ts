import { describe, expect, it } from 'vitest';
import { getCurrentLesson, getMaxLesson, setCurrentLesson } from './settings-service';

// The reversible in-memory lesson dial (slice B; slice C moves it to a set_lesson event).
describe('settings service — the lesson dial (B.3)', () => {
	it('max lesson = highest homeLesson in the seed (5)', () => {
		expect(getMaxLesson()).toBe(5);
	});

	it('clamps to [1, max] and floors fractional input', () => {
		expect(setCurrentLesson(3)).toBe(3);
		expect(setCurrentLesson(99)).toBe(5);
		expect(setCurrentLesson(0)).toBe(1);
		expect(setCurrentLesson(2.9)).toBe(2);
	});

	it('is reversible (dial down after up)', () => {
		setCurrentLesson(4);
		expect(getCurrentLesson()).toBe(4);
		setCurrentLesson(2);
		expect(getCurrentLesson()).toBe(2);
	});
});
