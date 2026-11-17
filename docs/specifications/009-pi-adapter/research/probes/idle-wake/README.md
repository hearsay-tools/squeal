# Probes: the Pi idle wake not armed in time

Throwaway. Written for `../../idle-wake-not-armed.md` (board row ci-43987606521), 2026-11-17. Delete when that row closes. Nothing here runs real Pi, and nothing writes outside its own temporary directories.

## `race.ts` and `prober.ts`: the tests' lock probe against the waiter

`race.ts` takes the consumer's waiter lock the way `waitIdle` does (`acquireWaiterLock`) on a fresh lock file, many times. A child process (`prober.ts`) calls `waiterLockState` on the same file every N ms, as `test/integration/pi-wake.test.ts` (20 ms) and `test/e2e/pi.test.ts` (150 ms) do. It counts acquisitions that return `null` while no waiter holds the lock.

    timeout 600 node_modules/.bin/tsx docs/specifications/009-pi-adapter/research/probes/idle-wake/race.ts <trials> <probe-interval-ms> [busy-timeout-ms]

The third argument runs a copy of `lock()` with `PRAGMA busy_timeout = <ms>` instead of 0. It is not product code.

## `arm.probe.ts` and `delay-worker.mjs`: the real host and worker, with a stub Pi

`arm.probe.ts` builds the Pi bundles (`buildPiBundles`), drives `squealExtension` from `src/` with the stub Pi of `test/harness/pi/stub-pi.ts` through one run in a `squealRepo` (`session_start`, `before_agent_start`, `tool_call`, `turn_end`, `agent_before_settle`, `agent_settled`), and measures when the wake holds the consumer's waiter lock. Its worker is the bundled `worker.mjs`, loaded by `delay-worker.mjs`. That wrapper posts the answer to one request kind late (`ARM_DELAY_MS`, default 2,500 ms, past the 2,000 ms deadlines), or ends the first worker when a request of kind `ARM_EXIT` arrives. It then lands a failure and records what Pi was sent.

    ARM_OUT=<file> [ARM_CASES=none,start,run,boundary,settle,endTurn] [ARM_EXIT=wait] \
      timeout 600 node_modules/.bin/vitest run \
      --config docs/specifications/009-pi-adapter/research/probes/idle-wake/vitest.config.ts --root .

## `ci-scan.sh`: the failure annotations of failed CI attempts

It reads `<run id> <attempts>` lines on stdin. For every attempt it prints each failed job with its failure annotations, one line per job. It only reads from the GitHub API.

    gh run list --repo hearsay-tools/squeal --workflow ci.yml --limit 1600 \
      --json databaseId,attempt,conclusion \
      --jq '.[] | select(.conclusion=="failure" or .attempt>1) | "\(.databaseId) \(.attempt)"' \
      | bash docs/specifications/009-pi-adapter/research/probes/idle-wake/ci-scan.sh | grep "idle wake"
