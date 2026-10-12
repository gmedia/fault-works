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

## v0.2: Free graphs, more failure kinds, Indonesian first, phone first

**Status (2026-10-12):** implemented. The maintainers brought v0.2 forward before the real pilot because the v0.1 workbench was judged too limiting and too hard to use on a phone, and because the primary audience reads Indonesian. The pilot in [docs/10](10-VALIDATION-PLAN.md) still gates publication.

- **Free topology.** Any directed acyclic graph of up to 12 components: client, load balancer (round robin, least connections, random; optional retry on another backend), service, database, cache (hit ratio) and worker queue (backlog, workers). Links carry latency, a call timeout, retries and a circuit breaker.
- **Seven fault kinds.** Component crash (refuse or hang), slowdown, error rate, capacity drop, link latency, link loss, cache flush. Any fault on any eligible component or link, several at once.
- **Creation.** Six templates plus a blank canvas; add, connect, edit and remove freely on the desktop canvas; the same operations through buttons on phones.
- **Indonesian first.** Full i18n with Bahasa Indonesia as the default and English as the fallback, including every validation message, insight and check; examples authored in both languages.
- **Phone first.** Build, Replay and Results screens with a bottom tab bar and a settings sheet; the desktop keeps the canvas, inspector and results on one page.
- **Alive replay.** Request flow along links, crash and recovery animation, breaker and fault indicators, all off under reduced motion.
- **Still out of scope.** Retry backoff, rate limiting, bulkheads, autoscaling, CPU or memory models, real containers, hosted compute, accounts, AI summaries.

Candidates for a v0.2.x, only if the pilot asks for them: retry backoff, rate limiting, bulkheads, cancellation on timeout, more built-in lessons.

## v0.3: Closer to real systems

**Status (2026-10-12):** implemented, again ahead of the pilot at the maintainers' request: the goal is that people can model what they actually run.

- **Contention under load.** Workers slow down as concurrency grows (Universal Scalability Law), so "more connections" can mean less throughput, as with real relational databases.
- **New components.** Connection pooler (PgBouncer transaction mode), rate limiter / API gateway (token bucket), database cluster (primary, replicas, failover), and a catalog of presets: CDN, web server, search engine, object storage, message broker, third-party API.
- **Resilience patterns.** Retry backoff, jitter and budgets; deadline propagation; parallel fan-out; gradual slowdowns.
- **Editing.** Impossible links refused while dragging, with the reason; inserting components in front of single-exit ones; four new templates; ten new built-in experiments.
- **Still out.** Bulkheads, autoscaling, pooler session mode, replication lag, CPU and memory models, real containers.

## v0.4: Optional Local Sandbox (conditional)

A separate local agent runs **allowlisted, fixed-image** real backend/proxy demos on an isolated Docker network; no arbitrary images, privileged containers, mounts, or unrestricted external network access by default. Record observed metrics with provenance, then compare them to simulated prediction **only for aligned definitions and workloads**. Follow [Sandbox Security](07-SANDBOX-AND-SECURITY.md).

## Future: Hosted labs (not committed)

Hosted runners, team sessions, instructor assignments, paid managed sandboxes, or advanced observability are business hypotheses. They require proven user demand, abuse controls, cost model, isolation design and operations ownership.

## Stop rules

Pause expansion when scenario comparison does not teach users more than a static diagram, when engine invariants fail, or when competitor tools satisfy the same workflow without a defensible gap. No 'feature-count race'.
