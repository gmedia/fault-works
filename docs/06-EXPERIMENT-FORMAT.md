# Portable Experiment Contract

**Status:** schema `0.3.0`, implemented in `packages/experiment`. The zod schema in [`schema.ts`](../packages/experiment/src/schema.ts) is the source of truth; this page explains it.

One file captures everything needed to reproduce a simulation and understand its assumptions. Canvas layout is stored for convenience but never affects results.

## Experiment file

| Field | Meaning |
|---|---|
| `schemaVersion` | `"0.3.0"`. Older versions are migrated; unknown versions are rejected with an explanation. |
| `experimentId` | 1–48 lowercase letters, digits or hyphens. Also the export file name. |
| `title`, `question`, `description` | What the experiment is for. Shown in the app, ignored by the engine. |
| `seed` | Unsigned 32-bit integer. Only matters for the random parts: Poisson arrivals, exponential service times, caches, random routing and share-based faults. |
| `model.nodes` | 2–12 nodes. Exactly one `client`; any mix of `load-balancer`, `rate-limiter`, `db-cluster`, `service`, `database`, `pooler`, `cache` and `queue`. Each may have a display `label` and a catalog `preset` (`cdn`, `api-gateway`, `web-server`, `external-api`, `object-storage`, `search-engine`, `message-broker`) that must fit its kind and never changes behavior. |
| `model.links` | Up to 24 links `{ id, source, target, latencyMs, timeoutMs \| null, retries, circuitBreaker }` in call direction. The graph must be acyclic; the client has exactly one outgoing link; a load balancer needs at least one backend and may not call another load balancer; a cache has at most one downstream; every node must be reachable from the client. |
| `workload` | `arrival` (`constant` or `poisson`), `offeredRps` (≤ 5,000), `startMs`, `durationMs`, `timeoutMs`, `propagateDeadline`, and up to 10 `bursts` of `{ atMs, durationMs, extraRps }`. |
| `faults` | Up to 12 faults, see below. |
| `run` | `sampleWindowMs` for charts, and an optional `horizonMs` (default: end of traffic plus one client timeout). |
| `assumptions` | Simplifications, exported with every result. |
| `expectedObservations` | Teaching hypotheses. Shown next to results, never evaluated. |
| `layout` | Optional canvas positions by node id. |

Node configs:

- `load-balancer`: `algorithm` (`round-robin`, `least-connections`, `random`), `retries` (0–5 attempts on another backend) and `healthCheck: { enabled, intervalMs, probeTimeoutMs, unhealthyThreshold, healthyThreshold }`.
- `service`, `database`, `pooler`, `queue`: `capacity` (slots, connections or workers, ≤ 10,000), `queueCapacity` (queue or backlog, ≤ 1,000,000), `serviceTimeMs`, `serviceTimeDistribution` (`fixed` or `exponential`), `contention` (0–1), `coherency` (0–0.1), `queueTimeoutMs` (or `null`) and `callMode` (`sequential` or `parallel`).
- `cache`: the same plus `hitRatio` (0–1).
- `rate-limiter`: `ratePerSec` and `burst`; exactly one downstream link.
- `db-cluster`: `writeRatio` (0–1) and `failoverMs`; two or more downstream links to workers, the first being the primary.
- `pooler`: exactly one downstream link.

Link extras: `retryBackoffMs`, `retryJitter`, `retryBudget` (0–1 or `null`) and `circuitBreaker: { enabled, failureThreshold, openMs }`. A `null` timeout means the caller waits until the request deadline.

Faults share `{ id, kind, target, atMs }`; every kind except `node-failure` has `untilMs | null` (null: until the end of the run).

