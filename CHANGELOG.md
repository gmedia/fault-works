# Changelog

## 0.2.0 (unreleased, 2026-10-12)

The fixed client, load balancer and servers shape becomes a free graph, the app speaks Indonesian first, and the workbench is designed for phones first. Engine `0.2.0`, schema `0.2.0`, metrics `0.2.0`; v0.1 files migrate automatically and produce the same results.

### Simulation
- Components: client, load balancer, service, database, cache and worker queue, up to 12 per experiment, connected by up to 24 links in call direction. Services call every component behind them in order while holding their slot, so slow dependencies back up their callers.
- Load balancer algorithms round robin, least connections and random; optional retry on another backend.
- Links carry one-way latency, a call timeout, immediate retries and a circuit breaker (consecutive failures, open period, one trial call).
- Seven fault kinds: component crash (refuse or hang), slowdown, error rate, capacity drop, link latency, link loss and cache flush; several may overlap.
- Answers that arrive after the client deadline still travel back up the chain, so a caller's slot is always released (a chain whose dependency recovered could otherwise stay stuck). Timed-out requests that later reach a slot are served without calling downstream.
- New failure reasons `circuit-open` and `injected-error`; new events for calls, routing, cache lookups, jobs, fault windows and breaker transitions. Random streams per balancer and per link in addition to arrivals and services.

### Experiment format
- Schema 0.2.0 with migration from 0.1.0 (`server` → `service`, link ids and defaults, balancer retries). Graph validation rejects cycles, self-calls, dangling or duplicate links, unreachable components and faults on the wrong kind of target.
- Validation messages, insights and check details are translatable keys with parameters instead of English sentences.
- Ten built-in experiments in Indonesian and English: the v0.1 five plus cascading failure, retry storm, circuit breaker, cache stampede and worker-queue backlog. Six templates for new experiments.

### Metrics
- Failures by originating component, per-component and per-link summaries (calls, retries, late responses, peak queue, slot-time busy, breaker openings), cache hit ratio, queue jobs and waiting times, fault windows and breaker states in the replay transitions.
- Insights for every fault kind, retries, breakers, caches and queues; comparison cautions when the number of successes differs.

### Web app
- Bahasa Indonesia by default, English when the browser prefers it, switchable and remembered. Every string, unit and message is translated; a unit test checks both locale files against the keys the app uses.
- Phone-first workbench: Build, Replay and Results screens in a bottom tab bar, a settings sheet, a stacked topology list and secondary actions in a menu. No horizontal scroll at 320 px.
- Desktop canvas with free editing: add any component, connect by dragging, click a link to edit it, remove components with their faults (undoable).
- Replay animation: request flow along links, crash shake and pulse rings on state changes, all disabled under reduced motion.
- New experiment dialog with templates; experiments are marked as example, imported, variant or created.

### Quality
- Engine tests for chains, breakers, latency and loss, caches, queues, slowdowns, capacity and error rates; experiment tests for migrations, graph validation and editing helpers; metrics golden numbers kept.
- Web unit tests for locale keys, replay snapshots and the library store; E2E for free creation, the language switch, phone screens, reduced motion and the seed sweep, with axe scans in both languages.

## Unreleased before 0.2.0

### Open source
- Apache-2.0 license with NOTICE; Contributor Covenant 2.1, security policy (GitHub private reporting), governance, contributing guide.
- AGENTS.md and CLAUDE.md for AI coding agents; issue and pull request templates, CODEOWNERS, Dependabot, EditorConfig.

### Fixes from the simulated pilot

See [docs/12](docs/12-SIMULATED-PILOT.md) for the findings.

- Import result and comparison files; re-run and verify their digests and counts.
- Export a comparison as an importable bundle and as a Markdown report.
- Compare shows timeouts, mean latency of all ended requests, client time spent on failures, a failure-inclusive p95 chart, survivorship cautions and a latency explanation.
- Possible detection range and probe count in results; probe cost stated as not modeled.
- Results reappear after reload for experiments run before; variants start without stale notes.
- Behavior digest in the UI and exports; editable experiment id; titled new experiments; no duplicate imports.
- Phone layout: stacked topology, scroll to results and settings, labeled toolbar, 44 px touch targets.

## 0.1.0 (unreleased, 2026-10-12)

First working version of the v0.1 scope: one browser-only experiment workflow from load to export.

### Simulation
- Deterministic discrete-event engine: client with constant or Poisson arrivals and bursts, round-robin load balancer with active health checks, servers with concurrency slots, FIFO queues and fixed or exponential service times.
- Server crashes that either refuse connections or hang, with optional recovery.
- Seeded SFC32 random streams, fixed same-time ordering, integer microsecond time, event ceiling.

### Experiment format
- Schema 0.1.0 with migration from the 0.1.0-proposal example, topology and budget validation with field paths, canonical JSON, input digest, run key and semantic diff.
- Five built-in experiments: no health checks, with health checks, hanging backend, failover overload, random traffic with a burst.

### Metrics
- Offered, admitted, succeeded, failed by reason, still in flight, late responses, nearest-rank latency with sample counts, detection delay, per-server load.
- Invariant checks after every run, trace fingerprint, plain-language explanation, A/B comparison rows.

### Web app
- Experiment library stored in the browser with import, export, variants, delete with undo.
- Workbench with topology canvas, inspector with inline validation, undo and redo, simulation in a Web Worker, replay over simulated time, charts with fault bands, event log with request tracing, model checks and reproducibility re-run.
- Compare page with semantic diff, metric deltas, overlaid timelines and a paired ten-seed check.
- Model guide, light and dark themes, keyboard shortcuts, accessible charts with table views.

### Quality
- Unit, property-based and hand-computed golden tests for the engine, contract and metrics.
- Playwright journeys, axe WCAG 2.2 A/AA scans in both themes, and a phone layout check.
