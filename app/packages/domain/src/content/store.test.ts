import { describe, expect, it } from 'vitest';
import { transformationType } from '../exercise/transformation';
import type { Item } from '../exercise/types';
import type { Rule } from './types';
import { buildContentStore, ContentValidationError } from './store';

const types = [transformationType];

function rule(over: Partial<Rule> & { key: string }): Rule {
  return { kind: 'transformation', homeLesson: 2, bundle: 'A', importance: 1, schedulable: true, ...over };
}
function item(over: Partial<Item> & { id: string }): Item {
  return {
    kind: 'transformation',
    front_en: 'nation',
    back_es: 'nación',
    min_lesson: 2,
    directions: ['en>es'],
    rule_refs: [{ key: 'r1', role: 'tests' }],
    tier: 'primary',
    related_lessons: [2],
    ...over,
  };
}

describe('buildContentStore — indexes + boot validation (B.1)', () => {
  it('builds a valid store, indexes it, and attaches content_hash', () => {
    const store = buildContentStore([rule({ key: 'r1' })], [item({ id: 'i1' })], types);
    expect(store.get('i1')?.content_hash).toMatch(/^[0-9a-f]{8}$/);
    expect(store.all()).toHaveLength(1);
    expect(store.byKind('transformation').map((i) => i.id)).toEqual(['i1']);
    expect(store.byTier('primary').map((i) => i.id)).toEqual(['i1']);
    expect(store.itemsForRule('r1').map((i) => i.id)).toEqual(['i1']);
    expect(store.getRule('r1')?.key).toBe('r1');
    expect(store.schedulableRules()).toHaveLength(1);
  });

  it('FATAL on duplicate item id', () => {
    expect(() =>
      buildContentStore([rule({ key: 'r1' })], [item({ id: 'dup' }), item({ id: 'dup' })], types)
    ).toThrow(ContentValidationError);
  });

  it('FATAL on duplicate rule key', () => {
    expect(() =>
      buildContentStore([rule({ key: 'r1' }), rule({ key: 'r1' })], [item({ id: 'i1' })], types)
    ).toThrow(ContentValidationError);
  });

  it('FATAL on unresolved rule_ref', () => {
    expect(() =>
      buildContentStore(
        [rule({ key: 'r1' })],
        [item({ id: 'i1', rule_refs: [{ key: 'ghost', role: 'tests' }] })],
        types
      )
    ).toThrow(/unknown rule/);
  });

  it('FATAL on supported-but-zero-params (undrillable)', () => {
    // transformation supports the item (kind) but enumerates zero instruments with no directions.
    expect(() =>
      buildContentStore([rule({ key: 'r1' })], [item({ id: 'i1', directions: [] })], types)
    ).toThrow(/zero param|undrillable/i);
  });

  it('FATAL when a schedulable rule has no eligible instrument at its home lesson', () => {
    expect(() =>
      buildContentStore([rule({ key: 'r1' }), rule({ key: 'r2' })], [item({ id: 'i1' })], types)
    ).toThrow(/no eligible instrument/i);
  });

  it('FATAL when the only ref to a schedulable rule is role "uses" (foreshadowing never gates)', () => {
    expect(() =>
      buildContentStore(
        [rule({ key: 'r1' })],
        [item({ id: 'i1', rule_refs: [{ key: 'r1', role: 'uses' }] })],
        types
      )
    ).toThrow(/no eligible instrument/i);
  });

  it('does NOT require instruments for schedulable:false (dormant) rules', () => {
    const store = buildContentStore(
      [rule({ key: 'r1' }), rule({ key: 'dormant', schedulable: false, kind: 'lexical' })],
      [item({ id: 'i1' })],
      types
    );
    expect(store.getRule('dormant')?.schedulable).toBe(false);
    expect(store.schedulableRules().map((r) => r.key)).toEqual(['r1']);
  });
});
