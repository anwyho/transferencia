import { expect, test, type Page } from '@playwright/test';

// Issue #C.3 acceptance: attempt -> reload (persisted) -> advance 1 day -> rule due.
async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}

async function clock(page: Page, body: Record<string, unknown>) {
	const res = await page.request.post('/__test__/clock', { data: body });
	expect(res.ok()).toBeTruthy();
}

const ROW = '[data-testid="rule-state-row"][data-rule-key="L2#conv-al"]';

test('attempt persists, survives reload, and comes due after advancing the clock', async ({
	page
}) => {
	await clock(page, { action: 'reset' });
	await setLesson(page, 2);

	// 1) attempt on the first gated item (annual -> anual, rule L2#conv-al)
	await page.goto('/');
	await expect(page.getByTestId('given')).toHaveText('annual');
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toHaveText('correct');

	// 2) persisted + observable: the scheduled-rules panel shows the rule, not due yet
	await page.goto('/inspector');
	await expect(page.locator(ROW)).toHaveCount(1);
	await expect(page.locator(ROW).getByTestId('rule-due-now')).toHaveText('false');

	// 3) survives a fresh navigation away and back (read from SQLite, not memory)
	await page.goto('/');
	await page.goto('/inspector');
	await expect(page.locator(ROW)).toHaveCount(1);

	// 4) advance one day -> the rule is due now
	await clock(page, { action: 'advance', ms: 86400000 });
	await page.goto('/inspector');
	await expect(page.locator(ROW).getByTestId('rule-due-now')).toHaveText('true');
});
