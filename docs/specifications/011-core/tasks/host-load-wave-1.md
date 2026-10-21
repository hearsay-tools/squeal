# Host-load wave 1: the accepted designs 011-85 and 011-84

The human, 2026-10-21: 011-85 and 011-84 accepted as recommended. The spec text is in 011 C3, C4, C7, C9, C11, C14 and 004 D2 (`status.md`, 2026-10-21). 011-87 to 011-90 reach main in one candidate: no release ships 011-87 to 011-89 without 011-90. Another coordinator's wave 10 (`wave-10.md`) runs 011-20 in `src/core/daemon/` and `src/cli/stop.ts`; keep to your files.

Every worker: tests first, red before green. Your full-suite verdict is `squeal run --all --wait`; `npx vitest run --maxWorkers=4` only when Squeal is unavailable, and say so. A file that fails under load and passes alone is named in your summary. Run `npm ci` first. No build, no bundles, no version raise, no spec text, no board. Done when your rows' tests are red before and green after, and `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass, their output in your summary.

## W1: 011-87 then 011-89, the installed-dependency input

Use /worker. Shape: slice, two commits. Read `tasks/011-85/design.md` sections 1, 1.3, 3 and 8 (R1, R3), C11's installed-dependencies bullet.

Seam: `installedDependencies` in `src/core/keys/environment.ts`. First edit, a lead: `withoutOwnVersions` in `src/core/keys/hidden-lockfile.ts` and `test/keys/own-versions.test.ts`; then R3's `src/core/keys/pnpm-lockfile.ts`.

Owns: R1's and R3's files in section 8. Not yours: `src/runners/vitest/` (W2), R4's files (011-90 comes to you after W1 and W2 land).

## W2: 011-88, each Vitest project's config files

Use /worker. Shape: slice. Read `tasks/011-85/design.md` sections 2 and 8 (R2), C3's environment-hash bullet.

Seam: `projectInputs` in `src/runners/vitest/project.ts`. First edit, a lead: `projectConfigFiles(vitest, project)` and `test/runners/vitest/project-config.test.ts`, "an edit of e2e/vitest.config.ts re-keys only e2e". `exclude-projects-filter.test.ts`'s "excluding e2e" row changes from `true` to `false` in the same commit.

Owns: R2's files in section 8. Not yours: `src/core/keys/` (W1), `src/runners/vitest/environment.ts` (011-90).

## W3: 011-91, 011-92, 011-93, departed and unused daemons

Use /worker. Shape: slice, three commits in this order. Read `tasks/011-84/design.md` sections 1 to 3 and 6, C9 and 004 D2 as amended.

Seams, one per row, as section 6 names them: 011-91 the `lookupOnly` branch of `src/core/scheduler/bootstrap.ts`; 011-92 `Scheduler.inUse()` in place of `busy()`; 011-93 `Scheduler.pauseBacklog`, `Ledger.ordered` and `slow-tier.ts`'s `next()` and `#waitAtSlot`. First edit, a lead: `test/scheduler/rest-resume.test.ts`, the edit that wakes a resting `lookup-only` daemon runs.

Owns: the three rows' files in section 6. Not yours: `src/core/capacity/` (011-83, not accepted yet), `tiers.ts`, `src/core/keys/`.
