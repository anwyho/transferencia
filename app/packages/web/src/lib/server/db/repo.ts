import { and, asc, eq, lte, sql } from 'drizzle-orm';
import {
	BOTH_DIRECTION,
	type AttemptInput,
	type Clock,
	type ItemExposureRow,
	type ReviewLogRow,
	type ReviewRepository,
	type RuleStateRow,
	type Scheduler,
	type SessionEndInput,
	type SessionStartInput
} from '@lt/domain';
import type { Db } from './index';
import { itemExposure, reviewLog, ruleState, sessions } from './schema';

/**
 * Drizzle/SQLite ReviewRepository (C.1 design §Ports / §DB schema). Incremental
 * apply-on-write: each attempt is ONE transaction — append the frozen log row,
 * upsert rule_state (due via the injected Scheduler) per tested rule, bump exposure,
 * bump the session's realized_count. `at` is stamped from the injected Clock, once
 * per attempt, so log + rule_state + exposure agree. Every query filters user_id.
 */
export class DrizzleReviewRepository implements ReviewRepository {
	constructor(
		private readonly db: Db,
		private readonly deps: { clock: Clock; scheduler: Scheduler }
	) {}

	startSession(i: SessionStartInput): { sessionId: number } {
		const row = this.db
			.insert(sessions)
			.values({ userId: i.userId, startedAt: i.at, mode: i.mode, targetAttempts: i.targetAttempts })
			.returning({ id: sessions.id })
			.get();
		this.db
			.insert(reviewLog)
			.values({
				userId: i.userId,
				at: i.at,
				kind: 'session_start',
				sessionId: row.id,
				sessionMode: i.mode,
				sessionTargetAttempts: i.targetAttempts
			})
			.run();
		return { sessionId: row.id };
	}

	endSession(i: SessionEndInput): void {
		this.db
			.update(sessions)
			.set({ endedAt: i.at })
			.where(and(eq(sessions.userId, i.userId), eq(sessions.id, i.sessionId)))
			.run();
		this.db
			.insert(reviewLog)
			.values({ userId: i.userId, at: i.at, kind: 'session_end', sessionId: i.sessionId })
			.run();
	}

	appendAttempt(i: AttemptInput): void {
		const at = this.deps.clock.now();
		this.db.transaction((tx) => {
			tx.insert(reviewLog)
				.values({
					userId: i.userId,
					at,
					kind: 'attempt',
					itemId: i.itemId,
					ruleKeys: i.ruleKeys,
					exerciseTypeKey: i.exerciseTypeKey,
					paramKey: i.paramKey,
					direction: i.direction,
					rating: i.rating,
					assessment: i.assessment,
					hintRevealed: i.hintRevealed,
					latencyMs: i.latencyMs ?? null,
					contentHash: i.contentHash,
					sessionId: i.sessionId
				})
				.run();

			for (const ruleKey of i.ruleKeys) {
				const existing = tx
					.select()
					.from(ruleState)
					.where(
						and(
							eq(ruleState.userId, i.userId),
							eq(ruleState.ruleKey, ruleKey),
							eq(ruleState.direction, BOTH_DIRECTION)
						)
					)
					.get();
				const { blob, due } = this.deps.scheduler.apply(
					existing ? existing.blob : null,
					i.rating,
					at
				);
				const firstExposedAt = existing ? existing.firstExposedAt : at;
				tx.insert(ruleState)
					.values({
						userId: i.userId,
						ruleKey,
						direction: BOTH_DIRECTION,
						blob,
						due,
						firstExposedAt
					})
					.onConflictDoUpdate({
						target: [ruleState.userId, ruleState.ruleKey, ruleState.direction],
						set: { blob, due }
					})
					.run();
			}

			const exp = tx
				.select()
				.from(itemExposure)
				.where(and(eq(itemExposure.userId, i.userId), eq(itemExposure.itemId, i.itemId)))
				.get();
			tx.insert(itemExposure)
				.values({
					userId: i.userId,
					itemId: i.itemId,
					timesSeen: 1,
					lastSeenAt: at,
					lastRating: i.rating
				})
				.onConflictDoUpdate({
					target: [itemExposure.userId, itemExposure.itemId],
					set: { timesSeen: (exp?.timesSeen ?? 0) + 1, lastSeenAt: at, lastRating: i.rating }
				})
				.run();

			tx.update(sessions)
				.set({ realizedCount: sql`${sessions.realizedCount} + 1` })
				.where(eq(sessions.id, i.sessionId))
				.run();
		});
	}

	dueRuleStates(userId: string, now: number): RuleStateRow[] {
		return this.db
			.select()
			.from(ruleState)
			.where(and(eq(ruleState.userId, userId), lte(ruleState.due, now)))
			.orderBy(asc(ruleState.due), asc(ruleState.ruleKey), asc(ruleState.direction))
			.all();
	}

	ruleStates(userId: string): RuleStateRow[] {
		return this.db
			.select()
			.from(ruleState)
			.where(eq(ruleState.userId, userId))
			.orderBy(asc(ruleState.due), asc(ruleState.ruleKey), asc(ruleState.direction))
			.all();
	}

	itemExposure(userId: string, itemId: string): ItemExposureRow | undefined {
		return this.db
			.select()
			.from(itemExposure)
			.where(and(eq(itemExposure.userId, userId), eq(itemExposure.itemId, itemId)))
			.get();
	}

	events(userId: string): ReviewLogRow[] {
		return this.db
			.select()
			.from(reviewLog)
			.where(eq(reviewLog.userId, userId))
			.orderBy(asc(reviewLog.at), asc(reviewLog.id))
			.all() as ReviewLogRow[];
	}
}
