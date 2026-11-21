# Wave 20 review

FAIL `126acb6691c00c3ec187687bfc42d00873b622ac`: **8 proven blockers**, 1 plausible nonblocking note.

Reviewed `bc30db2a6..126acb669`, rows 023-34, 023-35 and 023-36. The original candidate was `f1af4292d`. At the coordinator's request, this worktree fast-forwarded to `126acb669`: one test-expectation change, no product change. HEAD matched both requested candidates when checked. Generated bundle content was excluded from prosecution.

## Verification

Read `CLAUDE.md`, process, vision, styleguide, board rows, spec D3/D4/D6 and status amendments, wave-20 brief, Round 5 T1–T6, and `tasks/023-34-notes.md`. No separate 023-35/36 notes file is present. Reviewed the daemon and scheduler changes as product code under the approved cross-spec scope.

| Command or evidence | Actual result |
| --- | --- |
| Dependency setup | Used the supplied installation. Did not install again. |
| `git rev-parse HEAD`, `git status --short` | Exact `126acb6691c00c3ec187687bfc42d00873b622ac`; clean before verification and after removing probes. |
| `pnpm run lint` | Exit 0: `Checked 3934 files in 2s. No fixes applied.` One existing `noProto` warning and two literal-key infos outside this range. |
| `pnpm run typecheck` | Exit 0, no diagnostics. |
| `pnpm run build` | Exit 0, including all four plugin builds. No tracked file changed. |
| `pnpm run check:private` | Exit 0: `11378 added lines in 99 files over bc30db2a6b0537c89ba12ba7c6a2d50ef1026a24, ok`. Empty private denylist was skipped with a warning. |
| Installed `squeal checks` | Default tests, 2,088 files; typecheck/build and excluded e2e tests are outside its coverage. |
| Installed `squeal status --wait 60000 src/cli/status-at-commit-run.ts src/cli/status-at-both.ts src/cli/status-at-run-fit.ts src/core/scheduler/take-back.ts src/core/daemon/run-groups-watch.ts src/core/daemon/run-groups.ts test/cli/status-at-not-selected.test.ts` | Exit 3 at revision 1: 700 selected, 222 current passes, 478 unknown. Of those unknown, 474 were lookup-only misses and four awaited another worktree. This is incomplete affected evidence, not a suite pass. |
| Targeted candidate checks, command below | Exit 0: **18 files, 109 tests passed**, 38.11 s, on the clean candidate tree after probe removal. Direct tests were justified by the unknown affected results and the review's concrete failure cases. |
| Final installed `squeal status --wait 60000` on the seven focused test paths below | Exit 0, revision 11: `no known failures; 7 test files, each with a current result, after 29.8 s`. Worktree still had 555 of 2,088 files not current: four running, 100 queued, 451 unknown. No whole-worktree pass is claimed. |
| `git diff --check` | Exit 0. Only the review file remained untracked. |
| Exact-candidate CI | [CI 44895598143](https://github.com/hearsay-tools/squeal/actions/runs/44895598143) was in progress at the last read; full-suite evidence remains **unverified**. [Private material 44895598059](https://github.com/hearsay-tools/squeal/actions/runs/44895598059) passed. |
| Benchmark comparison, process 6c | **Unverified:** no base/candidate comparison is named in the row notes or found in `bench/results/TREND.md`. The worker notes explicitly say no benchmark ran. This does not block review. |

All direct Vitest commands used `timeout 600 pnpm exec vitest run --maxWorkers=2` with explicit paths. No full suite ran. `squeal.config.json` stayed as found.

The clean-tree targeted command was:

```sh
timeout 600 pnpm exec vitest run --maxWorkers=2 \
  test/cli/status-at-not-selected.test.ts test/cli/status-at-report-files.test.ts \
  test/cli/status-at-run-fit-check.test.ts test/cli/status-at-run-give-back.test.ts \
  test/cli/status-at-run-marks.test.ts test/cli/status-at-run-review.test.ts \
  test/cli/status-at-run-units.test.ts test/cli/status-at-run-unkept.test.ts \
  test/cli/status-at.test.ts test/cli/stop-run-groups.test.ts \
  test/daemon/run-group-paths-at.test.ts test/daemon/run-groups-watch.test.ts \
  test/daemon/run-groups.test.ts test/daemon/take-back.test.ts \
  test/harness/skill.test.ts test/scheduler/take-back.test.ts \
  test/runners/boundaries.test.ts test/version-sensitive.test.ts
```

The final Squeal path wait named `test/cli/status-at-not-selected.test.ts`, `test/cli/status-at-run-fit-check.test.ts`, `test/cli/status-at-run-unkept.test.ts`, `test/daemon/run-groups-watch.test.ts`, `test/daemon/run-groups.test.ts`, `test/scheduler/take-back.test.ts` and `test/version-sensitive.test.ts`.

Throwaway probes added test files only. They imported unchanged candidate product code. Final probe runs: CLI plus fast-starter daemon probes, **9/9 passed**, 3.55 s; fit plus real-scheduler probes, **7/7 passed**, 13.78 s; rejected-request daemon probes, **2/2 passed**, 2.61 s. These assertions confirm the bad behavior described below. Probe files and their processes were removed. Initial probe-only failures were a copied count expectation and an incorrect expectation for the daemon's unknown-group response; both were corrected. The temporary node:test probes also triggered the version-sensitive-list check because they were not in that list. None is counted as a candidate test failure.

## Blockers

### B1. Take-back removes work the user's edits still need — proven

**Location:** `src/core/scheduler/take-back.ts:78`, `:97`.

T1 requires that an edit's re-queued file stay queued. The new guard equates that ownership with `queue.isRecent`. Existing scheduler rules also queue edit-required files as catch-up: ten keyed paths in one revision, or readers demoted by the edit cut. Those entries are not recent. Their request's own promotion is excluded from the other-promotion guard, so take-back removes them.

**Real scheduler witness:** extend `test/scheduler/take-back.test.ts` to 12 manual-group files, each importing its own source. Use the existing lookup-only baseline, one-file tier, and held first run. Request all 12. While the first file runs, edit ten sources of the queued files in one `side.edit("watch", ...sources)` batch and let reconciliation finish. Take back the request's covered ID. Actual answer: `{takenBack: 11, running: 1, kept: 0}`. Release the run. Only the original first file runs; all ten edited files remain non-current. A direct `RunQueue`/`decideTakeBack` probe confirms the same missing guard.

**Repair:** record request ownership separately from scheduling rank. Preserve every queue entry independently required by a revision or another request, including catch-up and demoted readers. Test both paths through the real scheduler, rather than only injecting `recent: true`.

### B2. Later named runs still wait behind earlier wide runs — proven

**Location:** `src/core/scheduler/narrow-run.ts:157`, `src/core/scheduler/promotions.ts:127`.

D4.11: “files a later call names run ahead of earlier `--run` work.” This path still uses the ordinary first-batch order. A later request cannot move a selected file out of the earlier batch.

**Witness:** enqueue `a` and `b`, promote `[a,b]` for the earlier request, then promote `[b]` for the later named request. `queue.ordered(() => null)` returns `[a,b]`. The row notes also acknowledge that an overlapping earlier call leaves the later call behind it. Earlier calls moved to the background are the dogfood failure this requirement addresses. The notes propose a later row, but D4.11 has no approved exception for it.

**Repair:** distinguish the priority of a later explicit `--at ... <file> --run` request from ordinary named waits. Put its queued files first at the next runnable boundary. Preserve the rule that an already running file is not taken back. Add an overlapping wide/narrow call test.

### B3. A pending daemon request can queue work after its caller's budget — proven

**Location:** `src/cli/status-at-run-now.ts:188`, `:226`; `src/cli/status-at-run-give-back.ts:68`.

The socket request starts scheduler work before a covered-files ID exists. If `takenRequest` reaches its deadline first, the CLI replaces the pending request identity with text. `throughDaemon` retains no covered ID, and `giveBack` returns without sending anything. The daemon's `groupRequests.start` promise remains active and can later queue the whole selection. Thus a completed call can leave a new wide queue after its take-back opportunity has passed.

**Witness:** the CLI seam probe returns the real pending-request text from `ask`. `runNow` produces `coveredIds: []`; `giveBack` calls take-back zero times. The daemon's retained promise has no cancellation or caller-expiry check. The row notes explicitly acknowledge that the files can be queued after the call ends.

**Repair:** give the request a cancellation identity before scheduler intake, or enforce an expiry at intake. Taking it back must also prevent a pending request from queuing later. Add a daemon test that holds intake beyond the budget, ends the call, then releases intake and verifies no new queue entries appear. Keep old-daemon fallback explicit.

### B4. The cold-selection refusal hides an answer that fits — proven

**Location:** `src/cli/status-at-run-fit.ts:93`, `:97`; `src/cli/status-at-run.ts:181`.

The unknown-duration branch treats 20 seconds per round as a minimum. No observed duration supports that bound. It is a batch target, not a lower bound on execution time. The check stops both sides before learning their rate.

**End-to-end witness:** mock the parent's `availableParallelism()` to 2, giving estimate width 1. Make 16 tiny node:test files import a changed source, with an empty store, coverage off and child `--test-concurrency=1`. Default `--run` refuses, reports `fits: 15`, and runs zero files. The same call with explicit `--timeout 300` completes both sides in **10.477 s**, exit 0, `16 unchanged, 0 unknown`. This uses two host-independent CPU slots and serial child tests; it is not a timing extrapolation.

**Repair:** do not declare an unknown rate impossible from the fixed 20-second target. Measure a bounded first batch, or use another rule that cannot suppress this small, fast selection. Keep the explicit force/narrow text. Add this refusal-versus-success regression.

### B5. “None of its inputs differs” is false for dirty worktrees — proven

**Location:** `src/cli/status-at-commit-run.ts:130`, `src/cli/status-at-report-files.ts:178`.

The new complete-closure label only proves that the checkout's static graph reported no incomplete closure. Selection compares the commit with HEAD (`changedSince`), while the new text claims equality with the working tree. Dirty inputs are not checked before removing the file from unknown counts.

**End-to-end witness:** commit a node:test file that imports `src/plain.mjs` and asserts `value === 1`. Commit an unrelated README change. Then leave `src/plain.mjs` dirty with `value = 2`. `status --at <base> --run` prints a dirty header followed by:

```text
1 test file not selected: none of its inputs differs between <base> and the working tree, so this commit cannot change its result: test/plain.test.mjs
0 pass -> fail, 0 fail -> pass, 0 unchanged, 0 unknown, 1 not selected
```

The imported source differs and changes the assertion. The new claim is false even with a complete static import graph. The old HEAD-only selection is outside this range; the new certainty and removal from unknown counts are in it.

**Repair:** certify equality over the actual current inputs before applying this label, including dirty changes. Otherwise keep the file unknown and state what was not checked. Keep the existing incomplete/unchecked runner exceptions. Add staged and unstaged source controls.

### B6. A reused group is signalled when its newer leader is gone — proven

**Location:** `src/core/daemon/run-groups.ts:128`.

T3 requires matching group ID **and leader start**, never a reused group. `membersOf` checks the leader's start only if the leader is present in the current process table. With no leader, it accepts every member born after the old recorded start. That inequality also accepts a completely newer group.

**Deterministic process-table witness:** retain record `{pgid:100,start:50,runId:"old"}` after its group ends. A later unrelated leader reuses 100 at tick 90, starts member 101 at tick 95, then exits. The live table is only `{pid:101,ppid:1,pgrp:100,start:95}`. `membersOf` returns 101. `stopGroups` sends it `SIGTERM` and attributes it to `run old`. This reproduces the identity decision without forcing host PID reuse or signalling an unrelated host process. Persisted records after a killed daemon make this a supported recovery path.

**Repair:** retain enough verified process identity to establish membership when a leader exits. A stale pgid plus a lower start-time bound is not that evidence. If identity cannot be proved, spare the group and report the uncertainty. Test the absent newer leader, not only a live leader with a different start.

### B7. Fast starters leave detached groups unrecorded and alive — proven

**Location:** `src/core/daemon/run-groups-watch.ts:157`.

D4.11/D6 require the working-tree run's groups to end. The 100 ms tree walk only finds descendants while their marked starter still lives. After a starter exits, the detached child is reparented outside the walked tree. The final walk cannot recover it.

**Real-process witness:** use `test/daemon/run-groups-watch.test.ts` with only its artificial 600 ms sleep removed. The node:test body still starts a detached Node server with `env: {}` and unrefs it. Under a flagged run, the server is alive when the run returns, the recorded group list is empty, and no stop note names it. Both the flagged-leak witness and the unflagged outside control passed. The probe explicitly ended its child afterwards. An empty record also gives later `squeal stop` nothing to recover.

**Repair:** establish group ownership at process creation, or another boundary that survives the starter's exit. Polling alone does not supply the promised cleanup. Add the no-delay starter as the regression and retain the outside-process control.

### B8. Cleanup flags attach to later ordinary runs — proven

**Location:** `src/core/daemon/handlers.ts:358`; `src/core/daemon/run-groups-watch.ts:47`, `:99`.

T3 limits cleanup to a flagged `--run` request's runs. The handler marks raw paths before it knows whether the request is valid or queues anything. Flags last an hour unless a run consumes them. They have no request, project or queue ownership, and take-back does not clear them.

**Real-process witness:** wire the real `createHandlers` to an `AtRunPaths` and a `requestGroup` that returns null. Send a flagged request for `no-such-group` and wait until its status says `unknown: true`. Then call the node:test runner normally for that path. Its detached child is recorded and stopped under the ordinary run's ID, although the only flagged request was rejected and never started a run. The unflagged control's child survives. Both tests passed. A successfully taken-back request leaves the same path flag for a later edit's run.

**Repair:** bind cleanup policy to accepted request/file identities and carry it into the particular run. Clear it when a request fails, expires or is taken back. A rejected request must not alter later run behavior. Cover the same path in another project and a mixed batch as well.

## Nonblocking note

**N1 — plausible, T4 provenance:** `src/cli/status-at-run-unkept.ts:52` checks outcomes but ignores `GateFileRun.from`. An injected `from: "parts"` pass is converted to `origin.kind: "run", stored:false`; with an actually run base side, the formatter prints `(this run, not stored)` although this side did not run. The same risk applies to `from: "store"`. The gate's type permits both, but the current files-only caller supplies no parts, and its final store reread may suppress a cached answer. No reachable end-to-end one-sided false marker was established, so this is not blocking. Preserve the producer field through this boundary and test a real cache hit between the initial snapshot and the gate call.

## What fits

- Take-back leaves a running file in flight, and explicitly forced, recent and other-live-promotion entries have guards. The existing real-scheduler test covers normal queued removal and repeat take-back. B1 concerns the independent edit work those guards miss.
- The new request protocol crosses both desk modes with the right IDs and argument order. Old daemons can ignore the additive `at` field; unknown take-back requests retain the old “runs go on” report. No old-daemon protocol rejection was found.
- T2 treats incomplete node:test closures as incomplete and an absent completeness list, Vitest and other unreported runners as unchecked. It does not infer a complete closure from a missing list. JSON keeps old fields and adds `notSelected` details.
- The ordinary T4 path compares two actually run, unkept outcomes without storing them. Its tests also check the next non-run lookup has no result. The formatter requires both sides to carry unkept run provenance; a normal one-sided result does not receive the marker. N1 names the remaining producer-boundary question.
- T5 prints the requested single-line `--wait` explanation with exit 2. T6 adds the same 360 s tool-timeout example to all three skill copies and documents the adjusted cap test.
- For a currently verified group, stop reports name the processes and run, and the outside-group process survives. The existing live-reused-leader control is sound. B6 is the missing-leader case.

## Inputs for the repair wave

Keep the approved spec 011 daemon/scheduler scope. Do not widen cleanup to command-line or path matching. Repair request ownership once across acceptance, pending intake, queueing, run start and take-back; share that identity with the T3 run policy. Preserve independent revision work at every queue rank. Keep running tiers intact while making later explicit named requests lead the next boundary.

Keep the 300 s shared budget and bounded cleanup handshake. Cancellation must stop pending intake from creating work after that budget. Do not replace unknown timing with a fixed lower bound. Retain uncertainty when current input equality or group identity is not proved. Add the witnesses above as focused regressions. Obtain the exact repaired candidate's affected results and CI evidence; the missing benchmark comparison remains evidence to supply, not a review blocker.
