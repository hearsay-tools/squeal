# Wave 13ak review

Candidate: `1896e49cd6f65d2d696776196bd16348ad5ca983`.
Range: `2c691397..1896e49cd6f65d2d696776196bd16348ad5ca983`.
Rows: 001-281 and 001-282, review 001-286. Intent: `research/slow-claims.md`, sections 2 and 4; 001 D7, D9 and goal 3; 004 D2, D3 and D9.

## Verification output

The checkout matched the candidate and was clean for the checks and probes. Node v24.21.0. The brief explicitly excludes `npm run build`; bundle regeneration is therefore **unverified** here. No eval runner, agent session, or repository verification script was invoked. The independent suite includes the 006 eval unit tests present in the range; retained calibration sessions were not repeated.

```text
$ git rev-parse HEAD
1896e49cd6f65d2d696776196bd16348ad5ca983

$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities

$ npm run lint
> squeal@0.1.126 lint
> biome check .
Checked 885 files in 514ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.126 typecheck
> tsc --noEmit
[exit 0]

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  411 passed | 1 skipped (412)
     Tests  3273 passed | 10 skipped (3283)
  Start at  00:58:26
  Duration  644.08s (tests 97%, import 2%, transform 1%)
[exit 0; 0 failed]
```

The suite also printed two scratch-fixture `git worktree repair` notices and its teardown's cleanup of one process left by an earlier run. It exited 0, with no failed tests or cleanup errors.

`npm ci` also warned that the installed esbuild and parcel packages have install scripts outside `allowScripts`; installation exited 0. The targeted probes below are standalone scratch programs bundled with the installed esbuild API, using product source modules and scratch repositories/stores. They ran with the same git/session isolation, closed their servers and stores, and removed their fixture directories. No product code was changed.

## Verdict

**FAIL. Two proven blockers, one proven should-fix, no nits.** The routine tests cover the intended ready-state behavior. The startup boundary and changes to a held file's slow classification still break it.

## Blockers

### B1. A nudge during scheduler startup throws out of the front-desk callback

**Proven.** Changed boundary: `src/core/scheduler/scheduler.ts:295`, `src/core/scheduler/slow-tier.ts:130`, `src/core/daemon/desk.ts:117`, `src/core/daemon/daemon.ts:463`.

The daemon assigns `this.#loop` before awaiting `loop.start()` (`daemon.ts:428`). Scheduler startup assigns `#ledger` at line 156, then awaits the scan and baseline, and only assigns `#context` at line 164. During those awaits the new `Scheduler.nudge` passes its ledger guard and calls `SlowTier.nudge`, whose `host.started()` throws `squeal scheduler: not started`. The shipped worker front desk routes this call through a main-thread message listener with no catch. The socket worker can acknowledge the nudge, but its main-thread callback raises an uncaught exception and terminates the daemon under the normal Node exception policy.

A restarting daemon can still have its predecessor's pending slow rows. A silent Stop reads those rows and sends the newly added nudge while this daemon is scanning or awaiting a runner call. No slow runner has to start for the crash: `host.started()` is called before checking the slow queue.

Discriminator: start a real scheduler over a scratch git repository/store, hold its first `runner.environment()` call, then nudge. Direct invocation and the actual committed front-desk worker wired to this scheduler produced:

```text
startup nudge: squeal scheduler: not started
worker nudge uncaught: squeal scheduler: not started
ready nudge: returned
```

This breaks 001 D10's serving daemon/startup path and 001-281's idle-start behavior. No product handler installs an `uncaughtException` recovery path. The existing daemon test replaces `onNudge` with a counter, and the scheduler test nudges only after `start()` completed, so neither exercises this seam.

**One-worker fix:** make a pre-start nudge safe at the scheduler entry, checking initialized context as well as ledger, or serialize it after startup. Startup already pumps after it completes, so an early nudge need not force a partially initialized scheduler. Add a test through the worker front desk while baseline is held, then release the baseline and verify the pending slow tier still follows its ordinary trigger checks. Keep nudges during shutdown harmless.

### B2. A held running file disappears from the wait when its policy classification changes

**Proven.** Changed boundary: `src/cli/status-wait.ts:253`, `src/cli/status-wait-slow.ts:31` and `:42`.

The first read stores the held file IDs, but every subsequent read decides whether they remain pending by calling `pendingSlow` again. That function reloads today's policy and filters out everything no longer classified as slow. Removing the held path from `slow.include`, or clearing a node:test project's `slow` flag, therefore discharges it even when its key row and checks remain running. This can occur before the policy edit reaches the watcher; a sync pass made before that edit does not prevent it.

