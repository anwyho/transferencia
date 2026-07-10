import type {
  ExerciseType,
  Item,
  ItemKind,
  ItemLookup,
  RenderContext,
  Tier
} from '../exercise/types';
import type { Rule } from './types';
import { contentHash } from './content-hash';

/** Read-only content index (design v2 §Content plane). Built once, disk→memory. */
export interface ItemStore extends ItemLookup {
  all(): readonly Item[];
  byKind(kind: ItemKind): readonly Item[];
  byTier(tier: Tier): readonly Item[];
  /** rule→items inverted index. */
  itemsForRule(ruleKey: string): readonly Item[];
  getRule(key: string): Rule | undefined;
  allRules(): readonly Rule[];
  schedulableRules(): readonly Rule[];
}

/** A FATAL boot-validation failure (design v2 §Identity & integrity: boot-validate FATAL). */
export class ContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentValidationError';
  }
}

/**
 * Validate + index content into an `ItemStore`. Pure and isomorphic — the node-side
 * loader reads YAML off disk and hands the parsed arrays here (report M9). Throws
 * `ContentValidationError` (FATAL boot) on any of the four integrity violations.
 */
export function buildContentStore(
  rules: readonly Rule[],
  authoredItems: readonly Item[],
  exerciseTypes: readonly ExerciseType[]
): ItemStore {
  // (1a) rule keys unique — stable ids are sacred.
  const ruleByKey = new Map<string, Rule>();
  for (const r of rules) {
    if (ruleByKey.has(r.key)) throw new ContentValidationError(`duplicate rule key: ${r.key}`);
    ruleByKey.set(r.key, r);
  }

  // (1b) item ids unique; hydrate each with its derived content_hash.
  const itemById = new Map<string, Item>();
  const items: Item[] = [];
  for (const raw of authoredItems) {
    if (itemById.has(raw.id)) throw new ContentValidationError(`duplicate item id: ${raw.id}`);
    const item: Item = { ...raw, content_hash: contentHash(raw) };
    itemById.set(item.id, item);
    items.push(item);
  }

  // (2) every rule_ref resolves.
  for (const item of items) {
    for (const ref of item.rule_refs) {
      if (!ruleByKey.has(ref.key)) {
        throw new ContentValidationError(`item ${item.id} references unknown rule ${ref.key}`);
      }
    }
  }

  // indexes
  const byKind = new Map<ItemKind, Item[]>();
  const byTier = new Map<Tier, Item[]>();
  const itemsForRuleIdx = new Map<string, Item[]>();
  for (const item of items) {
    push(byKind, item.kind, item);
    if (item.tier) push(byTier, item.tier, item);
    for (const ref of item.rule_refs) push(itemsForRuleIdx, ref.key, item);
  }

  const store: ItemStore = {
    get: (id) => itemById.get(id),
    all: () => items,
    byKind: (k) => byKind.get(k) ?? [],
    byTier: (t) => byTier.get(t) ?? [],
    itemsForRule: (k) => itemsForRuleIdx.get(k) ?? [],
    getRule: (k) => ruleByKey.get(k),
    allRules: () => rules,
    schedulableRules: () => rules.filter((r) => r.schedulable),
  };

  const ctxAt = (currentLesson: number): RenderContext => ({
    items: store,
    currentLesson,
    rng: () => 0.5,
  });

  // Enumerate params (cheap, at boot) — distinct from lazy render (report m5).
  const paramCount = (item: Item, type: ExerciseType, currentLesson: number): number =>
    type.paramEnumerator.paramsFor(item, ctxAt(currentLesson)).length;

  // (3) supported-but-zero-params → silently undrillable.
  for (const item of items) {
    for (const type of exerciseTypes) {
      if (type.supports(item) && paramCount(item, type, item.min_lesson) === 0) {
        throw new ContentValidationError(
          `item ${item.id} is supported by ${type.stableKey} but enumerates zero params (undrillable)`
        );
      }
    }
  }

  // (4) every schedulable rule has >=1 eligible instrument at its home lesson.
  //     Eligible = an item that TESTS the rule (role 'tests', not mere foreshadowing),
  //     is gated in at the home lesson, and is drillable by some registered type.
  for (const rule of rules) {
    if (!rule.schedulable) continue;
    const hasEligible = (itemsForRuleIdx.get(rule.key) ?? []).some((item) => {
      const tests = item.rule_refs.some((r) => r.key === rule.key && r.role === 'tests');
      if (!tests || item.min_lesson > rule.homeLesson) return false;
      return exerciseTypes.some(
        (type) => type.supports(item) && paramCount(item, type, rule.homeLesson) > 0
      );
    });
    if (!hasEligible) {
      throw new ContentValidationError(
        `schedulable rule ${rule.key} has no eligible instrument at its home lesson ${rule.homeLesson}`
      );
    }
  }

  return store;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}
