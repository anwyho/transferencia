import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	reconcileIdManifest,
	transformationType,
	type CurrentIds,
	type IdManifest
} from '@lt/domain';
import { contentStore } from '../server/content-loader';

// The committed id-manifest snapshot guard (#3 / #0.3). CI fails if a known Rule.key or
// item slug disappears (or changes) without a reviewed remap entry — silent SRS data
// loss becomes a reviewable event. Regenerate after intentional content changes with:
//   pnpm --filter @lt/web manifest:update
const MANIFEST_PATH = fileURLToPath(new URL('./id-manifest.json', import.meta.url));
const EMPTY: IdManifest = {
	exerciseTypeKeys: [],
	ruleKeys: [],
	itemSlugs: {},
	remap: { ruleKeys: {}, itemSlugs: {} }
};

function readManifest(): IdManifest {
	return existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : EMPTY;
}

function currentIds(): CurrentIds {
	const store = contentStore();
	return {
		exerciseTypeKeys: [transformationType.stableKey],
		ruleKeys: store.allRules().map((r) => r.key),
		itemSlugs: store.all().map((i) => i.id)
	};
}

describe('id manifest snapshot — no silent id loss (#3 / #0.3)', () => {
	it('committed manifest reconciles clean against the seed content', () => {
		const { errors, next, upToDate } = reconcileIdManifest(currentIds(), readManifest());

		if (process.env.UPDATE_ID_MANIFEST === '1') {
			writeFileSync(MANIFEST_PATH, JSON.stringify(next, null, '\t') + '\n');
			expect(next.ruleKeys.length).toBeGreaterThan(0);
			return;
		}

		expect(errors).toEqual([]);
		expect(upToDate, 'id-manifest is stale — run `pnpm --filter @lt/web manifest:update`').toBe(
			true
		);
	});
});
