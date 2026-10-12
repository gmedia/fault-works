# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. Read it before changing code. [CONTRIBUTING.md](CONTRIBUTING.md) covers the contribution process; this file covers how the code works and what must stay true.

## What this project is

FaultWorks is a browser-only workbench for reproducible infrastructure failure experiments: a small directed graph of components (client, load balancers, services, databases, caches, worker queues) joined by links with latency, timeouts, retries and circuit breakers; seven kinds of scheduled fault; a deterministic discrete-event simulation; and an A/B comparison. There is no backend, account or telemetry. Simulation results are model outputs, never predictions of real systems, and the UI must never suggest otherwise.

The interface is Indonesian first (default language `id`, English when the browser prefers it). Every user-visible string goes through `t()`; see "Languages" below.

## Commands

Node 22+ and pnpm 10. Run from the repository root.

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Dev server | `pnpm dev` (http://localhost:3000) |
| Lint and format check | `pnpm check` (fix with `pnpm format` or `pnpm biome check --write`) |
| Typecheck all packages | `pnpm typecheck` |
| Unit, property and golden tests | `pnpm test` |
| One package | `pnpm --filter @faultworks/engine test` (also `experiment`, `metrics`, `web`) |
| Production build | `pnpm build` |
| E2E, accessibility, mobile | `pnpm test:e2e` (builds first; needs `pnpm --filter @faultworks/web exec playwright install chromium`) |
| Regenerate routes | `pnpm --filter @faultworks/web generate-routes` |

A change is done when `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:e2e` all pass.

## Layout and dependency direction

```text
apps/web               React 19 + Vite SPA (TanStack Router, React Flow, Zustand, Tailwind v4, shadcn/ui)
packages/engine        simulate(), PRNG, event queue, engine types        ← depends on nothing
packages/experiment    zod schema, migrate, validate, compile, digests, diff, import  ← engine
packages/metrics       recorder, event log, explanations, comparison     ← engine
examples/{id,en}/*.json built-in experiments per language, imported by packages/experiment
docs/                  product, model and decision documents
```

Packages are consumed as TypeScript source (`exports: ./src/index.ts`); there is no package build step. Inside packages, relative imports include the `.ts` extension. In `apps/web`, use the `#/` alias for `src/` (for example `#/lib/utils.ts`).

## Invariants you must not break

**Determinism.** Same experiment, seed and engine version must produce the byte-identical event trace.
- Never use `Math.random`, `Date`, `performance` or iteration over unordered state inside `packages/engine`.
- Randomness comes only from `createRng(seed, stream)` with a named stream (`arrivals`, `service:<id>`, `balancer:<id>`, `edge:<id>`).
- Same-time ordering is the `PRIORITY` table in `packages/engine/src/simulate.ts`. Changing it, the PRNG, or event semantics changes traces: bump `ENGINE_VERSION`, update golden tests on purpose, and note it in `CHANGELOG.md`.

**Request lifecycle.** Every request ends exactly once (`succeeded` or `failed`). Work finished after the client deadline is a `late-response`, never a success. Offered = succeeded + failed + still in flight. The metrics recorder checks these after every run; property tests check them over random inputs.

**Separation.** The engine knows nothing about React, the DOM, canvas layout or labels. Metrics read events only. Layout, titles, notes and labels must never change results; `runKey` (the behavior digest) ignores them.

**Languages.** Packages never produce English sentences: validation issues, insights and check details are `{ key, params }` (see `messages.ts`), and the web app translates them. In `apps/web`, every label, unit, message and aria-label comes from `t("…")` with keys in `src/i18n/locales/id.json` (primary) and `en.json`. Add new keys to both files; `src/i18n/keys.test.ts` fails when a key the app uses is missing from either, when the two files differ in keys, or when their placeholders differ. Use i18next plural suffixes (`_one`, `_other`) only in `en.json`; Indonesian has one form.

**File format.** `packages/experiment/src/schema.ts` is the contract. Unknown fields are rejected. Any change to a field's meaning or shape needs a new schema version, a migration in `migrate.ts`, migration tests, and an update to `docs/06-EXPERIMENT-FORMAT.md`. Imports are data only and size-limited; never execute or `eval` anything from a file.

**Browser-only.** Do not add a server, network calls, analytics or accounts. Results are not persisted; they are recomputed from the experiment (see `state/runs.ts`). Persist only through the safe storage wrapper in `state/library.ts`.

**Budget.** Product limits live in `LIMITS` in `schema.ts` (12 nodes, 24 links, 12 faults, 15 minutes, about 250,000 requests, 3,000,000 events). Runs happen in the Web Worker (`apps/web/src/workers`), never on the main thread.

## Tests

- `packages/engine/src/*.test.ts`: reference cases with hand-computed answers (load balancing, chains, breakers, latency, loss, caches, queues, slowdowns, capacity, error rates) and fast-check properties over random graphs.
- `packages/experiment/src/experiment.test.ts`: schema, migrations, graph validation, editing helpers, examples in both languages.
- `packages/metrics/src/metrics.test.ts`: golden numbers for the built-in examples (for example 1,005 failed requests without health checks and 255 with). If one changes, explain why in the PR.
- `apps/web/src/**/*.test.ts`: locale key coverage, replay snapshots, the library store.
- `apps/web/e2e`: Playwright journeys (including free creation and the language switch), axe WCAG 2.2 A/AA scans in both themes and both languages, phone screens, reduced motion, and regression tests for pilot findings. Playwright pins `locale: "en-US"`, so specs use English strings unless they switch the language on purpose.

Add the cheapest test that proves the behavior. Wait for the page heading before sending keyboard input in E2E tests; route chunks load lazily.

## UI conventions

- Colors come from role tokens in `apps/web/src/styles.css` (light and dark). Text must meet WCAG AA contrast (4.5:1, 3:1 for large text and UI parts) in both themes.
- Status is always icon plus words plus color, never color alone. The amber hatch means "down but still routed" and is reserved for that.
- Every chart has a title, units, a legend for two or more series, a keyboard slider with a text value, and a table view.
- Touch targets are at least 44 px on coarse pointers; no horizontal page scroll at 320 px. Below 768 px the workbench shows three screens (Build, Replay, Results) with a bottom tab bar and a settings sheet; secondary header actions move into the "More actions" menu. Design for the phone first, then widen.
- Copy is plain, sentence case, and honest about the model. Field keys, units and option values come from `packages/experiment/src/fields.ts`; their texts live under `fields.*`, `units.*` and `options.*` in the locale files. Reuse them instead of inventing new names.
- Replay animation (flow dots, crash shake, pulse rings) lives in `styles.css` and must stay disabled under `prefers-reduced-motion`. Animation reads the replay position; it never feeds back into results.
- Zustand selectors must return stable values. Selecting a freshly built array or object (`Object.keys(...)`, `.filter(...)`) causes an infinite render loop.
- Components in `apps/web/src/components/ui` come from shadcn/ui. If you add more with the shadcn CLI, fix their imports to `#/lib/utils.ts`.
- `apps/web/src/routeTree.gen.ts` is generated; never edit it by hand.

## Code style

Biome enforces formatting (tabs, double quotes) and lint rules; do not disable rules without a written reason in a `biome-ignore` comment. Write comments that explain *why*, matching the existing density. Keep docs and code comments in English (the project brief in `docs/00` is Indonesian; the UI is Indonesian first) and update the relevant `docs/` page and `CHANGELOG.md` when behavior changes.

## When unsure

Prefer the smaller change, keep the model honest, and ask in the issue or PR rather than guessing at product direction. Scope and stop rules are in `docs/02-SCOPE-AND-ROADMAP.md`; decisions are in `docs/11-DECISION-LOG.md`.
