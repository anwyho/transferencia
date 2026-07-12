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
	// The dial is now per-user in the DB (C.2a), but the clock offset and the shared
	// :memory: DB + seed user u1 remain process-globals on one preview server, so e2e
	// still runs serially. Dropping this needs per-test clock + DB isolation (separate task).
	workers: 1
});
