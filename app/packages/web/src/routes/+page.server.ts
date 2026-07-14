import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	planSession,
	PLANNER_KNOBS,
	ratingFromAssessment,
	seededRng,
	transformationType,
	type Direction
} from '@lt/domain';
import { contentStore } from '$lib/server/content-loader';
import { getRepo } from '$lib/server/db';
import { buildPlannerCtx } from '$lib/server/planner-ctx';
import { webClock } from '$lib/server/clock';

/**
 * Repo-backed practice (slice D.1). `load` reuses-or-creates the user's practice session and serves
 * the HEAD of a deterministic planSession (greedy — no plan persistence; the pre-committed/resumable
 * plan is P1). `submit` grades + appendAttempt (crediting the item's full tested+schedulable rules).
 * `star`/`unstar` toggle the current item.
 */
export const load: PageServerLoad = ({ locals }) => {
	const store = contentStore();
	const repo = getRepo();
	const userId = locals.user.id;
	const now = webClock.now();
	const currentLesson = repo.currentLesson(userId);

	// Reuse the user's current practice session so the seed — and thus the served item — is STABLE
	// across reloads (starring/annotating no longer swaps the item underneath the user); create one
	// lazily only when there's something to serve, so a lesson-1 / caught-up 'no-item' view writes no
	// session. planSession emptiness is seed-independent, so a fixed-seed probe decides servability.
	let sessionId = repo.currentSession(userId)?.id ?? null;
	const headFor = (seed: number) =>
		planSession(buildPlannerCtx(store, repo, userId, now, seededRng(seed)), 1)[0]; // greedy head; head is n-independent

	let pick = headFor(sessionId ?? 0);
	if (!pick) {
		return { sessionId, itemId: null, direction: null, prompt: null, hint: null, starred: false };
	}
	if (sessionId === null) {
		sessionId = repo.startSession({
			userId,
			mode: 'practice',
			targetAttempts: PLANNER_KNOBS.targetAttempts,
			at: now
		}).sessionId;
		pick = headFor(sessionId)!; // servability already confirmed above (seed-independent), so non-null
	}
	const item = store.get(pick.itemId)!;
	// Salt the render seed (+1) so render randomness never replays the planner's stream.
	const renderCtx = { items: store, currentLesson, rng: seededRng(sessionId + 1) };
	const prompt = transformationType.promptRenderer.render(
		item,
		{ direction: pick.direction },
		renderCtx
	);
	return {
		sessionId,
		itemId: item.id,
		direction: pick.direction,
		prompt,
		hint: item.hint ?? null,
		starred: repo.itemExposure(userId, item.id)?.starred ?? false
	};
};

/** Narrow a posted form value to a valid Direction (mirrors content-loader's DIRECTIONS set). */
function isDirection(d: string): d is Direction {
	return d === 'en>es' || d === 'es>en';
}

export const actions: Actions = {
	// Named (not `default`): SvelteKit forbids a default action alongside named actions
	// (`check_named_default_separate` throws on ANY submit once `star`/`unstar` exist) —
	// the practice/+page.svelte form targets this explicitly via action="?/submit".
	submit: async ({ request, locals }) => {
		const data = await request.formData();
		const sessionId = Number(data.get('sessionId'));
		const itemId = String(data.get('itemId') ?? '');
		const answer = String(data.get('answer') ?? '');
		const hintRevealed = data.get('hintRevealed') === 'true';
		const direction = String(data.get('direction') ?? 'en>es');

		const store = contentStore();
		const item = store.get(itemId);
		if (!item || Number.isNaN(sessionId) || !isDirection(direction)) {
			return fail(400, { error: 'unknown item, session, or direction' });
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
