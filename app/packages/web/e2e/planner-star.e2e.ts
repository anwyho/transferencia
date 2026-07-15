import { expect, test, type Page } from '@playwright/test';

// D.1 Task 5: the inspector's planned-queue preview is a deterministic fixed-seed (seededRng(1))
// planSession — read-only and illustrative only (the live practice session seeds from its own
// sessionId, so its actual picks differ; see the `planned-note` caption in +page.svelte). The
// e2e share one :memory: DB across a reused preview server, so each test resets the DB (+ clock,
// matching mastery.e2e.ts / practice.e2e.ts) first for a clean, rerun-robust slate.
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
async function start(page: Page) {
	const btn = page.getByTestId('start-session');
	if (await btn.isVisible()) await btn.click();
}

test('inspector planned-queue lists a spread of planned instruments (deterministic)', async ({
	page
}) => {
	await reset(page);
	await setLesson(page, 5);
	await page.goto('/inspector');
	await expect(page.getByTestId('planned-list')).toBeVisible();
	expect(Number(await page.getByTestId('planned-count').textContent())).toBeGreaterThan(1);
	const distinctRules = await page
		.locator('[data-testid="planned-item"]')
		.evaluateAll((els) => new Set(els.map((e) => e.getAttribute('data-rule-key'))).size);
	expect(distinctRules).toBeGreaterThanOrEqual(2); // spread across lessons/rules, not one bombarded
});

test('starring the practice item shows it in the inspector starred list (persisted)', async ({
	page
}) => {
	await reset(page);
	await setLesson(page, 5);
	await page.goto('/');
	await start(page);
	const itemId = await page.getByTestId('star-form').locator('input[name="itemId"]').inputValue();
	await page.getByTestId('star-toggle').click();
	await page.goto('/inspector');
	await expect(page.locator(`[data-testid="starred-item"][data-item-id="${itemId}"]`)).toHaveCount(
		1
	);
});
