import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Domain package lint.
 *
 * The load-bearing rule (report M9) is the isomorphic boundary: this package must
 * not import node built-ins, persistence drivers, or Svelte(Kit) modules, so the
 * same code runs client-side in the offline PWA (P3) without a rewrite. A leaked
 * `node:fs` / `better-sqlite3` / `$app/*` import fails lint = fails CI.
 *
 * The companion rule is determinism: the domain must not read ambient
 * nondeterminism (`Math.random`, `Date.now`, `performance.now`) — callers inject a
 * seeded rng / clock instead, so the fold/replay/distribution proofs stay
 * reproducible. `no-restricted-properties` (below) gives that invariant teeth.
 */
export default tseslint.config(
  { ignores: ['dist/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: 'domain must stay isomorphic — no node: built-ins (report M9).',
            },
            {
              group: [
                'fs', 'fs/*', 'path', 'os', 'crypto', 'http', 'https',
                'stream', 'child_process', 'better-sqlite3',
                'drizzle-orm', 'drizzle-orm/*',
              ],
              message:
                'domain must stay isomorphic — no node built-ins / persistence drivers (report M9).',
            },
            {
              group: ['svelte', 'svelte/*', '@sveltejs/*', '$app/*', '$env/*', '$lib/*'],
              message:
                'domain must not depend on Svelte(Kit) — keep UI/framework out of the domain (report M9).',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            '@lt/domain must be deterministic + isomorphic — inject a seeded rng / clock instead (M9 determinism).',
        },
        {
          object: 'Date',
          property: 'now',
          message:
            '@lt/domain must be deterministic + isomorphic — inject a seeded rng / clock instead (M9 determinism).',
        },
        {
          object: 'performance',
          property: 'now',
          message:
            '@lt/domain must be deterministic + isomorphic — inject a seeded rng / clock instead (M9 determinism).',
        },
      ],
    },
  },
);
