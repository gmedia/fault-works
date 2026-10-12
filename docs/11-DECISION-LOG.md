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

## ADR-008 — Do not create an Apache-2.0 LICENSE without authorization

**Decision:** Recommend Apache-2.0 but explicitly mark it pending. **Why:** company/employee IP and branding require approval. **Consequence:** blueprint not distributable as licensed source software yet.

## ADR-009 — Frontend stack: React + TanStack Router in a pnpm workspace

**Decision:** Scaffold `apps/web` with React 19, Vite, TanStack Router (file-based, code-split), Tailwind CSS v4 and shadcn/ui conventions, linted by Biome, inside a pnpm workspace that will also host `packages/engine`, `packages/experiment` and `packages/metrics`. TanStack Query is left out until there is real async server state. **Why:** matches the stack the team already uses in other React projects, keeps type-safe routing for experiment and comparison URLs, and still builds to a plain static bundle as required by ADR-003. **Consequence:** route files follow TanStack conventions and `routeTree.gen.ts` is generated; engine packages must stay free of React and router imports (ADR-004).
