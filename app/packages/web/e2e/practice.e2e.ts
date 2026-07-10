import { expect, test } from '@playwright/test';

// Epic A done-criterion (issue #8 / #5): drive the REAL scrappy screen end-to-end
// against the built app — load → type → submit → grade → reveal.
test('load → type → submit → grade → reveal (correct answer)', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('app-title')).toBeVisible();
	await expect(page.getByTestId('instruction')).toHaveText('Translate to Spanish');
	await expect(page.getByTestId('given')).toHaveText('nation');

	// nothing graded before submitting
	await expect(page.getByTestId('result')).toHaveCount(0);

	await page.getByTestId('answer-input').fill('nación');
	await page.getByTestId('submit').click();

	await expect(page.getByTestId('verdict')).toHaveText('correct');
	await expect(page.getByTestId('rating')).toHaveText('good');
	await expect(page.getByTestId('reveal')).toHaveText('nación');
});

test('accent-off answer grades correct + flagged, with no rating penalty', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('answer-input').fill('nacion');
	await page.getByTestId('submit').click();

	await expect(page.getByTestId('verdict')).toHaveText('correct');
	await expect(page.getByTestId('detail')).toContainText('accent');
	await expect(page.getByTestId('rating')).toHaveText('good');
});

test('wrong answer grades incorrect and reveals the expected answer', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('answer-input').fill('gato');
	await page.getByTestId('submit').click();

	await expect(page.getByTestId('verdict')).toHaveText('incorrect');
	await expect(page.getByTestId('rating')).toHaveText('again');
	await expect(page.getByTestId('reveal')).toHaveText('nación');
});
