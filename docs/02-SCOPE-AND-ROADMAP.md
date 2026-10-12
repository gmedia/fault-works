# Product Scope, Non-Goals and Roadmap

## MVP v0.1: Load Balancer Failure Experiment

**Status (2026-10-12):** every must-have below is implemented and covered by tests. What is not done yet is the product validation: the pilot in [docs/10](10-VALIDATION-PLAN.md) decides whether v0.2 happens. Small additions beyond the list: replay over simulated time, a plain-language run explanation, a paired ten-seed check on the Compare page, and five built-in experiments instead of one.

A single vertical slice must complete the loop: **load → configure → run → inject fault → inspect → clone & compare → export**.

### Must-have

- Canvas: predefined Client, Load Balancer, Server A and Server B; simple connections; node property panels.
- Traffic: baseline constant RPS and configurable short burst; seeded stochastic interarrival optional, with an explicit algorithm.
- Server model: concurrency capacity, service-time distribution, finite or configurable queue, fail/recover events.
- Load balancer: Round Robin; health-check configuration with explicit detection delay and routing decisions.
- Simulation: deterministic discrete-event event queue, stable tie-break ordering, reproducible seed, virtual clock, worker execution.
- Metrics: offered/completed/successful/failed requests, throughput by simulated-time window, p50/p95 completion latency with sample counts, timeouts, queue depth. Clearly differentiate attempted traffic from completed traffic.
- Experiment comparison: two configurations with one explicitly changed variable, same seed/horizon; side-by-side metric deltas and caveats.
- Persistence: versioned JSON import/export and validated schema.
- First-use: a built-in example that runs without onboarding, backend, account, or installation.
- Tests: reference calculation, event-ordering, conservation, seeded determinism, and rejection of invalid topology/scenario.

### Explicit non-goals for v0.1

No real Docker containers, NGINX emulation, TCP packets, network namespaces, databases, queue brokers, auth, collaboration, hosted compute, AI summaries, monetization, Kubernetes, production telemetry import, SLA/RTO estimates, prediction claims, complex global dashboards, arbitrary script/plugin execution.

## v0.2: Structured Distributed Systems Experiments (conditional)

Add only the components that validated users need: retries & timeout budgets, queue, cache, DB/connection pool, circuit breaker, and more built-in reference experiments. Each must have a behavioral contract, invariants, boundaries and examples. Scenario diff/compare should remain primary UX.

## v0.3: Optional Local Sandbox (conditional)

A separate local agent runs **allowlisted, fixed-image** real backend/proxy demos on an isolated Docker network; no arbitrary images, privileged containers, mounts, or unrestricted external network access by default. Record observed metrics with provenance, then compare them to simulated prediction **only for aligned definitions and workloads**. Follow [Sandbox Security](07-SANDBOX-AND-SECURITY.md).

## Future: Hosted labs (not committed)

Hosted runners, team sessions, instructor assignments, paid managed sandboxes, or advanced observability are business hypotheses. They require proven user demand, abuse controls, cost model, isolation design and operations ownership.

## Stop rules

Pause expansion when scenario comparison does not teach users more than a static diagram, when engine invariants fail, or when competitor tools satisfy the same workflow without a defensible gap. No 'feature-count race'.
