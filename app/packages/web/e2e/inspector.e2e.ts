import { expect, test, type Page } from '@playwright/test';

// The lesson dial is a single process-global (slice B), so each test sets a known
// starting lesson before asserting rather than assuming order.
async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}

test('empty queue at lesson 1 (L1 teaches no Spanish)', async ({ page }) => {
	await setLesson(page, 1);
	await expect(page.getByTestId('queue-count')).toHaveText('0');
	await expect(page.getByTestId('rule-count')).toHaveText('0');
	await expect(page.getByTestId('queue-item')).toHaveCount(0);
});

test('dialing up grows the eligible queue L2 -> L5', async ({ page }) => {
	await setLesson(page, 1);

	await page.getByTestId('lesson-up').click();
	await expect(page.getByTestId('current-lesson')).toHaveText('2');
	await expect(page.getByTestId('queue-count')).toHaveText('6');
	await expect(page.getByTestId('rule-count')).toHaveText('1');

	await page.getByTestId('lesson-up').click();
	await expect(page.getByTestId('queue-count')).toHaveText('18');
	await expect(page.getByTestId('rule-count')).toHaveText('4');

	await page.getByTestId('lesson-up').click();
	await expect(page.getByTestId('queue-count')).toHaveText('28');

	await page.getByTestId('lesson-up').click();
	await expect(page.getByTestId('current-lesson')).toHaveText('5');
	await expect(page.getByTestId('queue-count')).toHaveText('32');
	await expect(page.getByTestId('rule-count')).toHaveText('7');
});

test('dialing down re-hides higher-lesson content (reversible)', async ({ page }) => {
	await setLesson(page, 5);
	await expect(page.getByTestId('queue-count')).toHaveText('32');
	await expect(page.locator('[data-item-id="cion-opinion"]')).toBeVisible();

	await page.getByTestId('lesson-down').click(); // 4
	await expect(page.getByTestId('queue-count')).toHaveText('28');

	await page.getByTestId('lesson-down').click(); // 3
	await page.getByTestId('lesson-down').click(); // 2
	await expect(page.getByTestId('current-lesson')).toHaveText('2');
	await expect(page.getByTestId('queue-count')).toHaveText('6');
	await expect(page.locator('[data-item-id="al-normal"]')).toBeVisible();
	await expect(page.locator('[data-item-id="cion-opinion"]')).toHaveCount(0);
});
