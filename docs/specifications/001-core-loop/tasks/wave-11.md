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

## 001-103 review of wave 11

Use /reviewer. Range `49b5a28..9d92249`, the 001-100 and 001-101 commits and their build (the 002/003 commits in between are another coordinator's and out of scope). Output `reviews/wave-11.md`. Outcome: whether waiting for an install or recent-first ordering can hide a failure or leave a check falsely current, and whether the new delta reading (pass, unknown, fail reads PASS -> FAIL everywhere) or the narrowed deny-once can lose or mislabel a transition. Probe: a worktree that installs while a session is registered (what the header and the first reports say); a monorepo root with workspaces but per-package lockfiles; a `node:test` project with no dependencies (spec 003's runner) still validating; `run --all` while waiting; a revision during the first tier after the install; an edit-caused file starved by repeated edits (does the backlog ever finish); a runner crash between a pass and a fail, told and untold; Codex hooks through the shared deny module.

## After 001-102

The human chose both rows from `research/per-package-keys.md`: the stale hidden-lockfile check first, then scheme B. 001-105 waits for 001-104 (both in `src/core/keys/`). A review (001-106) follows 001-105.

## 001-104 a stale hidden lockfile never stands for the install

Use /worker. Shape: slice.

Outcome: an install that bypassed `node_modules/.package-lock.json` (a package folder it does not list, or a folder newer than it) can never keep an environment hash from changing.

Read: `research/per-package-keys.md` (finding on line 66, `probes/per-package-keys/freshness.mjs`), npm's rule for trusting the hidden lockfile (docs URL in its sources); spec D3 (installed-dependency fingerprint).

