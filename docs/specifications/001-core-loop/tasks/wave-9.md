# Wave 9 briefs

From `quality/2026-10.md` (rows renumbered +1, see the board) and the human's plugin-versioning note. All `--backend claude --model opus --effort high`, never Fable. Batch 1: 001-67, 001-68, 001-69, 001-76 in parallel. Batch 2: 001-65 (when decided), 001-72. Batch 3: 001-70, 001-71, 001-73. Batch 4: 001-74, 001-75. Reviews only for 001-71 and 001-72.

Common to every row: the scope and done-when are the board row in `docs/board.md`; read it, the quality file's finding, `docs/styleguide.md`, and the spec sections it names. No behaviour change unless the row says so. Do not run `npm run build` or touch `plugins/claude-code/dist`; the bundle-drift failure is expected. Commit as you go. Stay inside your ownership; if a needed edit is outside it, ask the coordinator.

## 001-67 runner interface: one note channel, one `affected`

Use /worker. Shape: finish. Seam: `src/core/types/runner.ts` (`InvalidateResult.notes`, `RunReport.notes`, `affectedDetailed`). Own: `src/core/types/runner.ts`, `src/core/scheduler/refinement.ts`, `src/core/scheduler/tiers.ts`, `src/core/daemon/runner.ts`, `src/core/daemon/daemon.ts` (the `note` option only), `src/runners/vitest/adapter.ts`, `src/runners/vitest/index.ts`, their tests. Leave `src/core/scheduler/scheduler.ts` and every `notes.ts` to 001-68, and `src/core/daemon/paths.ts` to 001-69.

## 001-68 one module for persisted daemon notes

Use /worker. Shape: finish. Seam: a new `src/core/notes.ts` from `src/core/status/notes.ts`. Own: `src/core/notes.ts`, `src/core/scheduler/notes.ts`, `src/core/scheduler/scheduler.ts`, `src/core/daemon/notes.ts`, `src/core/status/notes.ts`, `test/scheduler/`, `test/status/`, notes tests under `test/daemon/`. Leave `refinement.ts`, `tiers.ts`, `daemon.ts` to 001-67.

## 001-69 the git layout read in one place

Use /worker. Shape: finish. Seam: a new `src/core/fs/git-layout.ts`. Own: `src/core/fs/`, `src/core/store/paths.ts`, `src/core/daemon/paths.ts` (git parts only: `linkedWorktreeDir`, `worktreeIdFor`, the inline `gitdir:` read), `src/core/status/git-head.ts`, `src/core/status/open.ts`, `src/core/watcher/paths.ts`, `src/cli/init.ts`, `src/cli/daemon-access.ts`, `src/harness/claude-code/context.ts` (imports only), their tests. Hooks stay dependency-free; the hook p95 test must still pass.

## 001-76 the plugin version moves with every shipped change

Use /worker. Shape: slice.

Outcome: a user can update the installed plugin after any landing that changes the bundles, because the version Claude Code compares has changed.

Read: `plugins/claude-code/README.md` (version line), `.claude-plugin/marketplace.json`, `plugins/claude-code/.claude-plugin/plugin.json`, `package.json`, the esbuild `define` of the version (001-32), `.github/workflows/ci.yml`, Claude Code's plugin docs on how `version` drives updates (fetch them; cite).

Seam: `package.json` `version` is the one source. First edit: the build writes it into `plugin.json` (and the marketplace entry if it carries one) so they cannot drift; a test asserts they match. Then a CI check on pull requests and pushes to `main`: if `plugins/claude-code/dist` differs from the previous commit on `main`, the version must be greater. Set the version to `0.1.0`.

Own: `package.json` (version and scripts), the plugin build script, `plugins/claude-code/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.github/workflows/ci.yml`, `plugins/claude-code/README.md`, `test/harness/plugin.test.ts` (version assertions only), a new script under `scripts/` if needed, and the process sentence in `docs/process.md` and `.claude/skills/coordinator/SKILL.md` §6 plus its `.agents/skills/` mirror (bump the patch version in the bundle commit).

Done when: plugin and package versions match by test; CI fails on a dist change without a bump (shown by a test of the check script or a dry run against two commits); the README says how to update an installed plugin.
