/**
 * Identity manifest reconciliation (report M8/M7/m7; design v2 §Identity & integrity).
 * Stable ids are sacred: SRS history keys on `Rule.key`, item slugs, and the exercise
 * `stableKey`. This module is the pure core of the committed id-manifest + snapshot
 * test — it detects silent id disappearance (data loss) and assigns stable surrogate
 * ints, while a reviewed remap table lets a deliberate rename survive.
 */

export interface IdManifest {
  exerciseTypeKeys: string[];
  ruleKeys: string[];
  /** slug -> stable surrogate int (assigned once, never reused). */
  itemSlugs: Record<string, number>;
  /** reviewed old->new renames, applied during the fold (slice C) and honored here. */
  remap: {
    ruleKeys: Record<string, string>;
    itemSlugs: Record<string, string>;
  };
}

export interface CurrentIds {
  exerciseTypeKeys: string[];
  ruleKeys: string[];
  itemSlugs: string[];
}

export interface ManifestReconcile {
  /** Non-empty = FATAL (silent id loss or an invalid id). CI must fail. */
  errors: string[];
  /** the manifest updated to reflect current ids (stable ints preserved). */
  next: IdManifest;
  /** true when the committed manifest already equals `next` (nothing to regenerate). */
  upToDate: boolean;
}

// Clean id charsets — no whitespace or delimiters (#, /, ;, ,, |, =) that could collide
// in a composite/serialized key. Rule keys carry exactly one '#': L<lesson>#<slug>.
const TYPE_KEY = /^[a-z][a-z0-9-]*$/;
const RULE_KEY = /^L\d+#[a-z0-9][a-z0-9-]*$/;
const ITEM_SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function reconcileIdManifest(
  current: CurrentIds,
  committed: IdManifest
): ManifestReconcile {
  const errors: string[] = [];

  // (a) format / delimiter-collision validation.
  for (const k of current.exerciseTypeKeys) {
    if (!TYPE_KEY.test(k)) errors.push(`exercise type key "${k}" has an invalid/colliding format`);
  }
  for (const k of current.ruleKeys) {
    if (!RULE_KEY.test(k)) errors.push(`rule key "${k}" has an invalid/colliding format`);
  }
  for (const s of current.itemSlugs) {
    if (!ITEM_SLUG.test(s)) errors.push(`item slug "${s}" has an invalid/colliding format`);
  }

  // (b) no silent disappearance — a known id must still be present or be remapped.
  const curRules = new Set(current.ruleKeys);
  for (const key of committed.ruleKeys) {
    if (curRules.has(key)) continue;
    const to = committed.remap.ruleKeys[key];
    if (!to) errors.push(`rule key "${key}" disappeared from content without a remap entry`);
    else if (!curRules.has(to)) {
      errors.push(`rule key "${key}" is remapped to "${to}" but that key is not in content`);
    }
  }
  const curSlugs = new Set(current.itemSlugs);
  for (const slug of Object.keys(committed.itemSlugs)) {
    if (curSlugs.has(slug)) continue;
    const to = committed.remap.itemSlugs[slug];
    if (!to) errors.push(`item slug "${slug}" disappeared from content without a remap entry`);
    else if (!curSlugs.has(to)) {
      errors.push(`item slug "${slug}" is remapped to "${to}" but that slug is not in content`);
    }
  }

  // (c) build the reconciled manifest — sorted, stable ints (existing preserved, retired
  //     ints never reused: the next int is always max-seen + 1).
  let maxInt = 0;
  for (const n of Object.values(committed.itemSlugs)) maxInt = Math.max(maxInt, n);
  const itemSlugs: Record<string, number> = {};
  for (const slug of [...current.itemSlugs].sort()) {
    itemSlugs[slug] = committed.itemSlugs[slug] ?? ++maxInt;
  }

  const next: IdManifest = {
    exerciseTypeKeys: [...current.exerciseTypeKeys].sort(),
    ruleKeys: [...current.ruleKeys].sort(),
    itemSlugs,
    remap: {
      ruleKeys: { ...committed.remap.ruleKeys },
      itemSlugs: { ...committed.remap.itemSlugs }
    }
  };

  return { errors, next, upToDate: errors.length === 0 && canon(committed) === canon(next) };
}

/**
 * Canonical, delimiter-safe param_key encoding a `ParamEnumerator` should emit: sorted
 * `k=v` pairs joined by `;`, keys and values percent-encoded so nothing collides. Empty
 * params encode as `''` (the transformation case). The type owns the key; this is the
 * shared encoding so ids stay reconstructable across enumerators.
 */
export function canonicalParamKey(params: Record<string, string | number>): string {
  const keys = Object.keys(params).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join(';');
}

function canon(m: IdManifest): string {
  return JSON.stringify({
    exerciseTypeKeys: [...m.exerciseTypeKeys].sort(),
    ruleKeys: [...m.ruleKeys].sort(),
    itemSlugs: sortObj(m.itemSlugs),
    remap: { ruleKeys: sortObj(m.remap.ruleKeys), itemSlugs: sortObj(m.remap.itemSlugs) }
  });
}

function sortObj<T>(o: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}
