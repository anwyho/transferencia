import { contentStore } from './content-loader';

/**
 * The reversible in-memory lesson dial (slice B). One process-global value — fine for
 * the single-user Phase-0 app; slice C makes it a `set_lesson` event folded from the
 * ReviewLog. Capped at the highest seeded home lesson so every step of the dial changes
 * the eligible queue (the production dial will extend to the L30 content ceiling).
 */
const MIN_LESSON = 1;

function maxLesson(): number {
	return contentStore()
		.allRules()
		.reduce((max, rule) => Math.max(max, rule.homeLesson), MIN_LESSON);
}

let currentLesson = MIN_LESSON;

export function getCurrentLesson(): number {
	return currentLesson;
}

export function setCurrentLesson(n: number): number {
	currentLesson = Math.min(maxLesson(), Math.max(MIN_LESSON, Math.floor(n)));
	return currentLesson;
}

export function getMaxLesson(): number {
	return maxLesson();
}
