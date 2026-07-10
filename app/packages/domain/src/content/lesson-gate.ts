import type { Item } from '../exercise/types';
import type { Rule } from './types';
import type { ItemStore } from './store';

/**
 * Pure lesson gating: an item is visible iff `min_lesson <= current_lesson`
 * (design v2; the linear dial is a valid topological sort — see lesson-dependencies.md).
 * Nothing here holds state; the dial is passed in and is fully reversible.
 */
export function isVisible(item: Item, currentLesson: number): boolean {
  return item.min_lesson <= currentLesson;
}

/** Eligible items at the dial, in a defined stable order: (min_lesson asc, id asc). */
export function eligibleItems(store: ItemStore, currentLesson: number): Item[] {
  return store
    .all()
    .filter((item) => isVisible(item, currentLesson))
    .sort((a, b) => a.min_lesson - b.min_lesson || cmp(a.id, b.id));
}

/**
 * Schedulable rules whose home is reached AND that have >=1 gated-in *tested*
 * instrument, ordered (homeLesson asc, key asc). This is the rule-grain view the
 * later slices' selection reads through.
 */
export function eligibleRules(store: ItemStore, currentLesson: number): Rule[] {
  return store
    .schedulableRules()
    .filter((rule) => rule.homeLesson <= currentLesson)
    .filter((rule) =>
      store
        .itemsForRule(rule.key)
        .some(
          (item) =>
            item.rule_refs.some((ref) => ref.key === rule.key && ref.role === 'tests') &&
            isVisible(item, currentLesson)
        )
    )
    .sort((a, b) => a.homeLesson - b.homeLesson || cmp(a.key, b.key));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
