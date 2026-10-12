# Open-source Governance, Naming and Release

## Proposed public identity

- Product: **FaultWorks**
- Endorsement: **by GMEDIA** (subject to company approval)
- Tagline: **Experiment with failure. Build more resilient systems.**
- Repository: [`gmedia/fault-works`](https://github.com/gmedia/fault-works) on GitHub, public since 2026-10-12.
- Intended documentation language: English, with optional Indonesian project brief.

A preliminary broad web search found no obvious major infrastructure product using exactly `FaultWorks`, but **this is not a legal trademark search, domain availability check, or repository-name reservation**.

## Legal/release gate

**Status (2026-10-12):** the maintainers published the repository. Items 3, 5 and the governance files are done (Apache-2.0, dependency audit, see ADR-008); the security contact is GitHub private vulnerability reporting. A trademark search for the name is still open.

The original gate, before making anything public, was authorization for:

1. Company use of GMEDIA name, logo, trademarks and public communications.
2. Ownership and licensing of new employee-created code under the employment agreement.
3. Decision on license (**Apache-2.0 proposed**, *not granted yet*) and who can approve copyright notices.
4. No copying of the private Failab repository, assets, private configs or customers' infrastructure data without explicit rights review.
5. Dependency license audit, third-party notices, sample content permission and image asset review.
6. Company open-source policy, security disclosure address, and maintainer/backup maintainer commitment.

Do **not** add a fake copyright/Apache LICENSE file with a company's identity before approval. Until then, call this a *design blueprint*.

## Governance files

All present: `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `GOVERNANCE.md`, `.github/CODEOWNERS`, issue and pull request templates, Dependabot, and CI for lint, typecheck, tests, build and E2E. `AGENTS.md` and `CLAUDE.md` guide AI coding agents. Follow conventional semver after first release; before that, explicitly label breaking experiment schema changes.

## Project policy

- No secrets or real enterprise topologies in sample files and screenshots.
- Public discussions/roadmap without exposing GMEDIA infrastructure details.
- Every behavioral model documented, tested, and versioned.
- Contributor PRs need deterministic regression cases and user-facing limitations.
- Publish reproducible benchmark or test evidence rather than claims of unverified realism.

## Business model (unvalidated)

Core offline simulation and local experiments remain open-source. Managed hosted sandbox, instructor sessions and support are possible future products, but their security and infrastructure cost could exceed revenue. Do not build billing before demand validation.
