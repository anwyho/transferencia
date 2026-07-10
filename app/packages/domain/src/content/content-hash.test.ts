import { describe, expect, it } from 'vitest';
import { contentHash } from './content-hash';
import type { Item } from '../exercise/types';

const base: Item = {
  id: 'i1',
  kind: 'transformation',
  front_en: 'nation',
  back_es: 'nación',
  min_lesson: 2,
  directions: ['en>es'],
  rule_refs: [{ key: 'r1', role: 'tests' }],
  tier: 'primary',
  related_lessons: [2],
};

describe('contentHash (B.1)', () => {
  it('is deterministic', () => {
    expect(contentHash(base)).toBe(contentHash({ ...base }));
  });

  it('changes when an answer-defining field changes (back_es)', () => {
    expect(contentHash(base)).not.toBe(contentHash({ ...base, back_es: 'nacion' }));
  });

  it('ignores non-answer fields — a hint edit is a no-op (report m6)', () => {
    expect(contentHash(base)).toBe(contentHash({ ...base, hint: 'anything at all' }));
  });
});
