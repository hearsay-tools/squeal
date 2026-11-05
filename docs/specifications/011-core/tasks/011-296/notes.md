# 011-296: the Pi end-to-end baseline waits for a losing daemon to exit

Worker aa77ec31, 2026-11-05. Brief: `tasks/wave-70.md`, W2. Cause: `tasks/011-294/notes.md`, CI1. Shape: repair, test only. Changed: `test/e2e/pi-fixture.ts` and this file.

Tags: **verified** (run here), **read** (read in source), **inferred**.

## The change

`PiE2E.daemon()` waits in two steps:

1. Until a copy's daemon process exists and `squeal status` says `alive`, bounded by `DAEMON_WAIT_MS` (45 s), as before.
2. Then until `daemonPids(this.plugin)` lists one process, bounded by `LOSER_EXIT_MS` (10 s). At the bound it returns the pids left, so two processes still fail `pi.test.ts:88` with the same message CI showed.

A loser exits within about 250 ms of the first daemon's registration (`daemon/lock.ts:76`, `checkMs` 250; `open.ts`, `servedElsewhere`). 10 s is a third of its 30 s lock wait (`VACANT_LOCK_WAIT_MS`), so a second daemon that only leaves at its own timeout still fails the test. **Read.**

## Decisions the brief did not settle

- **Order.** The brief's lead polls the pids, then asks status. The fixture asks status first, then polls the pids. The answer of status is close to the first daemon's registration (its socket opens just before it registers), so the 10 s bound starts where the loser's 250 ms starts. A pid poll before the first daemon answers could see one process before the hook spawned the second, and report a single daemon that was not single. **Inferred.**
- **Bound end.** At the bound the fixture returns the pids and does not throw. The test keeps its own expectation (`toHaveLength(1)`), and the failure names both pids.
- **`:130`.** That line takes its own `daemonPids` snapshot in the test file and does not use `daemon()`. The race needs a worktree with no row. In the second run the row exists, and with a row the hook guard reads the start marks and does not spawn (row 011-252; the CI1 probe's control). So the fix at `:88` is what `:130` needs: the baseline's loser has exited long before. **Read**, and the CI1 probe for the guard.

## Checks

- Red, then green, with a throwaway probe (`test/e2e/pi-loser.probe.test.ts`, deleted, not committed). It ran a baseline run; at gate 0 it waited for `daemon()`, spawned `node <copy>/dist/cli/squeal.mjs daemon <repo>` with a private `HOME`, `TMPDIR` and the fixture's `XDG_RUNTIME_DIR`, took a `ps` snapshot, and called `daemon()` again. **Verified.**
  - Before the change: `AssertionError: expected [ 403320, 403402 ] to have a length of 1 but got 2`, the CI message.
  - After the change: passed. Log: `first 433894 loser 434068 seen 433894,434068 daemon() 433894 in 275 ms`. The snapshot listed both; `daemon()` returned the first alone 275 ms later.
- `env -u PLUGIN_ROOT -u PLUGIN_DATA npm_config_cache=/tmp/sq296-npm pnpm exec vitest run test/e2e/pi.test.ts`: 5 passed (5), 34.6 s. The Vitest install was already in `/tmp/squeal-e2e-cache`, so npm did not run; `/tmp/sq296-npm` stayed empty. **Verified.**
- `pnpm run lint` and `pnpm run typecheck`: pass. `squeal status --wait 60000 test/e2e/pi-fixture.ts`: Squeal does not run `test/e2e/**`; the one test file that reads the fixture (`test/version-sensitive.test.ts`) passes. **Verified.**
- No fixture daemon was left after the runs (`ps`). **Verified.**

One local run of a timing race proves the wait, not the absence of the race: the probe forces the second daemon, so it proves the fixture copes with it.

## For whoever continues

- The product cause stays: in a fresh repository a hook spawns a second daemon when it runs before the first one registers (`presence/findings.ts:36-37`). A guard that reads the marks when the worktree has no row would change a hook spawn decision, which needs the human (CI1, "What could change it").
- The OpenCode fixture has the same one-snapshot wait: `baseline()` in `test/e2e/opencode-fixture.ts:253-259` returns the pids of one `ps` snapshot, and `test/e2e/opencode.test.ts:199` expects one. It is not this row's file and was not changed. Whether an OpenCode hook can spawn a second daemon in the same window was not checked. If the flake appears there, the same two-step wait applies. **Read.**
- A throwaway probe under `test/e2e/` that imports `piUnavailable` makes `test/version-sensitive.test.ts` fail while it exists (a file that imports a Node-version helper must be named in that list's header). Delete the probe before committing.
