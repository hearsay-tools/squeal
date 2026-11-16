# Wave 1: the three foundations (rows 023-03, 023-04, 023-05; parallel)

Read `../spec.md` (D2, D4, D5, D6), `../status.md`, and the findings `../research/temp-checkout.md`, `../research/environment-at-commit.md`, `../../018-ci-and-shared-results/research/results-at-commit.md`. The three rows sit on disjoint seams and run in parallel. Nothing here adds a CLI command; 023-06 and 023-07 wire them. No version raise and no `pnpm run build` in a worker tree: the coordinator does both at integration. Verify with `squeal status --wait 60000 <changed paths>`, lint and typecheck; no full suite; bound any direct vitest run with `timeout 600`.

## 023-03 keys at a commit (slice) — Use /worker.

Outcome: a library function that, for a commit and this worktree, returns each listed test file's key at that commit or `not determined` with a reason (D2).
- Start: `src/core/store/transfer-rekey.ts` (`commitSegments`, `keyOver`) and `src/core/commit/tree.ts` (`committedBlobs`); first edit: a new `src/core/commit/at-keys.ts` that maps a commit's blobs over this worktree's closure lists with D11's closure rule.
- Environment, D2.2 steps 1 to 4: installed part from the commit's `pnpm-lock.yaml` (pnpm 12, whole mode, as `installedDependencies` / `withoutLinkedSpecifiers` compute it from `node_modules/.pnpm/lock.yaml`); lookup in `environments` (`src/core/store/environments.ts`), exactly one match or `not determined (environment)`; a project with equal git-held inputs under several hashes skips the lookup. npm and Yarn stop at step 1.
- Also: `side keys` for D5.1: the same function over a mixed blob set (test file blobs from one commit, the rest from another).
- Owns: new files under `src/core/commit/` (`at-keys*.ts`, `at-environment*.ts`) and their tests under `test/core/commit/`. May export helpers from `transfer-rekey.ts` and `environment*.ts` without changing their behaviour. Leaves alone: `src/core/code/gate/**`, `src/cli/**`, `src/core/ps/**`, any new `src/core/checkout/**`.
- Done when: tests show (a) keys equal a daemon's keys at HEAD on a two-commit git fixture, (b) a lockfile-only change yields the stored environment's hash, (c) a config-only difference yields `not determined (environment)`, (d) an untracked closure path yields `not determined (untracked input)`.

## 023-04 the gate as a library for runs at a commit (slice) — Use /worker.

Outcome: 020's gate can run named files only, return per-file outcomes without the CC/CRAP verdict, run in-process from another command, and leave no child behind when its parent dies (D4.4, D6; `temp-checkout.md` 4 and 5).
- Start: `src/cli/code-gate.ts:131` (the `--json` relaunch child) and `src/core/code/gate/scope.ts` / `prerun.ts`; first edit: an exported entry point (`runGateFiles` or similar) taking root, files, budget, env and store, returning `runs[]` per file with failed tests and failure text.
- Files-only: declared `inputs` and a dirty tree do not widen the selection (`temp-checkout.md` 5.2: one overlaid file selected 8).
- The relaunch child, where it stays, ends with its parent (process group or parent-death watch); a SIGKILL'd parent leaves no process writing to the store.
- `TMPDIR` may be set per call; `HOME` is never changed by the gate.
- Owns: `src/cli/code-gate*.ts`, `src/core/code/gate/**`, their tests. Leaves alone: `src/core/commit/**`, `src/core/ps/**`, `src/core/checkout/**`. `squeal code --base` behaviour and output stay as they are; its tests stay green.
- Done when: a test runs the entry point on a fixture with two named files and gets per-file outcomes; a test kills the `--json` parent with SIGKILL and finds no surviving child within 5 s; existing gate tests pass.

## 023-05 the temporary checkout's life cycle (slice) — Use /worker.

Outcome: a module that creates, installs, hands over and removes a detached checkout at a commit, sweeps dead ones, and is visible in `squeal ps` (D4.1 to D4.3, D4.8, D6).
- Start: new `src/core/checkout/`; reuse `src/core/scheduler/install-command.ts` for the install command and `src/core/fs/git-layout.ts` for the common dir.
- Location (human, 2026-11-16): `$XDG_CACHE_HOME/squeal/checkouts/` (platform cache folder on macOS) when it is on the same filesystem (`st_dev`) as the package store (pnpm: `pnpm store path`); else `<git common dir>/squeal/checkouts/` with one warning line.
- Create: a per-repository lock, `git worktree prune`, `git worktree add --detach --lock --reason squeal`, a marker file (owner pid, process start time, commit). Copy-in of named files from another tree (for D5) as a function.
- Install: frozen install with the project's manager; return time and the log on failure.
- Remove: stop the given process group, `git worktree unlock`, `remove --force`, delete the run folder, `prune`. Sweep: checkouts whose marker names a dead owner (pid and start time).
- `squeal ps`: list live checkouts (path, pid, age) and flag dead ones.
- Owns: `src/core/checkout/**`, `src/core/ps/**` changes for the listing, their tests. Leaves alone: `src/core/commit/**`, `src/core/code/gate/**`, `src/cli/code-gate*.ts`.
- Done when: tests on a git fixture create a checkout, install an npm fixture with no network, copy a file in, remove it with nothing left in `git worktree list` or on disk; a marker with a dead pid is swept; `squeal ps` output names a live checkout. Experiments use `$TMPDIR` repositories only.
