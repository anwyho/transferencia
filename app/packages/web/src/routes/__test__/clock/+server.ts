import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	advanceClock,
	currentOffset,
	resetClock,
	setClock,
	testControlEnabled
} from '$lib/server/clock';

/**
 * Env-gated test control-plane (C.1 design §Clock). Active IFF LT_TEST_CONTROL=1;
 * otherwise the route 404s (absent/no-op — cannot ship live). Body:
 *   { action: 'advance', ms } | { action: 'set', epoch } | { action: 'reset' }
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!testControlEnabled()) error(404);
	const body = (await request.json().catch(() => ({}))) as {
		action?: string;
		ms?: number;
		epoch?: number;
	};
	switch (body.action) {
		case 'advance':
			advanceClock(Number(body.ms ?? 0));
			break;
		case 'set':
			setClock(Number(body.epoch ?? 0));
			break;
		case 'reset':
			resetClock();
			break;
		default:
			error(400, 'unknown clock action');
	}
	return json({ offset: currentOffset(), now: Date.now() + currentOffset() });
};
