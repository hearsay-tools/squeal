# Wave 11 briefs

Rebased onto spec 002 and 003 work (other coordinator, landed 2026-10-07): harness-neutral hook logic is in `src/harness/shared/` (002-10), the daemon runs a composite runner (003-10), and 002-12, 002-13 and 003's wave 1 are running on `src/harness/codex/`, `plugins/codex/`, `src/cli/` and `src/runners/node-test/`. Stay out of those.

From `lessons.md` "Fresh worktrees and the validation backlog", defects 17 to 20, and the human's decisions of 2026-10-07. `--backend claude --model opus --effort high`, never Fable. 001-100, 001-101 and 001-102 run in parallel on disjoint files.

## 001-100 no validation without dependencies; the agent's edits run ahead of any backlog

Use /worker. Shape: slice. Defects 18 and 19.

Outcome: a worktree without its own installed dependencies pushes nothing and runs nothing until the install, and a test file the agent writes or affects runs within a tier even while a full-suite backlog is queued.

Read: `lessons.md` "Fresh worktrees and the validation backlog"; spec D3 (installed-dependency fingerprint, `isInstalledLockfile`), D5 (ordering, tiers, runner failure as a state), D6 (no-dependencies note), D10.

Decided:
- **Wait for dependencies:** when the worktree root's `package.json` declares dependencies (`dependencies`, `devDependencies` or `optionalDependencies`, workspaces included) and the root has no installed lockfile (D3; `locateLockfile` never looks above the root), the daemon does not list-run or baseline: every test file is `unknown` with the reason "no dependencies are installed in this worktree", one note is persisted, and nothing is pushed beyond the registration header saying so once. The install (an installed lockfile appearing) starts validation as today's recreate does. A project that declares no dependencies validates as today, which matters for spec 003's `node:test` runner. The rule applies to every runner behind the composite (003-10), not only Vitest.
- **Recent first:** work caused by the latest revisions (test files whose closure a revision changed, and test files added) runs ahead of work carried from earlier revisions, the baseline, or an environment change, at the next tier boundary. Within each group D5's order stands. Amend D5.

Seam: `src/core/scheduler/` (bootstrap and the queue), then the daemon start path for the wait.

Own: `src/core/scheduler/`, `src/core/daemon/` (start path and note only), `src/core/keys/environment.ts` (read only, unless a predicate is missing; ask), `src/core/delivery/format.ts` (the one no-dependencies registration line, if needed), tests under `test/scheduler/`, `test/daemon/`, `test/e2e/` if a new scenario fits there, D5 and D10 in `spec.md`, one `status.md` line. Leave `src/harness/` and `src/core/delivery/delta.ts` to 001-101, and `src/runners/node-test/` to spec 003's running rows. Do not run `npm run build` or touch `plugins/claude-code/dist`. Commit as you go.

Done when: a fixture worktree without `node_modules` runs nothing and the agent receives no failure reports, then validates after an install; with 200 test files queued by an environment change, an edit to one test file's module runs that file before 190 of them (measured, reported); the existing ordering tests pass.

## 001-101 deny-once only for a check that passed here

Use /worker. Shape: repair. Defect 17.

Outcome: `interrupt.onRegression` denies an edit only for a `PASS -> FAIL` of a check this worktree had seen pass, never for a first-seen or baseline failure, and never while no dependencies are installed.

Read: `lessons.md` defect 17; spec D9 (PreToolUse), D6; `src/harness/claude-code/hooks/pre-tool-use.ts`, `src/core/delivery/delta.ts` (how a regression is picked).

Seam: the regression filter in `src/harness/shared/deny.ts` (`denyOnRegression`, moved there by 002-10 and shared with the Codex plugin that 002-12 is building). Own: `src/harness/shared/deny.ts`, `src/harness/claude-code/hooks/pre-tool-use.ts`, the regression selection in `src/core/delivery/` (not `format.ts`), `test/harness/pre-tool-use.test.ts`, `test/e2e/policy.test.ts`, `plugins/claude-code/skills/squeal/references/policy.md`, D9 in `spec.md`, one `status.md` line. Leave `src/core/scheduler/` to 001-100 and `src/harness/codex/` to 002-12; the fix reaches Codex through the shared module. Do not run `npm run build` or touch `plugins/claude-code/dist`.

Done when: a baseline with 59 first-seen failures denies nothing; a check that passed and then fails denies once as today; an inherited pass that then fails here denies once; no deny while the no-dependencies state holds.

## 001-102 research: key results by the packages a test imports

Use /researcher. Topic: `research/README.md` "per-package-keys". Output `research/per-package-keys.md`, probes under `research/probes/per-package-keys/` (throwaway, `node_modules` out of git).

Outcome: whether a worker whose lockfile differs a little from a validated worktree's could inherit most results without ever reusing a result its dependencies could change.
