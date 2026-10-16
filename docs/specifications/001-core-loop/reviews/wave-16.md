# Wave 16 review: 001-429

Verdict: **FAIL**. Two proven blockers, one plausible should-fix, no nits.

Candidate: `cand/0.1.200`, pinned to `4a1c7f6adb764e07694f51f4b46a20ce174f89cc`. Range: `e0ff15a3..4a1c7f6a`. Reviewed W1 and W2 of `tasks/wave-16.md`, issue [#2](https://github.com/hearsay-tools/squeal/issues/2), D10 as amended on 2026-10-16, and D12. No product source was edited.

## Verification

`git rev-parse HEAD`:

```text
4a1c7f6adb764e07694f51f4b46a20ce174f89cc
```

All checks and both probes used the pinned candidate source and built bundles. `git status --short` was empty before verification and after the probes; `npm run build` left no tracked changes. A documentation-only draft of this review was temporarily untracked during the full run, then kept outside the tree until the results were ready. No product, test or configuration file changed. The final commit changes only this findings file.

`npm ci` exited 0:

```text
added 196 packages, and audited 197 packages in 6s

32 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

npm also reported the deprecated `node-domexception@1.0.0` and six install scripts not covered by `allowScripts` (`@google/genai`, `@parcel/watcher`, `esbuild`, `msgpackr-extract`, `opencode-ai`, `protobufjs`). No install approval was changed.

`npm run lint` exited 0:

```text
> squeal@0.1.200 lint
> biome check .

Checked 1350 files in 531ms. No fixes applied.
```

`npm run typecheck` exited 0:

```text
> squeal@0.1.200 typecheck
> tsc --noEmit
```

`npm run build` exited 0:

```text
> squeal@0.1.200 build
> tsc -p tsconfig.build.json && npm run build:plugin

> squeal@0.1.200 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
```

Independent full run, required for a reviewer, rather than Squeal's checkpoint:

```sh
flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
```

Exit 1. Verbatim output:

```text
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/424615bd-319a-4e50-8e5e-35af9710fd58

 ❯ test/harness/opencode-dispose.test.ts (3 tests | 1 failed) 43522ms
   ❯ a report held while dispose meets newer input (3)
     × serve: an abort of the new turn, then the old Stop's answer, stores nothing 26139ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/424615bd-319a-4e50-8e5e-35af9710fd58/test/fixtures/scheduler/.tmp/a8b4f81b-f92c-49ce-af1c-2ce6b417bb39/main/.git/worktrees/staged/gitdir
 ❯ test/cli/status-wait-edit.test.ts (8 tests | 1 failed) 3309ms
   ❯ status --wait holds for the edit's own test files (lessons, defect 32) (8)
     × returns quiet once the edited file's result is in, while a backlog runs 354ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/424615bd-319a-4e50-8e5e-35af9710fd58/test/fixtures/scheduler/.tmp/8829785e-9f76-4741-a96e-39e944e9e873/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 1874417
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/cli/status-wait-edit.test.ts > status --wait holds for the edit's own test files (lessons, defect 32) > returns quiet once the edited file's result is in, while a backlog runs
AssertionError: expected 661.7922679999999 to be greater than or equal to 668.374311
 ❯ test/cli/status-wait-edit.test.ts:40:21
     38|
     39|     expect(wait.outcome).toBe("quiet");
     40|     expect(endedBy).toBeGreaterThanOrEqual(finished.at);
       |                     ^
     41|     expect(wait.waitedMs).toBeLessThan(2_000);
     42|     expect(wait).toMatchObject({

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  test/harness/opencode-dispose.test.ts > a report held while dispose meets newer input > serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the plugin killed the held Stop at +2008, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +69 (pid 1699771), dispose +98, input +991, kill +2008 (pid 1699771), disposed +2373; the held Stop's deadline: +2000
 ❯ reached test/harness/opencode/held-stop.ts:210:27
    208|     if (gone !== null) {
    209|       const message = `before ${what}, ${gone.why}\n${timeline(b)}`;
    210|       throw gone.missed ? new Missed(message) : new Error(message);
       |                           ^
    211|     }
    212|     if (Date.now() > limit) throw new Error(`${what}: not within ${BAR…
 ❯ test/harness/opencode-dispose.test.ts:172:9
 ❯ Object.afterReply test/harness/opencode-dispose.test.ts:112:7
 ❯ runOpenCode test/helpers/opencode.ts:204:11
 ❯ squealOpenCode test/harness/opencode/real.ts:75:17
 ❯ overtaken test/harness/opencode-dispose.test.ts:99:18
 ❯ test/harness/opencode-dispose.test.ts:170:21
 ❯ ordered test/harness/opencode-dispose.test.ts:66:14
 ❯ test/harness/opencode-dispose.test.ts:168:26

 ❯ test/harness/opencode-dispose.test.ts:69:17 notice
   ↳ attempt 1 of 3 missed its barriers: before the new turn's request, the plugin killed the held Stop at +2092, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +47 (pid 1686140), dispose +73, input +826, kill +2092 (pid 1686140); the held Stop's deadline: +2000
   ↳ attempt 2 of 3 missed its barriers: before the new turn's request, the plugin killed the held Stop at +2156, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +49 (pid 1693218), dispose +101, input +911, kill +2156 (pid 1693218); the held Stop's deadline: +2000

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  2 failed | 663 passed | 1 skipped (666)
      Tests  2 failed | 5665 passed | 10 skipped (5677)
   Start at  18:15:49
   Duration  832.28s (tests 98%, import 2%)

    Isolate  666 workers spawned · ~145ms startup each (spawn + environment, per file)
             at least ~24.05s faster with isolate: false — reuses workers across files instead of one per file
```

Both new regression files and the key-format guard passed. The run is red; the two suite failures are separate from the candidate findings below:

- `test/harness/opencode-dispose.test.ts:172`: all three attempts missed the new-turn barrier because the held harness Stop was killed at +2092, +2156 and +2008 ms against its +2000 ms idle deadline. This is the load-sensitive case already recorded under board row 010-16 and Later. The OpenCode source and test are unchanged by this range; its rebuilt hook bundles change the version constant. This scenario uses a stand-in harness Stop, rather than the daemon-stop protocol this candidate changes.
- `test/cli/status-wait-edit.test.ts:40`: `endedBy` was 661.7922679999999, while `finished.at` was 668.374311. The assertion compares `timed`'s reconstructed end time with the timer callback's completion time. This test, `wait-clock.ts`, and the wait implementation are unchanged in the range; it uses a fake daemon and executes no cancelling scheduler or process scan. The exact timing cause is unverified, so this is not evidence of another candidate regression.

A focused repeat was attempted after the full run, but another run held the host lock. Neither invocation reached Vitest, so this repeat is **unverified**, not a test failure or pass:

```sh
flock -w 10 /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/cli/status-wait-edit.test.ts --maxWorkers=4
# exit 1; no output (host lock unavailable)
flock -w 45 /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/cli/status-wait-edit.test.ts --maxWorkers=4
# exit 1; no output (host lock unavailable)
```

The host's sampled one-minute load was 22.13, 40.47, 23.16 and 20.39 during the run. No second full run was performed.

Squeal's separate baseline at revision 2 also reported `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`, both expecting a pass in a no-recorder branch and receiving a fail. Both `why` reports were read. These tests did not fail in the independent run above. Their runner/recorder implementations are unchanged by this range; the reason for their background-only failures is unverified. Those reports are not substituted for the independent result.

## Blockers

### B1. The leftover scan attributes a pre-existing group member to the daemon

**Proven.** `src/core/daemon/leftovers.ts:46`, with group capture at `src/core/daemon/leftovers.ts:25` and the failure printed by `src/cli/stop.ts:86`.

D12 excludes “what shared the group when the daemon started ... and what that starts.” W2 explicitly requires that the scan cannot name a process the daemon did not start. The new scan treats every member of the captured group as owned. Unlike `EscapedChildren`'s existing `strangersOf` / `lineOf` exclusion, it captures no initial strangers and excludes none of their descendants.

Failure scenario: a daemon is the leader of a shell job's process group, with another pipeline command already in that group. Its shutdown correctly leaves that command alive. `squeal stop` then waits its entire leftover bound and exits 1 claiming that the unrelated command is a process the daemon started. The worktree's actual Squeal processes are already gone.

A Linux probe used the committed Codex CLI bundle, a bare temporary Git repository with one passing node:test file, and two sibling processes. The first called `setpgid(0, 0)`, waited at a pipe gate, and exec'd `node <bundle> daemon <root>`. The second joined the first's group and exec'd `sleep 180`, before the gate released the daemon. Both were children of the probe, not of each other. After 4 s the probe ran `node <bundle> stop <root>`. Actual result:

```text
daemonPid: 1525785
siblingPid: 1525793
stopCode: 1
elapsedSeconds: 10.38
stdout: Stop requested; the daemon for <fixture> stopped, but a process it started still runs after 10 s: pid 1525793 sleep 180
siblingStillAlive: true
```

The probe terminated and reaped its own sibling afterwards. The daemon's reaper correctly spared it; the new CLI scan incorrectly named it.

Worker-sized fix: make ownership information available to the stop waiter from the daemon's initial group snapshot, including excluded identities and their descendants, or use another equivalent ownership mechanism. Preserve the daemon's pid/start identity throughout. Do not merely exclude processes born before the daemon: a stranger can start a child later. Add the real shared-group regression beside `test/cli/stop-bound.test.ts`; stopping the daemon must succeed without waiting on or naming the sibling or its children.

### B2. Stopping a node:test backlog kills processes but does not cancel the runner's queue

**Proven for node:test.** `src/core/daemon/daemon.ts:669`, the new fallback after `loop.close({ cancel: true })`. Related boundary: `src/core/scheduler/tiers.ts:315`; the signal it passes is dropped at `src/runners/node-test/adapter-project.ts:157`. The queue keeps starting work at `src/runners/node-test/run/run.ts:132`.

D10 requires that stop “cancels the tier in flight in every lane, as a timeout stops one,” and that the rest stay queued for the next daemon. Forwarding an abort signal only reaches Vitest. The fallback sweeps marked processes once, in at most three rounds (`src/core/daemon/escaped.ts:232`), but node:test's worker loop only stops dequeuing on its own timeout's `expired` flag. Killing an active process frees that worker to start another queued file. Once the sweep ends or sees a gap between spawns, the new file can run until the normal tier timeout. `loop.close()` remains waiting on that tier.

Failure scenario and probe: a temporary Git repository had eight node:test files, each appending its file number and pid to an external log and then waiting for an external release file. Config: `runner.tierSize: 1`, `runner.backlogTierSize: 200`, `runner.timeoutMs: 150000`, one nodeTest project, and an isolated user capacity of 16 slots. Start with the committed Codex CLI bundle; wait for the first file's log, then call `stop`. At 12 s, read the log and check the stop process; finally create the release file for cleanup.

```text
beforeStop:
0 1551782

12secondsAfterStop:
0 1551782
3 1552759

stopStillRunning: true
```

Only after the probe released the waiting test did stop return:

```text
stopCode: 0
elapsedSeconds: 12.76
stdout: Squeal daemon stopped for <fixture>
```

File 3 started after the stop request, within the cancelled tier. Killing the first process was not cancellation of the tier. The same signal gap exists in pytest (`src/runners/pytest/adapter-run.ts:62`, queue at `src/runners/pytest/run/run.ts:159`); that consequence is **plausible**, not separately reproduced here.

Worker-sized fix: forward and consume the abort signal in node:test and pytest. Stop dequeuing immediately, signal active groups using their existing timeout termination mechanism, preserve already completed files, and leave interrupted and never-started files incomplete for the scheduler's new requeue path. Do not represent cancellation as a timeout or manufacture failed/unknown check results. Test a backlog wider than runner concurrency, assert no queued file begins after stop, assert stop completes while the held test remains unreleased, and verify completed results survive while the remainder is queued. Cover both runners and a pre-aborted signal.

## Should-fix

### S1. Leftover names are not protected against pid reuse during asynchronous reads

**Plausible.** `src/core/daemon/leftovers.ts:39` and `src/core/daemon/leftovers.ts:49`.

Failure scenario: the scan recognizes a process by its group or mark, saves only its pid, and the process exits. A new unrelated process gets that pid before the asynchronous command-line read completes. The waiter can name that new command as something the daemon started. `marksOf` also keeps no start identity for a group leader. W2 explicitly calls out reused pids; unlike `terminate`, this path does not revalidate start time. This race was not forced in a live kernel, so it is not blocking.

Worker-sized fix: retain `ProcessEntry` identities, recheck them after command-line reads, and do not accept a reused daemon/group identity. Reuse a controlled process-table approach like the termination tests to force reuse between the scan and name read. Fold this into B1's ownership repair.

## Nits

None.

## What fits

- Cancellation is requested by the stop handler. Ordinary superseded, sessions-gone, reinstall and signal shutdowns still call close without `cancel`; the new shared close promise also lets a later stop escalate an already-running close.
- The fast pump rechecks `#closed` under its selection lock after awaiting the install check. Slow selection also checks `host.closed()` after its guard and slot waits. Closing during scheduler startup prevents its pump from starting, and the loop avoids creating a watcher after close.
- The scheduler computes unfinished ids from `completedFiles` and supplies those ids to `recordTier`'s existing selective requeue path before its unknown-result branch. Completed files still take the stability and observation checks. No defect was found in that bookkeeping; B2 is the missing cancellation of another runner's internal work.
- The new real-daemon Vitest test checks both `/proc/*/cwd` and `/proc/*/fd` after stopping a held test with a child. The departure-drain test asserts that a second slow file never starts. The bound tests distinguish a still-serving daemon, a matching carrier, and another daemon's token.
- `squeal remove` still sends the same stop request, takes every daemon lock before deleting anything, and refuses deletion when a lock stays held. The new cancellation request does not bypass those locks. Its shared-group scan is not the new CLI leftover scan.
- README names the command before worktree deletion. Version 0.1.200 and key format 11 are consistent with the candidate; rebuilding all four plugin trees produces no tracked drift.

## Inputs for the repair and re-review

Repair B1 at the ownership boundary, preserving the daemon's initial stranger exclusions and process identities rather than treating a process-group number as ownership. Repair B2 at each runner's cancellation boundary, before it dequeues more work; keep the scheduler's completion/requeue distinction. Preserve ordinary shutdown's finish-and-store behavior and the stop-only escalation. Re-review these repairs and the regenerated bundles at a new pinned candidate, including the shared-group case, a backlog wider than concurrency in both runners, and completed-versus-unfinished state. S1 can share B1's process-identity tests. No source was changed in this review.

## Round 2: 001-430

Verdict: **PASS**. No proven blockers, one plausible should-fix remaining from S1, no nits. This verdict supersedes Round 1 for the candidate below; it does not assert that unrelated suite failures are repaired.

Candidate: `cand/0.1.200`, pinned to `b43375cc292e3eb3181b243c929bf89c7d4ccb28`. Bounded re-review of Round 1 B1, B2 and S1. Inspected repair `56744c0c`, regenerated bundles/key-format-11 pin `30ec91a2`, and the new tests. The Round 1 file is present through `d4b4576e`. No product source, test or configuration was edited.

### Round 2 verification

`git rev-parse HEAD`:

```text
b43375cc292e3eb3181b243c929bf89c7d4ccb28
```

All checks and probes ran at this pinned candidate with a clean tracked tree. The build produced no tracked drift. This Round 2 draft stayed outside the repository until verification finished; the final commit changes this findings file alone.

`npm ci` exited 0. Verbatim output:

```text
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 196 packages, and audited 197 packages in 7s

32 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 6 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @google/genai@2.21.0 (preinstall: echo 'preinstall: no-op')
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts   msgpackr-extract@3.0.4 (install: node-gyp-build-optional-packages)
npm warn install-scripts   opencode-ai@1.18.35 (postinstall: node ./postinstall.mjs)
npm warn install-scripts   protobufjs@7.6.6 (postinstall: node scripts/postinstall)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
```

`npm run lint` exited 0. Verbatim output:

```text
> squeal@0.1.200 lint
> biome check .

Checked 1351 files in 773ms. No fixes applied.
```

`npm run typecheck` exited 0. Verbatim output:

```text
> squeal@0.1.200 typecheck
> tsc --noEmit
```

`npm run build` exited 0. Verbatim output:

```text
> squeal@0.1.200 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.200 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
```

Independent reviewer full run, on the pinned clean candidate:

```sh
flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
```

Exit 0. Verbatim output:

```text
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/424615bd-319a-4e50-8e5e-35af9710fd58

Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/424615bd-319a-4e50-8e5e-35af9710fd58/test/fixtures/scheduler/.tmp/6994aee0-db3a-4e87-a720-ce709175a22e/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/424615bd-319a-4e50-8e5e-35af9710fd58/test/fixtures/scheduler/.tmp/94d1d3bf-9dc5-412c-bc4b-9151a4173f01/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
squeal tests: killing 1 process(es) an earlier run left: 2594926

 Test Files  666 passed | 1 skipped (667)
      Tests  5676 passed | 8 skipped (5684)
   Start at  18:43:18
   Duration  719.91s (tests 98%, import 2%)

    Isolate  667 workers spawned · ~111ms startup each (spawn + environment, per file)
             at least ~18.35s faster with isolate: false — reuses workers across files instead of one per file
```

Both Round 1 full-run failures **did not recur**: `test/harness/opencode-dispose.test.ts:172` and `test/cli/status-wait-edit.test.ts:40` passed in this run. The new leftovers file, both runners' stop cases and the key-format guard also passed. The earlier background-only recorder-fidelity failures did not occur in this independent run. This is one complete independent run; it does not prove those timing-sensitive cases can never fail under another load. Sampled host one-minute load during this run was 13.30.

### Round 2 closure evidence

**B1: closed for the proven failure.** `src/core/daemon/leftovers.ts:32` records non-descendants already in the group as pid/start identities; `src/core/daemon/leftovers.ts:85` excludes them and their current descendants. `test/daemon/leftovers.test.ts:78` exercises a stranger and a child it starts after marks are read, while retaining the leader's own child. Repeated the original fork/setpgid real-daemon probe with the committed Codex bundle. Stop succeeds promptly and leaves the unrelated sibling alive:

```json
{"mode": "group", "daemonPid": 2287454, "siblingPid": 2287460, "stopCode": 0, "elapsedSeconds": 0.31, "stdout": "Squeal daemon stopped for /home/agent/projects/squeal/.ai/cezar/t/424615bd/sq-review-group-p61slpr_\n", "stderr": "", "siblingStillAlive": true}
```

The probe terminated and reaped its own sibling after this observation.

**B2: closed.** `src/core/scheduler/tiers.ts:316` forwards the stop-only signal separately from the existing edit-cancel signal. `src/runners/node-test/adapter-project.ts:170` and `src/runners/pytest/adapter-run.ts:75` pass that stop signal into their low-level runners. The cancellation flags prevent further dequeueing, terminate running groups with the existing grace, and report `end: "completed", failure: null` with only completed files. `src/core/daemon/composite-runner.ts:125` prevents later parts from starting after stop. An edit still does not cancel node:test or pytest (D5).

Read the live cancellation and pre-aborted cases in `test/runners/node-test/run.test.ts:146` and `test/runners/pytest/run/run.test.ts:171`. Repeated the original eight-held-files backlog probe. No release file was created; stop returned without another file starting:

```json
{"mode": "node", "beforeStop": "0 2287771\n", "afterStop": "0 2287771\n", "stopStillRunning": false, "stopCode": 0, "elapsedSeconds": 0.25, "stdout": "Squeal daemon stopped for /home/agent/projects/squeal/.ai/cezar/t/424615bd/sq-review-node-you_nset\n", "stderr": "", "releaseExists": false}
```

A direct node:test boundary probe completed a fast file, then stopped a held file with a third file queued. It retained only the completed fast file and its passing result, with no queued file started. A composite probe stopped in its first part and retained that part's completed file; the corresponding edit-cancel probe ran both parts. Assertions passed (exit 0):

```json
{"probe":"completed-before-stop","end":"completed","failure":null,"completed":[{"project":"unit","path":"test/fast.mjs"}],"outcomes":["pass"],"lastStarted":false}
{"probe":"composite-stop","calls":["a"],"completed":[{"project":"a","path":"test/a.mjs"}]}
{"probe":"composite-edit-cancel","calls":["a","b"],"completed":[{"project":"a","path":"test/a.mjs"},{"project":"b","path":"test/b.mjs"}]}
```

**S1: the asynchronous name-read window is closed; group reuse remains plausible.** `src/core/daemon/leftovers.ts:87` retains each scanned entry and `src/core/daemon/leftovers.ts:92` drops it if its start time changes before the command-line read finishes. Thus the specific scan-to-name pid reuse scenario no longer returns the replacement's command. No forced kernel pid-reuse experiment was performed; this conclusion comes from source inspection, without a new race regression test. The narrower residual below is nonblocking.

### Round 2 blockers

None. Both previously proven failure scenarios passed against the repaired candidate.

### Round 2 should-fix

**R2-S1. Numeric group ownership can outlive the original group: plausible.** `src/core/daemon/leftovers.ts:33`, `src/core/daemon/leftovers.ts:84`.

This is the daemon/group-identity portion of the original S1. Marks retain the numeric group, without an identity or continuity check tying a later scan to the original group. Failure scenario: the original daemon and group disappear after marks are captured; before the first leftover scan (or between scans that did not observe the empty interval), the daemon pid is reused and an unrelated process creates a group with that number. The new group's members satisfy the group-number test, are not in the old foreign set, and keep the same start time during their own command-line reads. Stop can wait on and name them as the old daemon's children. The repaired final start-time check rules out reuse *during* a name read, but not reuse before a fresh scan. This was not reproduced and is not blocking.

Worker-sized follow-up: make the group fallback establish continuity with identities from the original group across scans, retiring it when that continuity cannot be established while retaining token matching; add a controlled process-table regression for original-group disappearance and number reuse. Do not simply disable all group scans when the daemon exits: its genuine orphans still need to be found.

### Round 2 nits

None.

### Round 2 what fits and next-wave inputs

The repair closes both proven stop failures without extending node:test/pytest cancellation to edit supersession. Completed versus unfinished files preserve the scheduler boundary already reviewed in Round 1, and a composite stop starts no later adapter part. Version 0.1.200, key format 11 and the rebuilt bundles remain consistent; the build has no tracked drift. The normal-shutdown and remove conclusions in Round 1 remain applicable; the repair changes neither request routing nor remove's lock checks. No further blocking repair is requested for this slice. Keep the stop-only versus edit signal distinction in any runner follow-up; the group-continuity note is optional work for the coordinator to schedule.
