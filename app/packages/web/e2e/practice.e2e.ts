import { expect, test, type Page } from '@playwright/test';
import { PLANNER_KNOBS } from '@lt/domain';

// D.2: `load` is side-effect-free — a session is created only by ?/start, so cold start shows a
// "Start practicing" screen. `start(page)` clicks it only when idle (mid-session loads are
// unaffected). Lesson 1 (nothing servable) is `caught-up` with no Start. Each test resets the DB.
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

test('caught up at lesson 1 (no eligible rule, no Start offered)', async ({ page }) => {
	await reset(page);
	await setLesson(page, 1);
	await page.goto('/');
	await expect(page.getByTestId('caught-up')).toBeVisible();
	await expect(page.getByTestId('start-session')).toHaveCount(0);
});

test('planner serves a prompt after Start; a wrong answer grades incorrect and reveals', async ({
	page
}) => {
	await reset(page);
	await setLesson(page, 5);
	await page.goto('/');
	await expect(page.getByTestId('start-session')).toBeVisible(); // positive gate: Start IS offered at a servable lesson
	await start(page);
	await expect(page.getByTestId('instruction')).toBeVisible();
	await expect(page.getByTestId('given')).toBeVisible();
	await page.getByTestId('answer-input').fill('zzzzz-not-a-word');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toHaveText('incorrect');
	await expect(page.getByTestId('rating')).toHaveText('again');
	await expect(page.getByTestId('reveal')).not.toBeEmpty();
});

test('a correct answer grades correct (rating good) and reveals the answer', async ({ page }) => {
	await reset(page);
	await setLesson(page, 2);
	// Only "annual"->"anual" matches the fixed answer; loop until the planner serves al-annual (bounded
	// by the budget). start(page) handles the first idle load + any mid-loop completion.
	let verdict = '';
	for (let i = 0; i < PLANNER_KNOBS.targetAttempts && verdict !== 'correct'; i++) {
		await page.goto('/');
		await start(page);
		await page.getByTestId('answer-input').fill('anual');
		await page.getByTestId('submit').click();
		await expect(page.getByTestId('verdict')).toBeVisible();
		verdict = (await page.getByTestId('verdict').textContent()) ?? '';
	}
	expect(verdict).toBe('correct');
	await expect(page.getByTestId('rating')).toHaveText('good');
	await expect(page.getByTestId('reveal')).toHaveText('anual');
});

test('the star toggle flips on the served item and persists across the reload', async ({
	page
}) => {
	await reset(page);
	await setLesson(page, 5);
	await page.goto('/');
	await start(page);
	const toggle = page.getByTestId('star-toggle');
	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await toggle.click();
	await expect(page.getByTestId('star-toggle')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('star-toggle')).toHaveText('★ starred');
});
