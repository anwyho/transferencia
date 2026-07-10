import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'pnpm build && pnpm preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		// C.1: the /__test__/clock control-plane is active only with the flag; the e2e DB
		// is fresh in-memory per run (no file to accumulate/gitignore-race).
		env: { LT_TEST_CONTROL: '1', LT_DB_PATH: ':memory:' }
	},
	testMatch: '**/*.e2e.{ts,js}',
	// The lesson dial + clock offset + :memory: DB are process-globals on one server,
	// so e2e runs serially. (Revisit when per-user state lands in slice C.2.)
	workers: 1
});
