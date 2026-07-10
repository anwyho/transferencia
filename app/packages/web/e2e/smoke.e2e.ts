import { expect, test } from '@playwright/test';

// Scaffold smoke: the real built app boots, renders, and the isomorphic domain
// package is reachable from a route (SSR-rendered text). This is the trivial
// Playwright pass that issue #1 requires; slice A replaces it with the real flow.
test('root page renders and the domain package is wired', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('app-title')).toBeVisible();
	await expect(page.getByTestId('domain-status')).toHaveText('domain: domain (ready)');
});
