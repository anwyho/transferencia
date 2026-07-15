import { expect, test, type Page } from '@playwright/test';

// D.1: practice is planner-driven; at lesson 2 the only eligible rule is L2#conv-al, so whatever
// instrument the planner serves credits that rule. Assert the persistence spine (attempt -> rule
// scheduled -> survives reload -> comes due after the clock advances) without assuming the item.
const ROW = '[data-testid="rule-state-row"][data-rule-key="L2#conv-al"]';

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
async function clock(page: Page, body: Record<string, unknown>) {
	const res = await page.request.post('/__test__/clock', { data: body });
	expect(res.ok()).toBeTruthy();
}
async function resetDb(page: Page) {
	const res = await page.request.post('/__test__/db', { data: { action: 'reset' } });
	expect(res.ok()).toBeTruthy();
}

test('an attempt persists, survives reload, and comes due after advancing the clock', async ({
	page
}) => {
	await resetDb(page); // clean slate: L2#conv-al's first rep. The test reads the real rule-due-at and advances past it (no assumption about the FSRS interval length).
	await clock(page, { action: 'reset' });
	await setLesson(page, 2);

	await page.goto('/');
	await start(page);
	await page.getByTestId('answer-input').fill('anual');
	await page.getByTestId('submit').click();
	await expect(page.getByTestId('verdict')).toBeVisible(); // graded (correct or not)

	await page.goto('/inspector');
	await expect(page.locator(ROW)).toHaveCount(1);
	await expect(page.locator(ROW).getByTestId('rule-due-now')).toHaveText('false');

	await page.goto('/');
	await page.goto('/inspector');
	await expect(page.locator(ROW)).toHaveCount(1);

	const dueAt = Number(await page.locator(ROW).getByTestId('rule-due-at').textContent());
	await clock(page, { action: 'set', epoch: dueAt + 1000 });
	await page.goto('/inspector');
	await expect(page.locator(ROW).getByTestId('rule-due-now')).toHaveText('true');
});
