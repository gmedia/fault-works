# CLAUDE.md

Project instructions for Claude Code. The shared guidance for all coding agents lives in AGENTS.md and is imported here so there is one source of truth.

@AGENTS.md

## Claude Code specifics

- Before finishing a task, run `pnpm check`, `pnpm typecheck` and `pnpm test`; run `pnpm test:e2e` when anything in `apps/web` changed.
- To look at the app, build and serve it with `pnpm build && pnpm --filter @faultworks/web preview` and drive it with Playwright; the E2E specs in `apps/web/e2e` show the selectors that work.
- Do not commit, push or open pull requests unless asked.
