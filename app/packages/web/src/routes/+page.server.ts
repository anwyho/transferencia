import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	planSession,
	PLANNER_KNOBS,
	ratingFromAssessment,
	seededRng,
	sessionSummary,
	transformationType,
	type Direction,
	type ItemStore
} from '@lt/domain';
import { contentStore } from '$lib/server/content-loader';
import { getRepo } from '$lib/server/db';
import { buildPlannerCtx } from '$lib/server/planner-ctx';
import { computePhase, toRedrillAttempts } from '$lib/server/session-ctx';
import type { DrizzleReviewRepository } from '$lib/server/db/repo';
import { webClock } from '$lib/server/clock';

/**
 * Bounded-session practice (slice D.2). `load` is READ-ONLY: it derives the session phase from the
 * user's persisted state and renders it (main/redrill = a pick; complete/idle = the done/caught-up
 * screen). Session creation lives in `?/start`; `submit` writes `session_end` when the attempt
 * completes the session. No plan/session-plan persistence; no side effects in `load` (this kills
 * the D.1 first-load race).
 */

/** True if the planner can serve at least one instrument now (seed-independent emptiness — fixed seed). */
function servable(
	store: ItemStore,
	repo: DrizzleReviewRepository,
	userId: string,
	now: number
): boolean {
	return !!planSession(buildPlannerCtx(store, repo, userId, now, seededRng(0)), 1)[0];
}

export const load: PageServerLoad = ({ locals }) => {
	const store = contentStore();
	const repo = getRepo();
	const userId = locals.user.id;
	const now = webClock.now();
	const currentLesson = repo.currentLesson(userId);

	// The idle (no active pick) view: the most-recent session's summary (if any) + whether Start shows.
	const idle = () => {
		const last = repo
			.sessions(userId)
			.filter((s) => s.mode === 'practice')
			.at(-1);
		const summary = last
			? sessionSummary(toRedrillAttempts(repo.sessionAttempts(userId, last.id)))
			: null;
		return {
			phase: 'idle' as const,
			sessionId: null,
			itemId: null,
			direction: null,
			prompt: null,
			hint: null,
			starred: false,
			canStart: servable(store, repo, userId, now),
			summary
		};
	};

	const open = repo.currentSession(userId); // latest UNENDED practice session
	if (!open) return idle();

	const phase = computePhase(store, repo, userId, now, open);
	// Rare: an open session that's complete-by-derivation (a non-attempt cause emptied the plan). Render
	// the done screen read-only; the next ?/start ends it before creating the fresh one (design edge).
	if (phase.kind === 'complete') return idle();

	const pick = phase.pick;
	const item = store.get(pick.itemId)!;
	// Salt the render seed (+1) so render randomness never replays the planner's stream.
	const renderCtx = { items: store, currentLesson, rng: seededRng(open.id + 1) };
	const prompt = transformationType.promptRenderer.render(
		item,
		{ direction: pick.direction },
		renderCtx
	);
	return {
		phase: phase.kind, // 'main' | 'redrill'
		sessionId: open.id,
		itemId: item.id,
		direction: pick.direction,
		prompt,
		hint: item.hint ?? null,
		starred: repo.itemExposure(userId, item.id)?.starred ?? false,
		canStart: false,
		summary: null
	};
};

/** Narrow a posted form value to a valid Direction (mirrors content-loader's DIRECTIONS set). */
function isDirection(d: string): d is Direction {
	return d === 'en>es' || d === 'es>en';
}

export const actions: Actions = {
	// Named (not `default`): SvelteKit forbids a default action alongside named actions; the practice
	// form targets ?/submit. `load` renders the next phase after the action re-runs it.
	submit: async ({ request, locals }) => {
		const data = await request.formData();
		const sessionId = Number(data.get('sessionId'));
		const itemId = String(data.get('itemId') ?? '');
		const answer = String(data.get('answer') ?? '');
		const hintRevealed = data.get('hintRevealed') === 'true';
		const direction = String(data.get('direction') ?? 'en>es');

		const store = contentStore();
		const repo = getRepo();
		const item = store.get(itemId);
		if (!item || Number.isNaN(sessionId) || !isDirection(direction)) {
			return fail(400, { error: 'unknown item, session, or direction' });
		}

		// The attempt must land on the user's current OPEN session. A stale/multi-tab form carrying a
		// different (e.g. already-ended) sessionId would otherwise be silently misattributed. Reject on
		// mismatch; the reload re-serves the live session.
		const open = repo.currentSession(locals.user.id);
		if (!open || open.id !== sessionId) {
			return fail(409, { error: 'session no longer active — reload' });
		}

		const grade = transformationType.grader.grade(
			item,
			{ direction },
			{ modality: 'text', text: answer },
			{ items: store }
		);
		const rating = ratingFromAssessment(grade, { hintRevealed });

		const ruleKeys = item.rule_refs
			.filter((r) => r.role === 'tests' && (store.getRule(r.key)?.schedulable ?? false))
			.map((r) => r.key);

		repo.appendAttempt({
			userId: locals.user.id,
			sessionId: open.id,
			itemId,
			ruleKeys,
			exerciseTypeKey: 'transformation',
			paramKey: '',
			direction,
			rating,
			assessment: grade,
			hintRevealed,
			contentHash: item.content_hash ?? ''
		});

		// End-of-session: if this attempt completed the session, write session_end. computePhase reads the
		// LIVE post-append attempt count, so passing the pre-append `open` row here is correct.
		const now = webClock.now();
		if (computePhase(store, repo, locals.user.id, now, open).kind === 'complete') {
			repo.endSession({ userId: locals.user.id, sessionId: open.id, at: now });
		}

		return {
			verdict: grade.correct ? 'correct' : 'incorrect',
			detail: grade.detail ?? null,
			rating,
			answer,
			correctAnswer: item.back_es,
			hintRevealed
		};
	},

	// Start a fresh session: end any lingering open one first (idempotent; handles the rare
	// complete-but-open edge), then create — but only if something is servable (no empty sessions).
	start: ({ locals }) => {
		const store = contentStore();
		const repo = getRepo();
		const userId = locals.user.id;
		const now = webClock.now();
		const open = repo.currentSession(userId);
		if (open) repo.endSession({ userId, sessionId: open.id, at: now });
		if (servable(store, repo, userId, now)) {
			repo.startSession({
				userId,
				mode: 'practice',
				targetAttempts: PLANNER_KNOBS.targetAttempts,
				at: now
			});
		}
	},

	star: async ({ request, locals }) => {
		const itemId = String((await request.formData()).get('itemId') ?? '');
		if (itemId && contentStore().get(itemId)) {
			getRepo().star({ userId: locals.user.id, itemId, at: webClock.now() });
		}
	},

	unstar: async ({ request, locals }) => {
		const itemId = String((await request.formData()).get('itemId') ?? '');
		if (itemId && contentStore().get(itemId)) {
			getRepo().unstar({ userId: locals.user.id, itemId, at: webClock.now() });
		}
	}
};
