/**
 * Deterministic seeded PRNG (mulberry32). The domain must never call `Math.random` — the ban is
 * enforced by this package's lint (`no-restricted-properties`) and is required for determinism: the
 * fold/replay/distribution proofs need reproducible output. Callers inject a seed; the web route
 * seeds it per-session from the sessionId so a session's plan is reproducible.
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
