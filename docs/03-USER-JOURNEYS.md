# User Journeys and UX Principles

## Journey A — First-time learner (no login)

1. Open FaultWorks. A runnable *Load Balancer Failure* scenario is visible; no blank canvas trap.
2. Read the stated question: **What happens to unsuccessful requests when one backend fails?**
3. Click Run Baseline. Observe event timeline, request completions and delay distributions.
4. Enable a scheduled Server B outage; re-run with the same seed.
5. Enable failure detection (health-check cadence + thresholds + propagation delay); re-run.
6. Open Compare. See request count and latency changes, with a warning about which assumptions are abstract.
7. Export the experiment, including engine version, input, seed, metric summary and limitations.

### First-use acceptance

Someone unfamiliar with the code should complete the journey in under ~10 minutes during a pilot (test target, not claim) and verbally explain the failure/recovery dynamics.

## Journey B — SRE / design review

Start from known topology, edit server capacity and traffic profile; run A/B; inspect saturation and failure modes; capture caveats and a shareable artifact; decide which assumptions require a real sandbox test. **Not** a substitute for measured capacity planning.

## Journey C — Instructor

Provide canonical scenario JSON and expected conceptual observations; have learners fork with a single variable change; check output version/seed; review explanation rather than gamified points alone.

## Workspace layout (proposal)

- Left: component palette + sample experiments.
- Center: topology canvas, node states, restrained event animations.
- Right: selected node configuration, explicit units, assumptions, and invalid configuration hints.
- Bottom: timeline, time-series metrics, table for before/after; contextual 'why it changed' sourced from deterministic events.
- Primary actions: Run, Pause, Step, Reset, Clone Experiment, Compare, Export.

## UX rules

- Simulation progress is based on **virtual time**, not UI frame timing.
- No misleading 'green' when backend failed but request success remains temporarily high.
- Never invent fractional requests in an event-level simulation.
- Always show number of observations behind percentiles and clarify handling of timeout/censored requests.
- Distinguish throughput from successful goodput and offer a visible legend with units.
- Show model assumptions next to controls and in export, not hidden behind settings.
- Keyboard accessible canvas controls; avoid color-only status encoding.
