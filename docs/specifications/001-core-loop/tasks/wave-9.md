# Wave 9 briefs

From `quality/2026-10.md` (rows renumbered +1, see the board) and the human's plugin-versioning note. All `--backend claude --model opus --effort high`, never Fable. Batch 1: 001-67, 001-68, 001-69, 001-76 in parallel. Batch 2: 001-65 (when decided), 001-72. Batch 3: 001-70, 001-71, 001-73. Batch 4: 001-74, 001-75. Reviews only for 001-71 and 001-72.

Common to every row: the scope and done-when are the board row in `docs/board.md`; read it, the quality file's finding, `docs/styleguide.md`, and the spec sections it names. No behaviour change unless the row says so. Do not run `npm run build` or touch `plugins/claude-code/dist`; the bundle-drift failure is expected. Commit as you go. Stay inside your ownership; if a needed edit is outside it, ask the coordinator.

## 001-67 runner interface: one note channel, one `affected`

Use /worker. Shape: finish. Seam: `src/core/types/runner.ts` (`InvalidateResult.notes`, `RunReport.notes`, `affectedDetailed`). Own: `src/core/types/runner.ts`, `src/core/scheduler/refinement.ts`, `src/core/scheduler/tiers.ts`, `src/core/daemon/runner.ts`, `src/core/daemon/daemon.ts` (the `note` option only), `src/runners/vitest/adapter.ts`, `src/runners/vitest/index.ts`, their tests. Also own `test/scheduler/helpers.ts` (`recording()` drops the `affectedDetailed` wrapper; `openHarness` passes `createVitestAdapter` a note sink that persists through the notes module) and `test/scheduler/ordering.test.ts` (wrap `affected` instead of `affectedDetailed`), in one standalone commit naming this agreement. Leave `src/core/scheduler/scheduler.ts` and every `notes.ts` to 001-68, and `src/core/daemon/paths.ts` to 001-69.

## 001-68 one module for persisted daemon notes

Use /worker. Shape: finish. Seam: a new `src/core/notes.ts` from `src/core/status/notes.ts`. Own: `src/core/notes.ts`, `src/core/scheduler/notes.ts`, `src/core/scheduler/scheduler.ts`, `src/core/daemon/notes.ts`, `src/core/status/notes.ts`, `src/core/types/scheduler.ts` and `src/core/scheduler/status.ts` (dropping `SchedulerStatus.notes`, agreed), `test/scheduler/` except `helpers.ts` and `ordering.test.ts` (001-67), `test/status/`, notes tests under `test/daemon/`. Leave `refinement.ts`, `tiers.ts`, `daemon.ts` to 001-67.

## 001-69 the git layout read in one place

Use /worker. Shape: finish. Seam: a new `src/core/fs/git-layout.ts`. Own: `src/core/fs/`, `src/core/store/paths.ts`, `src/core/daemon/paths.ts` (git parts only: `linkedWorktreeDir`, `worktreeIdFor`, the inline `gitdir:` read), `src/core/status/git-head.ts`, `src/core/status/open.ts`, `src/core/watcher/paths.ts`, `src/cli/init.ts`, `src/cli/daemon-access.ts`, `src/harness/claude-code/context.ts` (imports only), their tests. Decided: the definitions move to `src/core/fs/git-layout.ts` and the owned files re-export them unchanged (`store/paths.ts`, `daemon/paths.ts`, `status/open.ts`); no importer outside the row changes; 001-74 retargets imports and drops the re-exports. Hooks stay dependency-free; the hook p95 test must still pass.

## 001-76 the plugin version moves with every shipped change

Use /worker. Shape: slice.

Outcome: a user can update the installed plugin after any landing that changes the bundles, because the version Claude Code compares has changed.

Read: `plugins/claude-code/README.md` (version line), `.claude-plugin/marketplace.json`, `plugins/claude-code/.claude-plugin/plugin.json`, `package.json`, the esbuild `define` of the version (001-32), `.github/workflows/ci.yml`, Claude Code's plugin docs on how `version` drives updates (fetch them; cite).

