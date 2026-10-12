# Product Vision and Positioning

**Status:** Proposed / hypotheses pending validation.

## North star

**Turn infrastructure diagrams into reproducible experiments that explain system behavior under stress and failure.**

FaultWorks is not a general-purpose network emulator, a replacement for Docker, a capacity-planning oracle, or a professional chaos-engineering agent. The core unit of value is an **experiment**, not a dashboard or an individual canvas node.

## Jobs to be done

- *When I am learning HA or distributed-system patterns, I want to change an explicit condition and observe the consequence without provisioning a fleet.*
- *When I am teaching reliability, I want every student to run the same scenario, understand assumptions, and submit comparable evidence.*
- *When discussing system designs, I want a low-cost, reversible way to explore what could fail before doing a real lab test.*

## Users and non-users

**Initial:** engineers learning distributed systems, DevOps/SRE practitioners, instructors and student cohorts. **Not initial:** organizations demanding accurate production capacity forecasting, security certification, arbitrary untrusted code execution, or enterprise access governance.

## Differentiation hypothesis (not established advantage)

Most visual simulators and container labs already cover considerable ground. We will test whether a **portable, explicit experiment contract** and a workflow for **A/B scenario comparison with assumptions, invariants and evidence** creates stronger learning and engineering utility. Future simulation-to-sandbox parity may create additional value, but carries substantial model-fidelity and security challenges.

Our intended promise is **understandable experiments**, not 'more accurate than Stability Sim' or 'runs every technology'.

## Product values

1. **Truthful modeling:** synthetic data must be labeled; explain simplifying assumptions.
2. **Reproducibility:** same version + scenario + seed -> same results.
3. **Local-first:** no account required for core experiments; no telemetry by default.
4. **Progressive fidelity:** abstract model first, optional measured experiment later, never silently equate both.
5. **Small usable slices:** add one correct failure mode before broadening catalog.
6. **Accessible:** users can inspect event timeline and metrics without relying on animations alone.

## Questions to resolve with users

- Can a learner explain the latency/error difference between health-check enabled and disabled cases?
- Do educators want scenario authoring, grading, or just reproducible shareable reports?
- Do SREs find simulation useful for review, or do they prefer immediate real container labs?
- Would the cost of a local agent be offset by stronger understanding or debugging value?

## Positioning statement

For engineers and educators who want to understand infrastructure failures without risking real services, **FaultWorks** is an open-source experiment workbench for composing, running, comparing, and explaining reproducible failure scenarios. Unlike a static diagram, it has a testable behavioral engine; unlike a full container lab, the initial experience runs in the browser. A future optional sandbox could connect assumptions to measured observations.
