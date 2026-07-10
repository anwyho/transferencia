/**
 * Domain package entrypoint.
 *
 * Isomorphic by contract: nothing reachable from here may import node built-ins,
 * persistence drivers, or Svelte(Kit) modules (enforced by eslint — report M9),
 * so the same logic runs on the server today and client-side in the offline PWA
 * (P3). Real Phase-0 contracts (ExerciseType / Prompt / Response / Grade) land in
 * Epic A (#6); this is just enough to wire and smoke-test the package boundary.
 */

/** Proof-of-wiring marker imported by the web smoke route; replaced in Epic A. */
export const DOMAIN_READY = true as const;

/** Trivial pure function exercised by the scaffold smoke test. */
export function ping(): 'domain' {
  return 'domain';
}

// Phase-0 exercise composability layer (Epic A): contracts + the transformation type.
export * from './exercise/index';

// Phase-0 content plane (Epic B): Rule/Item schemas, store + boot validation, lesson gate.
export * from './content/index';

// Slice C.1 persistence ports (pure contracts + trivial scheduler; the Drizzle impl
// lives in @lt/web server — the domain stays isomorphic, report M9).
export * from './ports/index';
