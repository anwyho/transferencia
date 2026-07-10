import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { trivialScheduler } from '@lt/domain';
import { webClock } from '../clock';
import { DrizzleReviewRepository } from './repo';
import * as schema from './schema';
import { users } from './schema';

/**
 * Server persistence wiring (C.1 design §Migrations / §Clock). Native module + node
 * built-ins live here, NEVER in @lt/domain (report M9). Pragmas are set per-connection
 * (foreign_keys / busy_timeout do not persist and are ignored inside a migration txn —
 * see plan "Deviations"). Lazy singleton so importing this module opens no DB.
 */
export type Db = BetterSQLite3Database<typeof schema>;

export function applyPragmas(sqlite: Database.Database): void {
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('busy_timeout = 5000');
	sqlite.pragma('synchronous = NORMAL');
	sqlite.pragma('foreign_keys = ON');
}

function migrationsDir(): string {
	// cwd is packages/web for dev, `pnpm preview`, and vitest; override via env if not.
	return process.env.LT_MIGRATIONS_DIR ?? resolve('drizzle');
}

/** Open + migrate + seed a DB at `path` (':memory:' for e2e; a file for dev). */
export function openDb(path: string): { db: Db; sqlite: Database.Database } {
	const sqlite = new Database(path);
	applyPragmas(sqlite);
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: migrationsDir() });
	db.insert(users).values({ id: 'u1' }).onConflictDoNothing().run();
	return { db, sqlite };
}

let _db: Db | null = null;
let _repo: DrizzleReviewRepository | null = null;

export function getDb(): Db {
	if (!_db) _db = openDb(process.env.LT_DB_PATH ?? 'local.sqlite').db;
	return _db;
}

export function getRepo(): DrizzleReviewRepository {
	if (!_repo) {
		_repo = new DrizzleReviewRepository(getDb(), { clock: webClock, scheduler: trivialScheduler });
	}
	return _repo;
}
