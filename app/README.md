# Language Transfer practice app

The interactive practice app (Phase 0: Foundation). Separate from the repo's
Anki/podcast pipeline (`build/`, `cards/`, `audio/`, `podcast.xml`) — this is a
pnpm + SvelteKit workspace and shares none of that Python toolchain.

Design: [`docs/superpowers/specs/2026-07-09-language-transfer-design-v2.md`](../docs/superpowers/specs/2026-07-09-language-transfer-design-v2.md)
· constraints ledger: [`language-transfer-requirements.md`](../docs/superpowers/specs/language-transfer-requirements.md)
· standards: [`AGENTS.md`](../AGENTS.md).

## Layout

```
app/
├── pnpm-workspace.yaml
├── package.json              # root scripts: test / lint / check / build / test:e2e
└── packages/
    ├── domain/               # @lt/domain — isomorphic domain logic
    │   └── src/              #   NO node:* / persistence / Svelte(Kit) imports (lint-enforced)
    └── web/                  # @lt/web — SvelteKit app (adapter-node) + Playwright
        └── src/
```

**Why two packages.** `@lt/domain` is the pure, framework-free core (contracts,
grader, scheduler, planner as they land). It carries the load-bearing constraint
from the design review (M9): it must not import node built-ins, persistence
drivers, or Svelte(Kit), so the exact same code runs server-side today and
client-side in the eventual offline PWA (P3). That boundary is enforced by an
eslint `no-restricted-imports` rule — a leaked `node:fs` import fails CI, it is
not a matter of discipline. `@lt/web` consumes `@lt/domain` as TypeScript source
(Vite transpiles it; no build step in the dev/test loop).

## Quickstart

```bash
cd app
pnpm install
pnpm --filter @lt/web exec playwright install chromium   # one-time, for e2e

pnpm test        # unit tests (Vitest) across all packages
pnpm check       # tsc --noEmit (domain) + svelte-check (web)
pnpm lint        # eslint + prettier (incl. the domain boundary rule)
pnpm build       # standalone builds (proves domain compiles on its own)
pnpm test:e2e    # Playwright: builds the app, previews it, drives the real screen
pnpm --filter @lt/web dev   # dev server
```

## Verification standard

Per `AGENTS.md`: every slice ships with automated tests **and** a Playwright
walkthrough of the real (scrappy, automatable) screen — evidence before claims.
The scrappy UI stays automatable (stable `data-testid`s), not pretty.
