import {
	isVisible,
	planSession,
	PLANNER_KNOBS,
	redrillQueue,
	rowToEvent,
	seededRng,
	sessionPhase,
	type ItemStore,
	type Phase,
	type RedrillAttempt,
	type ReviewLogRow,
	type SessionRow
} from '@lt/domain';
import { buildPlannerCtx } from './planner-ctx';
import type { DrizzleReviewRepository } from './db/repo';

/**
 * Map this session's attempt log rows to the pure re-drill/summary projection via the domain's
 * `rowToEvent` narrowing, which THROWS on a null in a kind-required column — surfacing corruption
 * loudly instead of folding a type-lying value into the completion decision. (The population
 * guarantee comes from the `appendAttempt` write path; the caller's `sessionAttempts` filter only
 * excludes other kinds. An AttemptEvent structurally satisfies the RedrillAttempt Pick.)
 */
export function toRedrillAttempts(rows: ReviewLogRow[]): RedrillAttempt[] {
	return rows.map(rowToEvent).map((e) => {
		if (e.kind !== 'attempt') throw new Error(`toRedrillAttempts: non-attempt row kind=${e.kind}`);
		return e; // AttemptEvent <: RedrillAttempt
	});
}

/**
 * The single completion decision, shared by the practice route's `load` (render) and `submit`
 * (end-on-complete). Composes the planner greedy head + the re-drill queue + sessionPhase from the
 * user's current persisted state. Pure inputs in; a Phase out.
 */
export function computePhase(
	store: ItemStore,
	repo: DrizzleReviewRepository,
	userId: string,
	now: number,
	open: SessionRow
): Phase {
	if (open.userId !== userId) {
		throw new Error(`computePhase: session ${open.id} belongs to ${open.userId}, not ${userId}`);
	}
	const currentLesson = repo.currentLesson(userId);
	const head =
		planSession(buildPlannerCtx(store, repo, userId, now, seededRng(open.id)), 1)[0] ?? null;
	const isEligible = (itemId: string) => {
		const it = store.get(itemId);
		return !!it && isVisible(it, currentLesson);
	};
	const attempts = repo.sessionAttempts(userId, open.id);
	const redrill = redrillQueue(toRedrillAttempts(attempts), isEligible, {
		redrillMaxMissesPerInstrument: PLANNER_KNOBS.redrillMaxMissesPerInstrument
	});
	// realized_count == this session's attempt-row count (appendAttempt writes both in one txn, sole
	// writer). Use the LIVE count, not open.realizedCount, so load + submit can't diverge on a stale row.
	return sessionPhase({
		realizedCount: attempts.length,
		targetAttempts: open.targetAttempts,
		head,
		redrill
	});
}
