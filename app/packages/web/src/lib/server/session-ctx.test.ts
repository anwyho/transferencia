import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLANNER_KNOBS, type AttemptInput, type Clock } from '@lt/domain';
import { createTestDb } from './db/test-db';
import { contentStore } from './content-loader';
import { computePhase } from './session-ctx';

let t = 1_700_000_000_000;
const clock: Clock = { now: () => t };
let env: ReturnType<typeof createTestDb>;
const store = contentStore();

beforeEach(() => {
	t = 1_700_000_000_000;
	env = createTestDb(clock);
	env.repo.setLesson({ userId: 'u1', lesson: 2, at: t }); // lesson 2 -> the single rule L2#conv-al
});
afterEach(() => env.cleanup());

function open() {
	return env.repo.currentSession('u1')!;
}
// All L2#conv-al items are en>es-only in the seed content, so every crafted attempt uses en>es —
// the same instruments the real planner/route serves. Distinct instruments = distinct itemIds.
function append(itemId: string, rating: AttemptInput['rating']) {
	env.repo.appendAttempt({
		userId: 'u1',
		sessionId: open().id,
		itemId,
		ruleKeys: ['L2#conv-al'],
		exerciseTypeKey: 'transformation',
		paramKey: '',
		direction: 'en>es',
		rating,
		assessment: { correct: rating !== 'again' },
		hintRevealed: false,
		contentHash: ''
	});
}

describe('computePhase (lifecycle integration)', () => {
	it('main on a fresh servable session serves a real L2 instrument', () => {
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		const phase = computePhase(store, env.repo, 'u1', t, open());
		expect(phase.kind).toBe('main');
		if (phase.kind !== 'main') return;
		expect(phase.pick.ruleKey).toBe('L2#conv-al');
		expect(phase.pick.direction).toBe('en>es');
		expect(phase.pick.itemId.startsWith('al-')).toBe(true);
	});

	it('complete once the budget is spent with no unresolved miss', () => {
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		for (let i = 0; i < PLANNER_KNOBS.targetAttempts; i++) append('al-annual', 'good');
		expect(computePhase(store, env.repo, 'u1', t, open()).kind).toBe('complete');
	});

	it('re-drill once the budget is spent with an unresolved miss (distinct real instrument)', () => {
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		for (let i = 0; i < PLANNER_KNOBS.targetAttempts - 1; i++) append('al-annual', 'good');
		append('al-legal', 'again'); // realized == target; al-legal missed once -> unresolved
		const phase = computePhase(store, env.repo, 'u1', t, open());
		expect(phase.kind).toBe('redrill');
		if (phase.kind !== 'redrill') return;
		expect(phase.pick.itemId).toBe('al-legal');
		expect(phase.pick.direction).toBe('en>es');
	});

	it('re-drill resolves to complete after a correct re-attempt', () => {
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		for (let i = 0; i < PLANNER_KNOBS.targetAttempts - 1; i++) append('al-annual', 'good');
		append('al-legal', 'again');
		append('al-legal', 'good'); // latest on al-legal now non-again -> resolved
		expect(computePhase(store, env.repo, 'u1', t, open()).kind).toBe('complete');
	});

	it('complete on a caught-up session (plan empty before budget -> null head)', () => {
		env.repo.setLesson({ userId: 'u1', lesson: 1, at: t }); // lesson 1 teaches no Spanish -> no eligible rule
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		expect(computePhase(store, env.repo, 'u1', t, open()).kind).toBe('complete');
	});

	it('drops a re-drill whose item was gated out by a lowered dial -> complete', () => {
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		for (let i = 0; i < PLANNER_KNOBS.targetAttempts - 1; i++) append('al-annual', 'good');
		append('al-legal', 'again'); // a real miss at lesson 2
		env.repo.setLesson({ userId: 'u1', lesson: 1, at: t }); // al-legal (min_lesson 2) now invisible
		expect(computePhase(store, env.repo, 'u1', t, open()).kind).toBe('complete');
	});

	it('re-drills the earliest miss first (timestamps flow through to ordering)', () => {
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		for (let i = 0; i < PLANNER_KNOBS.targetAttempts - 2; i++) append('al-annual', 'good');
		append('al-natural', 'again'); // earlier miss (at t)
		t += 60_000;
		append('al-legal', 'again'); // later miss (at t + 60000)
		const phase = computePhase(store, env.repo, 'u1', t, open());
		expect(phase.kind).toBe('redrill');
		if (phase.kind !== 'redrill') return;
		expect(phase.pick.itemId).toBe('al-natural'); // earliest-first-miss
	});
});
