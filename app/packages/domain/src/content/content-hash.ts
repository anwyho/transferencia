import type { Item } from '../exercise/types';

/**
 * Stable content hash over ANSWER-DEFINING fields only (kind, front_en, back_es,
 * sorted directions + accepted_answers — NOT hint). Non-cryptographic FNV-1a:
 * deterministic and isomorphic (no node:crypto), which is all staleness detection
 * needs. A hint edit is a no-op; an answer edit churns the hash by design (m6).
 * Captured on attempts + the ReviewLog in slice C.
 */
export function contentHash(item: Item): string {
  const canonical = JSON.stringify({
    kind: item.kind,
    front_en: item.front_en,
    back_es: item.back_es,
    directions: [...item.directions].sort(),
    accepted_answers: [...(item.accepted_answers ?? [])].sort(),
  });
  return fnv1a(canonical);
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