Seam: `package.json` `version` is the one source. First edit: the build writes it into `plugin.json` (and the marketplace entry if it carries one) so they cannot drift; a test asserts they match. Then a CI check on pull requests and pushes to `main`: if `plugins/claude-code/dist` differs from the previous commit on `main`, the version must be greater. Set the version to `0.1.0`.

Own: `package.json` (version and scripts), the plugin build script, `plugins/claude-code/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.github/workflows/ci.yml`, `plugins/claude-code/README.md`, `test/harness/plugin.test.ts` (version assertions only), a new script under `scripts/` if needed, and the process sentence in `docs/process.md` and `.claude/skills/coordinator/SKILL.md` §6 plus its `.agents/skills/` mirror (bump the patch version in the bundle commit).

Done when: plugin and package versions match by test; CI fails on a dist change without a bump (shown by a test of the check script or a dry run against two commits); the README says how to update an installed plugin.

## 001-65 temp directory keyed by a stored repository identity

Use /worker. Shape: repair. Third round on the 001-61 slice, authorized by the human.

Outcome: no daemon can empty or remove another daemon's temp directory, whether another repository reuses the worktree path or the same path is deleted and re-cloned within the exit window.

Read: `reviews/wave-7.7.md` B1, N1, N2, N4; `research/daemon-under-harnesses.md` Q4 and line 62 (re-clone in place); spec D10.

Decided by the human: key the temp directory by a stored identity, not a path. On first start the daemon writes a random id to `<common-dir>/squeal/repository-id` (atomic create, kept if present) and names the temp directory `/tmp/squeal-<uid>/tmp/<hash of repository-id and root>/`. A re-clone gets a new id.

Seam: `src/core/daemon/scratch.ts`. Then N1 (cap the leftover sweep or empty it after the socket is up), N2 (someone else's `/tmp/squeal-<uid>` disables only the temp dir: fall back to a per-daemon `mkdtemp` and persist one note), N4 (reflow two comments).

Own: `src/core/daemon/scratch.ts`, `src/core/daemon/open.ts`, `src/core/daemon/daemon.ts` (shutdown only), `test/daemon/scratch*.test.ts`, `scratch-helpers.ts`, D10 in `spec.md`, one `status.md` line. Leave `src/core/daemon/paths.ts` git parts (001-69 is done by then; rebase if needed).

Done when: a test with two repositories at one path keeps both temp directories; a test that deletes and re-clones at the same path while the old daemon runs keeps the new one's; the sweep is no longer before the socket for a large leftover; the full suite passes.

## Batch 2

001-67, 001-68, 001-69 and 001-76 landed (`cc223cf..7392b7a`, version 0.1.0). Batch 2 runs 001-65 (above), 001-71 and 001-72 in parallel; their files are disjoint.

## 001-71 one rule for which daemon socket to ask

Use /worker. Shape: slice. Seam: `src/core/daemon/ensure.ts` (`probeDaemon`, `recordedDaemon`, `ping`). Own: `src/core/daemon/ensure.ts`, `src/cli/daemon-access.ts`, the CLI commands that call it, `test/cli/`, `test/harness/ensure.test.ts`, D1's socket sentence if it changes. Leave `scratch.ts`, `open.ts`, `daemon.ts` (001-65) and `src/core/keys/`, `src/core/scheduler/` (001-72) alone.

## 001-72 re-resolution after an add or delete: core heuristic or runner

Use /worker. Shape: survey, then slice. Seam: `src/core/keys/resolution.ts` `closuresToReresolve` and its call at `src/core/scheduler/refinement.ts:118`. First produce the table the row asks for and commit it in this file under a "001-72 table" heading; then drop or keep with a test. Own: `src/core/keys/resolution.ts`, `src/core/scheduler/refinement.ts` (that call only), `test/keys/resolution.test.ts`, a scratch test under `test/runners/vitest/` if needed, D3 in `spec.md`, one `status.md` line, and the table heading in this file. A /reviewer follows, because a wrong drop shows as a missed re-run.
