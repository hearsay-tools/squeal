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

## 001-72 table

Measured by `test/runners/vitest/reresolution-survey.test.ts` (commit of this table; replaced by `reresolution.test.ts` after). Each row is the `basic` fixture plus the scenario's files, with every test file's closure fetched and every test file run, then one add or delete through `invalidate`. "Heuristic" is `closuresToReresolve`, "rekeyed" the test files whose closure holds the changed path (`KeyIndex.rekey` through `content.rekeyed`), "affected" is `affected([path])` as `fetchRunnerPart` calls it. "Moved" is the test files whose closure, fetched again, differs; "missed" is moved but neither rekeyed nor affected. `basic` stands for `each`, `math` and `strings`, whose closures hold `src/` paths. The `resolution.test.ts` rows are replayed on real files as R1 to R4; its declared-input row cannot reach the call, which passes only changes that are not declared inputs (`refinement.ts:114`).

| Row | Change | Heuristic | Rekeyed | Affected | Heuristic only | Moved | Missed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| structural: missing target appears, extension | add `src/later.ts` | later, basic | later | later | basic | later | none |
| structural: missing target appears, `index` | add `src/pkg/index.ts` | pkg, basic | pkg | pkg | basic | pkg | none |
| structural: resolved target deleted | delete `src/util.ts` | util, basic | util | none | basic | util | none |
| structural: new file shadows a resolved one | add `src/util.ts` | util, basic | none | util | basic | util | none |
| structural: unrelated add | add `src/unrelated.ts` | basic | none | none | basic | none | none |
| structural: unrelated delete | delete `src/unrelated.ts` | basic | none | none | basic | none | none |
| structural: `import.meta.glob` (root and own server) | add `src/plugins/b.ts` | registry | none | registry | none | registry | none |
| structural: template-literal import | add `src/locales/fr.ts` | locale | none | locale | none | locale | none |
| structural: new file shadows a `package.json` directory | add `src/pkg.ts` | pkg, basic | none | pkg | basic | pkg | none |
| **structural: new `package.json` re-points a directory** | add `src/pkg/package.json` | pkg | none | none | **pkg** | pkg | **pkg** |
| **reverse of the row above** | delete `src/pkg/package.json` | pkg | none | none | **pkg** | pkg | **pkg** |
| structural: alias, `tsconfig` paths | add `src/later.ts` | later, basic | none | later | basic | later | none |
| structural: glob in a virtual module, an inlined dependency | add `src/plugins/b.ts` | none | none | none | none | none | none |
| structural: `package.json` `main` entry appears (`lib.ts`, `lib/`) | add `src/pkg/lib.ts` | pkg | none | pkg | none | pkg | none |
| R1 (resolution: directory a file was added to) | add `src/a.js` beside `src/a.ts` | a, basic | none | a | basic | a | none |
| R1, deleted from | delete `src/a.js` | a, basic | a | none | basic | a | none |
| R1b (TypeScript twin) | add `src/a.js`, imported as `./a.js` | a, basic | none | a | basic | a | none |
| R2 (resolution: new file shadows a directory) | as structural "shadows a resolved one" | | | | | | |
| R3 (resolution: `index` appears) | add `src/bar/index.ts`, `./bar` resolved to `src/bar.ts` | bar, basic | none | none | bar, basic | none | none |
| R4 (resolution: worktree root) | add `root.js` beside `root.ts` | root | none | root | none | root | none |

Outcome: keep. Adding or deleting a `package.json` re-points the directory it sits in, and only `closuresToReresolve` re-resolves its importers: the manifest is in no closure and in no module graph, so `rekey` and `affected` both miss it, while the directory's `index` or entry is in the closure and in that directory. Every other moved closure is covered by `rekey` or `affected`; the heuristic's other picks re-fetch closures that do not move. Editing a `package.json` `main` (a content change) moves nothing in any rule, the fetched closure included: Vite keeps the importer's transform. That is outside this row and is reported to the coordinator.

## Batch 3

Batch 2 landed (`9c8b609..53c0598`, version 0.1.1). Batch 3 runs 001-70, 001-73, 001-77 and the 001-78 review in parallel.

## 001-70 one per-user directory

Use /worker. Shape: finish (the board row is the scope). Seam: `src/core/daemon/paths.ts` (`runtimeDir`, `tempDir`, `userDirName`, `userTmpDir`, `checkPrivateDir`). Own: `src/core/daemon/paths.ts`, `src/core/daemon/scratch.ts` (the `userTmpDir` call only), `test/daemon/paths*.test.ts`, socket and hardening tests under `test/daemon/`, D1's socket sentence. Leave `server.ts` and `desk.ts` to 001-77.

