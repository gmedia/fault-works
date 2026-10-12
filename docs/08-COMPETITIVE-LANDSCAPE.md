# Competitive Landscape and Build-vs-Reuse

**Research snapshot:** 12 October 2026. This is a limited comparison of published repository/product descriptions, not an exhaustive feature or license audit. Recheck upstream versions before implementation.

| Project | Confirmed positioning from its published documentation | Implication |
|---|---|---|
| [Stability Sim](https://github.com/marcbrooker/stability-sim) | Browser discrete-event model, React Flow canvas, deterministic seeded behavior, retries, queues, outages, metrics. Apache-2.0 repo. | **High overlap** with a basic simulator; do not claim determinism or fault injection as unique. |
| [Breakscale](https://github.com/xevrion/breakscale) | Browser system-design simulator; documented scenarios and failure modes; deterministic engine. | High overlap with educational failure simulation and scenario libraries. |
| [SystemForge](https://github.com/GBFerro/system-design-simulator) | System-design interview practice, many building blocks, simulation and scoring. | Don't compete on number of nodes or interview gamification initially. |
| [DistSim](https://github.com/hamidxgh/distsim) | Docker-based real container labs with a visual topology, terminal, and fault injection; MIT repository. | Real sandbox alone is not unique and is expensive to secure. |
| [Containerlab](https://containerlab.dev/) | Real container-network topology and lifecycle management. | Integrate/adapt existing engines in future where suitable; avoid reinventing network orchestration. |
| [React Flow](https://reactflow.dev/) | MIT-licensed editor primitives. | Reuse, not reinvent canvas internals. |
| [Killercoda](https://killercoda.com/pricing) | Hosted interactive exercises and scenarios; paid offerings exist. | Demand for lab UX exists, but is not evidence of willingness to pay FaultWorks. |

## Hypothesis to validate

A **first-class portable experiment** with assumptions, deterministic run evidence, explicit A/B variable diff, and eventual predicted-vs-observed comparison may be useful in a more focused learning/engineering workflow. **No uniqueness claim** until pilot testing shows a meaningful gap compared with the above projects.

## Build-vs-reuse rules

- Use React Flow for topology UX.
- Study Stability Sim and Breakscale models/test strategies; do not copy source code into a clean project without license review and attribution.
- Before committing to an agent, evaluate reuse of containerlab or Docker SDK abstractions. Never expose raw daemon APIs over public HTTP.
- If a competitor already offers the exact validated end-to-end workflow at comparable cost, preferentially contribute upstream instead of duplicating it.

## Evidence we still need

- Hands-on UX testing with Stability Sim, Breakscale and DistSim (not just README).
- Feedback from 3–5 external engineers/educators on one experiment.
- Proof that comparison/evidence UX delivers insight beyond existing products.
- License compatibility, dependency and asset audits before publishing binaries/sites.
