import { describe, expect, it } from 'vitest';
import { transformationType } from './transformation';
import type { Item, ItemStore, RenderContext, Response } from './types';

const emptyStore: ItemStore = { get: () => undefined };
const ctx: RenderContext = { items: emptyStore, currentLesson: 1, rng: () => 0.5 };

const nation: Item = {
  id: 'l1-nation-nacion',
  kind: 'transformation',
  front_en: 'nation',
  back_es: 'nación',
  hint: '-tion → -ción',
  min_lesson: 1,
  directions: ['en>es'],
  rule_refs: [{ key: 'L1#suffix-cion', role: 'tests' }],
};

function text(t: string): Response {
  return { modality: 'text', text: t };
}

describe('transformation exercise type (A.1)', () => {
  it('has the stable key and text modality', () => {
    expect(transformationType.stableKey).toBe('transformation');
    expect(transformationType.inputModalities).toEqual(['text']);
  });

  it('supports() gates on item kind', () => {
    expect(transformationType.supports(nation)).toBe(true);
    expect(transformationType.supports({ ...nation, kind: 'cloze' } as unknown as Item)).toBe(false);
  });

  it('enumerates one instrument per direction with the canonical empty param_key', () => {
    // The B1/#2 touchpoint: param_key is present and canonical ('') even with no params.
    expect(transformationType.paramEnumerator.paramsFor(nation, ctx)).toEqual([
      { key: '', params: { direction: 'en>es' } },
    ]);
  });

  it('renders a text prompt carrying resolved content (not raw indices)', () => {
    const prompt = transformationType.promptRenderer.render(nation, { direction: 'en>es' }, ctx);
    expect(prompt).toEqual({
      modality: 'text',
      exerciseTypeKey: 'transformation',
      direction: 'en>es',
      instruction: 'Translate to Spanish',
      given: 'nation',
      hintAvailable: true,
    });
  });

  it('grades an exact answer correct with no note', () => {
    expect(
      transformationType.grader.grade(nation, { direction: 'en>es' }, text('nación'), ctx)
    ).toEqual({ correct: true });
  });

  it('grades a wrong answer incorrect', () => {
    expect(
      transformationType.grader.grade(nation, { direction: 'en>es' }, text('gato'), ctx)
    ).toEqual({ correct: false });
  });
});
