import type { Actions, PageServerLoad } from './$types';
import { eligibleItems, eligibleRules, masteryReady } from '@lt/domain';
import { contentStore, maxLesson } from '$lib/server/content-loader';
import { getRepo } from '$lib/server/db';
import { clockNow } from '$lib/server/clock';

export const load: PageServerLoad = ({ locals }) => {
	const store = contentStore();
	const repo = getRepo();
	const currentLesson = repo.currentLesson(locals.user.id);
	const now = clockNow();
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
		}))
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
