import { expect, test, type Page } from '@playwright/test';

// The practice screen serves the first gated seed item; the dial is a process-global
// (slice B), so set a known lesson first. At L>=2 the first eligible item (order
// min_lesson, id) is `al-annual` (annual -> anual, rule L2#conv-al).
async function setLesson(page: Page, n: number) {
	await page.goto('/inspector');
	await page.getByTestId('lesson-input').fill(String(n));
	await page.getByTestId('set-lesson').click();
	await expect(page.getByTestId('current-lesson')).toHaveText(String(n));
}

test('empty practice at lesson 1 (no eligible item)', async ({ page }) => {
	await setLesson(page, 1);
	await page.goto('/');
	await expect(page.getByTestId('no-item')).toBeVisible();
});

test('correct answer grades + persists (rating good)', async ({ page }) => {
	await setLesson(page, 2);
	await page.goto('/');
	await expect(page.getByTestId('instruction')).toHaveText('Translate to Spanish');
	await expect(page.getByTestId('given')).toHaveText('annual');

	await expect(page.getByTestId('result')).toHaveCount(0);
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();

	await expect(page.getByTestId('verdict')).toHaveText('correct');
	await expect(page.getByTestId('rating')).toHaveText('good');
	await expect(page.getByTestId('reveal')).toHaveText('anual');
});

test('wrong answer grades incorrect and reveals the expected answer', async ({ page }) => {
	await setLesson(page, 2);
	await page.goto('/');
	await page.getByTestId('answer-input').fill('gato');
	await page.getByTestId('submit').click();

	await expect(page.getByTestId('verdict')).toHaveText('incorrect');
	await expect(page.getByTestId('rating')).toHaveText('again');
	await expect(page.getByTestId('reveal')).toHaveText('anual');
});
