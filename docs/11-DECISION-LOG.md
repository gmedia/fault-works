# Decision Log (ADRs, Proposed)

All decisions are **provisional** until reviewed and approved by project maintainers/company.

## ADR-001 — Clean new public project, not publishing private Failab

**Decision:** New repository/source; prior Failab remains private. **Why:** different objective and unknown permission boundaries. **Consequence:** extra setup, but avoids historical scope/code/IP coupling.

## ADR-002 — Experiment-first instead of feature-count-first

**Decision:** Core artifact is a reproducible experiment with explicit model and comparison. **Why:** canvas/simulation alone is already well represented by open-source competitors. **Consequence:** need rigorous contract and definitions up front.

## ADR-003 — Browser-only v0.1

**Decision:** Static React/Vite (TanStack Router, see ADR-009) + TS engine + worker; no backend/auth/DB. **Why:** lowest adoption friction, cheapest hosting, simpler operations. **Consequence:** real execution not yet possible.

## ADR-004 — Separate engine from visualization

**Decision:** Pure TS engine with stable inputs/outputs; visual UI cannot modify virtual time. **Why:** correctness, headless tests, portability. **Consequence:** duplicate representations via compiler/adapter layer.

## ADR-005 — Simulation is not emulation

**Decision:** Explicitly describe abstract request-level behavior; no production predictions or claims of NGINX/HAProxy parity. **Why:** accurate expectation management. **Consequence:** some users looking for packet fidelity should choose other tools.

## ADR-006 — Sandbox only after validated MVP

**Decision:** Optional separate local agent behind narrow allowlisted templates; hosted version deferred. **Why:** execution risk and cost are materially different. **Consequence:** later product may require redesign at integration boundary, which is why schema is portable now.

## ADR-007 — FaultWorks branding is provisional

**Decision:** Use FaultWorks in blueprint only. **Why:** concise global-readable name that evokes failure experiments. **Consequence:** company authorization, namespace/trademark screening and legal approval required before publishing.

**Update (2026-10-12):** The maintainers published the project as `gmedia/fault-works` on GitHub under the FaultWorks name. A trademark search has still not been done; the name may change if one finds a conflict.

## ADR-008 — License: Apache-2.0

**Original decision:** Recommend Apache-2.0 but mark it pending until company/employee IP and branding were approved.

**Update (2026-10-12):** The maintainers chose Apache-2.0 when publishing the repository and added `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md` and `GOVERNANCE.md`. **Why Apache-2.0:** permissive, with an explicit patent grant and a clear contribution clause, which suits company-sponsored tooling. A production dependency audit (`pnpm licenses list --prod`) found only MIT, ISC, BSD, Apache-2.0, 0BSD and Unlicense code in the shipped bundle, plus IBM Plex fonts under OFL-1.1, all compatible. **Consequence:** contributions are accepted under Apache-2.0; new runtime dependencies must keep that compatibility.

## ADR-009 — Frontend stack: React + TanStack Router in a pnpm workspace

**Decision:** Scaffold `apps/web` with React 19, Vite, TanStack Router (file-based, code-split), Tailwind CSS v4 and shadcn/ui conventions, linted by Biome, inside a pnpm workspace that will also host `packages/engine`, `packages/experiment` and `packages/metrics`. TanStack Query is left out until there is real async server state. **Why:** matches the stack the team already uses in other React projects, keeps type-safe routing for experiment and comparison URLs, and still builds to a plain static bundle as required by ADR-003. **Consequence:** route files follow TanStack conventions and `routeTree.gen.ts` is generated; engine packages must stay free of React and router imports (ADR-004).

## ADR-010 — All state stays in the browser

**Decision:** Experiments and undo history live in a Zustand store; the library is persisted to `localStorage`. Results are kept in memory only and recomputed when needed. **Why:** v0.1 has no backend by design (ADR-003), and results are reproducible from the experiment, so storing them would only risk showing stale numbers. **Consequence:** experiments are per browser; sharing works by exporting and importing files. A sync or hosted mode would need its own design.

## ADR-011 — Simulation in a Web Worker, results replayed on the page

**Decision:** The worker validates, compiles, simulates and reduces; the page only renders and replays recorded results over simulated time. **Why:** long runs must not block input, and the replay must never be able to change results (invariant 7). **Consequence:** the replay works from windowed series plus exact transition times, so per-request animation is not shown; the event log covers that detail.

## ADR-012 — Hand-written SVG charts instead of a chart library

