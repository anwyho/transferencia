import { describe, expect, it } from 'vitest';
import { eligibleItems, eligibleRules, isVisible } from './lesson-gate';
import type { Item, ItemKind, Tier } from '../exercise/types';
import type { Rule } from './types';
import type { ItemStore } from './store';

function item(id: string, minLesson: number, ruleKey: string): Item {
  return {
    id,
    kind: 'transformation',
    front_en: 'x',
    back_es: 'x',
    min_lesson: minLesson,
    directions: ['en>es'],
    rule_refs: [{ key: ruleKey, role: 'tests' }],
    tier: 'primary',
    related_lessons: [minLesson],
  };
}
function rule(key: string, homeLesson: number, schedulable = true): Rule {
  return { key, kind: 'transformation', homeLesson, bundle: 'A', importance: 1, schedulable };
}
function fakeStore(items: Item[], rules: Rule[]): ItemStore {
  return {
    get: (id) => items.find((i) => i.id === id),
    all: () => items,
    byKind: (k: ItemKind) => items.filter((i) => i.kind === k),
    byTier: (t: Tier) => items.filter((i) => i.tier === t),
    itemsForRule: (k) => items.filter((i) => i.rule_refs.some((r) => r.key === k)),
    getRule: (k) => rules.find((r) => r.key === k),
    allRules: () => rules,
    schedulableRules: () => rules.filter((r) => r.schedulable),
  };
}

const store = fakeStore(
  [item('b2', 2, 'r2'), item('a3', 3, 'r3'), item('c4', 4, 'r4')],
  [rule('r2', 2), rule('r3', 3), rule('r4', 4)]
);

describe('LessonGate (B.3, pure)', () => {
  it('isVisible gates on min_lesson', () => {
    expect(isVisible(item('x', 3, 'r3'), 2)).toBe(false);
    expect(isVisible(item('x', 3, 'r3'), 3)).toBe(true);
  });

  it('eligibleItems: empty at lesson 1, grows with the dial, in (min_lesson, id) order', () => {
    expect(eligibleItems(store, 1)).toEqual([]);
    expect(eligibleItems(store, 2).map((i) => i.id)).toEqual(['b2']);
    expect(eligibleItems(store, 3).map((i) => i.id)).toEqual(['b2', 'a3']);
    expect(eligibleItems(store, 4).map((i) => i.id)).toEqual(['b2', 'a3', 'c4']);
  });

  it('dropping the dial re-hides higher-lesson items (reversible)', () => {
    expect(eligibleItems(store, 4)).toHaveLength(3);
    expect(eligibleItems(store, 2).map((i) => i.id)).toEqual(['b2']);
  });

  it('eligibleRules tracks the dial', () => {
    expect(eligibleRules(store, 1)).toEqual([]);
    expect(eligibleRules(store, 3).map((r) => r.key)).toEqual(['r2', 'r3']);
    expect(eligibleRules(store, 2).map((r) => r.key)).toEqual(['r2']);
  });
});
