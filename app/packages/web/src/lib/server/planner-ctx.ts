import { eligibleRules, transformationType, type ItemStore, type PlannerCtx } from '@lt/domain';
import type { DrizzleReviewRepository } from './db/repo';

/**
 * Assemble a PlannerCtx from the repo + content store (shared by the practice + inspector routes).
 * The caller supplies `rng` (per-session seed live; a fixed seed for the deterministic inspector
 * preview). Rule/exposure lookups are Map-backed snapshots of the user's current projection.
 */
export function buildPlannerCtx(
	store: ItemStore,
	repo: DrizzleReviewRepository,
	userId: string,
	now: number,
	rng: () => number
): PlannerCtx {
	const currentLesson = repo.currentLesson(userId);
	const ruleStates = new Map(repo.ruleStates(userId).map((r) => [r.ruleKey, r]));
	const exposures = new Map(repo.itemExposures(userId).map((e) => [e.itemId, e]));
	return {
		eligibleRules: [...eligibleRules(store, currentLesson)],
		ruleState: (k) => ruleStates.get(k),
		exposure: (id) => exposures.get(id),
		store,
		types: [transformationType],
		currentLesson,
		now,
		rng
	};
}
