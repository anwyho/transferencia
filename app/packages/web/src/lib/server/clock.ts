import type { Clock } from '@lt/domain';

/**
 * Injectable clock (C.1 design §Clock). Prod = wall clock; a server-side singleton
 * `offset` (mutated ONLY via the env-gated /__test__/clock route) lets a Playwright
 * walkthrough advance time instantly. When LT_TEST_CONTROL is unset the route is a
 * no-op, so `offset` stays 0 and this is a pure wall clock — cannot ship live.
 */
let offset = 0;

export function clockNow(): number {
	return Date.now() + offset;
}

/** The domain Clock impl passed to the repo/scheduler. */
export const webClock: Clock = { now: clockNow };

export function advanceClock(ms: number): number {
	offset += ms;
	return offset;
}

export function setClock(epoch: number): number {
	offset = epoch - Date.now();
	return offset;
}

export function resetClock(): number {
	offset = 0;
	return offset;
}

export function currentOffset(): number {
	return offset;
}

/** The control route is active IFF this is true (Playwright's preview sets the flag). */
export function testControlEnabled(): boolean {
	return process.env.LT_TEST_CONTROL === '1';
}
