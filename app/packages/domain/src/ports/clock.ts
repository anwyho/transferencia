/**
 * Time port (design v2 §Multi-user & persistence seams; C.1 design §Ports).
 * Epoch ms, UTC. Prod impl = wall clock (web); test impl = wall clock + a mutable
 * offset so a Playwright walkthrough can advance time instantly. Isomorphic: the
 * domain never reads `Date.now()` directly, so folds/scheduling stay deterministic.
 */
export interface Clock {
  now(): number;
}
