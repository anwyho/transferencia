import type { Direction, Grade, Grader, ParamEnumerator, PromptRenderer } from './types';
import { defineExerciseType } from './types';
import { matchSpanish } from './text-match';

/**
 * The `transformation` exercise type (design v2 §Exercise composability; card-design.md):
 * derive the Spanish form from the English via a rule (e.g. -tion → -ción). Slice A's
 * single registered type.
 */
interface TransformationParams {
  direction: Direction;
}

const paramEnumerator: ParamEnumerator<TransformationParams> = {
  paramsFor(item) {
    // No type-specific params → the canonical param_key is '' (the B1/#2 touchpoint:
    // the encoding is honest from attempt #1). `direction` is a separate identity
    // dimension carried in `params` (logged in its own column), never in the key.
    return item.directions.map((direction) => ({ key: '', params: { direction } }));
  },
};

const promptRenderer: PromptRenderer<TransformationParams> = {
  render(item, { direction }) {
    const [given, instruction] =
      direction === 'en>es'
        ? [item.front_en, 'Translate to Spanish']
        : [item.back_es, 'Translate to English'];
    return {
      modality: 'text',
      exerciseTypeKey: 'transformation',
      direction,
      instruction,
      given,
      hintAvailable: item.hint != null,
    };
  },
};

const grader: Grader<TransformationParams> = {
  grade(item, { direction }, response): Grade {
    const expected =
      direction === 'en>es'
        ? [item.back_es, ...(item.accepted_answers ?? [])]
        : [item.front_en];
    const result = matchSpanish(response.text, expected);
    if (!result.correct) return { correct: false };
    if (result.accentMismatch) {
      return { correct: true, detail: `accent mismatch — expected “${result.matched}”` };
    }
    return { correct: true };
  },
};

export const transformationType = defineExerciseType<TransformationParams>({
  stableKey: 'transformation',
  supports: (item) => item.kind === 'transformation',
  inputModalities: ['text'],
  paramEnumerator,
  promptRenderer,
  grader,
});
