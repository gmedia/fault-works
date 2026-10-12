# FaultWorks

> **Proposed open-source project by GMEDIA — planning documents plus an empty web app scaffold; the simulation is not implemented yet.**

**Experiment with failure. Build more resilient systems.**

FaultWorks is a proposed **local-first infrastructure experimentation workbench**. It helps developers, DevOps/SRE teams, and educators describe an architecture, model traffic and failures, run repeatable scenarios, compare alternatives, and eventually check simulated predictions against **observations from isolated local sandboxes**.

## Why build it?

Architecture diagrams explain structure but not necessarily behavior. Production systems are too risky to break just to learn how failures propagate. FaultWorks focuses on **reproducible experiment definitions and understandable evidence**, rather than just animated nodes.

**Product hypothesis:** a small, transparent experiment that lets a user compare *healthy vs failed* infrastructure is more valuable than a large visual editor with unvalidated physics. The hypothesis must be validated with users; existing open-source projects already provide simulation, fault injection, or container labs.

## Intended user experience

1. Open a browser and load the built-in *Load Balancer Failure* experiment.
2. Inspect or edit Client → Load Balancer → Server A/B topology.
3. Define a load pattern and scheduled server failure; choose a seed.
4. Run the deterministic simulation and inspect event timeline, errors, latencies, and throughput.
5. Clone the experiment, change just one variable (for example, enable failure detection), and compare results.
6. Export a portable, versioned experiment artifact with inputs, assumptions and metrics.

In a **later, optional** phase, an isolated local agent can execute a real proxy plus dummy backends and record observed behavior. **Simulation is not a production prediction, and sandbox results do not certify production resilience.**

## Proposed release boundaries

| Release | Planned scope |
|---|---|
| v0.1 | Browser-only experiment: one topology, traffic, server failure, health-check model, comparisons, portable artifact |
| v0.2 | More behavioral components: queue, retries, timeouts, cache, database; curated scenarios |
| v0.3 | Experimental local sandbox for a tightly controlled proxy/backend scenario |
| Future | Hosted sandbox and education/team workflows only if real demand is established |

## Engineering principles

- Simulation engine is independent of the UI and executable headlessly.
- Reproducible seeds, deterministic event ordering, and explicit units.
- Declare simplifications and unknowns; do not present synthetic metrics as production measurements.
- Prove correctness with invariants, property-based tests, and reference cases.
- Core stays browser-first, offline-capable, and without login.
- Treat execution of real containers as a distinct security boundary.
- No company/customer topology, credentials, or proprietary Failab source in public artifacts.

## Development

The web app lives in `apps/web` (React 19, Vite, TanStack Router, Tailwind CSS v4). Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev         # http://localhost:3000
pnpm build       # static bundle in apps/web/dist
pnpm typecheck
pnpm test
pnpm check       # Biome lint + format check
```

## Project status

**Design proposal (2026-10-12), web app scaffolded.** No runtime implementation, repository creation, official GMEDIA ownership authorization, trademark clearance, or Apache-2.0 license grant is implied by these files. The name **FaultWorks by GMEDIA** and proposed repository slug `faultworks` are provisional.

## Documentation

Start with [Project Brief (Bahasa Indonesia)](docs/00-PROJECT-BRIEF-ID.md), [Vision](docs/01-VISION-AND-POSITIONING.md), [Scope](docs/02-SCOPE-AND-ROADMAP.md), [Architecture](docs/04-ARCHITECTURE.md), and [Validation Plan](docs/10-VALIDATION-PLAN.md).

## Existing projects to study (not copied)

- [Stability Sim](https://github.com/marcbrooker/stability-sim) — discrete-event browser simulation.
- [Breakscale](https://github.com/xevrion/breakscale) — interactive distributed-system failure examples.
- [DistSim](https://github.com/hamidxgh/distsim) — real container-based distributed-system laboratory.
- [Containerlab](https://containerlab.dev/) — container network topology tooling.
- [React Flow](https://reactflow.dev/) — MIT-licensed node editor foundation.

See [Competitive Landscape](docs/08-COMPETITIVE-LANDSCAPE.md) for a gap analysis without claims of uniqueness.
