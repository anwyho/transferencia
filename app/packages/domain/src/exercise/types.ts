/**
 * Exercise composability contracts (design v2 §Exercise composability).
 *
 * `Item` is blind to how it's quizzed. An `ExerciseType` is a strategy (code, not
 * data) that enumerates an item's instruments, renders a prompt, and grades a
 * response. `Prompt`/`Response` are discriminated unions on input modality that
 * carry *resolved* content (never raw indices) so graders never touch a `Prompt`.
 */

export type SrsRating = 'again' | 'hard' | 'good' | 'easy';

/** Input modality an instrument uses. Slice A ships text only; MCQ/speech land later. */
export type InputModality = 'text';

/** Quiz direction. Production (EN→ES) is primary; ES→EN is the reverse. */
export type Direction = 'en>es' | 'es>en';

/** Whether an item *tests* a rule (earns mastery credit) or merely *uses* it (foreshadowing). */
export type RuleRole = 'tests' | 'uses';
export interface RuleRef {
  key: string;
  role: RuleRole;
}

/** Content kinds. Slice A registers only `transformation`. */
export type ItemKind = 'transformation';

/** Content tier: drawn straight from the lesson (primary) vs applied real-world examples (extended). */
export type Tier = 'primary' | 'extended';

/**
 * A content item — a variance instrument for the rules it tests. Slice A uses a
 * hardcoded instance; the YAML schema, full field set, and validating store are
 * slice B (#10). `id` is a short slug, NEVER the sentence.
 */
export interface Item {
  id: string;
  kind: ItemKind;
  front_en: string;
  back_es: string;
  hint?: string;
  /** Legitimately-variant correct answers beyond `back_es` (ledger grading decision / report M1). */
  accepted_answers?: string[];
  /** Visible iff `min_lesson <= current_lesson`. */
  min_lesson: number;
  /** Directions this item can be quizzed in. */
  directions: Direction[];
  rule_refs: RuleRef[];
  /** primary | extended (slice B content). Optional on the type; required of authored content by the loader. */
  tier?: Tier;
  /** Sibling lessons for the "read why this answer" surface (from the dependency thread). */
  related_lessons?: number[];
  /** Derived at load over answer-defining fields (never authored). Populated by `buildContentStore`. */
  content_hash?: string;
}

/** Minimal item lookup. The full indexed content store (`content/store.ts`) extends this. */
export interface ItemLookup {
  get(id: string): Item | undefined;
}

export interface RenderContext {
  items: ItemLookup;
  currentLesson: number;
  rng: () => number;
}
export type GradeContext = Pick<RenderContext, 'items'>;

/** A prompt shown to the learner. Discriminated on `modality`; carries resolved content. */
export type Prompt = {
  modality: 'text';
  exerciseTypeKey: string;
  direction: Direction;
  instruction: string;
  /** The resolved source text to transform (the English word for en>es). */
  given: string;
  /** Whether a hint exists for this item (a content flag — NOT whether it was revealed). */
  hintAvailable: boolean;
};

/** A learner's response. Discriminated on `modality`. */
export type Response = {
  modality: 'text';
  text: string;
};

/**
 * The grader's assessment. The final `SrsRating` is derived from this by the
 * central rating policy (`ratingFromAssessment`), never by the grader itself.
 */
export interface Grade {
  correct: boolean;
  score?: number;
  detail?: string;
}

export interface ParamEnumerator<P> {
  /** Enumerate this item's instruments. `key` is the canonical, type-owned param_key. */
  paramsFor(item: Item, ctx: RenderContext): { key: string; params: P }[];
}
export interface PromptRenderer<P> {
  render(item: Item, params: P, ctx: RenderContext): Prompt;
}
export interface Grader<P> {
  grade(item: Item, params: P, response: Response, ctx: GradeContext): Grade;
}

export interface ExerciseType {
  stableKey: string;
  supports(item: Item): boolean;
  inputModalities: InputModality[];
  paramEnumerator: ParamEnumerator<unknown>;
  promptRenderer: PromptRenderer<unknown>;
  grader: Grader<unknown>;
}

/**
 * Assemble a typed exercise type into the type-erased `ExerciseType` the registry
 * holds. Params are `P` internally (type-safe) and `unknown` at the boundary; the
 * same type both enumerates and consumes its own params, so the erasure is sound.
 */
export function defineExerciseType<P>(config: {
  stableKey: string;
  supports(item: Item): boolean;
  inputModalities: InputModality[];
  paramEnumerator: ParamEnumerator<P>;
  promptRenderer: PromptRenderer<P>;
  grader: Grader<P>;
}): ExerciseType {
  return config as unknown as ExerciseType;
}

/** Signals the central rating policy consumes alongside the grade. */
export interface RatingSignals {
  hintRevealed: boolean;
  selfReport?: SrsRating;
}