| Kind | Target | Extra fields |
|---|---|---|
| `node-failure` | worker node | `recoverAtMs \| null`, `behavior: "refuse" \| "hang"` |
| `slowdown` | worker node | `factor` (1–100), `addMs`, `ramp` (needs an end time) |
| `error-rate` | worker node | `rate` (0–1) |
| `capacity` | worker node | `capacity` (≤ the node's capacity) |
| `link-latency` | link | `addMs` |
| `link-loss` | link | `rate` (0–1) |
| `cache-flush` | cache | none |

The bundled examples in [`examples/id`](../examples/id) and [`examples/en`](../examples/en) are valid files of this format (twenty experiments, same behavior in both languages, different titles and notes) and are checked in tests.

## Budget limits

A file is rejected when the run would exceed 15 minutes of simulated time or about 250,000 offered requests, or when the file is larger than 512 KB. The engine also stops at 3,000,000 events and marks the result as stopped early. These limits keep a browser tab responsive; they are product limits, not model limits.

## Import rules

- The file is parsed as JSON data only; nothing is executed.
- Unknown fields are rejected rather than ignored, so typos do not silently change meaning.
- Older versions are migrated first, step by step. `0.1.0-proposal` → `0.1.0`: `failureThreshold` becomes `unhealthyThreshold`, `workload.kind: "constant-rate"` becomes `arrival: "constant"`, missing fields get documented defaults. `0.1.0` → `0.2.0`: `server` nodes become `service` nodes, the load balancer gets `retries: 0`, and links get an id, zero latency, no timeout, no retries and a disabled circuit breaker. `0.2.0` → `0.3.0`: workers get `contention: 0`, `coherency: 0`, `queueTimeoutMs: null`, `callMode: "sequential"`; links get `retryBackoffMs: 0`, `retryJitter: false`, `retryBudget: null`; the workload gets `propagateDeadline: false`; slowdowns get `ramp: false`. Migrated files produce the same results as before.
- Every problem is reported with its path (for example `model.nodes[2].config.serviceTimeMs`) and a translatable message that says how to fix it.
- If the same experiment (same title and behavior) is already in the browser, it is reused instead of duplicated. If a different experiment uses the id, the import gets a new id and "(imported)" in its title.
- Result files and comparison bundles can be imported too: their embedded experiments are imported and re-run, and the app shows whether the behavior digest, trace fingerprint and request counts match the file.

## Messages and languages

Validation messages, insights and check details are emitted as keys with parameters (`{ key, params }`), never as English sentences, so the web app can show them in the user's language. The locale files in `apps/web/src/i18n/locales` hold the texts; a unit test checks that both languages cover every key.

## Digests

- **Input digest:** SHA-256 of the canonical experiment without `layout`. Canonical form sorts object keys, keeps array order (link order is call order and round-robin order) and drops undefined values.
- **Run key:** SHA-256 of the compiled engine input. It changes exactly when results can change, so titles, notes, labels and layout never make a result stale.
- **Trace fingerprint:** a non-cryptographic hash over every event field in emission order. Two runs with the same input, seed and engine version must produce the same fingerprint.

## Result artifact

Exported as `<experimentId>.result.json`:

```json
{
  "resultSchemaVersion": "0.3.0",
  "engineVersion": "0.3.0",
  "metricDefinitionsVersion": "0.3.0",
  "behaviorDigest": "sha256:…",
  "inputDigest": "sha256:…",
  "traceDigest": "fnv1a32x2:…",
  "seed": 42,
  "runStatus": "completed",
  "eventCount": 30431,
  "horizonMs": 61000,
  "metrics": { "offered": 6000, "succeeded": 5745, "failed": 255, "inFlight": 0, "…": "…" },
  "checks": [ { "id": "conservation", "passed": true, "…": "…" } ],
  "series": { "…": "…" },
  "limitations": [ "…" ],
  "experiment": { "…": "the full input" }
}
```

The numbers above are the real result of `lb-failure-with-health-checks`, except the event count, which is illustrative. The artifact contains no wall-clock values, so exporting the same run twice gives byte-identical files. The full event trace can be exported separately as CSV.

## Comparison bundle

Exported from the Compare page as `compare-<a>-vs-<b>.comparison.json`: `comparisonSchemaVersion`, the settings diff, the metric rows, and both result artifacts in full. Importing it recreates both experiments and opens the comparison. A Markdown report with the same content is available for handouts and reviews.

## Diff for comparisons

`semanticDiff(a, b)` lists every behavior-relevant difference, keyed by node id, link id, fault id and burst position, with field keys and units that the app translates. Titles, notes, labels and layout are ignored. Settings that cannot affect results on either side (probe settings with health checks off, breaker settings with the breaker off) are ignored too.