Seam: the installed-dependency fingerprint in `src/core/keys/environment.ts`. Apply npm's rule: the hidden lockfile counts only when every package folder in the `node_modules` hierarchy is listed in it and no folder it references is newer than it. Compare workspace links with `lstat`, never follow them. When the rule fails, the fingerprint falls back to a hash of the package folders' `package.json` files (name, version, and the folder's own path) so a change still re-keys, and one note says the hidden lockfile is stale.

Own: `src/core/keys/environment.ts` and a new helper beside it, `test/keys/`, D3 in `spec.md`, one `status.md` line. Leave `src/core/scheduler/` and `src/core/delivery/` alone (001-103 is reviewing them). Do not run `npm run build` or touch `plugins/claude-code/dist` or `plugins/codex/dist`. Commit as you go.

Done when: a fixture with a package folder the hidden lockfile does not list, and one with a folder newer than it, each get a different environment hash from the clean install, with the note; a clean install keeps its hash; the check costs under 25 ms on a `cezar`-sized `node_modules` (measured).

## 001-105 per-package dependency keys (scheme B)

Use /worker. Shape: slice. After 001-104 lands.

Outcome: a worktree whose install differs from a validated one's in packages a test file does not use keeps that file's result, and never reuses a result its dependencies could change.

Read: `research/per-package-keys.md` in full (scheme B, "What D3 would say", the board-row done-when); spec D3, D4 (closure from the transform graph).

Decided by the human: scheme B. The environment hash keeps the runner's lockfile closure (`vitest` and its peers), the packages imported by setup and `globalSetup` closures and by the config files, and `patches/`; each test file's key adds the sorted `location@version#integrity` set of the lockfile closure of the installed packages its closure imports directly, with types-only packages as constants and unresolved names as absent; a file whose closure reaches `child_process`, `worker_threads` or `module` keeps today's whole-lockfile fingerprint. A stale hidden lockfile (001-104) falls back to the whole fingerprint for every file.

Seam: `src/core/keys/` (closure to key), then `src/runners/vitest/` for the first-hop package entries from the transform graph. Also wire 001-104's stale-lockfile note: `src/core/scheduler/lockfiles.ts` (`Lockfiles.set`) takes `installedDependencies(...)` and persists its `note` once through the scheduler's note path. Own: `src/core/keys/`, `src/core/scheduler/lockfiles.ts` and the one note call site, `src/runners/vitest/graph.ts` and the closure path, `src/core/types/` (additive), tests under `test/keys/`, `test/runners/vitest/`, `test/fixtures/vitest/`, D3 and D4 in `spec.md`, one `status.md` line. Leave `src/runners/node-test/` to spec 003. Agreed with the 002/003 coordinator (2026-10-07): a test file whose runner reports no first-hop package entries (today, every `node:test` file, until their row 003-22) keeps today's whole-lockfile fingerprint; add that as a test. Their 003-16 is moving `WorktreePaths` out of `src/runners/vitest/paths.ts` into `src/core/fs/` (a re-export stays) and editing the runner construction in `src/core/daemon/daemon.ts`: do not edit either; rebase if they land first. Do not run `npm run build` or touch any `dist`. Commit as you go.

Done when: the research's board-row done-when holds: on a `cezar` clone, between the main checkout's install and a fresh `npm ci` of `origin/main`, at least 300 of 632 test files keep their key and none of the files that reach `child_process` does; in a fixture, bumping a declared transitive dependency of an externalized package, an inlined package's dependency, a setup file's package and a config plugin each re-keys exactly the tests that use them, and bumping `@types/node` re-keys none; a package folder added without rewriting the hidden lockfile re-keys every file; keying cost stays under 300 ms for a full closure pass on `cezar`.

## After 001-103 and 001-104

001-104 landed (0.1.18, `02d3cd1`). `reviews/wave-11.md` failed 001-100 on B1. S1 was reproduced live by the coordinator: `npm ci` in this worktree under its running daemon stored 13 PASS -> FAIL results ("vitest/node does not resolve") that a direct full run did not have. 001-107 repairs 001-100 (first repair round on that slice; 001-108 re-reviews it). 001-105 runs beside it on disjoint files.

## 001-107 the install wait never claims a suite, and covers a reinstall

Use /worker. Shape: repair. Outcome: while dependencies are missing or being replaced, Squeal stores nothing, claims no checkpoint, and the edits made in that time run first once the install lands.

Read: `reviews/wave-11.md` (B1, S1 to S3, N1 to N5; each has fix steps); spec D5, D10; `lessons.md` defects 12 and 18.

Decided by the coordinator:
- **B1:** a `run --all` while waiting records its checkpoint `abandoned`, never `completed`; `readHeader` does not count the wait as a listing.
- **S1 (D5 amended):** the wait also starts when an installed lockfile disappears from the worktree root while the root's `package.json` declares dependencies (`npm ci` removes `node_modules` first). A tier whose run overlapped the disappearance or a lockfile change stores nothing: its files are re-queued after the install, as the post-tier stability check does for closure paths.
- **S2:** edits recorded during the wait count as recent when the install starts the baseline.
- **S3:** a committed lockfile (`bun.lock`, `yarn.lock`, `pnpm-lock.yaml`, `package-lock.json`) does not count as installed on its own; installed means the root `node_modules` exists with that manager's installed marker (as D3 lists).
- **N2:** a root that declares dependencies with installs only in workspaces counts as installed when every workspace that declares dependencies has one; the header says what is missing when not.
- **N1, N3** (a starvation bound: at most one backlog tier for every N recent tiers, N chosen and stated), **N4, N5** (a SIGKILL'd waiting daemon's flag is cleared by the next daemon's start and ignored when no daemon is live).

Seam: `src/core/scheduler/install.ts`. Own: `src/core/scheduler/` except `lockfiles.ts` (001-105 owns it), `src/core/state/header.ts`, `src/core/delivery/provenance.ts` and `format.ts` (N1 wording only), `src/core/daemon/` (N5 only), tests under `test/scheduler/`, `test/daemon/`, `test/state/`, D5, D9 (N4) and D10 in `spec.md`, one `status.md` line. Leave `src/core/keys/` and `src/runners/vitest/` to 001-105, and `src/core/daemon/daemon.ts`'s runner construction and `src/core/fs/` to the 002/003 coordinator's 003-16. Do not run `npm run build` or touch any `dist`. Commit as you go.

Done when: the review's B1 probe is a test; `npm ci` replacing `node_modules` under a running daemon stores no failure (fixture test that deletes and restores `node_modules` mid-tier); an edit during the wait runs within the first tier after the install; a bun fixture with a committed `bun.lock` and no `node_modules` waits; the starvation bound is a test.
