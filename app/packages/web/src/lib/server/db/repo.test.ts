import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS, fold, rowToEvent, trivialScheduler, type AttemptInput, type Clock } from '@lt/domain';
import { createTestDb } from './test-db';
import { users } from './schema';

// A controllable clock: appendAttempt stamps `at` from clock.now(); tests move `t`.
let t = 1_700_000_000_000;
const clock: Clock = { now: () => t };

let env: ReturnType<typeof createTestDb>;
beforeEach(() => {
	t = 1_700_000_000_000;
	env = createTestDb(clock);
});
afterEach(() => env.cleanup());

function attempt(over: Partial<AttemptInput> = {}): AttemptInput {
	return {
		userId: 'u1',
		sessionId: 1,
		itemId: 'al-annual',
		ruleKeys: ['L2#conv-al'],
		exerciseTypeKey: 'transformation',
		paramKey: '',
		direction: 'en>es',
		rating: 'good',
		assessment: { correct: true },
		hintRevealed: false,
		contentHash: 'deadbeef',
		...over
	};
}

describe('DrizzleReviewRepository (C.1 integration)', () => {
	it('appendAttempt writes log + rule_state + exposure in one txn', () => {
		const { sessionId } = env.repo.startSession({
			userId: 'u1',
			mode: 'practice',
			targetAttempts: 10,
			at: t
		});
		env.repo.appendAttempt(attempt({ sessionId }));

		const events = env.repo.events('u1');
		const att = events.find((e) => e.kind === 'attempt');
		expect(att).toBeTruthy();
		expect(att!.itemId).toBe('al-annual');
		expect(att!.ruleKeys).toEqual(['L2#conv-al']);
		expect(att!.paramKey).toBe(''); // present, never null (B1)
		expect(att!.direction).toBe('en>es'); // concrete, never 'both'
		expect(att!.contentHash).toBe('deadbeef');
		expect(att!.at).toBe(t);

		const rs = env.repo.ruleStates('u1');
		expect(rs).toHaveLength(1);
		expect(rs[0].ruleKey).toBe('L2#conv-al');
		expect(rs[0].direction).toBe('both'); // M7 sentinel
		expect(rs[0].due).toBe(t + DAY_MS);
		expect(rs[0].firstExposedAt).toBe(t);
		expect(rs[0].blob).toEqual({ last: t });

		const exp = env.repo.itemExposure('u1', 'al-annual');
		expect(exp?.timesSeen).toBe(1);
		expect(exp?.lastRating).toBe('good');
		expect(exp?.known).toBe(false);
		expect(exp?.starred).toBe(false);
	});

	it('a second attempt reschedules due but keeps first_exposed_at, and counts exposure', () => {
		const { sessionId } = env.repo.startSession({
			userId: 'u1',
			mode: 'practice',
			targetAttempts: 10,
			at: t
		});
		env.repo.appendAttempt(attempt({ sessionId }));
		const firstDue = env.repo.ruleStates('u1')[0].due;

		t += 60_000; // one minute later
		env.repo.appendAttempt(attempt({ sessionId, rating: 'again' }));

		const rs = env.repo.ruleStates('u1');
		expect(rs).toHaveLength(1); // still one row (rule is the SRS unit)
		expect(rs[0].firstExposedAt).toBe(1_700_000_000_000); // unchanged
		expect(rs[0].due).toBe(t + DAY_MS);
		expect(rs[0].due).toBeGreaterThan(firstDue);
		expect(env.repo.itemExposure('u1', 'al-annual')?.timesSeen).toBe(2);
	});

	it('dueRuleStates honors the clock cutoff and orders by (due, rule_key)', () => {
		env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(attempt({ ruleKeys: ['L3#conv-mente'] })); // due t+DAY
		t += 1000;
		env.repo.appendAttempt(attempt({ ruleKeys: ['L2#conv-al'] })); // due t+1000+DAY (later)

		expect(env.repo.dueRuleStates('u1', 1_700_000_000_000 + DAY_MS - 1)).toHaveLength(0);
		const dueAll = env.repo.dueRuleStates('u1', 1_700_000_000_000 + DAY_MS + 10_000);
		expect(dueAll.map((r) => r.ruleKey)).toEqual(['L3#conv-mente', 'L2#conv-al']); // by due asc
	});

	it('filters by user_id — a second user never leaks', () => {
		env.db.insert(users).values({ id: 'u2' }).run();
		const s1 = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		const s2 = env.repo.startSession({ userId: 'u2', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(
			attempt({ userId: 'u1', sessionId: s1.sessionId, ruleKeys: ['L2#conv-al'] })
		);
		env.repo.appendAttempt(
			attempt({ userId: 'u2', sessionId: s2.sessionId, ruleKeys: ['L3#conv-mente'] })
		);

		expect(env.repo.ruleStates('u1').map((r) => r.ruleKey)).toEqual(['L2#conv-al']);
		expect(env.repo.ruleStates('u2').map((r) => r.ruleKey)).toEqual(['L3#conv-mente']);
		expect(env.repo.dueRuleStates('u2', t + DAY_MS).map((r) => r.ruleKey)).toEqual([
			'L3#conv-mente'
		]);
		expect(env.repo.events('u1').every((e) => e.userId === 'u1')).toBe(true);
	});

	it('STRICT rejects a wrongly-typed row', () => {
		expect(() =>
			env.sqlite.exec(
				"INSERT INTO rule_state (user_id, rule_key, direction, blob, due, first_exposed_at) VALUES ('u1','k','both','{}','not-an-int', 1)"
			)
		).toThrow(/STRICT|cannot store|datatype/i);
	});

	it('foreign_keys are enforced (a session for a missing user is rejected)', () => {
		expect(() =>
			env.sqlite.exec(
				"INSERT INTO sessions (user_id, started_at, mode, target_attempts) VALUES ('ghost', 1, 'practice', 10)"
			)
		).toThrow(/FOREIGN KEY/i);
	});

	it('session open/close writes events and realized_count', () => {
		const { sessionId } = env.repo.startSession({
			userId: 'u1',
			mode: 'practice',
			targetAttempts: 10,
			at: t
		});
		env.repo.appendAttempt(attempt({ sessionId }));
		env.repo.appendAttempt(attempt({ sessionId }));
		t += 5000;
		env.repo.endSession({ userId: 'u1', sessionId, at: t });

		const kinds = env.repo.events('u1').map((e) => e.kind);
		expect(kinds).toEqual(['session_start', 'attempt', 'attempt', 'session_end']); // (at, id) order
		const row = env.sqlite
			.prepare('SELECT realized_count, ended_at FROM sessions WHERE id = ?')
			.get(sessionId) as { realized_count: number; ended_at: number | null };
		expect(row.realized_count).toBe(2);
		expect(row.ended_at).toBe(t);
	});

	it('setLesson appends a set_lesson event and updates the current_lesson cache', () => {
		expect(env.repo.currentLesson('u1')).toBe(1); // seeded default
		env.repo.setLesson({ userId: 'u1', lesson: 4, at: t });
		expect(env.repo.currentLesson('u1')).toBe(4);
		const ev = env.repo.events('u1').find((e) => e.kind === 'set_lesson');
		expect(ev?.annotationLesson).toBe(4);
		expect(ev?.at).toBe(t);
	});

	it('set_lesson is last-wins on the cache and per-user', () => {
		env.db.insert(users).values({ id: 'u2' }).run();
		env.repo.setLesson({ userId: 'u1', lesson: 4, at: t });
		env.repo.setLesson({ userId: 'u1', lesson: 2, at: t + 1 });
		expect(env.repo.currentLesson('u1')).toBe(2);
		expect(env.repo.currentLesson('u2')).toBe(1); // isolated default
	});

	it('sessions() and itemExposures() read back per-user rows', () => {
		const { sessionId } = env.repo.startSession({
			userId: 'u1',
			mode: 'practice',
			targetAttempts: 10,
			at: t
		});
		env.repo.appendAttempt(attempt({ sessionId, itemId: 'al-annual' }));
		const ss = env.repo.sessions('u1');
		expect(ss).toHaveLength(1);
		expect(ss[0]).toMatchObject({
			id: sessionId,
			mode: 'practice',
			targetAttempts: 10,
			realizedCount: 1,
			endedAt: null
		});
		expect(env.repo.itemExposures('u1').map((e) => e.itemId)).toEqual(['al-annual']);
	});
});

describe('C.2a rebuild proof — fold reproduces the incremental projection', () => {
	const byRule = (a: { ruleKey: string; direction: string }, b: { ruleKey: string; direction: string }) =>
		a.ruleKey.localeCompare(b.ruleKey) || a.direction.localeCompare(b.direction);

	it('deep-equals the live projection under monotonic time', () => {
		const { sessionId } = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(attempt({ sessionId, itemId: 'al-annual', ruleKeys: ['L2#conv-al'], rating: 'good' }));
		env.repo.appendAttempt(attempt({ sessionId, itemId: 'al-normal', ruleKeys: ['L2#conv-al'], rating: 'again' }));
		t += DAY_MS; // monotonic advance
		env.repo.appendAttempt(attempt({ sessionId, itemId: 'al-annual', ruleKeys: ['L2#conv-al'], rating: 'good' }));
		env.repo.appendAttempt(attempt({ sessionId, itemId: 'mente-lento', ruleKeys: ['L3#conv-mente'], rating: 'good' }));
		env.repo.setLesson({ userId: 'u1', lesson: 4, at: t });
		env.repo.endSession({ userId: 'u1', sessionId, at: t + 1000 });

		const state = fold(env.repo.events('u1').map(rowToEvent), { scheduler: trivialScheduler });

		expect(state.currentLesson).toBe(env.repo.currentLesson('u1'));
		expect([...state.ruleStates].sort(byRule)).toEqual([...env.repo.ruleStates('u1')].sort(byRule));
		expect(state.itemExposures).toEqual(env.repo.itemExposures('u1'));
		expect(state.sessions).toEqual(env.repo.sessions('u1'));
	});

	it('folds only the requested user (no cross-user leak)', () => {
		env.db.insert(users).values({ id: 'u2' }).run();
		const s1 = env.repo.startSession({ userId: 'u1', mode: 'practice', targetAttempts: 10, at: t });
		const s2 = env.repo.startSession({ userId: 'u2', mode: 'practice', targetAttempts: 10, at: t });
		env.repo.appendAttempt(attempt({ userId: 'u1', sessionId: s1.sessionId, ruleKeys: ['L2#conv-al'] }));
		env.repo.appendAttempt(attempt({ userId: 'u2', sessionId: s2.sessionId, ruleKeys: ['L3#conv-mente'] }));

		const u1 = fold(env.repo.events('u1').map(rowToEvent), { scheduler: trivialScheduler });
		expect(u1.ruleStates.map((r) => r.ruleKey)).toEqual(['L2#conv-al']);
	});
});
