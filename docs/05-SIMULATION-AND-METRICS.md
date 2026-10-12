# Simulation Model, Metrics and Correctness Contract

**Status:** engine `0.3.0`, metrics `0.3.0`. The in-app Model guide says the same in plain language, in Indonesian and English.

## Model scope

FaultWorks runs an **abstract request-level discrete-event simulation**, not packet-level networking, a faithful proxy replica, or a production-grade performance forecast. Every component below has an explicit behavioral contract so that results are inspectable; anything not listed is not modeled.

An experiment is a directed acyclic graph of up to 12 components joined by up to 24 links. Links follow the direction of calls. The client calls exactly one component; a load balancer forwards to one of its backends; services, databases and caches do their own work and then call every component behind them in link order; a worker queue answers at once and does its work later.

### Client

Produces request arrivals at scheduled simulated times: constant rate (exact intervals) or a Poisson process (seeded exponential gaps), plus up to ten bursts that add rate for a while. `offered` counts every attempt, even those later dropped. Each request carries a deadline, the client timeout; a response after it is discarded as a late response.

### Load balancer

Chooses a backend among those it considers healthy, by round robin, least connections (fewest open calls, ties by order) or seeded random. Without health checks every backend is healthy forever. With health checks it probes every backend each interval starting at time 0; a backend leaves rotation after the configured number of consecutive failed probes and returns after the configured number of successes. Probes bypass queues, answer instantly from a running component, and use no capacity, so a short interval only shows its benefit. `retries` lets the balancer try another backend after a failed call, which can mask a refusing backend. "Crashed" and "marked unhealthy" are distinct state changes; the gap between them is the amber hatched band in the UI.

### Contention under load

Every worker (service, database, pooler, cache, queue) has two coefficients from the Universal Scalability Law. With `n` busy slots when a call starts, its own work takes `base × (1 + α(n − 1) + β·n(n − 1))`. α (contention) is the share of work that must take turns; β (coherency) is a coordination cost that grows quadratically. With β above zero throughput peaks at about `√((1 − α)/β)` concurrent calls and falls beyond it. Both default to zero, except for databases created in the editor (α 0.02, β 0.0005, a peak near 44). The coefficients are illustrative, not measurements of any product. The factor is fixed when the call starts, not updated while it runs.

### Service and database

Identical behavior apart from defaults; the kind is a label for the reader. N concurrency slots and a FIFO queue of bounded size; a call that finds no slot and a full queue fails with `queue-full`. Service time is fixed or exponential (seeded, per component stream). After its own work the component calls each downstream link in order while still holding its slot, so a slow dependency makes the caller's queue grow. A failure anywhere in the chain fails the call unless the link retries.

A worker may call its downstream links one after another (default) or in parallel, waiting for the slowest and failing at the first failure. A worker may also have a queue wait limit: a call still waiting after that long leaves the queue and fails with `queue-timeout`.

### Connection pooler

A worker whose slots are server connections to the single component behind it, with a small own time (its overhead), a large waiting room and usually a wait limit. A call holds a connection only while its own call to the database runs, which is PgBouncer's transaction mode. Session mode is not modeled.

### Rate limiter

A token bucket in front of exactly one component, holding no slots. Tokens refill at `ratePerSec` up to `burst`; a call that finds less than one token fails at once with `rate-limited`.

### Database cluster

A router in front of two or more workers. The first link is the primary, the rest are replicas. Each call is a write with probability `writeRatio` (drawn from the `cluster:<id>` stream) and goes to the primary; reads round-robin over the replicas the cluster believes are up (the primary when none is). A crash or recovery is noticed `failoverMs` later; a dead primary is then replaced by the first replica believed up (`promoted` event), and a recovered node rejoins as a replica. Until the cluster notices, calls still go to the dead node. Replication is instant: no lag, no lost writes.

### Cache

A service whose lookups are answered from memory with probability `hitRatio` (seeded). Misses fall through to its single downstream component. A `cache-flush` fault sets the hit ratio to zero for a window.

### Worker queue

Stores jobs up to its backlog limit and answers the caller immediately (or rejects it when the backlog is full). `capacity` workers process jobs, call the components behind the queue and record their outcome as jobs, not requests. Backlog, waiting time and failed jobs are reported per queue.

### Links

Every link has one-way `latencyMs` added to each call and each answer, an optional call `timeoutMs` after which the caller gives up and frees its slot, `retries` to the same target, and an optional circuit breaker. Retries wait `retryBackoffMs × 2^(k−1)` (capped at 30 s) before retry k; with `retryJitter` each wait is drawn uniformly between zero and that value from the link's stream. A `retryBudget` deposits that share of a token per first attempt and spends one per retry, with a reserve and cap of 10; with no token left the call gives up. The caller keeps its slot while it waits out a backoff. The breaker counts consecutive failures; at `failureThreshold` it opens and rejects calls at once (`circuit-open`) for `openMs`, then lets one trial call through: success closes it, failure opens it again.

### Faults