Discriminator: seed one slow file's key and check as running, with a live daemon and a trusted, empty edit window. Start `waitForStatus` with `holdSlow: true`, then remove its slow declaration 100 ms after the first read, leaving its running row and check untouched. Output:

```text
Returned on quiet: nothing the edits since revision 1 re-keyed is pending (0 test files) at revision 1 after 0.1 s; 1 check pending in all; the 1 slow file run --slow queued has its result
owned row after return: running
held: {"held":1,"pending":[]}
```

The snapshot does still expose a pending check. The first line nevertheless explicitly claims that this request's running file has its result. This violates 001 goal 3 and 001-282's done-when: the wait holds until the queued file has its result or returns on timeout with its path.

**One-worker fix:** use the policy only to capture the initial slow set. Once held, determine pending membership from those IDs' key rows and checks regardless of their current slow classification. A held row still queued/running or a held check still pending must hold the wait. Cover both glob removal and node:test slow-flag removal during a held run, and retain timeout/news behavior.

## Should-fix

### S1. Slow news is reported as news in zero edit files

**Proven.** `src/cli/status-wait.ts:266` adds `slowNews` to the total transitions while leaving `edit.testFiles` unchanged. `src/cli/status-wait-lines.ts:59` then attributes the whole total to the edit window.

With an empty edit window and one held slow file finishing with a failure, an isolated probe returned:

```text
Returned on news: 1 transition in the 0 test files the edits since revision 1 re-keyed, at revision 1 after 0.1 s; the 1 slow file run --slow queued has its result
```

The failure is delivered and the outcome is correctly news; the attribution sentence is false. The new CLI news test accepts this output because it matches only the generic news prefix and slow suffix.

**One-worker fix:** render slow-file news separately from edit-window news, or describe the union of the two owned sets without attributing every transition to edits. Assert the full line for an empty edit window and for mixed fast-edit/slow news.

## Nits

None.

## Brief answers and what fits

- **Can a nudge start forbidden slow work or starve fast work?** In the initialized scheduler, no bypass was found. `nudge` changes neither `#requested` nor the pass budget; it asks the existing pump to plan. That pump selects fast tiers first. Slow candidates and final selection both check edit-caused fast work and the idle/explicit/checkpoint triggers, and the load guard, claims and per-user slot still apply. Edits abort the load wait, and fast tiers keep their separate lanes. B1 is the startup failure before these checks can run.
- **Can a wait return quiet while its owned slow file runs, or wait forever?** `run --slow --wait` can return false quiet in B2. Under unchanged classification, the added hold prevents the old early-quiet case and includes owned slow transitions as news. Plain `status --wait` intentionally holds for fast edit files and may return quiet with slow files running; its new suffix names that exclusion and the slow-wait command. No unbounded loop was found for a finite CLI wait: `performance.now()` enforces the deadline even during sync/refinement, and the final read can add the existing 1 s store busy timeout. A dead daemon has its own outcome. Request acknowledgement has a separate pre-existing bounded wait before the status wait begins.
- **Does Stop stay within 2 s under load?** The new socket request is bounded to 100 ms and its budget is subtracted from the store busy timeout. At the maximum 1,500 ms pending wait the arithmetic is 1,500 + 150 busy + 100 nudge + 250 margin = 2,000 ms. A standalone real `stopTurn` probe with a fast file continuously pending and a socket accepting the nudge but never replying returned silently in **1,646 ms**, sent one nudge, at host load **77.77**. This verifies the added path under that load. It does not prove a whole hook process, including startup and repeated store contention, finishes within 2 s under every load; that broader bound is **unverified**, not an additional blocker.

The nudge is sent only after a silent main Stop successfully commits `endTurn`; speaking/blocking Stops do not nudge. Both harnesses share this implementation. Threaded and main-thread desk routing are covered. The CLI hold is opt-in, leaving ordinary status waits unchanged. The release increments and key-format bump to 8 fit the guarded-source change; the CLI-only landing does not require another bump.

## Inputs for the fix wave

1. Repair B1 at the scheduler readiness boundary, preserving the existing trigger, fast-priority and capacity checks. A socket acknowledgement must never crash the main thread during startup.
2. Repair B2 inside the CLI wait: capture ownership once, then inspect all held IDs independently of live policy classification. No wire or key-format change is required for that approach.
3. Fold S1 into the same CLI worker. Keep distinct edit/slow ownership in the first-line wording, with no double-counted transitions.
4. Re-review the held-startup and policy-change discriminators, then run the required independent gate. The coordinator routes the two proven blockers to the human. The planned primer/skill and one-shot Stop rows remain outside this review's fixes; they must not rely on a quiet slow wait until B2 is repaired.