## 001-73 split the two modules past 300 lines

Use /worker. Shape: finish. Moves only, no behaviour change. Own: `src/core/scheduler/scheduler.ts`, a new `src/core/scheduler/runner-work.ts`, `src/runners/vitest/adapter.ts`, `stale.ts`, `broken.ts`, their `index.ts` barrels, and tests only if an import path changes. Leave `src/core/daemon/` alone.

## 001-77 a daemon unlinks only the socket it bound

Use /worker. Shape: repair. Outcome: when another repository reuses a worktree path, or the same path is re-cloned, the old daemon's exit never removes the new daemon's socket (found by 001-65; socket paths are keyed by the root path only, `socketPathFor`). Seam: `src/core/daemon/server.ts` close. First edit: record `dev`/`ino` of the socket file after `listen`, and on close unlink only if the path still has that inode. Same for any socket `desk.ts` owns. Own: `src/core/daemon/server.ts`, `src/core/daemon/desk.ts`, `test/daemon/server*.test.ts` or a new `test/daemon/socket-handover.test.ts`, one D10 sentence, one `status.md` line. Done when: the two `scratch-identity.test.ts` handover scenarios, extended or copied into the new test, show the newcomer still answering on its socket after the old daemon exits; full suite green.

## 001-78 review of 001-72

Use /reviewer. Range `53771a4..53c0598`, the 001-72 commits only (`c968a73`, `c8b5261` and their cherry-picks). Output `reviews/wave-9.md`. Outcome: whether keeping `closuresToReresolve` is right and the table is complete: a wrong keep only costs runs, a missed case is a missed re-run. Re-run the survey test from `c968a73`; probe a `package.json` edit (not add or delete) that changes `main`, a nested `package.json`, and a monorepo with two Vitest projects. Do not re-check what earlier reviews list under "What fits".

## Batch 4

Batch 3 landed (001-70, 001-73, 001-77, review 001-78; version 0.1.2). `reviews/wave-9.md` passed 001-72 with S1, S2 should-fix: they become 001-79. Quality slices 8 to 10 were done by the coordinator. Batch 4 runs 001-79 and 001-75 in parallel; 001-74 runs alone after them (it touches files across the tree).

## 001-79 a package.json move re-resolves its importers

Use /worker. Shape: repair. Outcome: deleting or editing a `package.json` re-runs every test whose closure resolution it changes, so no old result stays current. Read: `reviews/wave-9.md` S1, S2 (each has its fix steps), N1, N2; spec D3, D4. Seam: `src/core/keys/resolution.ts`, the `package.json` branch: pick `index.below(dir)`, and let a manifest content change through. Then `staleTransforms` treats a manifest `change` like an add or delete in its directory rule. Also quality slice 7: split `test/runners/vitest/structural.test.ts` at the D4 resolution-path rows into their own file, before adding rows. Own: `src/core/keys/resolution.ts`, `src/runners/vitest/stale.ts`, `adapter.ts` (`invalidate` only), `test/keys/resolution.test.ts`, `test/runners/vitest/structural*.test.ts`, `reresolution.test.ts`, the 001-72 table in this file (N1, N2 corrections), D3 and D4 sentences, one `status.md` line. Done when: the review's P1, P2a, P2a2 and P3c are tests with the run outcome asserted; `structural-cost.test.ts` keeps its guard and `afterEdit` is unchanged.

## 001-75 quality slices 1 to 6 and the two drops

Use /worker. Shape: finish. Outcome: the dead files, shims and copies `quality/2026-10.md` names are gone, and the two keys no code honours are removed. Read: `quality/2026-10.md` "Drop candidates" X1, X2 and "Slices" 1 to 6. Decided by the human: drop both X1 (`runner.maxConcurrentRuns`: type, default, validation, `squeal init`, skill and README text; a config that still sets it is reported as an unknown key by the loader as for any other) and X2 (`SchedulerStatus` keeps only `revision`; rewrite the 17 assertions to read the store). Own: the files each slice and drop names, outside `src/core/keys/`, `src/runners/vitest/stale.ts`, `adapter.ts` and `test/runners/vitest/structural*` (001-79). One commit per slice or drop. Amend D11 for X1 and add one `status.md` line per drop. Done when: each slice and drop has landed as its own commit; full suite green.
