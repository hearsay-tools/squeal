# 011-31 notes (W1 of wave 6, 2026-10-20)

A step-down cancels its tiers in flight, as `squeal stop` does, and the hook whose step-down a daemon accepted also sends it `stop` (spec 011 C9 and C4 step 5 as amended 2026-10-20; `tasks/011-30/design.md` section 1 and R1; gh-47). Base main at ec6337e6 (branch at f278a099, docs only on top). Commits 6cc61c75 and f8e34d79.

## The seams

- **The daemon.** `src/core/daemon/daemon.ts`, the desk's `onStepDown`: it calls `#cancelTiers()` and then schedules `#shutdown("superseded", …)` with `setImmediate`, the same order as `onStop`. Nothing else changed: `#cancelTiers` sets `#stopRequested`, which `#shutdown` already reads to close the loop with `{ cancel: true }` and to await `#cancelling` (the runner's cancel, then `stopMarked` after `CANCEL_GRACE_MS` for node:test and pytest). `#stopRequested` also keeps a start in progress from creating the loop. `#cancelTiers` returns at once on a second call, so the hook's `stop` after a step-down cancels nothing twice, and `#shutdown` is one promise (`??=`), so it writes no second note.
- **The hook.** `src/harness/shared/ensure.ts`, `stepDownIfOlder`: after an answer `{ type: "step-down", steppingDown: true }` it sends `{ type: "stop" }` with the same `SOCKET_TIMEOUT_MS`, ignores the answer and any error, and returns true. A refusal (`steppingDown: false`) and any error other than "unknown request type" send no stop, as before. Two round trips at most, the C8 budget.
- **Comments.** `stepDownNote` (`src/core/daemon/lifecycle.ts`), `StepDownRequest` (`src/core/types/daemon.ts`), `SUCCESSOR_LOCK_WAIT_MS` and `stepDownIfOlder` (`ensure.ts`) said the step-down lets its tier finish; they now say it cancels. Comments only. The note's text is unchanged.

## The tests

"Red" is the test against the sources named, run with `npx vitest run <file>` at a one-minute load of 30 to 58 on 24 CPUs.

| Test | What it checks | Red |
| --- | --- | --- |
| `test/daemon/step-down.test.ts`, "cancels its tier in flight and is out within 15 s, its file queued, with one note; the hook's successor serves" (`cancelsItsTier`, `buildAt("0.1.0")`) | A SessionStart steps the old daemon down while its tier runs a file that sleeps 60 s. The daemon reaches its lock release within 15 s; there it stops itself (`testPause("stop-gap")`, task 001-355), and the test reads what it left: the file's `test_file_keys` row `pending: "queued"`, no current result for the test, one `daemon stopped` note, the step-down's. Then the hook's successor serves at the hooks' version without another boundary. Measured 435 ms to the lock release. | Yes, with both halves absent (main's sources): `the old daemon at its lock release within 15000 ms: expected false to be true`. Green with either half alone, by design: the hook's `stop` cancels a 0.1.0 build of these sources too. |
| same file, "a released 0.1.31 daemon, from before the request, is sent stop and exits after its tier; a spawn meanwhile loses the lock" (`stepsDownAfterItsTier`) | Unchanged: before 0.1.200 the tier finishes and stores, and a contender spawned meanwhile loses the lock. That window is checked in this case only now, because the cancel leaves almost none in the 0.1.0 case. | n/a (stays green) |
| `test/daemon/step-down-lanes.test.ts`, two cases: "the baseline's backlog tier and backlog slot" and "an edit's tier in each lane" | A Vitest file and a node:test file both held, then a bare `step-down` request (as a hook before this row sends it, no `stop` after): the daemon reaches its lock release within 15 s, `leftovers(marksOf(pid, token))` is empty there and after the exit, both rows read `queued`, one note. Measured 214 ms and 261 ms (306 ms in an earlier run). | Yes, both cases, with the daemon half absent and the hook half present, at the 15 s bound. This is the test that discriminates the daemon's own cancel. |
| `test/harness/step-down.test.ts` | The `stop` after an accepted step-down (three tests now expect `[step-down, stop]`), true whatever the stop answers, no stop after a refusal; the budget: a daemon that answers the step-down and never answers the stop costs under `2 × SOCKET_TIMEOUT_MS + 400` ms and still returns true. The one-round-trip budget test is unchanged. | Yes, three tests, with the hook half absent. |

`test/version-sensitive.txt` lists `test/daemon/step-down-lanes` beside the other daemon tests that run a real node:test project; `test/version-sensitive.test.ts` fails otherwise.

## What the design did not foresee

1. **A test build has no node:test runtime.** `buildCli` compiles `src` with `tsc`, which does not emit `src/runners/node-test/runtime/reporter.mjs` and `recorder.cjs`. A daemon from that build records every node:test file as "no result: node:test runtime files not found" and never queues it (its row's `pending` is null). The lanes test copies the two files beside its `buildAt("0.1.0")` build (`withNodeTest`). If a later daemon test needs node:test, a `nodeTest` option on `BuildOptions` in `test/daemon/helpers.ts`, as `observe` copies the recorder, would replace this copy.
2. **Reading the cancelled row needs the old daemon held.** The successor waits for the lock with retries every 10 ms, and with the same key format (a `buildAt` of the same sources) it queues and runs the cancelled file at once, so the row reads `running` or a result by the time a test looks. Both daemon tests stop the old daemon in its stop gap (store closed, socket gone, lock held) and read the store there. "Out within 15 s" is therefore measured to the lock release; the exit follows the resume, within 30 s.
3. **The hook's stop result is ignored.** The design says the hook "also sends `stop`". I made a failed or unanswered `stop` count as nothing: the step-down was accepted, so `stepDownIfOlder` returns true and the successor is spawned. The alternative, false on a failed stop, would leave a stepping daemon with no successor.
4. **Every daemon that accepts a step-down takes the extra `stop` safely.** `#shutdown`'s single promise (`this.#exit ??=`) dates from the first daemon (fd6ffee3, 2026-10-04), before the step-down request existed (74052fbe, 2026-10-08, task 001-125). So a daemon from 0.1.34 to 0.1.199 that gets the `stop` after its step-down neither shuts down twice nor writes a second note. It still finishes its tier, because its `stop` did not cancel before 0.1.200.
5. **The design's run 4 number holds here.** In run 4 a `stop` to a stepping 0.1.223 daemon had the successor serving 1.3 s later. Here the lock release came 214 to 435 ms after the request at load 44 to 58, with Vitest's forced cancel and node:test's marked processes stopped.

## Expected failures in this branch

This row ships in the 001 coordinator's bundle under key format 18, so no version bump and no `KEY_FORMAT_VERSION` change or re-pin here. `test/keys/key-format.test.ts` fails three tests: "is bumped whenever the guarded sources change" (`pin "3361181d…0203"`) and the two "an adapter-only bump … keeps the global pin". The bundle-drift checks also fail, because `plugins/claude-code/dist` is not rebuilt by this row.

## For the next rows

- 011-32 (the handoff claim) goes into the same `ensure.ts` functions: `ensure`, `ensureIfStale` and `successor`. `stepDownIfOlder` now sends two requests on acceptance. The claim belongs before the spawn, not between the step-down and the `stop`.
- 011-34's `handover-tier.test.ts` can reuse `stoppedItself` with `testPause("stop-gap")` to read the handed-over row before the successor takes it, and `withNodeTest` if it adds a node:test file.
