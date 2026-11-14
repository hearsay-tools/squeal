# Probe: an edit just before `squeal run <group> --wait` (row 011-332)

Throwaway. Kept as the evidence for `../../group-wait-edits.md`; no test or product code uses it.

`probe.test.ts` starts a real daemon on the scheduler fixture with the helpers of `test/cli/run-group-daemon.test.ts` (`daemonSuite`, `waitReady`, `spawnCli`): the fixture under `test/fixtures/scheduler/.tmp` (git-ignored), `XDG_RUNTIME_DIR` and `XDG_CONFIG_HOME` in a private `/tmp/sq-*` directory, and `HOME` moved to `<runtime dir>/home` for the daemon and every command, so nothing reaches the real `HOME`. It compiles `src` into the test cache as the daemon tests do; it is not `pnpm run build`.

The fixture adds group `e2e` (`test/e2e/**`, `at: "stop"`) with one test file that reads `src/value.ts` and expects 1. No other test file reads `src/value.ts`.

Each run: wait until the store's revision has not moved for 1.5 s (`before`), write `src/value.ts` (odd runs return 2, a failure; even runs 1, a pass; a comment with the run number keeps each key new), then at once start the wait. Afterwards poll the store for the first revision above `before` (`edit`). The record holds the 1-minute load, the request's revision (`requestRev`, from the `requested`/`No test files` line), the verdict's revision and exit code, and the expected code.

- `missed`: the request was taken at a revision below the edit's.
- `wrongVerdict`: the exit code does not match the file's content (0 for a failing edit, or 1 for a passing one).

Modes (`PROBE_MODE`):

- `cli`: spawns the compiled CLI, `squeal run e2e --wait 300000`, as a user or agent does.
- `inproc`: calls `runGroupCommand` in the probe's process, so no Node start-up separates the write from the request. It stands for any client faster than the change feed, or a change feed slower than the client.
- `inproc-sync`: `inproc` after the status waits' sync (`syncDaemon`, poll 50 ms), the candidate fix; `syncMs` is its cost.
- `latency`: no command; polls the store every 5 ms after the write; `storedMs` is how long the edit took to reach a stored revision.

Run (from this directory, one batch per mode, 24 runs each by default):

```sh
PROBE_MODE=cli ../../../../../../node_modules/.bin/vitest run --config vitest.config.ts
```

`run-all-modes.sh` runs `cli`, `inproc` and `latency` in turn and writes `uptime` before each into `evidence/uptime.txt`. `evidence/<mode>-gap0.ndjson` holds one record per run; `*.warm.txt` is the first group run that gives the file its first result.
