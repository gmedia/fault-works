# Governance

FaultWorks is maintained by GMEDIA engineers together with outside contributors. This page says who decides what, so contributors know how a proposal moves forward.

## Roles

- **Contributors** are everyone who opens an issue, reviews a change or submits a pull request.
- **Maintainers** review and merge pull requests, triage issues, cut releases and enforce the Code of Conduct. The current maintainers are listed in [.github/CODEOWNERS](.github/CODEOWNERS).

A contributor who has made sustained, high-quality contributions can be invited to become a maintainer by the existing maintainers.

## How decisions are made

Most changes are decided in the pull request: a maintainer approves and merges once CI passes and review comments are resolved.

Larger decisions are recorded as numbered entries in the [decision log](docs/11-DECISION-LOG.md). These include new model behavior, file format changes, new runtime dependencies, and anything that adds a server or touches user data. Propose them in an issue first. Maintainers aim for agreement; if they cannot reach it, the GMEDIA maintainers make the final call and record the reasoning.

## Product guardrails

These come from the [vision](docs/01-VISION-AND-POSITIONING.md) and [scope](docs/02-SCOPE-AND-ROADMAP.md) documents and apply to every decision:

- The core stays browser-first, offline-capable and free of accounts and telemetry.
- Results must be reproducible and their assumptions visible.
- The product never claims to predict production behavior.
- Growth follows validated user needs, not feature counts. The stop rules in the scope document apply.

## Releases

Until 1.0, minor versions may change the experiment schema; every such change ships with a migration and a changelog entry. Engine changes that alter the event trace for an existing experiment bump the engine version.
