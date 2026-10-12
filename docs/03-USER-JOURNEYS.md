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

## Journey D — Builder (v0.2)

Start from a template or a blank canvas, add components and connect them in call order, set timeouts and breakers on the links that matter, add any fault to any component or link, run, and read the explanation. The app must never limit the builder to the shipped examples; the limits are only the product budget (12 components, 24 links, 12 faults).

## Workspace layout (as built in v0.2)

**Desktop (≥ 768 px):**

- **Header:** experiment title and question, a status line (not run, results current, settings changed, problems to fix), and the actions Undo, Redo, Create variant, Compare, Export, More and Run.
- **Canvas (left):** the free topology. Drag from a component's handle to another to connect; click a link to edit it; "Add component" offers the five kinds. During replay each component shows status, busy slots and queue, links show rates, breaker state and fault indicators, and requests flow along the links. Below it, the replay bar: play and pause, step one window, jump to the previous or next state change, a scrubber that shows fault periods, and replay speed.
- **Inspector (right):** tabs for the selected component or link, traffic, faults, run settings (seed, horizon, chart window) and notes. Units sit inside every field and errors appear next to it.
- **Results (below):** summary figures led by failed requests, then tabs for charts over time, a plain-language explanation next to the author's expected observations and assumptions, the event log, and model checks with a reproducibility re-run.

**Phone (< 768 px):** the same content as three screens in a bottom tab bar, Build (stacked topology list, tap a component for its settings sheet), Replay (playback bar over the list with live status) and Results, with Run always in the thumb zone. Secondary header actions sit in the More menu.

**Language:** Bahasa Indonesia by default, English when the browser prefers it; a menu in the header switches and remembers the choice.

## UX rules

- Simulation progress is based on **virtual time**, not UI frame timing.
- No misleading 'green' when backend failed but request success remains temporarily high.
- Never invent fractional requests in an event-level simulation.
- Always show number of observations behind percentiles and clarify handling of timeout/censored requests.
- Distinguish throughput from successful goodput and offer a visible legend with units.
- Show model assumptions next to controls and in export, not hidden behind settings.
- Keyboard accessible canvas controls; avoid color-only status encoding.
