# Validation, Test Strategy and Go/No-Go Gates

## Product validation

**Pilot group:** 3–5 independent participants across a DevOps/SRE engineer, a backend developer and at least one learner/educator. These are recruitment targets, not claimed users.

Give them a task: "A two-backend service loses one backend while receiving constant traffic. Show how failure detection changes unsuccessful requests and latency, then export enough evidence for someone else to reproduce it."

Observe without leading: time-to-first-run, completion, misinterpretations, confidence in assumptions, clarity of run comparison, whether they would reuse/share the artifact and what existing alternative they would choose.

**Go:** majority successfully interpret what changed, can reproduce experiment, and can articulate a benefit that alternatives don't already meet in their context. **No-go/adjust:** users only like visuals, can't trust results, or alternatives already solve their actual job as well or better.

## Engine test pyramid

1. **Unit**: priority queue, PRNG, state transitions, admission, health status and metrics.
2. **Property**: conservation counts, monotonic simulated time, nonnegative queue, no duplicate terminal outcomes, deterministic run.
3. **Reference golden cases**: fixed arrivals/latency, exact completions, failure-before/after detection.
4. **Scenario regression**: hashed canonical input → golden event trace and metrics; versioned snapshots.
5. **Browser E2E**: topological edits, Run/Pause/Reset, import validation, A/B comparison, large scenario rejection.
6. **Accessibility**: basic keyboard and screen-reader checks, reduced-motion controls.

## First golden scenarios

- Two healthy zero-queue backends, RR alternating routing.
- Backend B dies at a known simulated timestamp, no detection; subsequent B-directed attempts fail.
- Same scenario with explicit health-check interval/threshold; B removed after detection, not immediately.
- A temporarily overloaded while B down: finite queue causes increased latency and possibly timeout/rejection.
- Re-run same input with different animation speed; engine output unchanged.

## Performance constraints (initial targets, revise after profiling)

- First scenario starts without login or network calls beyond static assets.
- Typical 2–10 node teaching example completes on a midrange laptop without locking UI.
- Configurable max events/time horizon prevents browser freezes.
- Persistent artifacts remain interpretable with schema/engine version and units.

## Test status (v0.1)

| Layer | Where | State |
|---|---|---|
| Unit | `packages/*/src/*.test.ts` | PRNG, event queue, schema, migration, compiler, digests, diff, editing helpers, percentiles |
| Property | same files, with fast-check | determinism, conservation, single outcome, capacity and queue bounds, monotonic time, canonical JSON, SHA-256 |
| Golden reference | `packages/metrics/src/metrics.test.ts` | the four scenarios above with hand-computed counts (1,005 vs 255 failures, 355 timeouts, detection at 25 s and 27 s), window-size invariance |
| Browser E2E | `apps/web/e2e/journeys.spec.ts` | first-use A/B journey, undo and persistence, invalid input, replay speed invariance, import and migration, export, delete undo |
| Accessibility | `apps/web/e2e/accessibility.spec.ts` | axe WCAG 2.2 A/AA on every page in light and dark themes, keyboard checks |
| Mobile | `apps/web/e2e/mobile.spec.ts` | no horizontal scroll on a phone viewport |

Performance check: the largest allowed run (about 240,000 requests, 1.2 million events) simulates in under a second on a laptop, in a Web Worker so the page stays responsive.

## Three proof points before sandbox investment

1. Simulator is correct against known reference cases.
2. At least three independent pilot users successfully perform and explain the A/B experiment.
3. Strong evidence that a real sandbox comparison adds value beyond an existing container-lab tool.

## GMEDIA adoption

Use internally with a learner/engineer session, not a deployed platform requiring daily attention. Measure whether it reduces the effort to explain HA failure modes or improves review discussions, not number of dashboard visits.
