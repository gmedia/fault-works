# FaultWorks

**Experiment with failure. Build more resilient systems.**

FaultWorks is a browser-based workbench for reproducible infrastructure failure experiments. You draw a small system (load balancers, services, databases, caches, worker queues and the links between them), break any part of it on purpose, run a deterministic simulation, and compare two versions of the experiment to see exactly what one change does.

The interface is in Bahasa Indonesia by default and in English when the browser prefers it, and it is designed for phones first.

> **Status:** v0.3, pre-release. Open source under the [Apache-2.0 license](LICENSE).

## What you can do

Open the app and the *Load balancer failure* pair is ready to run: Server B crashes for 20 seconds while the client sends 100 requests per second. Without health checks, 1,005 requests fail. With health checks every 5 seconds, 255 fail. The Compare page shows that health checks are the only setting that differs, and the timelines show why: the load balancer keeps sending traffic to the dead server until two probes in a row have failed.

From there you can:

- build any system you like from ten templates or a blank canvas, with a catalog of everyday components: CDN, API gateway, rate limiter, load balancer, web server, service, relational database, connection pooler (PgBouncer style), database cluster with failover, cache, search engine, object storage, worker queue, message broker and third-party APIs;
- see why "more connections" can make a database slower: components slow down under concurrency following the Universal Scalability Law, and a connection pooler keeps them at their peak;
- set latency, timeouts, retries with backoff, jitter and budgets, and circuit breakers on every link, fan out calls in parallel, and propagate client deadlines;
- break it with seven kinds of fault: crashes that refuse or hang, slowdowns (sudden or gradual, like a memory leak), error rates, capacity drops, link latency, link loss and cache flushes;
- replay a run over simulated time and watch requests flow, components crash, get detected and come back;
- read a plain-language explanation built only from the simulated events;
- trace any single request through the event log;
- create a variant, change one setting and compare, including a paired ten-seed check for random scenarios;
- export the experiment, the result (with behavior digest and trace fingerprint), the event log as CSV, or a whole comparison as one file plus a Markdown report;
- import any of those files elsewhere and see whether a re-run reproduces them.

Twenty built-in experiments cover load balancer failures, hanging backends, failover overload, cascading failures, retry storms and their fix, circuit breakers, cache stampedes, worker-queue backlogs, PostgreSQL with too many connections versus a pooler, database cluster failover, a CDN purge at peak, a flash sale with and without a rate limit, deadline propagation, fan-out tail latency and a memory leak that health checks never see.

Everything runs in your browser. There is no account, no backend and no telemetry; experiments are saved in the browser's local storage.

## What it is not

The simulation is an abstract request-level model. It does not emulate TCP, a specific proxy such as NGINX or HAProxy, or any production environment, and its numbers are not predictions or capacity plans. The in-app [Model guide](apps/web/src/routes/guide.tsx) and [docs/05](docs/05-SIMULATION-AND-METRICS.md) state every assumption.

## Quick start

Requires Node 22 or newer and pnpm 10.

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

`pnpm build` produces a static site in `apps/web/dist` that any static host can serve. Unknown paths must fall back to `index.html` because routing happens in the browser.

## How it is built

```text
apps/web               React 19 + Vite SPA: TanStack Router, React Flow, Tailwind CSS v4
packages/engine        deterministic discrete-event simulation, no UI dependencies
packages/experiment    experiment schema (zod), migrations, validation, compiler, diff
packages/metrics       reducers from events to metrics, checks, explanations, comparison
examples/{id,en}       the built-in experiments as portable JSON, one set per language
```

The web app validates an experiment, sends it to a Web Worker, and the worker compiles it, runs the engine and reduces the event stream into metrics. The engine never imports React or browser APIs, so the same code runs in Node for tests. Details are in [docs/04-ARCHITECTURE.md](docs/04-ARCHITECTURE.md).

## Development

```bash
pnpm check        # Biome lint and format check
pnpm typecheck
pnpm test         # unit, property-based and golden tests (Vitest)
pnpm test:e2e     # Playwright journeys, axe accessibility scans, phone layout, both languages
```

The engine is checked three ways: reference cases whose answers were computed by hand, property-based tests over random experiments (conservation, single outcome per request, capacity and queue bounds, determinism), and invariant checks that run after every simulation in the app. The E2E suite covers the first-use journey from [docs/03](docs/03-USER-JOURNEYS.md) and scans every page for WCAG 2.2 A/AA violations in both themes.

## Project status

v0.2 (October 2026) turned the fixed v0.1 topology into a free graph with an Indonesian-first, phone-first interface; v0.3 adds contention under load, connection poolers, rate limiters, database clusters, smarter retries, fan-out, deadline propagation and a component catalog ([docs/02](docs/02-SCOPE-AND-ROADMAP.md)). A simulated pilot with four AI personas found and drove fixes for import, comparison export, latency reporting and the phone layout ([docs/12](docs/12-SIMULATED-PILOT.md)); it does not replace real users. The next gate is still the pilot in [docs/10](docs/10-VALIDATION-PLAN.md): three to five people should be able to run the A/B experiment and explain the difference without help.

The name **FaultWorks** has not been through a trademark search yet ([ADR-007](docs/11-DECISION-LOG.md)).

## Contributing

Bug reports, usability feedback and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); AI coding agents should read [AGENTS.md](AGENTS.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately as described in [SECURITY.md](SECURITY.md). How decisions are made is in [GOVERNANCE.md](GOVERNANCE.md).

## License

Copyright 2026 GMEDIA and the FaultWorks contributors. Licensed under the [Apache License, Version 2.0](LICENSE); see [NOTICE](NOTICE) for bundled third-party software and fonts.

## Documentation

- [Project brief (Bahasa Indonesia)](docs/00-PROJECT-BRIEF-ID.md)
- [Vision](docs/01-VISION-AND-POSITIONING.md) and [scope](docs/02-SCOPE-AND-ROADMAP.md)
- [Architecture](docs/04-ARCHITECTURE.md) and [simulation model](docs/05-SIMULATION-AND-METRICS.md)
- [Experiment format](docs/06-EXPERIMENT-FORMAT.md)
- [Validation plan](docs/10-VALIDATION-PLAN.md), [simulated pilot](docs/12-SIMULATED-PILOT.md) and [decision log](docs/11-DECISION-LOG.md)
- [Changelog](CHANGELOG.md)

## Existing projects to study (not copied)

- [Stability Sim](https://github.com/marcbrooker/stability-sim): discrete-event browser simulation.
- [Breakscale](https://github.com/xevrion/breakscale): interactive distributed-system failure examples.
- [DistSim](https://github.com/hamidxgh/distsim): real container-based distributed-system laboratory.
- [Containerlab](https://containerlab.dev/): container network topology tooling.
- [React Flow](https://reactflow.dev/): the MIT-licensed node editor FaultWorks uses for its canvas.

See [Competitive Landscape](docs/08-COMPETITIVE-LANDSCAPE.md) for a gap analysis without claims of uniqueness.
