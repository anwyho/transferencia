import { expect, test, type Page } from '@playwright/test';
import { PLANNER_KNOBS } from '@lt/domain';

// D.1: at lesson 2 the only eligible rule is L2#conv-al, whose 6 items are its instruments. The
// practice session is now STABLE (reused across loads), and Stage-2 freshness prefers the
// least-recently-seen instrument, so each successive attempt serves a DIFFERENT item — coverage
// strictly climbs. The e2e share one :memory: DB across a reused server, so each test resets the
// DB first for a clean, rerun-robust slate.
const ROW = '[data-testid="rule-state-row"][data-rule-key="L2#conv-al"]';

async function reset(page: Page) {
	await page.request.post('/__test__/db', { data: { action: 'reset' } });
	await page.request.post('/__test__/clock', { data: { action: 'reset' } });
}
async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}
async function attempt(page: Page): Promise<string> {
	await page.goto('/');
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toBeVisible();
	return (await page.getByTestId('verdict').textContent()) ?? '';
}
async function meter(page: Page): Promise<{ mastery: number; coverage: number }> {
	await page.goto('/inspector');
	return {
		mastery: Number(await page.locator(ROW).getByTestId('rule-mastery').textContent()),
		coverage: Number(await page.locator(ROW).getByTestId('rule-coverage').textContent())
	};
}

test('coverage strictly climbs as the planner varies instruments across attempts', async ({
	page
}) => {
	await reset(page);
	await setLesson(page, 2);

	await attempt(page);
	const a = await meter(page);
	await attempt(page);
	const b = await meter(page);

	// STRICT: the stable session + advancing freshness make the planner serve a DIFFERENT instrument
	// on the second attempt, so coverage rises by one. (A planner that stopped varying — or the old
	// tautological `>=` on append-only coverage — would not catch this; `>` does.)
	expect(b.coverage).toBeGreaterThan(a.coverage);
});

test('a correct rep lifts the mastery EWMA off its clean-slate zero', async ({ page }) => {
	await reset(page);
	await setLesson(page, 2);

	// The planner rotates all 6 L2#conv-al instruments before repeating, and only "annual"->"anual"
	// matches the fixed answer, so loop until a correct rep lands. Bounded by a session's attempt
	// budget (targetAttempts = 10 >= the 6-instrument rotation), so al-annual is guaranteed served
	// within it; the loud expect(landed) below fires if that ever regresses.
	// On the clean DB the EWMA starts at 0 and only a *correct* (good) rep can raise it, so asserting
	// > 0 after the loop proves the meter actually moved — not merely that a row exists.
	let landed = false;
	for (let i = 0; i < PLANNER_KNOBS.targetAttempts && !landed; i++) {
		landed = (await attempt(page)) === 'correct';
	}
	expect(landed).toBe(true);
	expect((await meter(page)).mastery).toBeGreaterThan(0);
});
