## What changes for the user

<!-- What someone using FaultWorks will see or get differently, and why. Link the issue: "Closes #123". -->

## How it was checked

<!-- Tests added or changed, and anything you checked by hand (screens, themes, phone width). -->

## Checklist

- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass; `pnpm test:e2e` passes for UI changes
- [ ] A test would have failed before this change (for bug fixes)
- [ ] Golden numbers are unchanged, or the PR explains why they changed
- [ ] Engine trace changes bump `ENGINE_VERSION`; schema changes include a migration
- [ ] UI works by keyboard, at 320 px and in both themes; status is never color alone
- [ ] Docs and `CHANGELOG.md` are updated when behavior, metrics or the file format change
