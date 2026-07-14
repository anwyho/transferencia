import { expect, test, type Page } from '@playwright/test';
import { PLANNER_KNOBS } from '@lt/domain';

// D.1: practice is planner-driven — the served instrument is planner-chosen (seeded, now STABLE
// across loads via a reused session). Assert planner INVARIANTS + grading (both verdicts) + a real
// star flip, not a specific item. Each test resets the shared :memory: DB first for a clean slate.
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

test('empty practice at lesson 1 (no eligible rule)', async ({ page }) => {
	await reset(page);
	await setLesson(page, 1);
	await page.goto('/');
	await expect(page.getByTestId('no-item')).toBeVisible();
});

test('planner serves a prompt; a wrong answer grades incorrect and reveals the answer', async ({
	page
}) => {
	await reset(page);
	await setLesson(page, 5);
	await page.goto('/');
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
	// At lesson 2 the planner rotates L2#conv-al's 6 instruments before repeating (stable session +
	// Stage-2 freshness); only "annual"->"anual" matches the fixed answer, so loop until it lands,
	// then assert the happy path grades correct. Bounded by a session's attempt budget
	// (targetAttempts = 10 >= the 6-instrument rotation); al-annual is guaranteed served within it.
	let verdict = '';
	for (let i = 0; i < PLANNER_KNOBS.targetAttempts && verdict !== 'correct'; i++) {
		await page.goto('/');
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
	const toggle = page.getByTestId('star-toggle');
	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');

	await toggle.click();
	// The stable session re-serves the SAME item, now starred, so the persisted star is reflected
	// after the action's reload. A no-op star handler would leave aria-pressed="false" here.
	await expect(page.getByTestId('star-toggle')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('star-toggle')).toHaveText('★ starred');
});
