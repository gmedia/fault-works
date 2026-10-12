# Technical Architecture (Proposed)

## Design constraints

A production-like engineering standard for a *small browser tool*: deterministic simulation, portable artifacts, no server on the critical path, low maintenance burden, and a clear future boundary for local sandbox execution.

## Modules

```text
faultworks/
  apps/web/                     React + Vite + TanStack Router + React Flow UI (scaffolded)
  packages/engine/              pure TypeScript simulation core
  packages/experiment/          scenario schema, validation, migrations
  packages/metrics/             reducers, percentiles, comparison
  examples/                     safe bundled experiment JSON
  docs/                         decisions and contracts
```

**UI/engine boundary:** UI holds scene layout and editing state; engine consumes a *compiled* validated topology and experiment inputs and returns ordered events/metrics. The event engine must not import React, DOM or react-flow types. Browser worker is only an adapter; unit tests execute core in Node without workers.

### Major pathways

```text
Canvas + scenario editor
          |
   validated experiment JSON
          |
   topology compiler/checker
          |
  pure discrete-event engine ----> event stream ---> metrics reducer
          |                                      |            |
         seed                                    v            v
          |                                  timeline     A/B comparison
          v
  deterministic PRNG
```

## Discrete-event design

- Virtual time represented consistently (recommend integer microseconds) with documented overflow bounds; UI formats values.
- Event priority queue key `(time, event_priority, monotonic_sequence)` to avoid nondeterministic same-time ordering.
- Seeded PRNG with specified algorithm, serialization and golden traces.
- Event categories: REQUEST_ARRIVAL, SERVICE_START, SERVICE_COMPLETE, REQUEST_TIMEOUT, NODE_FAIL, NODE_RECOVER, HEALTH_PROBE, HEALTH_STATUS_CHANGED.
- State transition contract: each request has a unique ID and one terminal outcome; late responses after timeout must not be counted as successful completions.
- Queue capacity and overflow policies explicit; no silent infinite queues.
- Time horizon and event count ceilings prevent browser lock-up or accidental denial of service.
- Metric reducers operate on typed events, not animation callbacks.

## Tech stack

The workspace follows the frontend conventions already used in other GMEDIA React projects, trimmed to what a static, backend-less app needs (see ADR-009).

| Area | Choice | Notes |
|---|---|---|
| Package manager | pnpm workspace | `apps/*` and `packages/*`; one lockfile at the root |
| UI framework | React 19 + Vite | Static SPA build, no SSR |
| Routing | TanStack Router (file-based) | Routes in `apps/web/src/routes/`, `routeTree.gen.ts` is generated |
| Styling | Tailwind CSS v4 + shadcn/ui conventions | `components.json` ready; components are added on demand |
| Canvas | `@xyflow/react` (not installed yet) | Canvas only; verify license in lockfile |
| Validation | `zod` (planned, in `packages/experiment`) | Experiment contract validation |
| Lint/format | Biome | Single root config |
| Tests | Vitest, plus property-based tests for engine invariants | Engine tests run in Node, no worker |
| Persistence | IndexedDB or JSON download | No database server |

TanStack Query is intentionally **not** included: there is no remote server state in v0.1. Simulation runs are local worker calls; add Query only if a real async data source appears (for example the v0.3 local agent).

**Avoid:** SSR framework when static SPA is sufficient, backend-as-default, Kubernetes, message broker, dynamic user scripts, generic plugin runtime, premature Rust/WASM ports.

## Versioning

An experiment artifact records `schemaVersion`, `engineVersion`, topology, workload, faults, policy, seed, limits and assumptions. Unknown major versions should fail explicitly; migration functions for backwards compatibility are versioned and tested.

## Security boundary

The browser simulation has no privileged execution. The optional local agent (future) is a separate trust boundary and must not be imported or bundled as part of baseline app execution. See [Security](07-SANDBOX-AND-SECURITY.md).
