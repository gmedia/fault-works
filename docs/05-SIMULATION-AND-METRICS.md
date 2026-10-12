# Simulation Model, Metrics and Correctness Contract

## Model scope

v0.1 is an **abstract request-level discrete-event simulation**, not packet-level networking, a faithful NGINX replica, or a production-grade performance forecast. Document each component's behavioral assumptions so that results are inspectable.

### Client

Produces request arrivals at scheduled simulated times (constant-RPS baseline or burst). `offered_requests` counts attempts sent by client, even if later dropped. A constant-RPS generator schedules at known intervals; optional stochastic mode requires a seeded PRNG.

### Load balancer

Selects eligible backend via Round Robin among backends currently marked healthy. A failed backend may remain *eligible* until a scheduled probe/threshold causes health status to flip. 'Crash' and 'detected unhealthy' are distinct state changes. Explicitly define whether requests in flight fail immediately and how connection reuse is abstracted.

### Server

Has N concurrent service slots; arriving requests join a queue if occupied. Service time is configurable; a server failure changes lifecycle of running/queued requests based on an explicit policy. No automatic retry unless a model explicitly includes it.

### Health checking

Probe interval, timeout, unsuccessful-successful thresholds and propagation delay are first-class parameters. For v0.1, model simplified scheduled probes; do **not** claim parity with NGINX passive checks or HAProxy active checks. Distinguish detected loss from actual failure time.

## Metrics with definitions

- **Offered:** number of client attempts generated.
- **Admitted:** attempts accepted by LB/server admission rules.
- **Completed success:** admitted requests receiving success before timeout.
- **Completed error:** terminal app failure, routing failure, queue rejection, or timeout (subtype separately).
- **In-flight:** requests not yet terminal by simulation horizon (censored; separate, not counted success).
- **Throughput:** completed attempts divided by measured simulated time, with clear units.
- **Goodput:** successful requests satisfying the declared response deadline divided by the window; if no objective is set, label 'successful completion rate' rather than SLO goodput.
- **Latency:** completion timestamp minus arrival timestamp for completed request samples; timeout handling explicit. Show sample N next to p50/p95.
- **Queue depth:** per-node timeseries and peak; include head-of-line processing rules.
- **Detection delay:** time when LB marks backend unhealthy minus actual backend failure time.

## Invariants and correctness

1. For any final run: `offered = success + failure + still_inflight` when every generated attempt is tracked; failed admission is a failure subtype. If there are retries in future versions, make distinction between logical client requests and individual attempts explicit.
2. Every request has exactly one terminal state; timeout + late completion must not double-count.
3. No active service count exceeds configured concurrency.
4. Queue counts and service slot allocations never negative.
5. Same `scenario + seed + engineVersion` produces byte-equivalent normalized event trace (excluding UI layout/recording time).
6. A known case with no failure/queueing and fixed service time produces a calculable completion count.
7. Changing visual zoom, animation speed or screen refresh rate does not alter results.
8. Invalid units, negative service time, unsupported cycles and unsupported topology are rejected with actionable errors.

## Explicit limits

No general TCP state machine, retries, connection pooling, serialization overhead, GC pauses, memory paging, OS scheduling, persistence guarantees, or causal explanation beyond model rules in v0.1. Any comparison against a real system requires aligned arrival pattern, concurrency semantics, failure semantics, output definition, and observed measurement uncertainty.

## Quality of results

A/B comparative claims must name the changed variable and show uncertainty / stochastic variability. A single seed is a deterministic demonstration, not statistical evidence. Optional future studies can run multiple independent seeds and report confidence intervals.
