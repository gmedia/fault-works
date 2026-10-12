# Changelog

## Unreleased: fixes from the simulated pilot

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