**Decision:** Time charts are a small SVG component with fault bands, a shared crosshair, keyboard slider semantics and a table view. **Why:** the detection-gap band, cross-chart hover and accessibility requirements were easier to meet exactly than to bend a library to, and it avoids a large dependency. **Consequence:** new chart types (histograms, scatter) need their own components.

## ADR-013 — Failure semantics: refuse or hang, no cancellation

**Decision:** Faults either refuse connections or hang; servers keep working on requests whose clients gave up and discard the late responses. **Why:** these two behaviors produce the contrast the first lessons need (immediate errors versus timeouts and slower detection), and no cancellation is the common real default. **Consequence:** overload scenarios can waste capacity on abandoned work, which is visible as late responses. Cancellation can be added later as an explicit server option.

## ADR-014 — v0.2 brought forward: free graphs before the real pilot

**Decision (2026-10-12):** Build v0.2 (free topology, five component kinds, seven fault kinds, link-level resilience) before the pilot in docs/10, instead of after it. **Why:** the maintainers judged the v0.1 workbench too limiting to publish: it could only teach the shipped examples, and the audience wants to design and break their own systems. **Consequence:** the pilot now evaluates a larger product; the scope doc records what is still out (backoff, rate limiting, bulkheads, autoscaling), and the stop rules still apply.

## ADR-015 — Indonesian first, with messages as keys

**Decision:** The UI defaults to Bahasa Indonesia and falls back to English from the browser language. Packages emit validation messages, insights and check details as `{ key, params }`; only the web app holds text. Built-in examples are authored per language with identical behavior. **Why:** the primary audience reads Indonesian, and translating after the fact would have left package messages in English. **Consequence:** every new string needs two locale entries, enforced by a unit test; package APIs never return sentences.

## ADR-016 — Phone first with one shared workbench state

**Decision:** Below 768 px the workbench is three screens (Build, Replay, Results) in a bottom tab bar with a settings sheet; above it, canvas, inspector and results on one page. Both layouts share the same context, stores and URL state. **Why:** most first contacts with the app happen on a phone, and a shrunken desktop layout failed the simulated pilot. **Consequence:** the stacked topology list must offer every editing operation the canvas offers, through buttons; the E2E suite runs the phone project on every change.

## ADR-017 — Replay animation is derived, never authoritative

**Decision:** Flow dots, crash shake and pulse rings are CSS driven by the recorded replay position and windowed rates. They do not run the simulation and cannot change it, and they switch off under `prefers-reduced-motion`. **Why:** the user asked for a simulation that feels alive; invariant 7 (replay never alters results) must hold. **Consequence:** animation shows rates per window, not individual requests; the event log remains the place for per-request detail (ADR-011).

## ADR-018 — Contention through the Universal Scalability Law

**Decision:** Model load-dependent slowdown with two coefficients per worker, contention α and coherency β, applied as `1 + α(n − 1) + β·n(n − 1)` to a call's own work, with n the busy slots when it starts. Databases created in the editor default to α 0.02 and β 0.0005. **Why:** without it, adding connections could only ever help, which contradicts the most common real database failure (too many connections) and makes the case for connection poolers impossible to show. USL is a published, two-parameter model that produces a throughput peak and retrograde scaling, and it is easy to explain next to the field. **Consequence:** results depend on illustrative coefficients; the UI, guide and examples say so and show where the peak is. The factor is fixed per call at start, a simplification documented in docs/05.

## ADR-019 — Catalog presets add names and defaults, never behavior

**Decision:** Components such as CDN, API gateway, web server, search engine, object storage, message broker and third-party API are presets on existing kinds (cache, rate limiter, service, queue). A preset stores only an id that sets the icon, name and starting values. **Why:** users want to build from the parts they know, but every new behavior needs a contract, tests and an engine version. Presets give breadth without pretending to emulate products (ADR-005). **Consequence:** a CDN behaves exactly like a cache with the same numbers; the inspector says so next to every preset.

## ADR-020 — Links are validated before they are created

**Decision:** One function, `linkProblem`, decides whether a link may exist; the canvas, the inspector and `addLink` all use it, and adding a component after a single-exit component inserts it in between. **Why:** users reported that linking components was buggy: drops only worked on a tiny dot, and invalid links appeared and immediately turned the experiment red. **Consequence:** some links can no longer be drawn at all (a second exit from the client, a cycle); the editor shows the reason instead.
