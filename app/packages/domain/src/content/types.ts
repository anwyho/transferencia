/** Rule kinds (design v2). meta + phonetic are dormant (schedulable:false) in a text app. */
export type RuleKind =
  | 'transformation'
  | 'paradigm'
  | 'lexical'
  | 'syntax'
  | 'confusable'
  | 'phonetic'
  | 'meta';

/**
 * A first-class Rule — the SRS unit (for the schedulable ones). Keys are stable
 * *semantic* slugs frozen independently of `rules.md` ordinals (report M8: the
 * positional `L13#3` is unstable). The committed manifest + snapshot guard is #0.3.
 */
export interface Rule {
  key: string;
  kind: RuleKind;
  /** The lesson that teaches (tests) the rule — its home; the gating floor for its instruments. */
  homeLesson: number;
  bundle: string;
  /** Rollup weight for mastery (tunable by the Monte Carlo experiment). */
  importance: number;
  /** Schedulable rules get an SRS schedule; dormant ones (meta/phonetic/P0-deferred spine) do not. */
  schedulable: boolean;
  label?: string;
  parentKey?: string;
}
