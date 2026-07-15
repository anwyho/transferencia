import type { Actions, PageServerLoad } from './$types';
import {
	eligibleItems,
	eligibleRules,
	masteryReady,
	planSession,
	PLANNER_KNOBS,
	redrillQueue,
	seededRng
} from '@lt/domain';
import { contentStore, maxLesson } from '$lib/server/content-loader';
import { getRepo } from '$lib/server/db';
import { clockNow } from '$lib/server/clock';
import { buildPlannerCtx } from '$lib/server/planner-ctx';
import { isItemEligible, toRedrillAttempts } from '$lib/server/session-ctx';

export const load: PageServerLoad = ({ locals }) => {
	const store = contentStore();
	const repo = getRepo();
	const currentLesson = repo.currentLesson(locals.user.id);
	const now = clockNow();
	// Current-session panel (D.2 lifecycle observability): the latest practice session + its re-drill
	// queue. Deliberately NOT `repo.currentSession` (unended-only): the panel must keep showing the
	// just-ended session until the next ?/start, mirroring the root route's `idle()` last-session read.
	const lastSession = repo
		.sessions(locals.user.id)
		.filter((s) => s.mode === 'practice')
		.at(-1);
	// For an ENDED session this queue is historical/observability only — those misses resurface via
	// the next session's normal due/weak flow, they are not re-drilled inside the closed session.
	const sessionRedrill = lastSession
		? redrillQueue(
				toRedrillAttempts(repo.sessionAttempts(locals.user.id, lastSession.id)),
				isItemEligible(store, currentLesson),
				{ redrillMaxMissesPerInstrument: PLANNER_KNOBS.redrillMaxMissesPerInstrument }
			).map((i) => ({ itemId: i.itemId, direction: i.direction }))
		: [];
	return {
		currentLesson,
		maxLesson: maxLesson(),
		// Defined ordering (min_lesson, id) comes from the domain LessonGate.
		items: eligibleItems(store, currentLesson).map((i) => ({
			id: i.id,
			front_en: i.front_en,
			back_es: i.back_es,
			min_lesson: i.min_lesson,
			rule_keys: i.rule_refs.filter((r) => r.role === 'tests').map((r) => r.key)
		})),
		rules: eligibleRules(store, currentLesson).map((r) => ({
			key: r.key,
			homeLesson: r.homeLesson
		})),
		// Durable scheduled-rules panel (C.1); C.2c adds the advisory mastery meter (never affects due).
		scheduledRules: repo.ruleStates(locals.user.id).map((r) => ({
			ruleKey: r.ruleKey,
			direction: r.direction,
			dueAt: r.due,
			dueNow: r.due <= now,
			mastery: r.mastery,
			coverage: r.coverage,
			mastered: masteryReady({
				ewma: r.mastery,
				instruments: r.seenInstruments,
				successDays: r.successDays
			})
		})),
		// Deterministic planner preview (fixed seed) — the planned session at the current state.
		plannedQueue: planSession(
			buildPlannerCtx(store, repo, locals.user.id, now, seededRng(1)),
			PLANNER_KNOBS.targetAttempts
		).map((inst) => ({ ruleKey: inst.ruleKey, itemId: inst.itemId, direction: inst.direction })),
		// Starred items (deterministic star-persistence surface for e2e + observability).
		starredItems: repo
			.itemExposures(locals.user.id)
			.filter((e) => e.starred)
			.map((e) => e.itemId),
		session: lastSession
			? {
					id: lastSession.id,
					realizedCount: lastSession.realizedCount,
					targetAttempts: lastSession.targetAttempts,
					ended: lastSession.endedAt != null
				}
			: null,
		sessionRedrill
	};
};

// The dial is a per-user set_lesson event + current_lesson cache (C.2a). The route clamps
// to [1, maxLesson] before emitting; the fold independently floors at 1 (design decision 2).
export const actions: Actions = {
	up: ({ locals }) => {
		const repo = getRepo();
		const next = Math.min(maxLesson(), repo.currentLesson(locals.user.id) + 1);
		repo.setLesson({ userId: locals.user.id, lesson: next, at: clockNow() });
	},
	down: ({ locals }) => {
		const repo = getRepo();
		const next = Math.max(1, repo.currentLesson(locals.user.id) - 1);
		repo.setLesson({ userId: locals.user.id, lesson: next, at: clockNow() });
	},
	set: async ({ request, locals }) => {
		const data = await request.formData();
		const requested = Math.floor(Number(data.get('lesson')));
		const lesson = Math.min(maxLesson(), Math.max(1, Number.isFinite(requested) ? requested : 1));
		getRepo().setLesson({ userId: locals.user.id, lesson, at: clockNow() });
	}
};
