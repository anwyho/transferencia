import { beforeAll, describe, expect, it } from 'vitest';
import { contentStore, load } from './content-loader';
import { eligibleItems, eligibleRules, type ItemStore } from '@lt/domain';

describe('content loader — seed loads clean (B.2)', () => {
	let store: ItemStore;

	beforeAll(() => {
		// The core AC: the real L1-5 seed passes every boot-validation FATAL check.
		store = contentStore();
	});

	it('indexes the dormant + schedulable rules and the item bank', () => {
		expect(store.allRules().length).toBe(11);
		expect(store.schedulableRules().length).toBe(7);
		expect(store.all().length).toBeGreaterThanOrEqual(30);
	});

	it('every schedulable rule has a TESTED instrument gated in at its home lesson', () => {
		for (const rule of store.schedulableRules()) {
			const ok = store
				.itemsForRule(rule.key)
				.some(
					(i) =>
						i.rule_refs.some((ref) => ref.key === rule.key && ref.role === 'tests') &&
						i.min_lesson <= rule.homeLesson
				);
			expect(ok, rule.key).toBe(true);
		}
	});

	it('gates: nothing at lesson 1, growing L2 -> L5', () => {
		expect(eligibleItems(store, 1)).toEqual([]);
		const atL2 = eligibleItems(store, 2).length;
		const atL5 = eligibleItems(store, 5).length;
		expect(atL2).toBeGreaterThan(0);
		expect(atL5).toBeGreaterThan(atL2);
	});

	it('dormant spine/pronoun rules exist but are never eligible (deferred to P1)', () => {
		expect(store.getRule('L4#spine-quiero')?.schedulable).toBe(false);
		expect(eligibleRules(store, 5).map((r) => r.key)).not.toContain('L4#spine-quiero');
	});

	it('surfaces a clear error on malformed content', () => {
		expect(() => load({ 'bad.yaml': 'rules:\n  - kind: transformation\n' })).toThrow(
			/content bad\.yaml.*key.*non-empty string/
		);
	});
});
