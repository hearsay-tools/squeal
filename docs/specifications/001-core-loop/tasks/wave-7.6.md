# Wave 7.6 worker briefs

001-58 (defect 12) landed under wave 7.6 without a brief file, from its board row and `tasks/wave-7.5.md`. 001-61 runs in parallel with 001-60 on disjoint files, `--backend claude --model opus --effort high`, never Fable.

## 001-61 the daemon holds nothing inside its worktree or its spawner's scratch

Use /worker. Shape: slice.

Outcome: a harness can delete a worktree whose daemon is running, and the daemon then exits by D10, so `squeal stop` before a worktree removal is never needed.

Read: `lessons.md` "A daemon that pins its worktree" and defect 13 (and defect 12, which it likely explains); spec D10, D12; `src/core/daemon/ensure.ts` (`spawn(..., { cwd: root })`), the `squeal daemon` start path in `src/cli/` and `src/core/daemon/`.

Seam: `ensure.ts`, the spawn. First edit: spawn with `cwd` outside the root (the common dir's `squeal/` directory) and `env.TMPDIR` (and `TMP`, `TEMP`) set to `<common-dir>/squeal/tmp/<worktree-hash>/`, created and emptied by the daemon at start under its exclusive lock. The daemon itself should `chdir` there too, so a `squeal daemon` started by hand behaves the same. Check that Vitest and Vite take `root` from `createVitest`'s options, not `process.cwd()`; if something does read the cwd, say where and handle it.

Own: `src/core/daemon/`, `src/cli/` (daemon start only), `test/daemon/`, `test/e2e/` (only a new test if needed), D10 in `spec.md`, one dated line in `status.md`. Leave `src/runners/vitest/` alone (001-60 owns it). Do not run `npm run build` or touch `plugins/claude-code/dist`. Commit as you go.

Done when: a test starts a real daemon for a fixture worktree and asserts from `/proc/<pid>` (Linux; skip elsewhere) that its cwd and every open file lie outside the root and the caller's `TMPDIR`; Vitest's temp directory is under `<common-dir>/squeal/tmp/`; `rm -rf` of the root makes the daemon exit within the reconciliation interval; the full suite passes.

## 001-62 review of 001-60 and 001-61

Use /reviewer. Range `f87067b..ae24aaf`. Output `reviews/wave-7.6.md`. For 001-60 this is the third review on the 001-53 slice: report blockers plainly, and the human decides whether a fourth round is bought.

Outcome: whether `reviews/wave-7.5.md` B1 and B2 are closed, and whether moving the daemon's working directory and temp directory broke anything that runs tests.

Read: `reviews/wave-7.5.md`; spec D4 (3), D10 as amended; `lessons.md` defect 13; `src/runners/vitest/dynamic.ts`, `stale.ts`; `src/core/daemon/runner.ts`, `scratch.ts`, `ensure.ts`, `daemon.ts`, `open.ts`; `test/daemon/scratch.test.ts`.

Probe at least: the three 001-60 rows on the candidate; a `package.json` with conditional `exports` or an `exports` map that is not a string; the cost test. For 001-61: the cwd switch in `runner.ts` while runner calls overlap or one throws (is the cwd always restored, can a watcher or reconciliation step see the wrong cwd); a test that reads a relative path run by a real spawned daemon; `TMPDIR` reaching Vitest's fork workers; cleanup of `<common-dir>/squeal/tmp/<hash>/` when two daemons race for one worktree; a Cezar-style removal of a worker worktree with the daemon idle (does it exit, and does `git worktree remove` succeed without `squeal stop`). Do not re-check what earlier reviews list under "What fits".
