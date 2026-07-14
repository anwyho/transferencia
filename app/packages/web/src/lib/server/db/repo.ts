import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import {
	applyMastery,
	BOTH_DIRECTION,
	fold,
	instrumentKey,
	rowToEvent,
	rowToMasteryState,
	type AttemptInput,
	type Clock,
	type ItemExposureRow,
	type ReviewLogRow,
	type ReviewRepository,
	type RuleStateRow,
	type Scheduler,
	type SessionEndInput,
	type SessionRow,
	type SessionStartInput,
	type SetLessonInput,
	type StarInput
} from '@lt/domain';
import type { Db } from './index';
import { itemExposure, reviewLog, ruleState, sessions, users } from './schema';

/**
 * Drizzle/SQLite ReviewRepository (C.1 design §Ports / §DB schema). Incremental
 * apply-on-write: each attempt is ONE transaction — append the frozen log row,
 * upsert rule_state (due via the injected Scheduler; the advisory mastery meter via the
 * shared applyMastery — every rep, never affecting due) per tested rule, bump exposure,
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
				const m = applyMastery(
					existing ? rowToMasteryState(existing) : null,
					i.rating,
					instrumentKey(i.itemId, i.exerciseTypeKey, i.paramKey, i.direction),
					at
				);
				tx.insert(ruleState)
					.values({
						userId: i.userId,
						ruleKey,
						direction: BOTH_DIRECTION,
						blob,
						due,
						firstExposedAt,
						mastery: m.ewma,
						coverage: m.instruments.length,
						seenInstruments: m.instruments,
						successDays: m.successDays
					})
					.onConflictDoUpdate({
						target: [ruleState.userId, ruleState.ruleKey, ruleState.direction],
						set: {
							blob,
							due,
							mastery: m.ewma,
							coverage: m.instruments.length,
							seenInstruments: m.instruments,
							successDays: m.successDays
						}
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
				.where(and(eq(sessions.userId, i.userId), eq(sessions.id, i.sessionId)))
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

	setLesson(i: SetLessonInput): void {
		this.db.transaction((tx) => {
			tx.insert(reviewLog)
				.values({ userId: i.userId, at: i.at, kind: 'set_lesson', annotationLesson: i.lesson })
				.run();
			tx.update(users).set({ currentLesson: i.lesson }).where(eq(users.id, i.userId)).run();
		});
	}

	currentLesson(userId: string): number {
		const row = this.db
			.select({ currentLesson: users.currentLesson })
			.from(users)
			.where(eq(users.id, userId))
			.get();
		return row?.currentLesson ?? 1;
	}

	sessions(userId: string): SessionRow[] {
		return this.db
			.select()
			.from(sessions)
			.where(eq(sessions.userId, userId))
			.orderBy(asc(sessions.id))
			.all();
	}

	/** The user's latest practice session (highest id), or undefined — D.1 reuses it for a stable
	 *  planner seed across loads. Shapes the row exactly like `sessions()` (same select). */
	currentSession(userId: string): SessionRow | undefined {
		return this.db
			.select()
			.from(sessions)
			.where(and(eq(sessions.userId, userId), eq(sessions.mode, 'practice')))
			.orderBy(desc(sessions.id))
			.limit(1)
			.get();
	}

	itemExposures(userId: string): ItemExposureRow[] {
		return this.db
			.select()
			.from(itemExposure)
			.where(eq(itemExposure.userId, userId))
			.orderBy(asc(itemExposure.itemId))
			.all();
	}

	/**
	 * Replay mechanism: fold the immutable log through `opts.scheduler` and rewrite rule_state
	 * (the only scheduler/keyRemap-dependent projection; it has no inbound FK). By design a
	 * COORDINATED swap — `rebuild(otherScheduler)` must be paired with swapping the app's injected
	 * scheduler, because `apply` never hydrates a foreign blob (C.2b decision 5). Mastery columns
	 * are scheduler-independent, so a scheduler swap leaves them unchanged; a keyRemap merges them.
	 * Phase-0 dev DB is disposable; no boot-time auto-rebuild.
	 */
	rebuild(
		userId: string,
		opts: { scheduler: Scheduler; keyRemap?: (ruleKey: string) => string }
	): void {
		const state = fold(this.events(userId).map(rowToEvent), opts);
		this.db.transaction((tx) => {
			tx.delete(ruleState).where(eq(ruleState.userId, userId)).run();
			for (const rs of state.ruleStates) {
				tx.insert(ruleState)
					.values({
						userId: rs.userId,
						ruleKey: rs.ruleKey,
						direction: rs.direction,
						blob: rs.blob,
						due: rs.due,
						firstExposedAt: rs.firstExposedAt,
						mastery: rs.mastery,
						coverage: rs.coverage,
						seenInstruments: rs.seenInstruments,
						successDays: rs.successDays
					})
					.run();
			}
		});
	}

	star(i: StarInput): void {
		this.setStarred(i, 'star');
	}

	unstar(i: StarInput): void {
		this.setStarred(i, 'unstar');
	}

	/** One txn: append the star/unstar event + upsert item_exposure.starred. Create-if-missing uses
	 *  literal defaults matching the fold's exposureFor (timesSeen 0, lastSeenAt = at, lastRating null,
	 *  known false) so the write path folds identically. On an existing row onConflictDoUpdate flips
	 *  only `starred`; SQLite preserves timesSeen/lastSeenAt/lastRating/known. */
	private setStarred(i: StarInput, kind: 'star' | 'unstar'): void {
		const starred = kind === 'star';
		this.db.transaction((tx) => {
			tx.insert(reviewLog).values({ userId: i.userId, at: i.at, kind, itemId: i.itemId }).run();
			tx.insert(itemExposure)
				.values({
					userId: i.userId,
					itemId: i.itemId,
					timesSeen: 0,
					lastSeenAt: i.at,
					lastRating: null,
					known: false,
					starred
				})
				.onConflictDoUpdate({
					target: [itemExposure.userId, itemExposure.itemId],
					set: { starred }
				})
				.run();
		});
	}
}
