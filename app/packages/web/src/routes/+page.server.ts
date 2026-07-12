import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	eligibleItems,
	ratingFromAssessment,
	transformationType,
	type Direction
} from '@lt/domain';
import { contentStore } from '$lib/server/content-loader';
import { getRepo } from '$lib/server/db';
import { webClock } from '$lib/server/clock';

/**
 * Repo-backed practice (slice C.1). `load` opens a durable session and serves the
 * first gated seed item (planner is Epic D). `submit` grades in the domain, then
 * appendAttempt persists + reschedules the tested rule. No planner/dedup/due-filter
 * here — C.1 is the persistence spine.
 */
export const load: PageServerLoad = ({ locals }) => {
	const store = contentStore();
	const currentLesson = getRepo().currentLesson(locals.user.id);
	const item = eligibleItems(store, currentLesson)[0];
	if (!item) {
		return { sessionId: null, itemId: null, direction: null, prompt: null, hint: null };
	}
	const ctx = { items: store, currentLesson, rng: () => 0.5 };
	const instrument = transformationType.paramEnumerator.paramsFor(item, ctx)[0];
	const prompt = transformationType.promptRenderer.render(item, instrument.params, ctx);
	const { sessionId } = getRepo().startSession({
		userId: locals.user.id,
		mode: 'practice',
		targetAttempts: 10,
		at: webClock.now()
	});
	return {
		sessionId,
		itemId: item.id,
		direction: prompt.direction,
		prompt,
		hint: item.hint ?? null
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const data = await request.formData();
		const sessionId = Number(data.get('sessionId'));
		const itemId = String(data.get('itemId') ?? '');
		const answer = String(data.get('answer') ?? '');
		const hintRevealed = data.get('hintRevealed') === 'true';
		const direction = String(data.get('direction') ?? 'en>es') as Direction;

		const store = contentStore();
		const item = store.get(itemId);
		if (!item || Number.isNaN(sessionId)) return fail(400, { error: 'unknown item or session' });

		const grade = transformationType.grader.grade(
			item,
			{ direction },
			{ modality: 'text', text: answer },
			{ items: store }
		);
		const rating = ratingFromAssessment(grade, { hintRevealed });

		// Credit only tested, schedulable rules (design: uses-role / non-schedulable skip).
		const ruleKeys = item.rule_refs
			.filter((r) => r.role === 'tests' && (store.getRule(r.key)?.schedulable ?? false))
			.map((r) => r.key);

		getRepo().appendAttempt({
			userId: locals.user.id,
			sessionId,
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

		return {
			verdict: grade.correct ? 'correct' : 'incorrect',
			detail: grade.detail ?? null,
			rating,
			answer,
			correctAnswer: item.back_es,
			hintRevealed
		};
	}
};
