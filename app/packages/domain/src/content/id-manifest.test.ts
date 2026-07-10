import { describe, expect, it } from 'vitest';
import {
  canonicalParamKey,
  reconcileIdManifest,
  type CurrentIds,
  type IdManifest
} from './id-manifest';

const base: IdManifest = {
  exerciseTypeKeys: ['transformation'],
  ruleKeys: ['L2#conv-al'],
  itemSlugs: { 'al-normal': 1 },
  remap: { ruleKeys: {}, itemSlugs: {} }
};
const current: CurrentIds = {
  exerciseTypeKeys: ['transformation'],
  ruleKeys: ['L2#conv-al'],
  itemSlugs: ['al-normal']
};

describe('reconcileIdManifest — the id snapshot guard (#3)', () => {
  it('is clean and up to date when current matches committed', () => {
    const r = reconcileIdManifest(current, base);
    expect(r.errors).toEqual([]);
    expect(r.upToDate).toBe(true);
  });

  it('FAILS when a known rule key disappears without a remap entry', () => {
    const r = reconcileIdManifest({ ...current, ruleKeys: [] }, base);
    expect(r.errors.join(' ')).toMatch(/L2#conv-al.*disappear/i);
  });

  it('FAILS when a known item slug disappears without a remap entry', () => {
    const r = reconcileIdManifest({ ...current, itemSlugs: [] }, base);
    expect(r.errors.join(' ')).toMatch(/al-normal.*disappear/i);
  });

  it('a reviewed remap entry rescues a renamed rule key', () => {
    const committed: IdManifest = {
      ...base,
      remap: { ruleKeys: { 'L2#conv-al': 'L2#conv-al-suffix' }, itemSlugs: {} }
    };
    const r = reconcileIdManifest({ ...current, ruleKeys: ['L2#conv-al-suffix'] }, committed);
    expect(r.errors).toEqual([]);
  });

  it('FAILS when a remap target is not present in content', () => {
    const committed: IdManifest = {
      ...base,
      remap: { ruleKeys: { 'L2#conv-al': 'ghost' }, itemSlugs: {} }
    };
    const r = reconcileIdManifest({ ...current, ruleKeys: [] }, committed);
    expect(r.errors.join(' ')).toMatch(/ghost.*not in content/i);
  });

  it('is not up to date when content adds a new id (prompts a manifest update)', () => {
    const cur: CurrentIds = {
      ...current,
      ruleKeys: ['L2#conv-al', 'L3#conv-mente'],
      itemSlugs: ['al-normal', 'mente-normally']
    };
    const r = reconcileIdManifest(cur, base);
    expect(r.errors).toEqual([]);
    expect(r.upToDate).toBe(false);
    expect(r.next.ruleKeys).toContain('L3#conv-mente');
  });

  it('assigns stable surrogate ints — preserves existing, appends the next for new', () => {
    const r = reconcileIdManifest({ ...current, itemSlugs: ['al-normal', 'al-legal'] }, base);
    expect(r.next.itemSlugs['al-normal']).toBe(1);
    expect(r.next.itemSlugs['al-legal']).toBe(2);
  });

  it('never reuses a retired surrogate int', () => {
    const committed: IdManifest = {
      ...base,
      itemSlugs: { 'al-normal': 1, 'al-legal': 2 },
      remap: { ruleKeys: {}, itemSlugs: { 'al-legal': 'al-legal-x' } }
    };
    const r = reconcileIdManifest({ ...current, itemSlugs: ['al-normal', 'al-legal-x'] }, committed);
    expect(r.next.itemSlugs['al-normal']).toBe(1);
    expect(r.next.itemSlugs['al-legal-x']).toBe(3); // not 2 (retired)
  });

  it('FAILS on an id with a colliding / invalid format', () => {
    const r = reconcileIdManifest({ ...current, itemSlugs: ['bad/slug'] }, base);
    expect(r.errors.join(' ')).toMatch(/bad\/slug.*format/i);
  });
});

describe('canonicalParamKey (#3)', () => {
  it('empty params -> empty string (the transformation case)', () => {
    expect(canonicalParamKey({})).toBe('');
  });

  it('is sorted, percent-encoded, and delimiter-safe', () => {
    expect(canonicalParamKey({ b: 2, a: 'x y' })).toBe('a=x%20y;b=2');
  });
});
