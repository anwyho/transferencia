import { expect, test, type Page } from '@playwright/test';

// The practice screen serves the first gated item (al-annual, rule L2#conv-al) every visit —
// the SAME instrument. So repeated attempts are a live demo of the C.2c divergence: coverage
// stays 1 (dedup) while mastery keeps moving (eats every rep). Relative assertions keep this
// robust to the Monte-Carlo-owned knob VALUES and to shared-server state from other e2e.
const ROW = '[data-testid="rule-state-row"][data-rule-key="L2#conv-al"]';

async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}

async function attemptAnnual(page: Page) {
	await page.goto('/');
	await expect(page.getByTestId('given')).toHaveText('annual');
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toHaveText('correct');
}

async function mastery(page: Page): Promise<number> {
	await page.goto('/inspector');
	return Number(await page.locator(ROW).getByTestId('rule-mastery').textContent());
}

test('inspector shows the folded mastery meter; coverage dedups, mastery eats every rep', async ({
	page
}) => {
	await page.request.post('/__test__/clock', { data: { action: 'reset' } });
	await setLesson(page, 2);

	await attemptAnnual(page);
	await page.goto('/inspector');
	await expect(page.locator(ROW).getByTestId('rule-coverage')).toHaveText('1');
	await expect(page.locator(ROW).getByTestId('rule-mastered')).toBeVisible();
	const m1 = await mastery(page);
	expect(m1).toBeGreaterThan(0);

	// Second attempt on the SAME instrument: coverage stays 1 (dedup), mastery strictly climbs.
	await attemptAnnual(page);
	await page.goto('/inspector');
	await expect(page.locator(ROW).getByTestId('rule-coverage')).toHaveText('1');
	const m2 = await mastery(page);
	expect(m2).toBeGreaterThan(m1);
});
