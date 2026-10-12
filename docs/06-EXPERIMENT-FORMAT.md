# Portable Experiment Contract

**Status:** schema `0.1.0`, implemented in `packages/experiment`. The zod schema in [`schema.ts`](../packages/experiment/src/schema.ts) is the source of truth; this page explains it.

One file captures everything needed to reproduce a simulation and understand its assumptions. Canvas layout is stored for convenience but never affects results.

## Experiment file

| Field | Meaning |
|---|---|
| `schemaVersion` | `"0.1.0"`. Unknown versions are rejected with an explanation. |
| `experimentId` | 1–48 lowercase letters, digits or hyphens. |
| `title`, `question`, `description` | What the experiment is for. Shown in the app, ignored by the engine. |
| `seed` | Unsigned 32-bit integer. Only matters with Poisson arrivals or exponential service times. |
| `model.nodes` | Exactly one `client`, one `load-balancer` and 1–8 `server` nodes. Each may have a display `label`. |
| `model.links` | `client → load-balancer` and `load-balancer → server` for every server; nothing else is accepted in v0.1. |
| `workload` | `arrival` (`constant` or `poisson`), `offeredRps`, `startMs`, `durationMs`, `timeoutMs`, and up to 10 `bursts` of `{ atMs, durationMs, extraRps }`. |
| `faults` | Up to 10 `node-failure` faults: `{ id, target, atMs, recoverAtMs \| null, behavior: "refuse" \| "hang" }`. Faults on the same server must not overlap. |
| `run` | `sampleWindowMs` for charts, and an optional `horizonMs` (default: end of traffic plus one client timeout). |
| `assumptions` | Simplifications, exported with every result. |
| `expectedObservations` | Teaching hypotheses. Shown next to results, never evaluated. |
| `layout` | Optional canvas positions by node id. |

Load balancer config: `algorithm: "round-robin"` and `healthCheck: { enabled, intervalMs, probeTimeoutMs, unhealthyThreshold, healthyThreshold }`.

Server config: `capacity` (slots), `queueCapacity`, `serviceTimeMs` and `serviceTimeDistribution` (`fixed` or `exponential`).

The bundled examples in [`examples/`](../examples) are valid files of this format and are checked in tests.

## Budget limits

A file is rejected when the run would exceed 15 minutes of simulated time or about 250,000 offered requests, or when the file is larger than 512 KB. The engine also stops at 3,000,000 events and marks the result as stopped early. These limits keep a browser tab responsive; they are product limits, not model limits.

## Import rules

- The file is parsed as JSON data only; nothing is executed.
- Unknown fields are rejected rather than ignored, so typos do not silently change meaning.
- Older versions are migrated first. `0.1.0-proposal`, the planning-phase example, is upgraded automatically: `failureThreshold` becomes `unhealthyThreshold`, `workload.kind: "constant-rate"` becomes `arrival: "constant"`, and missing fields get documented defaults.
- Every problem is reported with its path (for example `model.nodes[2].config.serviceTimeMs`) and a message that says how to fix it.
- If the same experiment (same title and behavior) is already in the browser, it is reused instead of duplicated. If a different experiment uses the id, the import gets a new id and "(imported)" in its title.
- Result files and comparison bundles can be imported too: their embedded experiments are imported and re-run, and the app shows whether the behavior digest, trace fingerprint and request counts match the file.

## Digests

- **Input digest:** SHA-256 of the canonical experiment without `layout`. Canonical form sorts object keys, keeps array order (server order is round-robin order) and drops undefined values.
- **Run key:** SHA-256 of the compiled engine input. It changes exactly when results can change, so titles, notes, labels and layout never make a result stale.
- **Trace fingerprint:** a non-cryptographic hash over every event field in emission order. Two runs with the same input, seed and engine version must produce the same fingerprint.

## Result artifact

Exported as `<experimentId>.result.json`:

```json
{
  "resultSchemaVersion": "0.1.0",
  "engineVersion": "0.1.0",
  "metricDefinitionsVersion": "0.1.0",
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

`semanticDiff(a, b)` lists every behavior-relevant difference, keyed by node id, fault id and burst position, with human labels and units. Titles, notes, labels and layout are ignored. When health checks are off on both sides, probe settings are ignored too, because they cannot affect results.
