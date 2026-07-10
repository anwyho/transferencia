import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Direction, Grade, SchedulerState, SrsRating } from '@lt/domain';

/**
 * SQLite schema (design v2 §State plane; C.1 design §DB schema). Every per-user
 * table carries user_id; booleans are int 0/1; all timestamps epoch-int UTC.
 * STRICT is added to the generated migration SQL (drizzle-kit does not emit it);
 * this schema is the typed query surface + the drizzle-kit generate source.
 *
 * review_log holds the FULL frozen column set now (un-backfillable ground truth),
 * even though C.1 only writes attempt + session_start/session_end. rule_state /
 * item_exposure gain mastery/coverage/known/starred columns in C.2/D by re-fold.
 */

export const users = sqliteTable('users', {
	id: text('id').primaryKey()
	// current_lesson added in C.2 with the folded per-user dial.
});

export const sessions = sqliteTable('sessions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: text('user_id')
		.notNull()
		.references(() => users.id),
	startedAt: integer('started_at').notNull(),
	endedAt: integer('ended_at'),
	mode: text('mode').notNull(),
	targetAttempts: integer('target_attempts').notNull(),
	realizedCount: integer('realized_count').notNull().default(0)
});

export const reviewLog = sqliteTable(
	'review_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		at: integer('at').notNull(),
		kind: text('kind').notNull(),
		itemId: text('item_id'),
		ruleKeys: text('rule_keys', { mode: 'json' }).$type<string[]>(),
		exerciseTypeKey: text('exercise_type_key'),
		paramKey: text('param_key'),
		direction: text('direction').$type<Direction>(),
		rating: text('rating').$type<SrsRating>(),
		assessment: text('assessment', { mode: 'json' }).$type<Grade>(),
		hintRevealed: integer('hint_revealed', { mode: 'boolean' }),
		latencyMs: integer('latency_ms'),
		contentHash: text('content_hash'),
		sessionId: integer('session_id').references(() => sessions.id),
		annotationKnown: integer('annotation_known', { mode: 'boolean' }),
		annotationLesson: integer('annotation_lesson'),
		sessionMode: text('session_mode'),
		sessionTargetAttempts: integer('session_target_attempts')
	},
	(t) => [index('review_log_user_at_id_idx').on(t.userId, t.at, t.id)]
);

export const ruleState = sqliteTable(
	'rule_state',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		ruleKey: text('rule_key').notNull(),
		direction: text('direction').notNull(),
		blob: text('blob', { mode: 'json' }).$type<SchedulerState>().notNull(),
		due: integer('due').notNull(),
		firstExposedAt: integer('first_exposed_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.ruleKey, t.direction] }),
		index('rule_state_user_due_idx').on(t.userId, t.due)
	]
);

export const itemExposure = sqliteTable(
	'item_exposure',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		itemId: text('item_id').notNull(),
		timesSeen: integer('times_seen').notNull().default(0),
		lastSeenAt: integer('last_seen_at').notNull(),
		lastRating: text('last_rating').$type<SrsRating>(),
		known: integer('known', { mode: 'boolean' }).notNull().default(false),
		starred: integer('starred', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [primaryKey({ columns: [t.userId, t.itemId] })]
);
