# Technical Architecture

**Status:** implemented in v0.2. Decisions are recorded in the [decision log](11-DECISION-LOG.md).

FaultWorks is a static single-page app with a pure TypeScript simulation core. Nothing runs on a server: the browser validates an experiment, a Web Worker simulates it, and the page renders the result. The constraints from the proposal still hold: deterministic simulation, portable artifacts, no server on the critical path, low maintenance, and a clear boundary for a future local sandbox.

## Modules

```text
faultworks/
  apps/web/              React 19 + Vite SPA (TanStack Router, React Flow, Tailwind CSS v4)
  packages/engine/       discrete-event simulation core; no React, DOM or canvas types
  packages/experiment/   schema, migrations, validation, compiler, canonical form, diff
  packages/metrics/      event reducers, invariant checks, explanations, comparison
  examples/{id,en}/      built-in experiments as JSON per language (validated in tests and at load)
  docs/                  decisions and contracts
```

Dependencies only point downward: `web` uses all three packages, `metrics` and `experiment` use `engine`, and `engine` uses nothing. Packages are consumed as TypeScript source through pnpm workspaces, so there is no separate build step for them.

## Data flow

```text
editor (library store)            Web Worker                                   page
  experiment JSON  ──────────▶  parseExperiment (again)                ┌──▶ summary tiles, charts
                                compileExperiment ──▶ EngineInput      │    playback canvas
                                simulate ──▶ event stream ──▶ recorder ┼──▶ explanation, checks
                                                          └─▶ event log┘    event table, exports
```

1. The editor keeps the experiment exactly as the user typed it, including invalid values, and validates on every change so problems appear next to the field.
2. Run sends the experiment to the worker. The worker validates it again because it never trusts its caller.
3. `compileExperiment` turns milliseconds into integer microseconds, merges bursts into rate phases, indexes nodes and links, and keeps link order as call order and round-robin order. Canvas layout, titles and labels are dropped here, so they can never change a result.
4. `simulate` streams typed events into a sink. The metrics recorder and the columnar event log both listen to the same stream.
5. The worker returns the metrics and transfers the event log buffers without copying them.

## Engine design

- Simulated time is integer microseconds. The 15-minute limit is far below the safe-integer range.
- The event queue is a binary heap ordered by `(time, priority, sequence)`. The priority table (faults, probe results and breaker transitions, link transfers, completions, timeouts, probe sends, arrivals) is part of the reproducibility contract.
- Calls are the unit of work between components. A call holds its caller's slot until it ends, chains into downstream calls in link order, and carries its attempt number for retries. Timeouts, breakers and loss are decided on the link; crashes, slowdowns, error rates and capacity on the node.
- Randomness uses SFC32 seeded through SplitMix32, with one named stream for arrivals, one per worker node, one per load balancer and one per link, so adding a component does not shift another component's random numbers.
- Arrivals are generated lazily, one at a time, so memory does not grow with the number of planned requests.
- Each request has exactly one terminal event. Work a server finishes after the client's deadline is reported as a late response, never as a success.
- A hard event ceiling (3,000,000) stops a runaway input; the result says the run stopped early.

The full behavioral contract is in [docs/05](05-SIMULATION-AND-METRICS.md) and in the in-app Model guide.

## Metrics design

The recorder only reads events. It never looks at engine internals, which makes its invariant checks (conservation, single outcome, capacity, queue bounds, monotonic time) an independent check on the engine after every run. It produces a summary, windowed series for charts, exact state transitions for the replay, fault summaries with detection delay, and a trace fingerprint (two FNV-1a lanes over every event field). Chart window size only changes the series; tests check that the summary and fingerprint stay identical.

## Web app

- **Routing:** TanStack Router with file-based routes: `/` (library), `/experiments/$experimentId` (workbench), `/compare?a=&b=`, `/guide`. Selected component or link, inspector panel, results tab and phone screen live in the URL search params.
- **Languages:** i18next with `react-i18next`. Resources are two JSON files (`id` primary, `en` fallback); the language comes from the saved choice, then the browser, then Indonesian. Package messages arrive as keys with parameters and are translated at the edge, with field labels and units substituted from the same files.
- **Phone layout:** one `useMediaQuery` decides between the desktop grid (canvas, inspector, results) and the phone screens (Build, Replay, Results) with a bottom tab bar and a settings sheet. Both share the same workbench context, so there are no two code paths for state.
- **State:** Zustand stores. The experiment library and undo history live in one store; the library part is persisted to `localStorage` behind a wrapper that keeps working when storage is blocked. Run results live only in memory, because they can always be reproduced from the experiment.
- **Staleness:** every result carries a `runKey`, the SHA-256 of the compiled engine input. When the current settings produce a different key, the page marks the shown results as stale instead of silently mixing them.
- **Canvas:** React Flow renders the free graph with connectable handles; connecting, adding and removing go through `packages/experiment` editing helpers so the canvas can never produce an invalid file silently. Nodes and links read the replay position directly from a small playback store, so moving the replay re-renders only what changed. Flow animation is CSS (`offset-path` dots per link, keyed on the window's call rate) and is disabled under `prefers-reduced-motion`.
- **Charts:** hand-written SVG. One shared hover position moves the crosshair on every chart; each chart is a keyboard slider with a text value and has a table view.
- **UI kit:** shadcn/ui components on Radix primitives, styled with role-based tokens that were contrast-checked in both themes.

## Persistence and portability

Experiments export as versioned JSON. Imports are size-limited, parsed as data only, migrated from older schema versions, and validated with readable errors. Results export as an artifact with engine version, metric definitions version, input digest and trace fingerprint, and contain the full input so anyone can re-run them. See [docs/06](06-EXPERIMENT-FORMAT.md).

## Tech stack

| Area | Choice | Notes |
|---|---|---|
| Package manager | pnpm workspace | `apps/*` and `packages/*`, one lockfile |
| UI | React 19 + Vite | static build, no SSR |
| Routing | TanStack Router (file-based) | `routeTree.gen.ts` is generated |
| State | Zustand | library persisted to `localStorage` |
| Canvas | `@xyflow/react` | MIT |
| Styling | Tailwind CSS v4, shadcn/ui on Radix | IBM Plex Sans and Mono, self-hosted |
| Validation | zod 4 | experiment contract |
| Languages | i18next, react-i18next | `id` default, `en` fallback |
| Lint/format | Biome | single root config |
| Tests | Vitest, fast-check, Playwright, axe-core | unit, property, golden, E2E, accessibility |

TanStack Query is not used: there is no remote server state. Add it only if a real async data source appears, for example the v0.3 local agent.

## Security boundary

The browser simulation has no privileged execution and imports never execute anything. The optional local agent (v0.3, not built) is a separate trust boundary and must not be bundled with the web app. See [Security](07-SANDBOX-AND-SECURITY.md).
