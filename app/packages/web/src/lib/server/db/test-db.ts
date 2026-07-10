import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { trivialScheduler, type Clock } from '@lt/domain';
import { applyPragmas, type Db } from './index';
import { DrizzleReviewRepository } from './repo';
import * as schema from './schema';
import { users } from './schema';

/**
 * A FRESH temp-file SQLite per integration test (real WAL/foreign_keys, real
 * migrations). Not a *.test.ts so vitest won't run it as an (empty) suite.
 */
export function createTestDb(clock: Clock): {
	db: Db;
	sqlite: Database.Database;
	repo: DrizzleReviewRepository;
	cleanup: () => void;
} {
	const dir = mkdtempSync(join(tmpdir(), 'lt-c1-'));
	const sqlite = new Database(join(dir, 'test.sqlite'));
	applyPragmas(sqlite);
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: resolve('drizzle') });
	db.insert(users).values({ id: 'u1' }).onConflictDoNothing().run();
	const repo = new DrizzleReviewRepository(db, { clock, scheduler: trivialScheduler });
	return {
		db,
		sqlite,
		repo,
		cleanup: () => {
			sqlite.close();
			rmSync(dir, { recursive: true, force: true });
		}
	};
}
