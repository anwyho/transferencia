import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'pnpm build && pnpm preview',
		port: 4173,
		reuseExistingServer: !process.env.CI
	},
	testMatch: '**/*.e2e.{ts,js}',
	// Slice B holds the lesson dial as a single process-global on one server, so e2e
	// must run serially — parallel workers would race on shared mutable state.
	// (Revisit when per-user state lands in slice C.)
	workers: 1
});
