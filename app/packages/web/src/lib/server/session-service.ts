import {
	ratingFromAssessment,
	transformationType,
	type Direction,
	type GradeContext,
	type Grade,
	type Item,
	type ItemLookup,
	type Prompt,
	type RenderContext,
	type SrsRating
} from '@lt/domain';

/**
 * In-memory session seam for slice A (#8). No persistence: it serves ONE hardcoded
 * item through the domain `transformation` type and grades via the domain grader +
 * central rating policy. Slice C (#14/#15) replaces the in-memory store with the
 * `ReviewRepository`; the shape of `startSession`/`answerSession` is the seam.
 */

const HARDCODED_ITEM: Item = {
	id: 'l1-nation-nacion',
	kind: 'transformation',
	front_en: 'nation',
	back_es: 'nación',
	hint: '-tion → -ción (many -tion nouns just swap the ending)',
	min_lesson: 1,
	directions: ['en>es'],
	rule_refs: [{ key: 'L1#suffix-cion', role: 'tests' }]
};

const store: ItemLookup = {
	get: (id) => (id === HARDCODED_ITEM.id ? HARDCODED_ITEM : undefined)
};
const renderCtx: RenderContext = { items: store, currentLesson: 1, rng: () => 0.5 };
const gradeCtx: GradeContext = { items: store };

export interface StartResult {
	sessionId: string;
	itemId: string;
	direction: Direction;
	paramKey: string;
	prompt: Prompt;
	hint?: string;
}

export interface AnswerResult {
	grade: Grade;
	rating: SrsRating;
	answer: string;
	correctAnswer: string;
	hintRevealed: boolean;
}

export interface AnswerInput {
	sessionId: string;
	answer: string;
	hintRevealed: boolean;
}

interface SessionRecord {
	itemId: string;
	direction: Direction;
	paramKey: string;
}

const sessions = new Map<string, SessionRecord>();
let counter = 0;

export function startSession(): StartResult {
	const item = HARDCODED_ITEM;
	const instrument = transformationType.paramEnumerator.paramsFor(item, renderCtx)[0];
	const prompt = transformationType.promptRenderer.render(item, instrument.params, renderCtx);
	const sessionId = `s${++counter}`;
	sessions.set(sessionId, {
		itemId: item.id,
		direction: prompt.direction,
		paramKey: instrument.key
	});
	return {
		sessionId,
		itemId: item.id,
		direction: prompt.direction,
		paramKey: instrument.key,
		prompt,
		hint: item.hint
	};
}

export function answerSession(input: AnswerInput): AnswerResult {
	// Slice A is single-item; if the session id is unknown (server restart, stale
	// page) fall back to the hardcoded item so the throwaway screen stays usable.
	const record = sessions.get(input.sessionId);
	const item = store.get(record?.itemId ?? HARDCODED_ITEM.id) ?? HARDCODED_ITEM;
	const direction: Direction = record?.direction ?? 'en>es';
	const grade = transformationType.grader.grade(
		item,
		{ direction },
		{ modality: 'text', text: input.answer },
		gradeCtx
	);
	const rating = ratingFromAssessment(grade, { hintRevealed: input.hintRevealed });
	return {
		grade,
		rating,
		answer: input.answer,
		correctAnswer: item.back_es,
		hintRevealed: input.hintRevealed
	};
}
