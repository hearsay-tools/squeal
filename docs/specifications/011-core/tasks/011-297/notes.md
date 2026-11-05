# 011-297: the OpenCode end-to-end baseline waits for a losing daemon to exit

Worker aa77ec31, 2026-11-05. Brief: `tasks/wave-70.md`, W3 (on main at c5a6e3957). The same race and fix as row 011-296: `tasks/011-296/notes.md`. Shape: repair, test only. Changed: `test/e2e/opencode-fixture.ts` and this file.

Tags: **verified** (run here), **read** (read in source), **inferred**.

## The change

`OpenCodeE2E.baseline()` waits in three steps:

1. Until a copy's daemon process exists and `squeal status` says `alive`, bounded by `DAEMON_WAIT_MS` (45 s), as before.
2. Then until `daemonPids(this.plugin)` lists one process, bounded by `LOSER_EXIT_MS` (10 s, a third of a loser's 30 s lock wait). At the bound it takes the pids left, so two processes still fail `opencode.test.ts:199`.
3. Then until the baseline passes (`settled("pass")`), as before. It returns the pids of step 2.

The bound, the order (status before the pid poll) and the choice to return the pids at the bound are those of row 011-296, for the same reasons (011-296 notes, "Decisions the brief did not settle").

Every caller gets the wait: `opencode.test.ts:181`, `:305`, `:380`, and `#build` with `started: true` (after `squeal start`). When one daemon runs, step 2 returns at its first poll. **Read.**

## Checks

- Red, then green, with a throwaway probe (`test/e2e/oc-loser.probe.test.ts`, deleted, not committed). One `opencode run` with a gate; at gate 0 it called `baseline()`, spawned `node <copy>/dist/cli/squeal.mjs daemon <repo>` with a private `HOME`, `TMPDIR` and the fixture's `XDG_RUNTIME_DIR`, took a `ps` snapshot, and called `baseline()` again. **Verified.**
  - Before the change: `AssertionError: expected [ 562495, 563946 ] to have a length of 1 but got 2`. Log: `seen 562495,563946 baseline() 562495,563946 in 422 ms`.
  - After the change: passed. Log: `first 579112 loser 580181 seen 579112,580181 baseline() 579112 in 449 ms`.
- `env -u PLUGIN_ROOT -u PLUGIN_DATA npm_config_cache=/tmp/sq297-npm pnpm exec vitest run test/e2e/opencode.test.ts`: 8 passed (8), 148.9 s. The Vitest install was already in `/tmp/squeal-e2e-cache`, so npm did not run; `/tmp/sq297-npm` stayed empty. OpenCode ran under `runOpenCode`'s private `HOME`, `TMPDIR` and XDG directories. **Verified.**
- `pnpm run lint` and `pnpm run typecheck`: pass. `squeal status --wait 60000 test/e2e/opencode-fixture.ts`: Squeal does not run `test/e2e/**`; the one test file that reads the fixture (`test/version-sensitive.test.ts`) passes. **Verified.**
- No fixture daemon was left after the runs (`ps`). **Verified.**

## For whoever continues

- Not checked: whether the OpenCode bridge can spawn a second daemon in a fresh repository the way Pi's hooks do. The row has not failed in CI; the probe forces the second daemon, so it proves the fixture copes with one, not that the race occurs here.
- `opencode-fixture.ts` is 359 lines, above the styleguide's about 300. It was 344 before this row. The two-step wait is now in both fixtures; a shared helper in `test/e2e/support.ts` (for example `oneDaemon(plugin, ms)`) would remove the copy and some lines. `support.ts` was not this row's file.
- Correction to the 011-296 notes: a throwaway test file that imports `./install.js` also makes `test/version-sensitive.test.ts` fail while it exists, not only one that imports `piUnavailable`. `test/version-sensitive.txt` names `test/e2e/install.ts` as a helper that reads the Node version (it keys its cache by Node major), and every file that imports such a helper directly must be named in that header. This probe imported no Pi helper and still tripped it. Delete the probe before committing. **Verified.**
