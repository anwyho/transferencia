import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

/**
 * M9 tripwire (final-review-report M9; issue #14 acceptance): the domain package's
 * no-restricted-imports rule must actually FIRE on a leaked persistence-driver import,
 * not merely exist. Plant a fixture that imports better-sqlite3 into the domain, run
 * the REAL domain lint, assert the rule fires, then clean up.
 */
it('domain lint (report M9) fails on a planted persistence-driver import', () => {
	const domainDir = resolve('../domain');
	const fixtureDir = resolve(domainDir, 'src/__m9_tripwire__');
	const fixtureRel = 'src/__m9_tripwire__/leak.ts';
	mkdirSync(fixtureDir, { recursive: true });
	writeFileSync(resolve(domainDir, fixtureRel), "import 'better-sqlite3';\nexport const leak = true;\n");

	let failed = false;
	let stdout = '';
	try {
		execFileSync('pnpm', ['exec', 'eslint', fixtureRel, '--format', 'json'], {
			cwd: domainDir,
			encoding: 'utf8'
		});
	} catch (e) {
		failed = true;
		stdout = (e as { stdout?: string }).stdout ?? '';
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
	}

	expect(failed).toBe(true); // eslint exits non-zero when the rule fires
	const results = JSON.parse(stdout) as { messages: { ruleId: string | null }[] }[];
	const ruleIds = results.flatMap((r) => r.messages.map((m) => m.ruleId));
	expect(ruleIds).toContain('no-restricted-imports');
});
