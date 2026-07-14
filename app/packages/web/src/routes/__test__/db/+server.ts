import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { testControlEnabled } from '$lib/server/clock';
import { getDb } from '$lib/server/db';
import { itemExposure, reviewLog, ruleState, sessions } from '$lib/server/db/schema';

/**
 * Env-gated test control-plane sibling of /__test__/clock (C.1 §Clock; D.1 e2e isolation).
 * Active IFF LT_TEST_CONTROL=1; otherwise the route 404s (cannot ship live). The e2e share one
 * :memory: DB across a reused preview server, so per-user mutable state leaks between tests/runs
 * and makes strict assertions vacuous. Body: { action: 'reset' } clears the mutable per-user
 * tables in one txn (review_log deleted first — it FKs sessions). Schema/migrations and the seeded
 * `users` row (with its current_lesson cache) are untouched; tests re-set the lesson explicitly.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!testControlEnabled()) error(404);
	const body = (await request.json().catch(() => ({}))) as { action?: string };
	if (body.action !== 'reset') error(400, 'unknown db action');
	const db = getDb();
	db.transaction((tx) => {
		tx.delete(reviewLog).run();
		tx.delete(itemExposure).run();
		tx.delete(ruleState).run();
		tx.delete(sessions).run();
	});
	return json({ ok: true });
};
