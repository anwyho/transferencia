import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Domain package lint.
 *
 * The load-bearing rule (report M9) is the isomorphic boundary: this package must
 * not import node built-ins, persistence drivers, or Svelte(Kit) modules, so the
 * same code runs client-side in the offline PWA (P3) without a rewrite. A leaked
 * `node:fs` / `better-sqlite3` / `$app/*` import fails lint = fails CI.
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
    },
  },
);
