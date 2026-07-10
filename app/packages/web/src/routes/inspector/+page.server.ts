import type { Actions, PageServerLoad } from './$types';
import { eligibleItems, eligibleRules } from '@lt/domain';
import { contentStore } from '$lib/server/content-loader';
import { getCurrentLesson, getMaxLesson, setCurrentLesson } from '$lib/server/settings-service';

export const load: PageServerLoad = () => {
	const store = contentStore();
	const currentLesson = getCurrentLesson();
	return {
		currentLesson,
		maxLesson: getMaxLesson(),
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
		}))
	};
};

export const actions: Actions = {
	up: () => {
		setCurrentLesson(getCurrentLesson() + 1);
	},
	down: () => {
		setCurrentLesson(getCurrentLesson() - 1);
	},
	set: async ({ request }) => {
		const data = await request.formData();
		setCurrentLesson(Number(data.get('lesson')));
	}
};
