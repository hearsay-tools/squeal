# 011-20 notes (W1 of wave 10, 2026-10-21)

The stop-gap e2e race (`test/e2e/stop-gap.test.ts`, 001-340 and 001-355, since 011-08 with an edit in the gap). Base main at 2b1fbecce (0.1.245). Brief: `tasks/wave-10.md`, W1.

## One shape, not two

The board listed two shapes: shape 1, `The daemon is stopped by request` at `:58`; shape 2, `registered at revision 0`. The first attempts' logs of all six runs (`gh run view <id> --attempt 1 --log-failed`: 39141267519, 39576507169, 39628123539, 39648758886, 39657056174, 39658902847) show one shape. `registered at revision 0` is only the first line of the received text, which Vitest truncates in the assertion's one-line message (`expected 'SQUEAL · registered at revision 0\nRe…'`). In all six, line 2 of the received text says `The daemon is stopped by request (…stop); a hook starts one at the next edit`. No run had a replacement already serving.

## The cause

`squeal stop` (`src/cli/stop.ts`) leaves its stopped mark only after it sees the socket go: one ping every 50 ms, then a store write. The daemon unlinks its socket and then stalls before its lock release (the test's `stop-gap` pause). So there is a gap between the socket going and the mark landing. A SessionStart in that gap:

1. finds no mark (`stopHolds` in `ensure`), so it spawns a daemon;
2. waits up to `SPAWN_SETTLE_MS` (750 ms) for its heartbeat, which cannot come while the stalled daemon holds the lock, so it always waits the full 750 ms;
3. registers. `register` reads the header by store alone (`readLiveHeader`, `asStopped`, `heldStop`). The mark landed during the wait, so the header has `stopped`, and `livenessSentence` (`src/core/delivery/header.ts`) puts `stopped` before this hook's own `startingSince`.

On this host, at `taskset -c 0-1` and a load of 44 to 47 on 24 CPUs, three probe runs (two cases each) read the store when the test saw the daemon stall. In both cases of the first run the mark was not there yet. In the other four cases it had landed 3 to 30 ms before. The hook took 854 to 909 ms, of which 750 ms is the wait, so its start-up and stop check take about 130 ms. The race needs the stop's write to lag the stall by more than that, which a loaded CI runner can do.

It is not an edit inside the mark's mtime tick. The edit is a new untracked file, which changes `git status` itself, so the tree print always differs.

Product effect: the agent is told "stopped by request" while the daemon this hook spawned will serve once the lock is free. It is never told otherwise. Its told liveness is `{ startingSince }`, and a starting daemon's first heartbeat is no news.

## The fix

The daemon the hook spawned voids the mark at its first heartbeat (011-08: `heldStop`, a heartbeat after `at`). So a starting daemon is not stopped:

- `asTold` (`src/core/delivery/liveness.ts`) drops `stopped` when it marks the liveness starting. This covers `register` and the header of a delivery.
- `asStopped` (`src/core/delivery/stopped.ts`) leaves a liveness that is starting unchanged. This covers `livenessChange`, which applies `asStopped` after `asTold`.

The contract, agreed with the coordinator on 2026-10-21:

- A daemon that a hook spawned and that is still starting voids the mark, so it is told as starting.
- After `DAEMON_START_GRACE_MS` with no heartbeat, a held mark is told again.
- A later liveness-only delta never says "stopped by request" under a "starting" header.

`livenessSentence` is unchanged. With the fix, `stopped` and `startingSince` no longer occur together.

## The tests

| Test | What it checks | Red on base |
| --- | --- | --- |
| `test/harness/stopped.test.ts`, "says a daemon is starting when the stop's mark lands while its SessionStart spawns one (row 011-20)" | Real git repo. The stop's tree is printed, then an edit, then a SessionStart whose `ensureDaemon` stub leaves the mark (as the late `squeal stop` does) and returns `spawned`. The registration says `A daemon is starting` and not stopped. The next PostToolBatch does not say stopped. | Yes, with CI's exact header: `registered at revision 1 … The daemon is stopped by request`. |
| `test/harness/starting-daemon.test.ts`, "a stop's mark that lands while a SessionStart spawns": "says a daemon is starting, and nothing while it starts" | Fake clock `T`. The mark at `T + 1` lands in the spawn. The registration says starting. PostToolBatch at `T + 1 s` and at `T + DAEMON_START_GRACE_MS` delivers nothing. | Yes. |
| same, "says the daemon is stopped by request, once, when no heartbeat came within the grace" | At grace + 1 ms the delta's title is `the daemon is stopped by request`, once. | No, by design: it pins the contract's second line. |
| `test/e2e/stop-gap.test.ts`, both plugins | The order is forced. `squeal stop` runs with `testPause("stop-mark")`, a new CLI pause point just before its mark. The test waits until the daemon stalls in its stop gap and the stop pauses. Then it checks there is no mark, edits, and starts the SessionStart. It waits for the replacement daemon process (a `/proc` scan, 20 ms polls), resumes the stop, waits for the mark, and checks that the SessionStart has not registered yet. Then the old 001-340 checks: `A daemon is starting`, the stop does not say stopped while the lock is held, the replacement takes the lock and validates. | Yes, both cases, deterministically, with CI's exact header (bundles built from base plus the pause point only). |

## Checks run

E2E runs use bundles built in a separate copy (`/tmp/w1-build`: `git archive HEAD`, the changed files, `node_modules` symlinked, `tsx src/harness/{claude-code,codex}/build.ts`), never in this tree. `copyPlugin` copies `plugins/<name>` from `REPO_ROOT`, so `SQUEAL_TEST_DIST` does not reach the e2e. The next worker who must run an e2e against unbuilt source can use the same copy.

- Red e2e (pause point only): 2 failed of 2, `expected 'SQUEAL · registered at revision 0\nRe…' to contain 'A daemon is starting'`.
- Green e2e (pause point and fix), `taskset -c 0-1 npx vitest run test/e2e/stop-gap.test.ts`, 10 runs in a row: all passed, 20 of 20 cases, 24 to 28 s a run, at a one-minute load of 52 to 67 on 24 CPUs. One more run after a behaviour-neutral tidy of `cliWith` passed too, at load 51.

## Brief defect

The brief names "the mark's tree check in `src/cli/stop.ts` and `src/core/daemon/escaped.ts`". `escaped.ts` handles the processes a daemon's tests leave behind; it has no tree check. The mark's tree check is `treePrint` and `stopHolds` in `src/core/delivery/stopped.ts`, and its writer is `src/cli/stopped-mark.ts`.

## For the next rows

- The gap stays open. Without an edit, a hook in the stop gap still finds no mark and spawns a daemon, which takes the lock once it is free and serves. `squeal stop` then prints `Squeal daemon stopped` while the replacement runs. 001-340 wants this (the replacement serves), and 011-08's C8 is not broken, because the mark does not hold yet. If a later row wants a stop to stop that replacement too, the mark must be written before the socket goes. The obstacle: the stopping daemon's last heartbeat must not void it (`heldStop`). One option: write the mark before the stop request, and re-date it after the socket goes only if it is still there.
- The same rule leaves a second hole. A `squeal stop` that finds no socket while a hook-spawned daemon waits for the lock says `No daemon running` and leaves a mark. That daemon's first heartbeat then voids the mark. With this fix, a consumer whose registration said that daemon is starting keeps hearing it as starting, which matches the outcome. A consumer told nothing of the start still hears the mark until the heartbeat.
- `testPause("stop-mark")` is the CLI's first pause point. The preload stops any process that loads it with `SQUEAL_TEST_PAUSE` naming the point, the CLI included.
