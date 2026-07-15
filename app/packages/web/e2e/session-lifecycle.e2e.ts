import { expect, test, type Page } from '@playwright/test';
import { PLANNER_KNOBS } from '@lt/domain';

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

test('caught up at lesson 1 shows the caught-up screen with no Start', async ({ page }) => {
	await reset(page);
	await setLesson(page, 1);
	await page.goto('/');
	await expect(page.getByTestId('caught-up')).toBeVisible();
	await expect(page.getByTestId('start-session')).toHaveCount(0);
});

test('a session bounds at the budget, re-drills misses, ends with a summary, and a fresh one starts', async ({
	page
}) => {
	await reset(page);
	await setLesson(page, 2);
	await page.goto('/');
	await page.getByTestId('start-session').click(); // explicit start (cold)

	// Answer every prompt 'anual' (correct only for al-annual->anual; every other instrument misses),
	// so the budget is spent with unresolved misses -> a re-drill tail. Loop until the done screen
	// (bounded: budget + a per-instrument-capped tail, so it always terminates).
	let sawRedrill = false;
	for (let i = 0; i < 60; i++) {
		if (
			await page
				.getByTestId('session-summary')
				.isVisible()
				.catch(() => false)
		)
			break;
		if (
			await page
				.getByTestId('redrill-badge')
				.isVisible()
				.catch(() => false)
		)
			sawRedrill = true;
		const input = page.getByTestId('answer-input');
		if (!(await input.isVisible().catch(() => false))) break;
		await input.fill('anual');
		await page.getByTestId('submit').click();
	}

	await expect(page.getByTestId('session-summary')).toBeVisible();
	const attempts = Number(await page.getByTestId('summary-attempts').textContent());
	const redrilled = Number(await page.getByTestId('summary-redrilled').textContent());
	// Strict >: realized can exceed the budget ONLY via re-drill picks -> a deterministic proof the tail ran.
	expect(attempts).toBeGreaterThan(PLANNER_KNOBS.targetAttempts);
	expect(redrilled).toBeGreaterThanOrEqual(1); // >=1 instrument served more than once (summary render)
	expect(sawRedrill).toBe(true); // the "Reviewing a miss" badge UI rendered during the tail

	// Inspector: the session ended, with realized matching the summary (fold vs realized_count agree).
	await page.goto('/inspector');
	await expect(page.getByTestId('session-ended')).toHaveText('true');
	await expect(page.getByTestId('session-realized')).toHaveText(String(attempts));
	const endedId = Number(await page.getByTestId('session-id').textContent());

	// Start another -> a genuinely fresh session (new id, ended=false, realized reset below target).
	await page.goto('/');
	await page.getByTestId('start-session').click();
	await page.goto('/inspector');
	await expect(page.getByTestId('session-ended')).toHaveText('false');
	expect(Number(await page.getByTestId('session-id').textContent())).toBeGreaterThan(endedId);
	expect(Number(await page.getByTestId('session-realized').textContent())).toBeLessThan(
		PLANNER_KNOBS.targetAttempts
	);
});

test('inspector shows an unresolved miss in the re-drill queue mid-session', async ({ page }) => {
	await reset(page);
	await setLesson(page, 2);
	await page.goto('/');
	await page.getByTestId('start-session').click();
	await page.getByTestId('answer-input').fill('zzzz-not-a-word'); // guaranteed miss (matches no answer)
	await page.getByTestId('submit').click();
	await page.goto('/inspector');
	// one attempt -> one instrument -> one unresolved miss queued (mid-session, well under the cap)
	await expect(page.getByTestId('session-redrill-item')).toHaveCount(1);
});
