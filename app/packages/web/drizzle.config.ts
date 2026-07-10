import { defineConfig } from 'drizzle-kit';

// Forward-only committed migrations (design C.1 §Migrations). `generate` diffs the
// schema into ./drizzle SQL; we NEVER `push`. migrate() (db/index.ts) applies them
// on boot + in test setup.
export default defineConfig({
	dialect: 'sqlite',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle'
});
