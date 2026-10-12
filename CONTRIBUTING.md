# Contributing to FaultWorks

Thanks for helping. FaultWorks is small on purpose: one correct, well-explained failure scenario is worth more than ten loosely modeled ones. This guide covers how to set up, what a good change looks like, and how it gets merged.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md), never in a public issue.

## Ways to help

- **Use it and tell us where you got stuck.** A report like "I thought p95 meant X" is as useful as a bug report. Open an issue with the *Feedback* or *Bug* template.
- **Fix a bug or a confusing screen.** Issues labeled `good first issue` are a good start.
- **Propose a new behavior** (retries, circuit breakers, caches). Open a *Feature* issue first and describe the behavioral contract before writing code; see [Adding model behavior](#adding-model-behavior).
- **Improve the docs or examples.** Built-in examples must teach one thing and say what they expect.

## Set up

You need Node 22 or newer and pnpm 10.

```bash
pnpm install
pnpm dev          # web app on http://localhost:3000
```

Before you push, run what CI runs:

```bash
pnpm check        # Biome lint and format (pnpm format fixes formatting)
pnpm typecheck
pnpm test         # unit, property-based and golden tests
pnpm build
pnpm test:e2e     # Playwright journeys, accessibility and mobile checks
```

`pnpm test:e2e` builds the app and needs a Chromium for Playwright: `pnpm --filter @faultworks/web exec playwright install chromium`.

## How the code is organized

| Path | What lives there | Rules |
|---|---|---|
| `packages/engine` | The discrete-event simulation | No React, DOM, `Date` or `Math.random`. Same input and seed must give the same event trace. |
| `packages/experiment` | Schema, migrations, validation, compiler, digests, diff | Every schema change needs a migration and tests. |
| `packages/metrics` | Reducers from events to metrics, checks, explanations | Reads events only, never engine internals. |
| `apps/web` | The React app | All state stays in the browser; no backend. |
| `examples` | Built-in experiments | Validated in tests; each one answers one question. |
| `docs` | Product and design decisions | Update the relevant page when behavior changes. |

[docs/04-ARCHITECTURE.md](docs/04-ARCHITECTURE.md) explains the data flow, and [AGENTS.md](AGENTS.md) has the detailed conventions (it is written for AI coding agents but is just as useful for people).

## What a good pull request looks like

- **One change, explained.** Say what the user will see differently and why. Link the issue.
- **Tests that would have failed before.** Bug fixes come with a regression test at the cheapest layer that proves the behavior: unit or property test for engine and metrics, Playwright for a user flow.
- **Golden numbers change only on purpose.** If a reference result in `packages/metrics/src/metrics.test.ts` changes, explain in the PR why the old number was wrong or why the model changed.
- **Determinism is preserved.** Anything that changes the event trace for an existing experiment is an engine change: bump `ENGINE_VERSION` and note it in the changelog.
- **Accessible and honest UI.** Status is never shown by color alone, text meets WCAG AA contrast in both themes, everything works by keyboard and at 320 px, and the UI never claims more than the model does.
- **Docs and changelog updated** when behavior, metrics or the file format change.

Keep commits focused and write messages in the imperative mood ("Add queue timeout option"). A short body explaining *why* is welcome.

## Adding model behavior

New behavior (a component, a fault type, a policy) needs, in the same pull request:

1. A behavioral contract in [docs/05-SIMULATION-AND-METRICS.md](docs/05-SIMULATION-AND-METRICS.md): what it does, what it does not do, and its assumptions.
2. Schema fields with units, limits and readable validation messages, plus a migration if existing files are affected.
3. Engine tests: at least one hand-computed reference case and the existing property tests passing.
4. Metrics and explanation updates, so results stay explainable from events.
5. A built-in example or an update to one, with expected observations.

## Reviews and merging

A maintainer reviews every pull request. CI must pass. We aim to give a first response within a week; if you have not heard back, a polite ping on the PR is welcome. Maintainers and decision-making are described in [GOVERNANCE.md](GOVERNANCE.md).

## License

FaultWorks is licensed under [Apache-2.0](LICENSE). By submitting a contribution you agree that it is licensed under the same terms, as stated in section 5 of the license.
