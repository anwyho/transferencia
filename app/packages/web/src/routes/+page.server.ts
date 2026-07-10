import type { Actions, PageServerLoad } from './$types';
import { answerSession, startSession } from '$lib/server/session-service';

export const load: PageServerLoad = () => {
	const session = startSession();
	return {
		sessionId: session.sessionId,
		prompt: session.prompt,
		hint: session.hint ?? null
	};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const data = await request.formData();
		const sessionId = String(data.get('sessionId') ?? '');
		const answer = String(data.get('answer') ?? '');
		const hintRevealed = data.get('hintRevealed') === 'true';

		const result = answerSession({ sessionId, answer, hintRevealed });
		return {
			verdict: result.grade.correct ? 'correct' : 'incorrect',
			detail: result.grade.detail ?? null,
			rating: result.rating,
			answer: result.answer,
			correctAnswer: result.correctAnswer,
			hintRevealed: result.hintRevealed
		};
	}
};
