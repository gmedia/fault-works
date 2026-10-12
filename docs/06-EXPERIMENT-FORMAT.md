# Portable Experiment Contract

## Goal

One file captures enough information to **reproduce** an abstract simulation and understand its assumptions. Don't let the React Flow layout become the source of truth for behavior.

## Proposed schema

Top-level fields:

- `schemaVersion` — artifact schema, e.g. `0.1.0`.
- `experimentId`, `title`, `question`, `description` — user-facing metadata.
- `model` — nodes, directed links and their component parameters.
- `workload` — arrival plan and simulation horizon in named units.
- `faults` — ordered fault injections with simulated timestamps.
- `seed` — integer or string normalized by specified PRNG implementation.
- `assumptions` — model simplifications, limits and unsupported behavior.
- `expectedObservations` — human-readable teaching hypotheses, not hard-coded answers.
- `layout` — optional canvas positions; must not affect engine results.

See [`examples/load-balancer-failure.scenario.json`](../examples/load-balancer-failure.scenario.json) for **provisional example data**. It is a proposal, not an implemented schema and not an executable verified simulation.

## Result artifact (future implementation)

Separate `experiment-input.json` from `result.json`. Result should include:

```json
{
  "resultSchemaVersion": "0.1.0",
  "engineVersion": "<git-sha-or-release>",
  "inputDigest": "<sha256-of-canonical-input>",
  "seed": 42,
  "runStatus": "completed",
  "metrics": {"offered": 0, "success": 0, "failure": 0, "inflight": 0},
  "metricDefinitionsVersion": "0.1.0",
  "limitations": ["abstract request-level simulation"]
}
```

This is a **schema sketch**, not an observed result. The values `0` and placeholders are illustrative only.

## Import/export requirements

- Strict schema validation and readable rejection errors.
- Explicit migration path when a schema field is renamed or default behavior changes.
- Canonical sorting/serialization for input digest; execution semantics never depend on object key order.
- Limit input bytes, node count, edge count, and events; importing JSON must not execute scripts.
- No secrets, internal IPs or customer data in bundled public examples.
- Diff-aware A/B experiments should show exactly which semantic configuration fields changed; layout coordinates ignored.

## Reproducibility test

Given the same validated input, engine commit/version, and seed, event results and metrics must match. Browser/device framerate cannot change the output.