| Kind | Target | Effect during the window |
|---|---|---|
| `node-failure` | service, database, cache, queue | `refuse`: new connections and probes fail at once, work in progress is lost (`lost-in-crash`). `hang`: no answers; callers wait for their timeout. Recovery empties the queue. |
| `slowdown` | worker | service time × `factor` + `addMs`; with `ramp`, growing linearly from no effect at the start to full effect at the end |
| `error-rate` | worker | a seeded share `rate` of arriving calls fail at once (`injected-error`) |
| `capacity` | worker | concurrency becomes `capacity`; running work finishes |
| `link-latency` | link | `addMs` added to each call and answer |
| `link-loss` | link | a seeded share `rate` of calls never arrive; callers time out |
| `cache-flush` | cache | hit ratio 0 |

Several faults may be active at once. Crashes of the same component must not overlap.

## Engine decisions

- **No cancellation.** A component does not know its caller gave up. Queued or running work continues, uses capacity, and its answer is discarded as a late response (ADR-013). The answer still travels back up the chain so that every caller releases the slot it held for the call; a timed-out request that reaches a slot later is served without calling anything downstream.
- **Same-time ordering.** Faults, then probe results and breaker transitions, link transfers, service completions, timeouts, probe sends, arrivals. A response landing exactly on the deadline counts as on time.
- **Randomness.** SFC32 seeded through SplitMix32 with one named stream per consumer: `arrivals`, `service:<id>`, `balancer:<id>`, `cluster:<id>` and `edge:<id>`. Adding a component never shifts another component's random numbers.
- **Deadline propagation.** Off by default. When on, a worker turns away a call whose request already ended, both on arrival and when its turn in the queue comes (`abandoned` with reason `deadline`, failure `timeout`). Work already running is not cancelled.
- **Time** is integer microseconds; the 15-minute limit is far below the safe-integer range. A hard ceiling of 3,000,000 events stops a runaway input and the result says the run stopped early.
- **Percentiles.** Nearest rank, always an observed sample, always shown with its sample count. Success latency excludes failures; a separate "all ended requests" set includes them, with timeouts counted as the full timeout.
- **Censoring.** Requests without an outcome at the horizon are still in flight, never success or failure.
- **Attribution.** Every failed request records the component where the failure originated (where it was refused, timed out, lost or rejected), even when the client saw it as an error from a component in front of it.

## Metrics with definitions

- **Contention and abandonment:** per component, mean and maximum own work compared with the base time, and calls that left a queue by wait limit or deadline. Database clusters report each promotion.
- **Offered:** client attempts generated. **Succeeded:** answered at or before the deadline. **Failed:** ended without success, by reason (`no-healthy-backend`, `refused`, `queue-full`, `lost-in-crash`, `timeout`, `circuit-open`, `injected-error`) and by originating component. **In flight:** no outcome at the horizon.
- **Latency:** completion minus arrival for ended requests. p50/p95/p99 of successful requests with n; mean and p95 of all ended requests; total client time spent waiting on failed requests (percentiles hide this once more than 5 % of requests fail).
- **Calls:** every attempt over a link, retries included, so calls can far exceed requests. Per component: calls, failures originating there, call latency, late responses, peak queue, slot-time busy. Per link: calls, retries, failures, breaker openings. Caches report hit ratio; queues report jobs done, failed, peak backlog and waiting times.
- **Detection delay:** time the load balancer marked a component unhealthy minus the time it crashed, with the range the settings allow.
- **Series:** per chart window, offered, succeeded, failed, in flight, latency percentiles, and per component calls, failures, peak queue and busy slots; per link calls. Exact transition times (down, up, healthy, unhealthy, fault start and end, breaker state) drive the replay.

## Invariants and correctness

Five checks run after every simulation in the app, independently of the engine's own bookkeeping:

1. `offered = succeeded + failed + inFlight`.
2. Every request has exactly one terminal event; late responses only follow a caller giving up.
3. Busy slots never exceed concurrency, per component, at every event.
4. Queues stay between zero and their size.
5. Event timestamps never decrease.

Automated tests cover the rest: byte-identical traces for the same input, seed and engine version; reference cases with hand-computed answers for load balancing, chains, breakers, latency, loss, caches, queues, slowdowns, capacity and error rates; property tests over random graphs; golden numbers for the built-in examples (1,005 failed requests without health checks, 255 with, 355 for the hanging backend); and rejection of cycles, dangling links, self-calls, unreachable components and over-budget runs with actionable messages.

## Explicit limits

No TCP, TLS, packets, keep-alive or DNS; no bulkheads, autoscaling, pooler session mode or replication lag; no CPU, memory, garbage collection or OS scheduling; no claim of parity with NGINX, HAProxy, Envoy, Kafka or any product. Any comparison against a real system requires aligned arrival pattern, concurrency semantics, failure semantics, output definitions and measurement uncertainty.

## Quality of results

A/B comparative claims must name the changed variable and show variability. A single seed is a deterministic demonstration, not statistical evidence; the Compare page can repeat both sides with ten paired seeds when either has random parts.
